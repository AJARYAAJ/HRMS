import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), `peoplehub-api-${process.pid}.db`);
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `peoplehub-api-uploads-${process.pid}`);
const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { annualTaxNewRegime, computePayslip, workingDaysBetween } = await import('../src/utils.js');

let server;
let base;
const tokens = {};

async function call(role, method, url, body) {
  const res = await fetch(`${base}/api/${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) {
    const r = await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' });
    tokens[role] = r.body.token;
  }
});
after(() => server.close());

test('income tax (new regime FY25-26) follows slabs, rebate and cess', () => {
  assert.equal(annualTaxNewRegime(1200000), 0); // 87A rebate: taxable 11.25L
  assert.equal(annualTaxNewRegime(1275000), 0); // taxable exactly 12L
  // 20L gross → 19.25L taxable: 20k + 40k + 60k + 65k = 1.85L, +4% cess
  assert.equal(annualTaxNewRegime(2000000), 192400);
});

test('payslip applies PF cap, PT and pro-rates for loss of pay', () => {
  const full = computePayslip(1200000, 22, 22);
  assert.equal(full.gross, 100000);
  assert.equal(full.basic, 50000);
  assert.equal(full.pf, 1800); // 12% of capped ₹15,000 basic
  assert.equal(full.pt, 200);
  assert.equal(full.esi, 0);
  const half = computePayslip(1200000, 22, 11);
  assert.equal(half.gross, 50000);
  assert.ok(half.net < full.net);
});

test('working days exclude weekends and holidays', () => {
  assert.equal(workingDaysBetween('2026-10-01', '2026-10-02'), 1); // 2 Oct is Gandhi Jayanti
  assert.equal(workingDaysBetween('2026-10-03', '2026-10-04'), 0); // weekend
});

test('authentication is required and bad credentials are rejected', async () => {
  assert.equal((await call(null, 'GET', 'employees')).status, 401);
  assert.equal((await call(null, 'POST', 'auth/login', { email: 'admin@peoplehub.demo', password: 'nope' })).status, 401);
});

test('employees cannot reach HR-only endpoints or see others\' salary', async () => {
  assert.equal((await call('employee', 'GET', 'payroll/runs')).status, 403);
  assert.equal((await call('employee', 'POST', 'employees', { first_name: 'X', last_name: 'Y', email: 'x@y.z' })).status, 403);
  const other = await call('employee', 'GET', 'employees/3');
  assert.equal(other.status, 200);
  assert.equal(other.body.annual_ctc, undefined);
  assert.equal(other.body.password_hash, undefined);
  const self = await call('employee', 'GET', 'employees/4');
  assert.ok(self.body.annual_ctc > 0);
});

test('leave: balance is enforced, overlap is blocked, approval deducts balance', async () => {
  const types = (await call('employee', 'GET', 'leave/types')).body;
  const co = types.find((t) => t.code === 'CO');
  const tooMuch = await call('employee', 'POST', 'leave/requests', { leave_type_id: co.id, start_date: '2027-02-01', end_date: '2027-02-19', reason: 'x' });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.error, /Insufficient/);

  const cl = types.find((t) => t.code === 'CL');
  const created = await call('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: '2027-02-02', end_date: '2027-02-03', reason: 'trip' });
  assert.equal(created.status, 201);
  assert.equal(created.body.days, 2);
  assert.equal(created.body.status, 'pending');
  const dup = await call('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: '2027-02-03', end_date: '2027-02-03', reason: 'dup' });
  assert.equal(dup.status, 409);

  // Employees cannot approve, even their own request.
  assert.equal((await call('employee', 'PUT', `leave/requests/${created.body.id}/decision`, { status: 'approved' })).status, 403);
  const approved = await call('manager', 'PUT', `leave/requests/${created.body.id}/decision`, { status: 'approved' });
  assert.equal(approved.status, 200);
  const bal = (await call('employee', 'GET', 'leave/balances?year=2027')).body.find((b) => b.code === 'CL');
  assert.equal(bal.used, 2);
});

test('managers only see their own team in scoped data', async () => {
  const regs = (await call('manager', 'GET', 'regularizations')).body;
  const team = (await call('manager', 'GET', 'employees?manager_id=3')).body.map((e) => e.id);
  assert.ok(regs.length > 0);
  assert.ok(regs.every((r) => team.includes(r.employee_id) || r.employee_id === 3));
});

test('payroll run computes payslips and locks once paid', async () => {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const res = await call('hr', 'POST', 'payroll/run', { month });
  assert.equal(res.status, 201);
  // One run per legal entity; together they cover every salaried employee.
  assert.ok(res.body.runs.length >= 1);
  assert.ok(res.body.runs.reduce((a, r) => a + r.employees, 0) > 30);
  for (const r of res.body.runs) {
    assert.ok(r.total_net > 0 && r.total_net < r.total_gross);
    assert.equal((await call('hr', 'POST', `payroll/runs/${r.id}/pay`)).status, 200);
  }
  assert.equal((await call('hr', 'POST', 'payroll/run', { month })).status, 400);
  const future = await call('hr', 'POST', 'payroll/run', { month: '2099-01' });
  assert.equal(future.status, 400);
});

test('hiring a candidate creates an employee with an onboarding checklist', async () => {
  const cand = (await call('hr', 'GET', 'candidates?stage=offer')).body[0];
  const hired = await call('hr', 'POST', `candidates/${cand.id}/hire`, { email: `hire.${Date.now()}@peoplehub.demo` });
  assert.equal(hired.status, 201);
  const tasks = (await call('hr', 'GET', 'onboarding?type=onboarding')).body.filter((t) => t.employee_id === hired.body.employee_id);
  assert.ok(tasks.length >= 5);
});

test('every mutation is written to the audit log', async () => {
  const logs = (await call('admin', 'GET', 'audit-logs?entity=payroll_runs')).body;
  assert.ok(logs.some((l) => l.action === 'run_payroll'));
  assert.equal((await call('employee', 'GET', 'audit-logs')).status, 403);
});

test('login is rate limited after repeated failures for the same email', async () => {
  const bad = { email: 'ratelimit.target@peoplehub.demo', password: 'wrong-password' };
  let last;
  for (let i = 0; i < 11; i++) last = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) });
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /Too many failed sign-in attempts/);
});
