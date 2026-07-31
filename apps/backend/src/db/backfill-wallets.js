/**
 * One-time backfill for databases created before addresses were derived from a
 * single watch-only account xpub (when each user still had their own seed phrase).
 *
 * Re-derives stale addresses from the account xpub in `app_settings`. Balances,
 * allowances, events and games key off user UUIDs, so nothing else is touched and
 * no history is lost.
 *
 * Idempotent: users whose address already matches the xpub at their recorded index
 * are left exactly as they are, so re-running changes nothing. Run with:
 *   docker compose exec backend node src/db/backfill-wallets.js
 */
import { pool, withTransaction } from './pool.js';
import { getConfig } from '../utils/config.js';
import { normalizeUsername } from '../services/user-service.js';
import { getWalletAccount } from '../services/wallet-service.js';
import { deriveWalletFromXpub } from '../utils/wallet.js';

/**
 * Demo users are all created inside one bootstrap transaction, so `created_at`
 * cannot order them. Fall back to the order they appear in the config file — the
 * order a fresh bootstrap would have assigned indices in — so a backfilled
 * database ends up identical to a freshly seeded one.
 */
function rankByConfigOrder() {
  const order = new Map();
  getConfig().users.forEach((user, index) => order.set(normalizeUsername(user.username), index));
  return (user) => order.get(user.username_normalized) ?? Number.MAX_SAFE_INTEGER;
}

async function backfill() {
  const changed = await withTransaction(async (client) => {
    const account = await getWalletAccount(client);
    const rank = rankByConfigOrder();
    const { rows: users } = await client.query(
      'SELECT id, username, username_normalized, address, address_index, created_at FROM users',
    );

    const derive = (index) => deriveWalletFromXpub(account.xpub, index, account.accountPath);

    // Anything already consistent with the xpub keeps its address and index.
    const taken = new Set();
    const stale = [];
    for (const user of users) {
      if (user.address === derive(user.address_index).address) {
        taken.add(user.address_index);
        continue;
      }
      stale.push(user);
    }

    stale.sort((left, right) => {
      const delta = rank(left) - rank(right);
      if (delta !== 0) return delta;
      if (left.created_at < right.created_at) return -1;
      if (left.created_at > right.created_at) return 1;
      return left.username.localeCompare(right.username);
    });

    // Reassigning indices can permute addresses between rows, so park every stale
    // row on a unique placeholder first. Otherwise writing user A's new address
    // trips the uniqueness constraint while user B still holds it.
    for (const user of stale) {
      await client.query('UPDATE users SET address_normalized = $2 WHERE id = $1', [user.id, `pending:${user.id}`]);
    }

    const updates = [];
    let next = 0;
    for (const user of stale) {
      while (taken.has(next)) next += 1;
      const wallet = derive(next);
      taken.add(next);
      await client.query(
        `UPDATE users SET address = $2, address_normalized = $3, wallet_xpub = $4,
           account_path = $5, address_path = $6, address_index = $7
         WHERE id = $1`,
        [
          user.id,
          wallet.address,
          wallet.address.toLowerCase(),
          wallet.xpub,
          wallet.accountPath,
          wallet.addressPath,
          wallet.addressIndex,
        ],
      );
      updates.push({ username: user.username, from: user.address, to: wallet.address, index: next });
    }

    // Keep the sequence past every index now in use.
    const highest = taken.size ? Math.max(...taken) : -1;
    await client.query("SELECT setval('wallet_address_index_seq', $1::bigint, false)", [highest + 1]);
    return updates;
  }, { isolationLevel: 'SERIALIZABLE' });

  if (!changed.length) {
    console.log('Every user address already matches the account xpub. Nothing to do.');
    return;
  }
  for (const row of changed) {
    console.log(`${row.username}: ${row.from} -> ${row.to} (index ${row.index})`);
  }
  console.log(`Re-derived ${changed.length} address(es) from the account xpub.`);
}

backfill()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
