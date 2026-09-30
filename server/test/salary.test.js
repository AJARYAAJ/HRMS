import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-salary-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, all } = await import('../src/db.js');
const { computeSalary, loadStructure, cleanComponents } = await import('../src/salary.js');

let server;
let base;
const tokens = {};
async function call(who, method, url, body) {
  const res = await fetch(`${base}/api/${url}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) tokens[role] = (await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
});
after(() => server.close());

const line = (r, code) => r.lines.find((l) => l.code === code)?.amount;

test('standard structure: basic 50% of CTC, HRA 40% of basic, special balances to CTC', () => {
  const s = loadStructure(get("SELECT id FROM salary_structures WHERE name = 'Standard'").id);
  const r = computeSalary(s, 1200000);
  assert.deepEqual([r.basic, r.hra, r.special, r.gross], [50000, 20000, 30000, 100000]);
  assert.deepEqual([r.pf, r.esi, r.pt], [1800, 0, 200]); // PF on the 15,000 wage cap
  assert.equal(r.net, 100000 - 2000);
  const low = computeSalary(s, 240000); // gross 20,000 → ESI applies
  assert.equal(low.esi, 150);
  assert.equal(low.employer.esi, 650);
});

test('CTC structure: employer PF and gratuity come out of CTC; fixed and % components; custom deduction', () => {
  const s = loadStructure(get("SELECT id FROM salary_structures WHERE name LIKE 'CTC incl.%'").id);
  const r = computeSalary(s, 1200000);
  assert.equal(r.employer.pf, 1800);
  assert.equal(r.employer.gratuity, 1924);             // 4.81% of 40,000
  assert.deepEqual([line(r, 'BASIC'), line(r, 'HRA'), line(r, 'CONV'), line(r, 'MED'), line(r, 'LTA')], [40000, 20000, 1600, 1250, 3332]);
  assert.equal(line(r, 'SPECIAL'), 100000 - 1800 - 1924 - 40000 - 20000 - 1600 - 1250 - 3332);
  assert.equal(r.gross + r.employer.pf + r.employer.gratuity, 100000); // CTC fully accounted for
  assert.equal(line(r, 'GHI'), 450);
  assert.equal(r.total_deductions, 1800 + 200 + 450);
  // Half the month on loss of pay: earnings and PF halve, the fixed deduction does not.
  const half = computeSalary(s, 1200000, { workingDays: 22, paidDays: 11 });
  assert.equal(line(half, 'BASIC'), 20000);
  assert.equal(half.pf, 1800); // basic 20,000 still above the cap
  assert.equal(line(half, 'GHI'), 450);
  // Components worth more than the CTC are flagged.
  assert.match(computeSalary(s, 100000).warnings[0], /more than the CTC/);
});

test('component validation', () => {
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  assert.throws(() => cleanComponents([{ name: 'HRA', calc: 'fixed', value: 10 }], err), /Basic component/);
  assert.throws(() => cleanComponents([{ name: 'Basic', code: 'BASIC', calc: 'percent_ctc', value: 50 }, { name: 'A', calc: 'balance' }, { name: 'B', calc: 'balance' }], err), /Only one/);
  assert.throws(() => cleanComponents([{ name: 'Basic', code: 'BASIC', calc: 'percent_ctc', value: 150 }], err), /exceed 100/);
  assert.throws(() => cleanComponents([{ name: 'Basic', code: 'BASIC', calc: 'percent_ctc', value: 50 }, { name: 'PF', calc: 'fixed', value: 1 }], err), /automatically/);
});

test('API: create, preview, assign; payroll payslips carry component lines', async () => {
  assert.equal((await call('employee', 'GET', 'salary/structures')).status, 403);
  const body = {
    name: 'Interns stipend', pf_enabled: 0, esi_enabled: 0, pt_enabled: 1,
    components: [{ name: 'Basic', code: 'BASIC', calc: 'percent_ctc', value: 60 }, { name: 'Internet allowance', code: 'NET', calc: 'fixed', value: 1000 }, { name: 'Special allowance', code: 'SPECIAL', calc: 'balance' }],
  };
  const prev = (await call('hr', 'POST', 'salary/preview', { structure: body, annual_ctc: 360000 })).body;
  assert.deepEqual([prev.basic, prev.pf, prev.gross], [18000, 0, 30000]);
  const created = await call('hr', 'POST', 'salary/structures', body);
  assert.equal(created.status, 201);
  assert.equal(created.body.components.length, 3);
  assert.equal((await call('hr', 'POST', 'salary/structures', body)).status, 409);
  assert.equal((await call('hr', 'POST', `salary/structures/${created.body.id}/assign`, { employee_ids: [4] })).body.updated, 1);
  const mine = (await call('employee', 'GET', 'salary/breakup/4')).body;
  assert.equal(mine.structure, 'Interns stipend');
  assert.ok(mine.monthly.lines.some((l) => l.name === 'Internet allowance'));
  assert.equal(mine.monthly.pf, 0);
  assert.equal((await call('employee', 'GET', 'salary/breakup/3')).status, 403);
  assert.deepEqual(Object.keys((await call('manager', 'GET', 'salary/breakup/4')).body), ['structure']); // no amounts for managers

  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await call('hr', 'POST', 'payroll/run', { month })).status, 201);
  const slip = get('SELECT id, structure_name FROM payslips WHERE employee_id = 4 AND month = ?', month);
  assert.equal(slip.structure_name, 'Interns stipend');
  const view = (await call('employee', 'GET', `payroll/payslips/${slip.id}`)).body;
  assert.ok(view.lines.some((l) => l.code === 'NET' && l.type === 'earning'));
  const sales = get("SELECT e.id FROM employees e JOIN departments d ON d.id = e.department_id WHERE d.name = 'Sales' AND e.status = 'active' AND e.annual_ctc > 0 LIMIT 1").id;
  const salesLines = all("SELECT l.code, l.type FROM payslip_lines l JOIN payslips p ON p.id = l.payslip_id WHERE p.employee_id = ? AND p.month = ?", sales, month);
  assert.ok(salesLines.some((l) => l.code === 'GRATUITY' && l.type === 'employer'));
  assert.ok(salesLines.some((l) => l.code === 'GHI' && l.type === 'deduction'));

  const std = get("SELECT id FROM salary_structures WHERE name = 'Standard'").id;
  assert.equal((await call('hr', 'DELETE', `salary/structures/${std}`)).status, 409); // default
});
