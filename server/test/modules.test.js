import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-modules-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), CAREERS_RATE_LIMIT: '50', AGENT_DIST_DIR: path.join(tmp, 'agent-dist') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, all, run } = await import('../src/db.js');
const { annualTaxOldRegime } = await import('../src/tax.js');

let server;
let base;
const tokens = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nextWeekday = (n) => { let d = addDays(today(), n); while ([0, 6].includes(new Date(`${d}T00:00:00`).getDay())) d = addDays(d, 1); return d; };
const thisMonth = () => today().slice(0, 7);

async function call(who, method, url, body, headers = {}) {
  const isForm = body instanceof FormData;
  const auth = who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {};
  const res = await fetch(`${base}/api/${url}`, {
    method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...auth, ...headers },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
}
const form = (fields, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('file', new Blob([file.data], { type: file.type }), file.name);
  return f;
};
let peer; // a direct report of the manager (not the demo employee)

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) {
    tokens[role] = (await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
  }
  peer = get("SELECT * FROM employees WHERE manager_id = 3 AND id != 4 AND status = 'active' AND id NOT IN (SELECT employee_id FROM resignations) ORDER BY id LIMIT 1");
  tokens.peer = (await call(null, 'POST', 'auth/login', { email: peer.email, password: 'Password@123' })).body.token;
});
after(() => server.close());

// ---------- approvals ----------
test('two-level approval: manager approval moves an expense to HR, HR finalises it, history is recorded', async () => {
  const exp = (await call('employee', 'POST', 'expenses', { category: 'Travel', amount: 450, date: today(), description: 'Cab' })).body;
  const m = await call('manager', 'PUT', `expenses/${exp.id}/decision`, { status: 'approved', comment: 'ok by me' });
  assert.equal(m.body.status, 'manager_approved');
  assert.equal((await call('manager', 'PUT', `expenses/${exp.id}/decision`, { status: 'approved' })).status, 403);
  const inbox = (await call('hr', 'GET', 'approvals')).body.find((i) => i.type === 'expense' && i.id === exp.id);
  assert.equal(inbox.stage, 'manager_approved');
  assert.ok(!(await call('manager', 'GET', 'approvals')).body.some((i) => i.type === 'expense' && i.id === exp.id));
  const h = await call('hr', 'PUT', `expenses/${exp.id}/decision`, { status: 'approved' });
  assert.equal(h.body.status, 'approved');
  const hist = (await call('employee', 'GET', `approvals/history?entity=expenses&id=${exp.id}`)).body;
  assert.deepEqual(hist.map((s) => [s.level, s.decision]), [['manager', 'approved'], ['hr', 'approved']]);
});

test('approval flows are configurable per request type', async () => {
  await call('hr', 'PUT', 'approvals/flows', { expenses: 'manager' });
  const exp = (await call('employee', 'POST', 'expenses', { category: 'Office Supplies', amount: 999, date: today(), description: 'Keyboard' })).body;
  assert.equal((await call('manager', 'PUT', `expenses/${exp.id}/decision`, { status: 'approved' })).body.status, 'approved');
  await call('hr', 'PUT', 'approvals/flows', { expenses: 'manager_hr' });
  const flows = (await call('employee', 'GET', 'approvals/flows')).body;
  assert.equal(flows.find((f) => f.key === 'expenses').flow, 'manager_hr');
  assert.equal((await call('employee', 'PUT', 'approvals/flows', { expenses: 'manager' })).status, 403);
});

// ---------- companies & payroll depth ----------
test('payroll runs per legal entity with company details on payslips; loans, reimbursements and re-runs are correct', async () => {
  const companies = (await call('hr', 'GET', 'companies')).body;
  assert.equal(companies.length, 2);
  // Loan: request → manager → HR approval, then disbursed.
  assert.equal((await call('peer', 'POST', 'loans', { type: 'advance', amount: 10_000_000, tenure_months: 1 })).status, 400);
  const loan = (await call('peer', 'POST', 'loans', { type: 'loan', amount: 60000, tenure_months: 6, reason: 'Wedding' })).body;
  assert.equal(loan.emi, 10000);
  await call('manager', 'PUT', `loans/${loan.id}/decision`, { status: 'approved' });
  assert.equal((await call('hr', 'PUT', `loans/${loan.id}/decision`, { status: 'approved' })).body.status, 'approved');
  // An approved expense gets reimbursed via payroll (together with any other approved, unpaid claims).
  const exp = (await call('peer', 'POST', 'expenses', { category: 'Other', amount: 900, date: today(), description: 'Course' })).body;
  await call('hr', 'PUT', `expenses/${exp.id}/decision`, { status: 'approved' });
  const owed = get("SELECT SUM(amount) AS s FROM expenses WHERE employee_id = ? AND status = 'approved' AND payslip_id IS NULL", peer.id).s;

  const res = await call('hr', 'POST', 'payroll/run', { month: thisMonth() });
  assert.equal(res.status, 201);
  assert.equal(res.body.runs.length, 2);
  const runFor = res.body.runs.find((r) => r.company_id === peer.company_id);
  const slip = (await call('hr', 'GET', `payroll/runs/${runFor.id}/payslips`)).body.find((s) => s.employee_id === peer.id);
  assert.equal(slip.loan_deduction, 10000);
  assert.equal(slip.reimbursement, owed);
  assert.equal(Math.round(slip.net), Math.round(slip.gross + owed - slip.total_deductions));
  assert.equal(get('SELECT outstanding FROM loans WHERE id = ?', loan.id).outstanding, 50000);
  assert.equal(get('SELECT status FROM expenses WHERE id = ?', exp.id).status, 'reimbursed');
  // Re-running the unpaid month must not double-deduct.
  await call('hr', 'POST', 'payroll/run', { month: thisMonth(), company_id: peer.company_id });
  assert.equal(get('SELECT outstanding FROM loans WHERE id = ?', loan.id).outstanding, 50000);
  assert.equal(get('SELECT COUNT(*) AS n FROM loan_repayments WHERE loan_id = ?', loan.id).n, 1);

  const detail = (await call('hr', 'GET', `payroll/payslips/${get('SELECT id FROM payslips WHERE employee_id = ? AND month = ?', peer.id, thisMonth()).id}`)).body;
  const co = companies.find((c) => c.id === peer.company_id);
  assert.equal(detail.company.company_name, co.legal_name);
  assert.equal(detail.loans[0].amount, 10000);
  assert.equal(detail.reimbursed.reduce((a, r) => a + r.amount, 0), owed);

  const bank = await call('hr', 'GET', `payroll/runs/${get('SELECT run_id FROM payslips WHERE employee_id = ? AND month = ?', peer.id, thisMonth()).run_id}/bank-file`);
  assert.equal(bank.status, 200);
  const lines = bank.body.trim().split('\n');
  assert.equal(lines[0], 'Beneficiary Name,Employee ID,Bank,Account Number,IFSC,Amount,Narration');
  assert.ok(lines.some((l) => l.includes(peer.emp_code)));
});

test('tax: old regime uses approved declarations; the employee can switch regimes; annual statement sums paid payslips', async () => {
  assert.equal(annualTaxOldRegime(500000), 0);
  assert.equal(annualTaxOldRegime(1000000), 117000); // 12.5k + 1L = 1.125L + 4% cess
  const cmp = (await call('employee', 'GET', 'payroll/regime')).body;
  assert.ok(cmp.verified.regimes.old.deductions >= 50000 + 150000); // standard + 80C (approved in seed)
  assert.ok(['old', 'new'].includes(cmp.verified.recommended));
  assert.equal((await call('employee', 'PUT', 'payroll/regime', { regime: 'old' })).body.regime, 'old');
  const preview = (await call('employee', 'GET', 'payroll/preview')).body;
  assert.equal(preview.regime, 'old');
  assert.equal(Math.round(preview.annual_tax), Math.round(cmp.verified.regimes.old.tax));
  await call('employee', 'PUT', 'payroll/regime', { regime: 'new' });
  const st = (await call('employee', 'GET', 'payroll/tax-statement')).body;
  assert.ok(st.months.length >= 1);
  assert.equal(Math.round(st.totals.gross), Math.round(st.months.reduce((a, m) => a + m.gross, 0)));
  assert.equal((await call('employee', 'GET', `payroll/tax-statement?employee_id=${peer.id}`)).status, 403);
});

// ---------- exit ----------
test('resignation → manager → HR approval puts the employee on notice; exit interview; F&F computed, approved and paid', async () => {
  const r = await call('peer', 'POST', 'resignations', { reason: 'Relocating to Delhi' });
  assert.equal(r.status, 201);
  assert.equal(r.body.requested_lwd, addDays(today(), 60));
  assert.equal((await call('peer', 'POST', 'resignations', { reason: 'again' })).status, 409);
  await call('manager', 'PUT', `resignations/${r.body.id}/decision`, { status: 'approved' });
  await call('hr', 'PUT', `resignations/${r.body.id}/lwd`, { last_working_day: addDays(today(), 30) });
  assert.equal((await call('hr', 'PUT', `resignations/${r.body.id}/decision`, { status: 'approved' })).body.status, 'approved');
  const emp = get('SELECT status, exit_date FROM employees WHERE id = ?', peer.id);
  assert.deepEqual([emp.status, emp.exit_date], ['on_notice', addDays(today(), 30)]);
  assert.ok(get("SELECT COUNT(*) AS n FROM onboarding_tasks WHERE employee_id = ? AND type = 'offboarding'", peer.id).n >= 5);

  const iv = await call('peer', 'POST', 'exit/interviews', { resignation_id: r.body.id, primary_reason: 'Relocation', rating_manager: 5, rating_culture: 4, would_recommend: true });
  assert.equal(iv.status, 201);
  assert.ok((await call('hr', 'GET', 'exit/interviews')).body.summary.count >= 2);

  const pre = (await call('hr', 'GET', `exit/fnf/preview/${peer.id}`)).body;
  assert.equal(pre.last_working_day, addDays(today(), 30));
  assert.equal(pre.notice_shortfall_days, 60 - 31);
  assert.ok(pre.notice_recovery > 0);
  assert.equal(pre.loan_recovery, 50000); // outstanding loan from the payroll test
  const waived = (await call('hr', 'GET', `exit/fnf/preview/${peer.id}?waive_notice=1`)).body;
  assert.equal(waived.notice_recovery, 0);
  const fnf = (await call('hr', 'POST', 'exit/fnf', { employee_id: peer.id, waive_notice: true, bonus: 5000 })).body;
  assert.equal(fnf.status, 'draft');
  assert.equal((await call('peer', 'GET', `exit/fnf/${fnf.id}`)).status, 404); // drafts are HR-only
  await call('hr', 'PUT', `exit/fnf/${fnf.id}/status`, { status: 'approved' });
  assert.equal((await call('peer', 'GET', `exit/fnf/${fnf.id}`)).body.net_payable, fnf.net_payable);
  await call('hr', 'PUT', `exit/fnf/${fnf.id}/status`, { status: 'paid' });
  assert.equal(get('SELECT status FROM employees WHERE id = ?', peer.id).status, 'exited');
  assert.equal(get("SELECT COUNT(*) AS n FROM loans WHERE employee_id = ? AND status = 'approved'", peer.id).n, 0);
});

test('gratuity applies after five years of service', async () => {
  const veteran = get("SELECT * FROM employees WHERE date_of_joining <= date('now', '-6 years') AND status = 'active' AND role != 'admin' LIMIT 1");
  run("UPDATE employees SET status = 'on_notice', exit_date = ? WHERE id = ?", addDays(today(), 10), veteran.id);
  const pre = (await call('hr', 'GET', `exit/fnf/preview/${veteran.id}`)).body;
  assert.ok(pre.service_years >= 6);
  assert.ok(pre.gratuity > 0);
  run("UPDATE employees SET status = 'active', exit_date = NULL WHERE id = ?", veteran.id);
});

test('probation: HR can confirm or extend', async () => {
  const p = get("SELECT id, probation_end_date FROM employees WHERE confirmation_status IN ('probation','extended') LIMIT 1");
  const ext = (await call('hr', 'POST', `employees/${p.id}/confirmation`, { action: 'extend', extend_days: 30 })).body;
  assert.equal(ext.confirmation_status, 'extended');
  assert.equal(ext.probation_end_date, addDays(p.probation_end_date, 30));
  assert.equal((await call('hr', 'POST', `employees/${p.id}/confirmation`, { action: 'confirm' })).body.confirmation_status, 'confirmed');
  assert.equal((await call('employee', 'POST', `employees/${p.id}/confirmation`, { action: 'confirm' })).status, 403);
});

// ---------- attendance & leave depth ----------
test('WFH request marks attendance remote; comp-off needs weekend work; overtime is recorded', async () => {
  const d = nextWeekday(5);
  const wfh = (await call('employee', 'POST', 'attendance-requests', { type: 'wfh', date: d, reason: 'Plumber visit' })).body;
  await call('manager', 'PUT', `attendance-requests/${wfh.id}/decision`, { status: 'approved' });
  assert.equal(get('SELECT work_mode FROM attendance WHERE employee_id = 4 AND date = ?', d).work_mode, 'remote');

  const weekday = nextWeekday(-10 - 2);
  assert.equal((await call('employee', 'POST', 'attendance-requests', { type: 'comp_off', date: weekday < today() ? weekday : addDays(today(), -1), reason: 'x' })).status, 400);
  const weekend = get("SELECT date FROM attendance WHERE employee_id = 4 AND strftime('%w', date) IN ('0','6') AND clock_in IS NOT NULL ORDER BY date DESC").date;
  const before = get("SELECT allocated + adjustment AS allocated FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.employee_id = 4 AND t.code = 'CO' AND b.year = ?", Number(weekend.slice(0, 4))).allocated;
  const co = (await call('employee', 'POST', 'attendance-requests', { type: 'comp_off', date: weekend, reason: 'Release weekend' })).body;
  await call('manager', 'PUT', `attendance-requests/${co.id}/decision`, { status: 'approved' });
  const after2 = get("SELECT allocated + adjustment AS allocated FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.employee_id = 4 AND t.code = 'CO' AND b.year = ?", Number(weekend.slice(0, 4))).allocated;
  assert.equal(after2, before + 1);
  assert.equal((await call('employee', 'POST', 'attendance-requests', { type: 'comp_off', date: weekend, reason: 'again' })).status, 409);
});

test('geofenced clock-in: flagged outside in flag mode, blocked in enforce mode, inside passes', async () => {
  run("DELETE FROM attendance WHERE employee_id = 3 AND date = ?", today());
  const far = await call('manager', 'POST', 'attendance/clock-in', { work_mode: 'office', latitude: 28.6139, longitude: 77.2090 });
  assert.equal(far.status, 200);
  assert.equal(far.body.geo_status, 'outside');
  run("DELETE FROM attendance WHERE employee_id = 3 AND date = ?", today());
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_mode', 'enforce')");
  const blocked = await call('manager', 'POST', 'attendance/clock-in', { work_mode: 'office', latitude: 28.6139, longitude: 77.2090 });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /km from Bengaluru HQ/);
  const inside = await call('manager', 'POST', 'attendance/clock-in', { work_mode: 'office', latitude: 12.9258, longitude: 77.6765 });
  assert.equal(inside.body.geo_status, 'inside');
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_mode', 'flag')");
});

test('shift roster: managers roster their team only; roster shift overrides the default shift', async () => {
  const shifts = (await call('manager', 'GET', 'shifts')).body;
  const early = shifts.find((s) => s.name === 'Early');
  const date = nextWeekday(2);
  assert.equal((await call('manager', 'PUT', 'workforce/roster', { entries: [{ employee_id: 4, date, shift_id: early.id }] })).status, 200);
  assert.equal((await call('manager', 'PUT', 'workforce/roster', { entries: [{ employee_id: 1, date, shift_id: early.id }] })).status, 403);
  const week = (await call('manager', 'GET', `workforce/roster?start=${date}`)).body;
  assert.equal(week.rows.find((r) => r.id === 4).days[0].shift_id, early.id);
  const { shiftFor } = await import('../src/routes/attendance.js');
  assert.equal(shiftFor(4, date).name, 'Early');
});

test('optional holidays respect the yearly limit and leave year-end carries forward with a cap', async () => {
  run("INSERT INTO holidays (name, date, type) VALUES ('Opt A', ?, 'Optional'), ('Opt B', ?, 'Optional'), ('Opt C', ?, 'Optional')", nextWeekday(20), nextWeekday(21), nextWeekday(22));
  const list = (await call('employee', 'GET', `workforce/optional-holidays?year=${nextWeekday(20).slice(0, 4)}`)).body;
  const future = list.holidays.filter((h) => h.date > today());
  for (const h of future.slice(0, list.limit - list.used)) assert.equal((await call('employee', 'POST', `workforce/optional-holidays/${h.id}`)).body.chosen, true);
  const extra = future.find((h) => !get('SELECT 1 FROM optional_holiday_choices WHERE employee_id = 4 AND holiday_id = ?', h.id));
  assert.equal((await call('employee', 'POST', `workforce/optional-holidays/${extra.id}`)).status, 400);

  const year = new Date().getFullYear();
  // Allocation comes from the leave plan (18 EL); a +27 correction and 5 used leave 40 unused days.
  run("UPDATE leave_balances SET adjustment = 27, used = 5 WHERE employee_id = 4 AND year = ? AND leave_type_id = (SELECT id FROM leave_types WHERE code = 'EL')", year);
  const ye = (await call('hr', 'POST', 'workforce/leave-year-end', { year })).body;
  assert.ok(ye.details.some((d) => d.employee_id === 4 && d.leave_type === 'EL' && d.carry === 30 && d.encash === 10));
  const nextEl = get("SELECT allocated, carried FROM leave_balances WHERE employee_id = 4 AND year = ? AND leave_type_id = (SELECT id FROM leave_types WHERE code = 'EL')", year + 1);
  assert.deepEqual([nextEl.allocated, nextEl.carried], [18, 30]);
  const nextBal = (await call('employee', 'GET', `leave/balances?year=${year + 1}`)).body.find((b) => b.code === 'EL');
  assert.equal(nextBal.available, 48);
});

// ---------- letters, acknowledgements, custom fields, import, KB ----------
test('letters: templates validate placeholders, generate a PDF document and email it as an attachment; requests get fulfilled', async () => {
  assert.equal((await call('hr', 'POST', 'letter-templates', { name: 'Bad', type: 'x', body: 'Hi {{nope}}' })).status, 400);
  const tpl = (await call('hr', 'GET', 'letter-templates')).body.find((t) => t.type === 'salary');
  const preview = (await call('hr', 'POST', 'hr/letters/preview', { template_id: tpl.id, employee_id: 4, purpose: 'Visa' })).body.text;
  assert.match(preview, /Ananya Iyer/);
  assert.match(preview, /purpose of Visa/);
  const reqs = (await call('hr', 'GET', 'letter-requests?status=pending')).body;
  const gen = await call('hr', 'POST', 'hr/letters/generate', { template_id: tpl.id, employee_id: 4, purpose: 'Visa', request_id: reqs[0].id });
  assert.equal(gen.status, 201);
  const doc = (await call('employee', 'GET', 'documents')).body.find((d) => d.id === gen.body.document_id);
  assert.equal(doc.category, 'Letter');
  assert.equal(doc.file_type, 'application/pdf');
  const pdf = await fetch(`${base}/api/attachments/${doc.file_id}/download`, { headers: { Authorization: `Bearer ${tokens.employee}` } });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal(get('SELECT status FROM letter_requests WHERE id = ?', reqs[0].id).status, 'fulfilled');
  const mail = get("SELECT attachments FROM email_outbox WHERE template = 'letter' ORDER BY id DESC");
  assert.equal(JSON.parse(mail.attachments)[0].filename, gen.body.filename);
});

test('policy acknowledgement is tracked per employee', async () => {
  const doc = (await call('employee', 'GET', 'documents')).body.find((d) => d.title === 'Employee Handbook');
  assert.equal(doc.requires_ack, 1);
  assert.equal(doc.acknowledged, false);
  await call('employee', 'POST', `hr/documents/${doc.id}/acknowledge`);
  assert.equal((await call('employee', 'GET', 'documents')).body.find((d) => d.id === doc.id).acknowledged, true);
  const acks = (await call('hr', 'GET', `hr/documents/${doc.id}/acknowledgements`)).body;
  assert.ok(acks.rows.find((r) => r.id === 4).acknowledged_at);
  assert.equal(acks.acknowledged, acks.rows.filter((r) => r.acknowledged_at).length);
});

test('custom fields: HR defines them, values are validated, employees edit only permitted fields', async () => {
  const f = (await call('hr', 'POST', 'custom-fields', { label: 'Work shift preference', type: 'select', options: 'Morning\nEvening', employee_editable: 1 })).body;
  assert.equal(f.field_key, 'work_shift_preference');
  assert.equal((await call('hr', 'PUT', 'employees/4', { custom: { work_shift_preference: 'Night' } })).status, 400);
  await call('employee', 'PUT', 'auth/profile', { custom: { work_shift_preference: 'Evening', father_s_name: 'Hacker' } });
  const me = (await call('employee', 'GET', 'auth/me')).body.custom_fields;
  assert.equal(me.find((x) => x.field_key === 'work_shift_preference').value, 'Evening');
  assert.equal(me.find((x) => x.field_key === 'father_s_name').value ?? null, null); // not employee-editable
});

test('bulk import validates every row in a dry run, then creates only valid employees', async () => {
  const csv = 'first_name,last_name,email,department,designation,date_of_joining,annual_ctc\n'
    + 'Asha,Rao,asha.rao@x.test,Engineering,Software Engineer,2026-09-01,900000\n'
    + 'Bad,Row,not-an-email,Engineering,,2026-13-40,abc\n'
    + 'Dup,User,employee@peoplehub.demo,,,,\n';
  const file = { data: Buffer.from(csv), type: 'text/csv', name: 'people.csv' };
  const dry = (await call('hr', 'POST', 'hr/employees-import?dry_run=1', form({}, file))).body;
  assert.deepEqual([dry.total, dry.valid, dry.invalid, dry.created], [3, 1, 2, 0]);
  assert.ok(dry.rows[1].errors.includes('invalid email'));
  assert.ok(dry.rows[2].errors.includes('email already exists'));
  const done = await call('hr', 'POST', 'hr/employees-import', form({}, file));
  assert.equal(done.body.created, 1);
  assert.ok(get("SELECT id FROM employees WHERE email = 'asha.rao@x.test'"));
  assert.equal((await call('employee', 'POST', 'hr/employees-import', form({}, file))).status, 403);
});

test('knowledge base search', async () => {
  const r = (await call('employee', 'GET', 'kb?q=reimburse')).body;
  assert.ok(r.length >= 1 && r[0].title.toLowerCase().includes('reimburse'));
  assert.equal((await call('employee', 'POST', 'kb', { title: 'x', body: 'y' })).status, 403);
});

// ---------- performance & engagement ----------
test('feedback visibility, 360 requests and one-on-ones', async () => {
  await call('manager', 'POST', 'people/feedback', { to_id: 4, message: 'Private note for skip-level', visibility: 'manager' });
  const recv = (await call('employee', 'GET', 'people/feedback')).body;
  assert.ok(!recv.some((f) => f.message === 'Private note for skip-level'));
  const req = await call('employee', 'POST', 'people/feedback/requests', { reviewer_ids: [3], question: 'How was my Q3?' });
  assert.equal(req.body.created, 1);
  const inbox = (await call('manager', 'GET', 'people/feedback/requests')).body.find((r) => r.question === 'How was my Q3?');
  await call('manager', 'POST', 'people/feedback', { to_id: 4, message: 'Strong quarter!', request_id: inbox.id });
  assert.equal(get('SELECT status FROM feedback_requests WHERE id = ?', inbox.id).status, 'completed');
  assert.equal((await call('employee', 'POST', 'people/feedback/requests', { subject_id: 1, reviewer_ids: [3] })).status, 403);

  const one = await call('employee', 'POST', 'people/one-on-ones', { with_id: 3, scheduled_at: `${nextWeekday(3)}T10:00`, agenda: 'Promotion path' });
  assert.equal(one.body.manager_id, 3);
  assert.equal((await call('employee', 'POST', 'people/one-on-ones', { with_id: 1, scheduled_at: `${nextWeekday(3)}T10:00` })).status, 403);
  const upd = (await call('manager', 'PUT', `people/one-on-ones/${one.body.id}`, { notes: 'Discussed L3 criteria', action_items: 'Share rubric', status: 'completed' })).body;
  assert.equal(upd.status, 'completed');
});

test('social feed: post, like toggle, comment and moderation', async () => {
  const p = (await call('employee', 'POST', 'people/posts', { body: 'Hello team 👋 thanks @Rohan Mehta' })).body;
  assert.equal((await call('manager', 'POST', `people/posts/${p.id}/like`)).body.likes, 1);
  assert.equal((await call('manager', 'POST', `people/posts/${p.id}/like`)).body.liked, false);
  const c = (await call('manager', 'POST', `people/posts/${p.id}/comments`, { body: 'Welcome!' })).body;
  assert.equal((await call('employee', 'DELETE', `people/comments/${c.id}`)).status, 403);
  assert.ok(get("SELECT id FROM notifications WHERE employee_id = 3 AND title LIKE '%mentioned you%'"));
  assert.equal((await call('manager', 'DELETE', `people/posts/${p.id}`)).status, 403);
  assert.equal((await call('hr', 'DELETE', `people/posts/${p.id}`)).status, 200);
});

test('eNPS survey computes promoters minus detractors', async () => {
  const s = (await call('hr', 'POST', 'surveys', { type: 'enps', question: 'Recommend us?' })).body;
  for (const [who, score] of [['employee', 10], ['manager', 9], ['admin', 3], ['peer', 8]]) await call(who, 'POST', `surveys/${s.id}/vote`, { option_index: score });
  const got = (await call('employee', 'GET', 'surveys')).body.find((x) => x.id === s.id);
  assert.equal(got.breakdown.total, 3); // the exited peer can no longer sign in
  assert.equal(got.enps, Math.round(((2 - 1) / 3) * 100));
});

// ---------- hiring ----------
test('public careers: list jobs without auth, apply with a resume, duplicates and spam rejected; offer letter emailed', async () => {
  const pub = await call(null, 'GET', 'careers');
  assert.equal(pub.status, 200);
  const job = pub.body.jobs[0];
  const ok = await call(null, 'POST', `careers/jobs/${job.id}/apply`, form({ name: 'Priti Sen', email: 'priti@mail.test', expected_ctc: '12,00,000' }, { data: PDF, type: 'application/pdf', name: 'priti.pdf' }));
  assert.equal(ok.status, 201);
  assert.match(ok.body.application_id, /^APP-/);
  const cand = get("SELECT * FROM candidates WHERE email = 'priti@mail.test'");
  assert.equal(cand.source, 'Careers Page');
  assert.equal(cand.expected_ctc, 1200000);
  assert.ok(get("SELECT id FROM attachments WHERE entity = 'candidates' AND entity_id = ?", cand.id));
  assert.ok(get("SELECT id FROM email_outbox WHERE to_email = 'priti@mail.test' AND template = 'application_received'"));
  assert.equal((await call(null, 'POST', `careers/jobs/${job.id}/apply`, form({ name: 'Priti Sen', email: 'priti@mail.test' }, { data: PDF, type: 'application/pdf', name: 'p.pdf' }))).status, 409);
  assert.equal((await call(null, 'POST', `careers/jobs/${job.id}/apply`, form({ name: 'Bot', email: 'b@b.co', website: 'spam' }, { data: PDF, type: 'application/pdf', name: 'b.pdf' }))).status, 400);
  assert.equal((await call(null, 'POST', `careers/jobs/${job.id}/apply`, form({ name: 'Img', email: 'i@i.co' }, { data: PNG, type: 'image/png', name: 'me.png' }))).status, 415);

  const offer = await call('hr', 'POST', `offers/${cand.id}`, { offered_ctc: 1300000, joining_date: nextWeekday(20) });
  assert.equal(offer.status, 201);
  assert.equal(get('SELECT stage FROM candidates WHERE id = ?', cand.id).stage, 'offer');
  const mail = get("SELECT * FROM email_outbox WHERE to_email = 'priti@mail.test' AND template = 'offer_letter'");
  assert.equal(JSON.parse(mail.attachments)[0].filename, offer.body.filename);
});

// ---------- work management ----------
test('tasks: managers assign to their team, status changes notify, calendar shows tasks and holidays', async () => {
  const t = (await call('manager', 'POST', 'work/tasks', { title: 'Write RFC', assignee_id: 4, due_date: `${thisMonth()}-28`, priority: 'high' })).body;
  assert.equal(t.assignee_id, 4);
  assert.equal((await call('employee', 'POST', 'work/tasks', { title: 'x', assignee_id: 1 })).status, 403);
  assert.equal((await call('employee', 'PUT', `work/tasks/${t.id}`, { status: 'done' })).body.status, 'done');
  assert.ok(get("SELECT id FROM notifications WHERE employee_id = 3 AND title LIKE 'Task completed%'"));
  const t2 = (await call('employee', 'POST', 'work/tasks', { title: 'Due soon', due_date: `${thisMonth()}-27` })).body;
  const cal = (await call('employee', 'GET', `work/calendar?month=${thisMonth()}`)).body;
  assert.ok(cal.events.some((e) => e.type === 'task' && e.title === `Due: ${t2.title}`));
  assert.ok(cal.events.some((e) => e.type === 'birthday'));
});

test('travel requests validate dates and follow the manager → HR flow', async () => {
  assert.equal((await call('employee', 'POST', 'travel', { purpose: 'x', from_city: 'A', to_city: 'B', depart_date: '2020-01-01' })).status, 400);
  const tr = (await call('employee', 'POST', 'travel', { purpose: 'Conference', from_city: 'Bengaluru', to_city: 'Delhi', depart_date: nextWeekday(15), return_date: nextWeekday(17), estimated_cost: 30000, advance_amount: 5000 })).body;
  assert.equal((await call('manager', 'PUT', `travel/${tr.id}/decision`, { status: 'approved' })).body.status, 'manager_approved');
  assert.equal((await call('hr', 'PUT', `travel/${tr.id}/decision`, { status: 'approved' })).body.status, 'approved');
});

// ---------- activity monitoring ----------
test('activity agent: device token, classified heartbeats, live board, timeline, alerts, screenshots, revocation', async () => {
  const dev = (await call('employee', 'POST', 'activity/devices', { name: 'Work laptop', platform: 'macOS' })).body;
  assert.match(dev.token, /^phd_/);
  const agent = (method, url, body) => call(null, method, url, body, { Authorization: `Device ${dev.token}` });
  assert.equal((await agent('GET', 'agent/config')).body.employee_id, 4);
  const now = Date.now();
  const events = [
    { ts: new Date(now - 120000).toISOString(), app: 'Code', active_seconds: 60, idle_seconds: 0 },
    { ts: new Date(now - 60000).toISOString(), app: 'Chrome', domain: 'www.youtube.com', active_seconds: 50, idle_seconds: 10 },
    { ts: new Date(now - 30000).toISOString(), app: 'Chrome', domain: 'github.com', active_seconds: 30, idle_seconds: 0 },
  ];
  assert.equal((await agent('POST', 'agent/heartbeat', { events })).status, 202);
  const cats = all('SELECT app, domain, category FROM activity_events WHERE device_id = ? ORDER BY id', dev.id).map((e) => e.category);
  assert.deepEqual(cats, ['productive', 'unproductive', 'productive']);
  const live = (await call('manager', 'GET', 'activity/live')).body.rows.find((r) => r.id === 4);
  assert.equal(live.status, 'active');
  assert.equal(live.current.domain, 'github.com');
  const detail = (await call('manager', 'GET', 'activity/employee/4')).body;
  assert.ok(detail.hourly.reduce((a, h) => a + h.productive, 0) >= 1);
  assert.ok(detail.domains.some((d) => d.name === 'youtube.com'));
  assert.equal((await call('peer', 'GET', 'activity/employee/4')).status, 401); // exited user's session is inactive

  await call('hr', 'PUT', 'activity/settings', { overwork_hours: 6 });
  const long = Array.from({ length: 7 }, (_, i) => ({ ts: new Date(now - (i + 3) * 3600000).toISOString(), app: 'Code', active_seconds: 3600, idle_seconds: 0 }))
    .filter((e) => new Date(e.ts).toDateString() === new Date(now).toDateString());
  if (long.length >= 6) {
    await agent('POST', 'agent/heartbeat', { events: long });
    assert.ok(get("SELECT id FROM activity_alerts WHERE employee_id = 4 AND type = 'overwork'"));
  }
  await call('hr', 'PUT', 'activity/settings', { overwork_hours: 10 });

  const shot = await call(null, 'POST', 'agent/screenshot', form({}, { data: PNG, type: 'image/png', name: 's.png' }), { Authorization: `Device ${dev.token}` });
  assert.equal(shot.status, 201);
  assert.equal((await call('manager', 'GET', `attachments/${shot.body.id}/download`)).status, 200);
  assert.equal((await call('admin', 'GET', `attachments/${shot.body.id}/download`)).status, 200);

  await call('hr', 'POST', 'activity/rules', { pattern: 'youtube.com', category: 'productive', department_id: 1 });
  const re = (await call('hr', 'POST', 'activity/rules/reapply', { days: 1 })).body;
  assert.ok(re.changed >= 1);
  await call('employee', 'DELETE', `activity/devices/${dev.id}`);
  assert.equal((await agent('GET', 'agent/config')).status, 401);
});

test('desktop agent: reports version/OS/host, idle settings reach the agent, builds and installers are served', async () => {
  const dev = (await call('employee', 'POST', 'activity/devices', { name: 'MacBook', platform: 'macOS' })).body;
  const agent = (method, url, body) => call(null, method, url, body, { Authorization: `Device ${dev.token}` });
  await call('hr', 'PUT', 'activity/settings', { idle_threshold_seconds: 90, away_after_minutes: 45 });
  const cfg = (await agent('GET', 'agent/config')).body;
  assert.equal(cfg.idle_threshold_seconds, 90);
  assert.equal(cfg.away_after_minutes, 45);
  assert.equal((await call('hr', 'PUT', 'activity/settings', { idle_threshold_seconds: 5 })).status, 400);

  const ts = new Date(Date.now() - 60000).toISOString();
  const hb = await agent('POST', 'agent/heartbeat', { events: [{ ts, idle_seconds: 60, active_seconds: 0 }], agent: { version: '1.2.3', os: 'darwin/arm64', hostname: 'ananya-mbp' } });
  assert.equal(hb.status, 202);
  const row = (await call('employee', 'GET', 'activity/devices')).body.find((d) => d.id === dev.id);
  assert.deepEqual([row.agent_version, row.os, row.hostname], ['1.2.3', 'darwin/arm64', 'ananya-mbp']);
  // A heartbeat without agent info keeps what was reported before.
  await agent('POST', 'agent/heartbeat', { events: [{ ts, app: 'Code', active_seconds: 10 }] });
  assert.equal(get('SELECT agent_version FROM agent_devices WHERE id = ?', dev.id).agent_version, '1.2.3');

  // Downloads: nothing built yet, then builds appear with size and checksum.
  assert.deepEqual((await call(null, 'GET', 'agent-downloads')).body.files, []);
  const dist = process.env.AGENT_DIST_DIR;
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'peoplehub-agent-windows-amd64.exe'), 'MZ fake exe');
  fs.writeFileSync(path.join(dist, 'peoplehub-agent-macos-arm64.zip'), 'PK fake zip');
  fs.writeFileSync(path.join(dist, 'VERSION'), '1.2.3\n');
  fs.writeFileSync(path.join(dist, 'secret.txt'), 'nope');
  const list = (await call(null, 'GET', 'agent-downloads')).body;
  assert.equal(list.version, '1.2.3');
  assert.deepEqual(list.files.map((f) => f.file).sort(), ['peoplehub-agent-macos-arm64.zip', 'peoplehub-agent-windows-amd64.exe']);
  assert.match(list.files[0].sha256, /^[a-f0-9]{64}$/);
  const dl = await call(null, 'GET', 'agent-downloads/peoplehub-agent-windows-amd64.exe');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal((await call(null, 'GET', 'agent-downloads/secret.txt')).status, 404);
  assert.equal((await call(null, 'GET', 'agent-downloads/peoplehub-agent-macos-amd64.zip')).status, 404);

  const sh = await call(null, 'GET', 'agent-downloads/install.sh');
  assert.match(sh.body, new RegExp(`SERVER="${base}"`));
  assert.match(sh.body, /peoplehub-agent-macos-\$ARCH\.zip/);
  const ps = await call(null, 'GET', 'agent-downloads/install.ps1');
  assert.match(ps.body, new RegExp(`\\$server = '${base}'`));
  // A spoofed Host header must never be echoed into the installer scripts (fetch can't set Host, so use http).
  const http = await import('node:http');
  const evilStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/agent-downloads/install.sh`, { headers: { Host: "x';rm -rf ~;'" } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(evilStatus, 400);
  await call('hr', 'PUT', 'activity/settings', { idle_threshold_seconds: 120, away_after_minutes: 60 });

  // Pausing from the tray icon: an event-less status ping marks the person as paused on the live board.
  assert.equal(cfg.allow_pause, true);
  assert.equal((await agent('POST', 'agent/heartbeat', { events: [] })).status, 400); // empty batch without agent info
  const until = new Date(Date.now() + 15 * 60000).toISOString();
  assert.equal((await agent('POST', 'agent/heartbeat', { events: [], agent: { version: '1.2.3', paused_until: until } })).status, 202);
  run("UPDATE activity_events SET ts = datetime('now', '-30 minutes', 'localtime') WHERE employee_id = 4"); // no recent activity
  let live = (await call('manager', 'GET', 'activity/live')).body;
  let me = live.rows.find((r) => r.id === 4);
  assert.equal(me.status, 'paused');
  assert.ok(live.counts.paused >= 1);
  assert.equal(me.current, null);
  await agent('POST', 'agent/heartbeat', { events: [], agent: { version: '1.2.3', resumed: true } });
  me = (await call('manager', 'GET', 'activity/live')).body.rows.find((r) => r.id === 4);
  assert.notEqual(me.status, 'paused');

  await call('hr', 'PUT', 'activity/settings', { agent_allow_pause: false });
  assert.equal((await agent('GET', 'agent/config')).body.allow_pause, false);
  assert.equal((await agent('POST', 'agent/heartbeat', { events: [], agent: { paused_until: until } })).status, 403);
  await call('hr', 'PUT', 'activity/settings', { agent_allow_pause: true });
});
