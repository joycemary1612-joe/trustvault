// Database access. In production DATABASE_URL points at PostgreSQL (Neon).
// Without it (local dev and tests) we run real Postgres in-process via PGlite,
// so nobody needs to install a database to try the project.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

const schemaPath = new URL('./schema.sql', import.meta.url);

export async function createDb(databaseUrl = process.env.DATABASE_URL) {
  let db;
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    db = {
      query: (sql, params) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (s, p) => client.query(s, p) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const lite = new PGlite(process.env.PGLITE_DIR || undefined);
    db = {
      query: (sql, params) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
      close: () => lite.close(),
    };
  }
  await db.exec(await readFile(schemaPath, 'utf8'));
  return db;
}
