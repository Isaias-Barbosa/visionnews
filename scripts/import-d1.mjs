import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createPool } from '../server/postgres.mjs';

const path=process.argv[2];
if (!path) throw Error('Informe o arquivo SQL exportado do D1.');
const source=new DatabaseSync(':memory:');
source.exec(await readFile(path,'utf8'));
const pool=createPool();
const tables=['news','schedule','recommendations','editorial_accounts'];
try {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE news,schedule,recommendations,editorial_accounts IN SHARE ROW EXCLUSIVE MODE');
  for (const table of tables) {
   const {rowCount}=await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
   if (rowCount) throw Error('O destino já contém conteúdo editorial. Use um banco novo para importar.');
   const {rows:fields}=await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",[table]
   );
   const columns=fields.map(field=>field.column_name);
   if (!columns.length || !columns.every(column=>/^[a-z_]+$/.test(column))) throw Error('Esquema editorial incompatível.');
   const rows=source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
   const placeholders=columns.map((_,index)=>'$'+(index+1)).join(',');
   for (const row of rows) {
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,columns.map(column=>row[column]));
   }
   if (columns.includes('id')) {
    await client.query(`SELECT setval(pg_get_serial_sequence($1,'id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${table}`,[table]);
   }
  }
  await client.query('COMMIT');
  console.log('Conteúdo editorial importado.');
 } catch (error) {
  await client.query('ROLLBACK');
  throw error;
 } finally {
  client.release();
 }
} finally {
 source.close();
 await pool.end();
}
