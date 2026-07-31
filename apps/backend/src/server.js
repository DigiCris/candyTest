import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { getConfig } from './utils/config.js';
import { ensureWalletAccount } from './services/wallet-service.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();

// Addresses are derived from a watch-only account xpub kept in the database.
// Install the configured one if this database does not have it yet.
try {
  const { created } = await ensureWalletAccount(getConfig().wallet);
  if (created) console.log('Installed the configured watch-only account xpub.');
} catch (error) {
  console.error('Could not verify the account xpub:', error.message);
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Candy backend listening on http://0.0.0.0:${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
