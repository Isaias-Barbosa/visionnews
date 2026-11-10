import pg from 'pg';

export function createPool() {
 if (!process.env.DATABASE_URL) throw Error('DATABASE_URL precisa ser configurada.');
 return new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 10000,
  allowExitOnIdle: true
 });
}

// Editorial queries use D1's small statement interface. This adapter keeps
// parameter binding and write counts while reusing the same Worker handlers.
export function postgresDatabase(pool) {
 return {
  prepare(statement) {
   let parameters = [];
   let index = 0;
   const sql = statement.replace(/\?/g, () => '$' + ++index);
   const query = () => pool.query(sql, parameters);
   return {
    bind(...values) { parameters = values; return this; },
    async first() { return (await query()).rows[0] ?? null; },
    async all() { return {results:(await query()).rows}; },
    async run() { return {meta:{changes:(await query()).rowCount}}; }
   };
  }
 };
}
