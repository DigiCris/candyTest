import { pool } from '../db/pool.js';

export async function getOnlyOwnerOrAllowed(client = pool) {
  const result = await client.query("SELECT value FROM app_settings WHERE key = 'onlyOwnerOrAllowed'");
  return Boolean(result.rows[0]?.value?.enabled);
}

export async function setOnlyOwnerOrAllowed(enabled, client = pool) {
  await client.query(
    `INSERT INTO app_settings(key, value, updated_at)
     VALUES ('onlyOwnerOrAllowed', jsonb_build_object('enabled', $1::boolean), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [Boolean(enabled)],
  );
  return Boolean(enabled);
}
