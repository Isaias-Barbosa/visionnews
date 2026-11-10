import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPool } from '../server/postgres.mjs';

export async function migrate(pool = createPool()) {
 try {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(1738842546)');
   await client.query('CREATE TABLE IF NOT EXISTS visionnews_migrations (name text PRIMARY KEY)');
   const {rows} = await client.query('SELECT name FROM visionnews_migrations');
   const applied = new Set(rows.map(row=>row.name));
   const directory = new URL('../postgres/', import.meta.url);
   for (const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    await client.query(await readFile(new URL(name,directory),'utf8'));
    await client.query('INSERT INTO visionnews_migrations (name) VALUES ($1)',[name]);
   }
   await client.query('COMMIT');
  } catch (error) {
   await client.query('ROLLBACK');
   throw error;
  } finally {
   client.release();
  }
 } finally {
  await pool.end();
 }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 await migrate();
 console.log('Migrações PostgreSQL aplicadas.');
}
