import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-policies-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, all, run } = await import('../src/db.js');
const { holidaySet } = await import('../src/utils.js');
const { entitlement, isWeeklyOff } = await import('../src/policies.js');

let server;
let base;
const tokens = {};
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return fmt(d); };
const NEXT_YEAR = new Date().getFullYear() + 1;
/** The n-th given weekday (0=Sun) of a month. */
const nthWeekday = (year, month, weekday, n) => {
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (n - 1));
  return fmt(d);
};
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return fmt(d).slice(0, 7); };

async function login(key, email) {
  tokens[key] = (await call(null, 'POST', 'auth/login', { email, password: 'Password@123' })).body.token;
}
async function call(who, method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}/api/${url}`, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : null };
}

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) await login(role, `${role}@peoplehub.demo`);
});
after(() => server.close());

test('entitlement: yearly pro-rating for joiners and monthly accrual', () => {
  const yearly = { accrual: 'yearly', annual_quota: 12 };
  const monthly = { accrual: 'monthly', annual_quota: 12 };
  assert.equal(entitlement(yearly, '2020-01-01', 2026, '2026-09-30'), 12);
  assert.equal(entitlement(yearly, '2026-07-10', 2026, '2026-09-30'), 6);   // July–December
  assert.equal(entitlement(yearly, '2026-07-20', 2026, '2026-09-30'), 5);   // joined after the 15th: August onwards
  assert.equal(entitlement(yearly, '2027-02-01', 2026, '2026-09-30'), 0);
  assert.equal(entitlement(monthly, '2020-01-01', 2026, '2026-09-30'), 9);  // January–September credited
  assert.equal(entitlement(monthly, '2026-03-20', 2026, '2026-09-30'), 6);  // April–September
  assert.equal(entitlement(monthly, '2020-01-01', 2025, '2026-09-30'), 12);
  assert.equal(entitlement({ accrual: 'none', annual_quota: 5 }, '2020-01-01', 2026, '2026-09-30'), 0);
});

test('weekly-off patterns: all days and nth weeks of the month', () => {
  const alt = { 0: 'all', 6: '2,4' };
  assert.equal(isWeeklyOff(new Date(2026, 9, 4), alt), true);    // Sunday
  assert.equal(isWeeklyOff(new Date(2026, 9, 3), alt), false);   // 1st Saturday of Oct 2026 works
  assert.equal(isWeeklyOff(new Date(2026, 9, 10), alt), true);   // 2nd Saturday off
  assert.equal(isWeeklyOff(new Date(2026, 9, 17), alt), false);  // 3rd Saturday works
  assert.equal(isWeeklyOff(new Date(2026, 9, 5)), false);         // Monday under the default
});

test('policy admin: permissions, validation, copy, default and delete rules', async () => {
  assert.equal((await call('employee', 'GET', 'policies/leave')).status, 403);
  assert.equal((await call('manager', 'POST', 'policies/assign', { kind: 'leave', employee_ids: [4] })).status, 403);
  const plans = (await call('hr', 'GET', 'policies/leave')).body;
  const std = plans.find((p) => p.is_default);
  assert.equal(std.name, 'Standard leave plan');
  assert.ok(std.rules.length >= 6 && std.effective > std.assigned);
  assert.equal((await call('hr', 'POST', 'policies/leave', { name: 'standard LEAVE plan' })).status, 409);
  const copy = await call('hr', 'POST', 'policies/leave', { name: 'Sales leave plan', copy_from: std.id });
  assert.equal(copy.status, 201);
  assert.equal(copy.body.rules.length, std.rules.length);
  assert.equal(copy.body.is_default, false);
  assert.equal((await call('hr', 'POST', 'policies/weekly-off', { name: 'Four days', pattern: { 0: 'all', 1: 'all', 5: 'all', 6: 'all' } })).status, 400);
  assert.equal((await call('hr', 'POST', 'policies/attendance', { name: 'Nothing', allow_web: 0, allow_remote: 0, allow_field: 0 })).status, 400);
  assert.equal((await call('hr', 'POST', 'policies/expense/999/categories', { name: 'X' })).status, 404);

  await call('hr', 'POST', `policies/leave/${copy.body.id}/default`);
  assert.equal((await call('hr', 'DELETE', `policies/leave/${copy.body.id}`)).status, 409);
  await call('hr', 'POST', `policies/leave/${std.id}/default`);
  assert.equal((await call('hr', 'DELETE', `policies/leave/${copy.body.id}`)).status, 200);
  assert.equal((await call('hr', 'GET', 'policies/leave')).body.find((p) => p.is_default).id, std.id);

  // A new leave type joins the default plan so employees can use it straight away.
  const lt = await call('hr', 'POST', 'leave/types', { name: 'Bereavement Leave', code: 'BRV', annual_quota: 3, paid: 1 });
  assert.equal(lt.status, 201);
  const rule = (await call('hr', 'GET', 'policies/leave')).body.find((p) => p.is_default).rules.find((r) => r.code === 'BRV');
  assert.deepEqual([rule.annual_quota, rule.accrual], [3, 'yearly']);
  assert.equal((await call('employee', 'GET', 'leave/balances')).body.find((b) => b.code === 'BRV').available, 3);
});

test('leave plan rules: gender, consecutive days, notice, sandwich, probation and plan membership', async () => {
  const mine = (await call('employee', 'GET', 'leave/balances')).body;
  assert.ok(mine.some((b) => b.code === 'ML') && !mine.some((b) => b.code === 'PL'));
  assert.equal(mine.find((b) => b.code === 'EL').rule.sandwich, true);
  const his = (await call('manager', 'GET', 'leave/balances')).body;
  assert.ok(his.some((b) => b.code === 'PL') && !his.some((b) => b.code === 'ML'));

  const type = (code) => get('SELECT id FROM leave_types WHERE code = ?', code).id;
  const mon = nthWeekday(NEXT_YEAR, 3, 1, 2);
  const tooLong = await call('employee', 'POST', 'leave/requests', { leave_type_id: type('CL'), start_date: mon, end_date: addDays(mon, 3), reason: 'Trip' });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /at most 3 consecutive/);

  // Earned leave needs a week's notice…
  let soon = addDays(today(), 2);
  const off = holidaySet(3);
  while ([0, 6].includes(new Date(`${soon}T00:00:00`).getDay()) || off.has(soon)) soon = addDays(soon, 1);
  const short = await call('manager', 'POST', 'leave/requests', { leave_type_id: type('EL'), start_date: soon, end_date: soon, reason: 'x' });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /at least 7 day/);
  // …and the sandwich rule counts the weekend between Friday and Monday.
  const fri = nthWeekday(NEXT_YEAR, 3, 5, 3);
  const sandwich = await call('manager', 'POST', 'leave/requests', { leave_type_id: type('EL'), start_date: fri, end_date: addDays(fri, 3), reason: 'Long weekend' });
  assert.equal(sandwich.status, 201);
  assert.equal(sandwich.body.days, 4);
  // Casual leave has no sandwich rule: Friday + Monday is two days.
  const cl = await call('manager', 'POST', 'leave/requests', { leave_type_id: type('CL'), start_date: addDays(fri, 7), end_date: addDays(fri, 10), reason: 'x' });
  assert.equal(cl.body.days, 2);

  const probationer = get("SELECT email FROM employees WHERE confirmation_status != 'confirmed' AND probation_end_date > ? AND status = 'active' AND leave_plan_id IS NULL", today());
  await login('probation', probationer.email);
  const el = await call('probation', 'POST', 'leave/requests', { leave_type_id: type('EL'), start_date: addDays(fri, 21), end_date: addDays(fri, 21), reason: 'x' });
  assert.equal(el.status, 400);
  assert.match(el.body.error, /probation/);

  const intern = get("SELECT id, email FROM employees WHERE leave_plan_id = (SELECT id FROM leave_plans WHERE name = 'Interns & contract staff') AND status = 'active'");
  await login('intern', intern.email);
  const notInPlan = await call('intern', 'POST', 'leave/requests', { leave_type_id: type('EL'), start_date: addDays(fri, 28), end_date: addDays(fri, 28), reason: 'x' });
  assert.equal(notInPlan.status, 400);
  assert.match(notInPlan.body.error, /not part of your leave plan/);
  const ib = (await call('intern', 'GET', 'leave/balances')).body;
  assert.equal(ib.find((b) => b.code === 'CL').rule.accrual, 'monthly');
  assert.ok(!ib.some((b) => b.code === 'EL' && b.applicable));
});

test('assigning a leave plan recalculates balances; resetting returns to the default', async () => {
  const internPlan = get("SELECT id FROM leave_plans WHERE name = 'Interns & contract staff'").id;
  const res = await call('hr', 'POST', 'policies/assign', { kind: 'leave', policy_id: internPlan, employee_ids: [4] });
  assert.equal(res.body.updated, 1);
  const cl = (await call('employee', 'GET', 'leave/balances')).body.find((b) => b.code === 'CL');
  assert.equal(cl.plan, 'Interns & contract staff');
  assert.equal(cl.allocated, Number(today().slice(5, 7))); // 1 CL credited per month so far
  const rows = (await call('hr', 'GET', 'policies/assignments')).body;
  assert.equal(rows.find((r) => r.id === 4).effective.leave.explicit, true);
  await call('hr', 'POST', 'policies/assign', { kind: 'leave', policy_id: null, employee_ids: [4] });
  assert.equal((await call('employee', 'GET', 'leave/balances')).body.find((b) => b.code === 'CL').allocated, 12);
  assert.equal((await call('hr', 'GET', 'policies/assignments')).body.find((r) => r.id === 4).effective.leave.name, 'Standard leave plan');
});

test('holiday lists follow the office location; weekly-off policy changes working days', async () => {
  const mumbai = get("SELECT e.id FROM employees e JOIN locations l ON l.id = e.location_id WHERE l.name = 'Mumbai Office' AND e.status = 'active'");
  assert.equal(holidaySet(mumbai.id).has('2026-03-19'), true);  // Gudi Padwa (Maharashtra)
  assert.equal(holidaySet(4).has('2026-03-19'), false);
  const att = (await call('hr', 'GET', `attendance?employee_id=${mumbai.id}&month=2026-03`)).body;
  assert.ok(att.holidays.some((h) => h.name === 'Gudi Padwa'));
  assert.equal(att.holidays.filter((h) => h.name === 'Holi').length, 1);

  const alt = get("SELECT id FROM weekly_off_policies WHERE name LIKE 'Sunday + 2nd%'").id;
  await call('hr', 'POST', 'policies/assign', { kind: 'weekly_off', policy_id: alt, employee_ids: [4] });
  const month = `${NEXT_YEAR}-04`;
  const offs = (await call('employee', 'GET', `attendance?month=${month}`)).body.weekly_offs;
  const firstSat = nthWeekday(NEXT_YEAR, 4, 6, 1);
  const secondSat = nthWeekday(NEXT_YEAR, 4, 6, 2);
  assert.ok(!offs.includes(firstSat) && offs.includes(secondSat));
  // Leave on a working Saturday counts; on a Saturday off it does not.
  const cl = get("SELECT id FROM leave_types WHERE code = 'CL'").id;
  assert.equal((await call('employee', 'POST', 'leave/requests', { leave_type_id: cl, start_date: firstSat, end_date: firstSat, reason: 'x' })).body.days, 1);
  assert.equal((await call('employee', 'POST', 'leave/requests', { leave_type_id: cl, start_date: secondSat, end_date: secondSat, reason: 'x' })).status, 400);
  await call('hr', 'POST', 'policies/assign', { kind: 'weekly_off', policy_id: null, employee_ids: [4] });
});

test('attendance policy: clock-in modes, regularization limit, late-mark penalties and waivers', async () => {
  const sales = get("SELECT e.id, e.email FROM employees e JOIN departments d ON d.id = e.department_id WHERE d.name = 'Sales' AND e.status = 'active' AND e.role = 'employee'");
  await login('sales', sales.email);
  run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', sales.id, today());
  const office = await call('sales', 'POST', 'attendance/clock-in', { work_mode: 'office' });
  assert.equal(office.status, 400);
  assert.match(office.body.error, /Field sales/);
  assert.deepEqual((await call('sales', 'GET', 'attendance/today')).body.modes, ['remote', 'field']);
  assert.equal((await call('sales', 'POST', 'attendance/clock-in', { work_mode: 'field' })).status, 200);

  // Standard office policy: 4 regularizations a month.
  const month = lastMonth();
  run('DELETE FROM regularizations WHERE employee_id = 4');
  for (let i = 1; i <= 4; i++) {
    assert.equal((await call('employee', 'POST', 'regularizations', { date: `${month}-${pad(i + 10)}`, clock_in: '09:30', clock_out: '18:30', reason: 'Forgot' })).status, 201);
  }
  const fifth = await call('employee', 'POST', 'regularizations', { date: `${month}-20`, clock_in: '09:30', clock_out: '18:30', reason: 'Forgot' });
  assert.equal(fifth.status, 400);
  assert.match(fifth.body.error, /4 regularization/);

  // 7 late marks with "every 3 late marks = ½ day CL" → 1 day deducted from casual leave.
  run('UPDATE attendance SET late = 0 WHERE employee_id = 4 AND substr(date, 1, 7) = ?', month);
  const days = all("SELECT id FROM attendance WHERE employee_id = 4 AND substr(date, 1, 7) = ? AND status = 'present' ORDER BY date LIMIT 7", month);
  assert.equal(days.length, 7);
  for (const d of days) run('UPDATE attendance SET late = 1 WHERE id = ?', d.id);
  const year = Number(month.slice(0, 4));
  const clAdj = () => get("SELECT adjustment FROM leave_balances WHERE employee_id = 4 AND year = ? AND leave_type_id = (SELECT id FROM leave_types WHERE code = 'CL')", year).adjustment;
  const before = clAdj();
  assert.equal((await call('manager', 'POST', 'policies/penalties/run', { month })).status, 403);
  const r = (await call('hr', 'POST', 'policies/penalties/run', { month })).body;
  assert.ok(r.applied >= 1);
  const pen = (await call('hr', 'GET', `policies/penalties?month=${month}`)).body.find((p) => p.employee_id === 4);
  assert.deepEqual([pen.late_count, pen.days, pen.leave_type], [7, 1, 'Casual Leave']);
  assert.equal(clAdj(), before - 1);
  await call('hr', 'POST', 'policies/penalties/run', { month }); // re-running does not double-deduct
  assert.equal(clAdj(), before - 1);
  const again = (await call('hr', 'GET', `policies/penalties?month=${month}`)).body.find((p) => p.employee_id === 4);
  assert.equal((await call('hr', 'POST', `policies/penalties/${again.id}/waive`, { comment: 'Traffic diversion' })).status, 200);
  assert.equal(clAdj(), before);
  await call('hr', 'POST', 'policies/penalties/run', { month }); // waived penalties stay waived
  assert.equal(clAdj(), before);
});

test('expense policy: mileage, per-claim and monthly limits, categories and required receipts', async () => {
  const d = addDays(today(), -1);
  const mileage = await call('employee', 'POST', 'expenses', { category: 'Local conveyance', distance_km: 25, date: d, description: 'Client visit' });
  assert.equal(mileage.status, 201);
  assert.equal(mileage.body.amount, 300); // 25 km × ₹12
  const perDiem = await call('employee', 'POST', 'expenses', { category: 'Outstation per diem', days: 2, date: d, description: 'Chennai' });
  assert.equal(perDiem.body.amount, 3000);
  const big = await call('employee', 'POST', 'expenses', { category: 'Food & Meals', amount: 6000, date: d, description: 'Offsite' });
  assert.equal(big.status, 400);
  assert.match(big.body.error, /limited to ₹5000/);
  const unknown = await call('employee', 'POST', 'expenses', { category: 'Fuel', amount: 100, date: d, description: 'x' });
  assert.match(unknown.body.error, /not a category in your expense policy/);
  const internet = get("SELECT date FROM expenses WHERE employee_id = 4 AND category = 'Internet' ORDER BY id DESC").date;
  const over = await call('employee', 'POST', 'expenses', { category: 'Internet', amount: 400, date: internet, description: 'Broadband' });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /monthly Internet limit/);

  const dinner = (await call('employee', 'POST', 'expenses', { category: 'Client Entertainment', amount: 1000, date: d, description: 'Dinner' })).body;
  assert.equal(dinner.receipt_required, 1);
  const blocked = await call('hr', 'PUT', `expenses/${dinner.id}/decision`, { status: 'approved' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /receipt is required/);
  assert.equal(get('SELECT status FROM expenses WHERE id = ?', dinner.id).status, 'pending');
  const fd = new FormData();
  fd.append('entity', 'expenses');
  fd.append('entity_id', String(dinner.id));
  fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'bill.pdf');
  assert.equal((await call('employee', 'POST', 'attachments', fd)).status, 201);
  assert.equal((await call('hr', 'PUT', `expenses/${dinner.id}/decision`, { status: 'approved' })).body.status, 'approved');

  const my = (await call('employee', 'GET', 'policies/my')).body;
  assert.equal(my.expense.name, 'Standard expense policy');
  assert.ok(my.expense.categories.some((c) => c.kind === 'mileage'));
  assert.equal(my.holiday_list.name, 'India – Karnataka');
  assert.equal((await call('employee', 'GET', 'policies/my?employee_id=3')).status, 403);
});
