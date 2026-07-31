import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './pool.js';

const sqlDirectory = resolve(process.cwd(), 'sql');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(sqlDirectory)).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (existing.rowCount) continue;
    const sql = await readFile(resolve(sqlDirectory, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`Applied migration ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
