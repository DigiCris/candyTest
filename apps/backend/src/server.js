import { createApp } from './app.js';
import { pool } from './db/pool.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();
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
