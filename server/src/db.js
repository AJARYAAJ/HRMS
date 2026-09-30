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
  addColumn('employees', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL');
  addColumn('employees', 'probation_end_date', 'TEXT');
  addColumn('employees', 'confirmation_status', "TEXT DEFAULT 'confirmed'");
  addColumn('employees', 'tax_regime', "TEXT DEFAULT 'new'");
  addColumn('agent_devices', 'agent_version', 'TEXT');
  addColumn('agent_devices', 'hostname', 'TEXT');
  addColumn('agent_devices', 'os', 'TEXT');
  addColumn('agent_devices', 'paused_until', 'TEXT');
  // Plans & policies assigned to each employee (NULL = the default plan; holiday list falls back to the location's).
  for (const col of ['leave_plan_id', 'holiday_list_id', 'weekly_off_policy_id', 'attendance_policy_id', 'expense_policy_id']) {
    addColumn('employees', col, 'INTEGER');
  }
  addColumn('locations', 'holiday_list_id', 'INTEGER');
  addColumn('holidays', 'list_id', 'INTEGER');     // NULL = the default holiday list
  addColumn('leave_balances', 'adjustment', 'REAL NOT NULL DEFAULT 0'); // comp-offs, penalties, manual corrections
  addColumn('employees', 'photo_file', 'TEXT');
  addColumn('assets', 'warranty_until', 'TEXT');
  addColumn('assets', 'condition', "TEXT DEFAULT 'good'");
  addColumn('assets', 'notes', 'TEXT');
  addColumn('assets', 'assigned_on', 'TEXT');
  addColumn('assets', 'acknowledged_at', 'TEXT');
  addColumn('fnf_settlements', 'asset_recovery', 'REAL DEFAULT 0');
  addColumn('employees', 'photo_type', 'TEXT');
  addColumn('leave_balances', 'carried', 'REAL NOT NULL DEFAULT 0');    // carried forward from the previous year
  addColumn('expenses', 'distance_km', 'REAL');
  addColumn('expenses', 'days', 'REAL');
  addColumn('expenses', 'receipt_required', 'INTEGER DEFAULT 0');
  addColumn('attendance', 'penalty_applied', 'INTEGER DEFAULT 0');
  // Professional services: projects belong to clients and carry billing details.
  addColumn('projects', 'client_id', 'INTEGER REFERENCES clients(id) ON DELETE SET NULL');
  addColumn('projects', 'code', 'TEXT');
  addColumn('projects', 'billing_type', "TEXT DEFAULT 'time_materials'");
  addColumn('projects', 'manager_id', 'INTEGER');
  addColumn('projects', 'budget_amount', 'REAL');
  addColumn('projects', 'description', 'TEXT');
  addColumn('projects', 'health', "TEXT DEFAULT 'on_track'");
  addColumn('projects', 'opportunity_id', 'INTEGER');
  addColumn('timesheets', 'invoice_id', 'INTEGER');
  addColumn('locations', 'latitude', 'REAL');
  addColumn('locations', 'longitude', 'REAL');
  addColumn('locations', 'radius_m', 'INTEGER DEFAULT 300');
  addColumn('attendance', 'latitude', 'REAL');
  addColumn('attendance', 'longitude', 'REAL');
  addColumn('attendance', 'geo_status', 'TEXT');
  addColumn('attendance', 'overtime_mins', 'INTEGER DEFAULT 0');
  addColumn('payslips', 'company_id', 'INTEGER');
  addColumn('payslips', 'reimbursement', 'REAL DEFAULT 0');
  addColumn('payslips', 'loan_deduction', 'REAL DEFAULT 0');
  addColumn('payslips', 'tax_regime', "TEXT DEFAULT 'new'");
  addColumn('expenses', 'payslip_id', 'INTEGER');
  addColumn('documents', 'requires_ack', 'INTEGER DEFAULT 0');
  addColumn('surveys', 'type', "TEXT DEFAULT 'poll'");
  addColumn('email_outbox', 'attachments', 'TEXT');

  // Databases created before multi-company support: give existing people a default legal entity.
  if (get('SELECT id FROM employees LIMIT 1') && !get('SELECT id FROM companies LIMIT 1')) {
    const setting = (k, d) => get('SELECT value FROM settings WHERE key = ?', k)?.value || d;
    run('INSERT INTO companies (name, legal_name, pan, tan, address) VALUES (?, ?, ?, ?, ?)',
      setting('company_short', 'Main company'), setting('company_name', 'Main company'), setting('company_pan', null), setting('company_tan', null), setting('company_address', null));
  }
  const defaultCompany = get('SELECT id FROM companies ORDER BY id LIMIT 1')?.id;
  if (defaultCompany) run('UPDATE employees SET company_id = ? WHERE company_id IS NULL', defaultCompany);

  // payroll_runs used to allow one run per month; it is now one run per month per company.
  const runsSql = get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payroll_runs'")?.sql || '';
  if (!runsSql.includes('company_id')) {
    db.exec('PRAGMA foreign_keys = OFF');
    tx(() => {
      db.exec(`CREATE TABLE payroll_runs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, month TEXT NOT NULL, company_id INTEGER,
        status TEXT NOT NULL DEFAULT 'processed', employees INTEGER DEFAULT 0, total_gross REAL DEFAULT 0,
        total_deductions REAL DEFAULT 0, total_net REAL DEFAULT 0, processed_by INTEGER,
        processed_at TEXT DEFAULT (datetime('now')), paid_at TEXT, UNIQUE(month, company_id))`);
      run(`INSERT INTO payroll_runs_new (id, month, company_id, status, employees, total_gross, total_deductions, total_net, processed_by, processed_at, paid_at)
           SELECT id, month, ?, status, employees, total_gross, total_deductions, total_net, processed_by, processed_at, paid_at FROM payroll_runs`, defaultCompany ?? null);
      db.exec('DROP TABLE payroll_runs');
      db.exec('ALTER TABLE payroll_runs_new RENAME TO payroll_runs');
      if (defaultCompany) run('UPDATE payslips SET company_id = ? WHERE company_id IS NULL', defaultCompany);
    });
    db.exec('PRAGMA foreign_keys = ON');
  }
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
