import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-exports-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get } = await import('../src/db.js');

let server;
let base;
const tokens = {};

async function call(who, method, url, body) {
  const res = await fetch(`${base}/api/${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

/** Reads one entry out of a ZIP produced by buildXlsx (deflate, sizes in the local header). */
function unzipEntry(buf, name) {
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const entry = buf.subarray(o + 30, o + 30 + nameLen).toString();
    const start = o + 30 + nameLen + extra;
    if (entry === name) return zlib.inflateRawSync(buf.subarray(start, start + size)).toString();
    o = start + size;
  }
  return null;
}

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) {
    tokens[role] = (await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
  }
});
after(() => server.close());

test('exports: catalogue, permissions and validation', async () => {
  assert.equal((await call('manager', 'GET', 'exports/modules')).status, 403);
  assert.equal((await call('employee', 'POST', 'exports', { module: 'employees' })).status, 403);
  const mods = (await call('hr', 'GET', 'exports/modules')).body;
  assert.ok(mods.length >= 17);
  const emp = mods.find((m) => m.key === 'employees');
  assert.ok(emp.filters.department && emp.filters.status.includes('active'));
  assert.equal((await call('hr', 'POST', 'exports', { module: 'nope' })).status, 400);
  assert.equal((await call('hr', 'POST', 'exports', { module: 'employees', format: 'pdf' })).status, 400);
  assert.equal((await call('hr', 'POST', 'exports', { module: 'employees', columns: ['bogus'] })).status, 400);
  assert.equal((await call('hr', 'POST', 'exports', { module: 'employees', filters: { status: 'x' } })).status, 400);
});

test('exports: CSV with BOM, chosen columns and filters', async () => {
  const dept = get("SELECT id FROM departments WHERE name = 'Engineering'");
  const expected = get("SELECT COUNT(*) AS n FROM employees WHERE department_id = ? AND status = 'active'", dept.id).n;
  const r = await call('hr', 'POST', 'exports', { module: 'employees', format: 'csv', columns: ['emp_code', 'name', 'department'], filters: { department_id: dept.id, status: 'active' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /employees-\d{4}-\d{2}-\d{2}\.csv/);
  assert.equal(Number(r.headers.get('x-row-count')), expected);
  const text = r.body.toString('utf8');
  assert.equal(text.charCodeAt(0), 0xfeff);
  const lines = text.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'Employee ID,Name,Department');
  assert.equal(lines.length, expected + 1);
  assert.ok(lines.slice(1).every((l) => l.endsWith(',Engineering')));
});

test('exports: XLSX is a valid workbook and the job is logged', async () => {
  const before = get('SELECT COUNT(*) AS n FROM export_jobs').n;
  const r = await call('admin', 'POST', 'exports', { module: 'invoices', format: 'xlsx' });
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 2).toString(), 'PK');
  const sheet = unzipEntry(r.body, 'xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('<sheetData>') && sheet.includes('state="frozen"'));
  assert.ok(unzipEntry(r.body, 'xl/workbook.xml').includes('name="Invoices"'));
  const rows = Number(r.headers.get('x-row-count'));
  assert.equal((sheet.match(/<row /g) || []).length, rows + 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM export_jobs').n, before + 1);
  const hist = (await call('hr', 'GET', 'exports/history')).body;
  assert.equal(hist[0].module, 'invoices');
  assert.equal(hist[0].row_count, rows);
  assert.equal(hist[0].module_label, 'Invoices');
  assert.ok(get("SELECT id FROM audit_logs WHERE action = 'export' AND entity = 'invoices'"));
});

test('exports: every dataset exports in both formats', async () => {
  const mods = (await call('hr', 'GET', 'exports/modules')).body;
  for (const m of mods) {
    for (const format of ['csv', 'xlsx']) {
      const r = await call('hr', 'POST', 'exports', { module: m.key, format, columns: m.columns.map((c) => c.key) });
      assert.equal(r.status, 200, `${m.key} ${format}`);
    }
  }
});

test('exports: CSV neutralises spreadsheet formulas', async () => {
  const { buildCsv } = await import('../src/xlsx.js');
  const csv = buildCsv(['A', 'B'], [['=HYPERLINK("x")', -5], ['a,b', null]]);
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[1], `"'=HYPERLINK(""x"")",-5`);
  assert.equal(lines[2], '"a,b",');
});

test('analytics: money only for HR, employees blocked, period respected', async () => {
  assert.equal((await call('employee', 'GET', 'analytics')).status, 403);
  const hr = (await call('hr', 'GET', 'analytics?months=12')).body;
  assert.equal(hr.months, 12);
  assert.equal(hr.series.length, 12);
  assert.ok(hr.kpis.headcount > 0);
  assert.ok('revenue' in hr.kpis && 'payroll_cost' in hr.series[0]);
  assert.equal(hr.pipeline.length, 6);
  assert.ok(hr.by_department.length > 0);
  const mgr = (await call('manager', 'GET', 'analytics?months=99')).body;
  assert.equal(mgr.months, 6);
  assert.equal(mgr.series.length, 6);
  assert.ok(!('revenue' in mgr.kpis) && !('revenue' in mgr.series[0]));
  assert.equal(mgr.kpis.headcount, hr.kpis.headcount);
});
