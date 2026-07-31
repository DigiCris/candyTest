import { withTransaction } from '../db/pool.js';
import { getConfig } from '../utils/config.js';
import { humanToRaw } from '../utils/amounts.js';
import { registerUser } from './user-service.js';
import { setOnlyOwnerOrAllowed } from './settings-service.js';
import { setWalletAccount } from './wallet-service.js';
import { candyToken } from './token-service.js';

export async function seedDemoIfEmpty() {
  const config = getConfig();
  return withTransaction(async (client) => {
    const count = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (count.rows[0].count > 0) return { initialized: false, reason: 'already_initialized' };

    await client.query(
      `INSERT INTO token_metadata(id, name, symbol, fallback_symbol, decimals, total_supply)
       VALUES (1,$1,$2,$3,$4,0)
       ON CONFLICT (id) DO UPDATE
       SET name=EXCLUDED.name, symbol=EXCLUDED.symbol, fallback_symbol=EXCLUDED.fallback_symbol,
           decimals=EXCLUDED.decimals, total_supply=0`,
      [config.token.name, config.token.symbol, config.token.fallbackSymbol, config.token.decimals],
    );
    await setOnlyOwnerOrAllowed(config.token.onlyOwnerOrAllowed, client);
    // Store the watch-only account xpub before creating anyone: every address is
    // derived from it, in registration order, starting at index 0.
    await setWalletAccount({
      xpub: config.wallet.accountXpub,
      accountPath: config.wallet.accountPath,
    }, client);

    const created = [];
    for (const entry of config.users) {
      const registered = await registerUser(entry, client);
      created.push({ ...registered.user, initialCandy: entry.initialCandy, password: entry.password });
    }

    const admin = created.find((user) => user.role === 'admin');
    for (const user of created) {
      const raw = humanToRaw(user.initialCandy, config.token.decimals);
      if (raw > 0n) await candyToken.mint(admin, user.address, raw.toString(), { client });
    }

    return {
      initialized: true,
      users: created.map(({ password, initialCandy, ...user }) => user),
    };
  }, { isolationLevel: 'SERIALIZABLE' });
}
