import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-psa-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, all } = await import('../src/db.js');

let server;
let base;
const tokens = {};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function call(who, method, url, body) {
  const res = await fetch(`${base}/api/${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
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

test('clients: validation, duplicates, contacts, summary and permissions', async () => {
  assert.equal((await call('employee', 'POST', 'clients', { name: 'Nope Inc' })).status, 403);
  assert.equal((await call('manager', 'POST', 'clients', { name: 'Bad GST', gstin: '123' })).status, 400);
  const c = await call('manager', 'POST', 'clients', { name: 'Orbit Systems', gstin: '29ABCDE1234F1Z5', email: 'ap@orbit.example', payment_terms_days: 15 });
  assert.equal(c.status, 201);
  assert.equal((await call('manager', 'POST', 'clients', { name: 'orbit systems' })).status, 409);
  const contact = await call('manager', 'POST', `clients/${c.body.id}/contacts`, { name: 'Ira Sen', email: 'ira@orbit.example', is_primary: true });
  assert.equal(contact.status, 201);
  const sum = (await call('manager', 'GET', `clients/${c.body.id}/summary`)).body;
  assert.equal(sum.contacts[0].name, 'Ira Sen');
  assert.deepEqual(sum.invoices, []); // managers don't see invoices
  const list = (await call('manager', 'GET', 'clients')).body;
  const shopkart = list.find((x) => x.name === 'ShopKart India');
  assert.ok(shopkart.active_projects >= 1 && shopkart.outstanding > 0);
});

test('projects: client link, members and rates, overview with financials, employee visibility', async () => {
  const client = get("SELECT id FROM clients WHERE name = 'MediCare Plus'");
  const p = await call('manager', 'POST', 'projects', { name: 'Claims Portal', client_id: client.id, billing_type: 'time_materials', budget_amount: 500000, manager_id: 3 });
  assert.equal(p.status, 201);
  assert.equal(p.body.client_name, 'MediCare Plus');
  assert.equal((await call('manager', 'POST', 'projects', { name: 'X', billing_type: 'barter' })).status, 400);
  const members = await call('manager', 'PUT', `projects/${p.body.id}/members`, { members: [{ employee_id: 3, role: 'PM', bill_rate: 3000 }, { employee_id: 4, role: 'Engineer', bill_rate: 1800 }] });
  assert.equal(members.body.length, 2);
  const ov = (await call('manager', 'GET', `projects/${p.body.id}/overview`)).body;
  assert.equal(ov.members.length, 2);
  assert.ok(ov.financials);
  // The employee is a member: sees the project but not rates or money.
  const asEmp = (await call('employee', 'GET', `projects/${p.body.id}/overview`)).body;
  assert.equal(asEmp.financials, null);
  assert.equal(asEmp.members[0].bill_rate, undefined);
  await call('manager', 'PUT', `projects/${p.body.id}/members`, { members: [{ employee_id: 3, bill_rate: 3000 }] });
  assert.equal((await call('employee', 'GET', `projects/${p.body.id}/overview`)).status, 403);
  assert.ok((await call('employee', 'GET', 'projects')).body.length >= 5); // employees can pick projects for timesheets
});

test('opportunities: stage probabilities, lost reason, summary, convert won deal into client + project', async () => {
  const o = await call('manager', 'POST', 'opportunities', { name: 'Nova CRM', prospect: 'Nova Retail', value: 800000 });
  assert.equal(o.status, 201);
  assert.equal(o.body.probability, 10);
  assert.equal(o.body.owner_id, 3);
  assert.equal((await call('manager', 'POST', 'opportunities', { name: 'No account' })).status, 400);
  assert.equal((await call('manager', 'PUT', `opportunities/${o.body.id}`, { stage: 'proposal' })).body.probability, 50);
  assert.equal((await call('manager', 'PUT', `opportunities/${o.body.id}`, { stage: 'lost' })).status, 400);
  assert.equal((await call('manager', 'POST', `opportunities/${o.body.id}/convert`)).status, 400); // not won yet
  const won = await call('manager', 'PUT', `opportunities/${o.body.id}`, { stage: 'won' });
  assert.equal(won.body.probability, 100);
  assert.equal(won.body.closed_on, today());
  const conv = await call('manager', 'POST', `opportunities/${o.body.id}/convert`, { manager_id: 3 });
  assert.equal(conv.status, 201);
  assert.equal(get('SELECT name FROM clients WHERE id = ?', conv.body.client_id).name, 'Nova Retail');
  const proj = get('SELECT * FROM projects WHERE id = ?', conv.body.project_id);
  assert.equal(proj.budget_amount, 800000);
  assert.equal(proj.opportunity_id, o.body.id);
  assert.equal((await call('manager', 'POST', `opportunities/${o.body.id}/convert`)).status, 409);
  const s = (await call('manager', 'GET', 'opportunities/summary')).body;
  assert.equal(s.stages.length, 6);
  assert.ok(s.pipeline_value > 0 && s.weighted_pipeline < s.pipeline_value);
  assert.ok(s.win_rate > 0 && s.win_rate <= 100);
  assert.equal((await call('employee', 'GET', 'opportunities/summary')).status, 403);
});

test('resources: allocation validation, utilisation statuses and weekly timeline', async () => {
  const project = get("SELECT id FROM projects WHERE name = 'Retail Mobile App'");
  assert.equal((await call('manager', 'POST', 'resources/allocations', { employee_id: 4, project_id: project.id, start_date: today(), end_date: '2000-01-01' })).status, 400);
  assert.equal((await call('manager', 'POST', 'resources/allocations', { employee_id: 4, project_id: project.id, start_date: today(), end_date: today(), allocation_pct: 150 })).status, 400);
  assert.equal((await call('employee', 'POST', 'resources/allocations', { employee_id: 4, project_id: project.id, start_date: today(), end_date: today() })).status, 403);
  const u = (await call('manager', 'GET', 'resources/utilization')).body;
  assert.ok(u.capacity_hours > 0);
  assert.ok(u.summary.bench > 0, 'someone is on the bench');
  assert.ok(u.summary.overallocated >= 1, 'the seed overallocates one engineer');
  const over = u.rows.find((r) => r.status === 'overallocated');
  assert.ok(over.allocation_pct > 100);
  const t = (await call('manager', 'GET', 'resources/timeline?weeks=8')).body;
  assert.equal(t.weeks.length, 8);
  assert.ok(t.rows.some((r) => r.weeks[0].pct > 0 && r.weeks[0].projects.length));
  // Employees see only their own allocations.
  const mine = (await call('employee', 'GET', 'resources/allocations')).body;
  assert.ok(mine.every((a) => a.employee_id === 4));
});

test('finance: T&M invoice from approved time, edit, send with PDF, payments, void rules', async () => {
  assert.equal((await call('manager', 'GET', 'finance/invoices')).status, 403);
  const project = get("SELECT * FROM projects WHERE name = 'Retail Mobile App'");
  const billable = (await call('hr', 'GET', `finance/billable?project_id=${project.id}`)).body;
  assert.ok(billable.time.length > 0, 'approved billable hours exist');
  const inv = await call('hr', 'POST', 'finance/invoices', { project_id: project.id, period_end: today() });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.status, 'draft');
  assert.match(inv.body.number, /^INV-\d{4}-\d{4}$/);
  const hours = billable.time.reduce((a, t) => a + t.hours, 0);
  assert.equal(inv.body.lines.filter((l) => l.kind === 'time').reduce((a, l) => a + l.quantity, 0), Math.round(hours * 100) / 100);
  assert.equal(inv.body.tax_rate, 18);
  assert.equal(inv.body.total, Math.round((inv.body.subtotal * 1.18) * 100) / 100);
  assert.ok(all('SELECT id FROM timesheets WHERE invoice_id = ?', inv.body.id).length > 0);
  // Billed time can't be billed twice.
  assert.equal((await call('hr', 'POST', 'finance/invoices', { project_id: project.id, period_end: today() })).status, 400);

  const edited = await call('hr', 'PUT', `finance/invoices/${inv.body.id}`, { lines: [{ description: 'Cloud hosting pass-through', quantity: 1, rate: 10000, kind: 'expense' }], notes: 'Thank you' });
  assert.equal(edited.body.lines.length, inv.body.lines.length + 1);
  assert.equal(edited.body.subtotal, Math.round((inv.body.subtotal + 10000) * 100) / 100);

  const pdf = await call('hr', 'GET', `finance/invoices/${inv.body.id}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');

  assert.equal((await call('hr', 'POST', `finance/invoices/${inv.body.id}/payments`, { amount: 100 })).status, 400); // draft
  const sent = await call('hr', 'POST', `finance/invoices/${inv.body.id}/send`);
  assert.equal(sent.body.status, 'sent');
  const mail = get("SELECT * FROM email_outbox WHERE template = 'invoice' ORDER BY id DESC LIMIT 1");
  assert.equal(mail.to_email, 'accounts@shopkart.example');
  assert.match(mail.attachments, new RegExp(`${inv.body.number}\\.pdf`));
  assert.equal((await call('hr', 'PUT', `finance/invoices/${inv.body.id}`, { notes: 'x' })).status, 400); // sent: locked

  const total = sent.body.total;
  const part = await call('hr', 'POST', `finance/invoices/${inv.body.id}/payments`, { amount: 1000, method: 'NEFT', reference: 'UTR1' });
  assert.equal(part.body.status, 'partially_paid');
  assert.equal((await call('hr', 'POST', `finance/invoices/${inv.body.id}/payments`, { amount: total })).status, 400); // exceeds balance
  assert.equal((await call('hr', 'POST', `finance/invoices/${inv.body.id}/void`)).status, 400); // has payments
  const paid = await call('hr', 'POST', `finance/invoices/${inv.body.id}/payments`, { amount: Math.round((total - 1000) * 100) / 100 });
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.balance, 0);
});

test('finance: fixed-price milestones, drafts release work when deleted, summary and ageing', async () => {
  const dwh = get("SELECT * FROM projects WHERE name = 'Data Warehouse Migration'");
  const inv = await call('hr', 'POST', 'finance/invoices', { project_id: dwh.id });
  assert.equal(inv.status, 201);
  assert.deepEqual(inv.body.lines.map((l) => l.kind), ['milestone']);
  assert.equal(get("SELECT status FROM project_milestones WHERE name = 'Schema design sign-off'").status, 'invoiced');
  assert.equal((await call('hr', 'DELETE', `finance/invoices/${inv.body.id}`)).status, 200);
  assert.equal(get("SELECT status FROM project_milestones WHERE name = 'Schema design sign-off'").status, 'completed');

  const internal = get("SELECT id FROM projects WHERE billing_type = 'non_billable' LIMIT 1");
  assert.equal((await call('hr', 'POST', 'finance/invoices', { project_id: internal.id })).status, 400);
  const client = get("SELECT id FROM clients WHERE name = 'GreenGrid Energy'");
  const manual = await call('hr', 'POST', 'finance/invoices', { client_id: client.id, lines: [{ description: 'Advisory workshop', quantity: 2, rate: 25000 }], tax_rate: 0 });
  assert.equal(manual.body.total, 50000);
  const due = new Date(manual.body.issue_date); due.setDate(due.getDate() + 60);
  assert.equal(manual.body.due_date, due.toISOString().slice(0, 10)); // client's 60-day terms

  const s = (await call('hr', 'GET', 'finance/summary')).body;
  assert.ok(s.outstanding > 0 && s.overdue > 0 && s.overdue_count >= 1);
  const ageingTotal = s.ageing.reduce((a, b) => a + b.amount, 0);
  assert.ok(Math.abs(ageingTotal - s.outstanding) < 1, 'ageing buckets add up to outstanding');
  assert.equal(s.trend.length, 12);
  assert.ok(s.top_clients[0].billed > 0);
  assert.ok(s.project_pnl.some((p) => p.billed > 0 && p.cost > 0));
  const overdue = (await call('hr', 'GET', 'finance/invoices?status=overdue')).body;
  assert.ok(overdue.length >= 1 && overdue.every((i) => i.days_overdue > 0));
});
