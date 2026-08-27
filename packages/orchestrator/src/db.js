import pg from 'pg';

let pool;

export function initDb(url) {
  pool = new pg.Pool({ connectionString: url });
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database not initialised');
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}