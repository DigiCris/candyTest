import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { DEFAULT_ACCOUNT_PATH, deriveWalletFromXpub, isValidXpub } from '../utils/wallet.js';

const SETTING_KEY = 'walletAccount';

/**
 * The account xpub lives in the database. It is watch-only public data: the
 * matching seed stays in an offline cold wallet that never touches this service,
 * so nothing here can sign or move funds. Derived addresses only identify users
 * for transfers — Candy balances live in `balances` and every authorization is
 * resolved from the user's session, never from a wallet signature.
 */
export async function getWalletAccount(client = pool) {
  const result = await client.query('SELECT value FROM app_settings WHERE key = $1', [SETTING_KEY]);
  const value = result.rows[0]?.value;
  if (!value?.xpub) {
    throw new AppError(500, 'WALLET_XPUB_MISSING', 'No account xpub is configured. Seed the demo or set one before registering users.');
  }
  return { xpub: value.xpub, accountPath: value.accountPath || DEFAULT_ACCOUNT_PATH };
}

/**
 * Installs the configured xpub only if the database has none yet. Runs at boot so
 * an already-seeded database can never be left unable to derive addresses, while
 * an xpub rotated directly in the database still wins over the config file.
 */
export async function ensureWalletAccount({ accountXpub, accountPath }, client = pool) {
  const existing = await client.query('SELECT value FROM app_settings WHERE key = $1', [SETTING_KEY]);
  if (existing.rows[0]?.value?.xpub) return { created: false };
  await setWalletAccount({ xpub: accountXpub, accountPath }, client);
  return { created: true };
}

export async function setWalletAccount({ xpub, accountPath = DEFAULT_ACCOUNT_PATH }, client = pool) {
  if (!isValidXpub(xpub)) {
    throw new AppError(400, 'INVALID_XPUB', 'The configured account xpub is not a valid BIP32 extended public key.');
  }
  await client.query(
    `INSERT INTO app_settings(key, value, updated_at)
     VALUES ($1, jsonb_build_object('xpub', $2::text, 'accountPath', $3::text), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTING_KEY, String(xpub), String(accountPath)],
  );
  return { xpub: String(xpub), accountPath: String(accountPath) };
}

/**
 * Claims the next address index. Backed by a sequence so concurrent registrations
 * can never be handed the same index (and so an index is never reused).
 */
export async function allocateWallet(client = pool) {
  const account = await getWalletAccount(client);
  const result = await client.query("SELECT nextval('wallet_address_index_seq')::int AS index");
  return deriveWalletFromXpub(account.xpub, result.rows[0].index, account.accountPath);
}
