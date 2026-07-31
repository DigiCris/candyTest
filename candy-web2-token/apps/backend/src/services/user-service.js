import { pool, withTransaction } from '../db/pool.js';
import { AppError, assert } from '../utils/errors.js';
import { generateMnemonic, deriveWalletFromMnemonic } from '../utils/wallet.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

export function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

export function validateUsername(username) {
  const value = String(username).trim();
  assert(/^[A-Za-z0-9_]{3,32}$/.test(value), 400, 'INVALID_USERNAME', 'Username must contain 3-32 letters, numbers, or underscores.');
  return value;
}

export function validatePassword(password) {
  assert(typeof password === 'string' && password.length >= 8 && password.length <= 200, 400, 'INVALID_PASSWORD', 'Password must contain between 8 and 200 characters.');
  return password;
}

export function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    address: row.address,
    xpub: row.wallet_xpub,
    accountPath: row.account_path,
    addressPath: row.address_path,
    createdAt: row.created_at,
  };
}

export async function getUserById(userId, client = pool) {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}

export async function getUserByIdentifier(identifier, client = pool, { required = true } = {}) {
  const normalized = String(identifier || '').trim();
  let result;
  if (/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    result = await client.query('SELECT * FROM users WHERE address_normalized = $1', [normalized.toLowerCase()]);
  } else {
    result = await client.query('SELECT * FROM users WHERE username_normalized = $1', [normalizeUsername(normalized)]);
  }
  const user = result.rows[0] || null;
  if (!user && required) throw new AppError(404, 'USER_NOT_FOUND', `No user exists for identifier "${normalized}".`);
  return user;
}

export async function registerUser({ username, password, role = 'user', mnemonic }, clientOverride) {
  const cleanUsername = validateUsername(username);
  const cleanPassword = validatePassword(password);
  assert(['admin', 'user', 'game_engine'].includes(role), 400, 'INVALID_ROLE', 'Invalid user role.');
  const recoveryPhrase = mnemonic || generateMnemonic();
  const wallet = deriveWalletFromMnemonic(recoveryPhrase, 0);
  const passwordHash = await hashPassword(cleanPassword);

  const create = async (client) => {
    try {
      const inserted = await client.query(
        `INSERT INTO users(
          username, username_normalized, password_hash, role, address, address_normalized,
          wallet_xpub, account_path, address_path, address_index
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
        [
          cleanUsername,
          normalizeUsername(cleanUsername),
          passwordHash,
          role,
          wallet.address,
          wallet.address.toLowerCase(),
          wallet.xpub,
          wallet.accountPath,
          wallet.addressPath,
          wallet.addressIndex,
        ],
      );
      await client.query('INSERT INTO balances(user_id, amount) VALUES ($1, 0)', [inserted.rows[0].id]);
      return inserted.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'USER_EXISTS', 'The username or derived address is already registered.');
      }
      throw error;
    }
  };

  const row = clientOverride ? await create(clientOverride) : await withTransaction(create);
  return { user: serializeUser(row), recoveryPhrase };
}

export async function authenticateUser(username, password) {
  const result = await pool.query('SELECT * FROM users WHERE username_normalized = $1', [normalizeUsername(username)]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(String(password), user.password_hash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Invalid username or password.');
  }
  return serializeUser(user);
}
