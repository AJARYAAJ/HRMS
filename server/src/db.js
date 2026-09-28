import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hrms.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  // Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to existing databases.
  const addColumn = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn('employees', 'email_notifications', 'INTEGER NOT NULL DEFAULT 1');
}

export function resetDb() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.exec('PRAGMA foreign_keys = ON');
  migrate();
}

// node:sqlite rejects undefined and booleans, so normalise every bound value.
const clean = (v) => (v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const bind = (params) =>
  params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])
    ? [Object.fromEntries(Object.entries(params[0]).map(([k, v]) => [k, clean(v)]))]
    : params.map(clean);

export const all = (sql, ...params) => db.prepare(sql).all(...bind(params));
export const get = (sql, ...params) => db.prepare(sql).get(...bind(params));
export const run = (sql, ...params) => db.prepare(sql).run(...bind(params));

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function insert(table, data) {
  const keys = Object.keys(data);
  const info = run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => ':' + k).join(',')})`,
    data,
  );
  return Number(info.lastInsertRowid);
}

export function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`, { ...data, __id: id });
}
