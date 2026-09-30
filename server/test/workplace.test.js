import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-workplace-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, run } = await import('../src/db.js');

let server;
let base;
const tokens = {};
// A valid 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function call(who, method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}/api/${url}`, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const fileForm = (data, type, name, fields = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append('file', new Blob([data], { type }), name);
  return fd;
};

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) {
    tokens[role] = (await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
  }
});
after(() => server.close());

test('ID card: photo upload, card SVG with QR, permissions and batch printing', async () => {
  assert.equal((await call('employee', 'POST', 'id-cards/4/photo', fileForm(Buffer.from('%PDF-1.4\n'), 'application/pdf', 'x.pdf'))).status, 415);
  assert.equal((await call('employee', 'POST', 'id-cards/3/photo', fileForm(PNG, 'image/png', 'me.png'))).status, 403);
  const up = await call('employee', 'POST', 'id-cards/4/photo', fileForm(PNG, 'image/png', 'me.png'));
  assert.equal(up.status, 200);
  const info = (await call('employee', 'GET', 'id-cards/4')).body;
  assert.equal(info.name, 'Ananya Iyer');
  assert.match(info.verify_url, /\/verify\/[0-9a-z]+-[A-Za-z0-9_-]{16}$/);
  assert.ok(info.photo_url && !('photo_file' in info));
  const svg = (await call('employee', 'GET', 'id-cards/4/card.svg')).body.toString();
  assert.match(svg, /^<svg/);
  assert.ok(svg.includes('Ananya Iyer') && svg.includes('data:image/png;base64,') && svg.includes('Scan to verify'));
  assert.equal((await call('employee', 'GET', 'id-cards/3')).status, 403);
  assert.equal((await call('manager', 'GET', 'id-cards/4')).status, 200); // their manager
  assert.equal((await call('manager', 'GET', 'id-cards/batch')).status, 403);
  const dept = get("SELECT id FROM departments WHERE name = 'Engineering'").id;
  const batch = (await call('hr', 'GET', `id-cards/batch?department_id=${dept}`)).body;
  assert.ok(batch.length > 3 && batch.every((c) => c.svg.startsWith('<svg')));
  const emp = (await call('employee', 'GET', 'employees/4')).body;
  assert.ok(emp.photo_url.startsWith('/api/public/photo/'));
});

test('ID card verification is public, tamper-proof and reflects employment status', async () => {
  const code = (await call('employee', 'GET', 'id-cards/4')).body.verify_url.split('/verify/')[1];
  const ok = await call(null, 'GET', `public/verify/${code}`);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.valid, ok.body.current, ok.body.name], [true, true, 'Ananya Iyer']);
  assert.ok(!('email' in ok.body) && !('phone' in ok.body) && !('blood_group' in ok.body));
  const photo = await call(null, 'GET', `public/photo/${code}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
  // Changing the employee number invalidates the signature.
  const forged = `${(3).toString(36)}-${code.split('-').slice(1).join('-')}`;
  assert.equal((await call(null, 'GET', `public/verify/${forged}`)).status, 404);
  assert.equal((await call(null, 'GET', 'public/verify/garbage')).status, 404);
  const exited = get("SELECT id FROM employees WHERE status = 'exited' LIMIT 1").id;
  const exCode = (await call('hr', 'GET', `id-cards/${exited}`)).body.verify_url.split('/verify/')[1];
  const ex = (await call(null, 'GET', `public/verify/${exCode}`)).body;
  assert.deepEqual([ex.valid, ex.current], [true, false]);
  run('UPDATE employees SET photo_file = NULL WHERE id = 4');
});

test('assets: assign → acknowledge → return with condition, history and guard rails', async () => {
  const created = await call('hr', 'POST', 'assets', { asset_tag: 'AST-T1', name: 'ThinkPad X1', category: 'Laptop', cost: 150000, warranty_until: '2029-01-01', condition: 'new' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call('hr', 'POST', 'assets', { asset_tag: 'ast-t1', name: 'Dup' })).status, 409);
  assert.equal((await call('hr', 'PUT', `assets/${id}`, { status: 'assigned' })).status, 400); // must use Assign
  assert.equal((await call('employee', 'POST', `assets/${id}/assign`, { employee_id: 4 })).status, 403);
  const a = await call('hr', 'POST', `assets/${id}/assign`, { employee_id: 4, note: 'New joiner kit' });
  assert.equal(a.body.status, 'assigned');
  assert.equal((await call('hr', 'POST', `assets/${id}/assign`, { employee_id: 3 })).status, 409);
  assert.equal((await call('manager', 'POST', `assets/${id}/acknowledge`)).status, 404); // not theirs
  const mine = (await call('employee', 'GET', 'assets?mine=1')).body.find((x) => x.id === id);
  assert.equal(mine.acknowledged_at, null);
  assert.equal((await call('employee', 'POST', `assets/${id}/acknowledge`, {})).status, 200);
  assert.equal((await call('employee', 'POST', `assets/${id}/acknowledge`, {})).status, 400);
  const ret = await call('hr', 'POST', `assets/${id}/return`, { condition: 'damaged', note: 'Cracked hinge' });
  assert.deepEqual([ret.body.status, ret.body.assigned_to, ret.body.condition], ['in_repair', null, 'damaged']);
  const hist = (await call('hr', 'GET', `assets/${id}/history`)).body.map((h) => h.action);
  assert.deepEqual(hist, ['returned', 'acknowledged', 'assigned', 'created']);
  assert.equal((await call('employee', 'GET', `assets/${id}/history`)).status, 403); // no longer theirs
  const sum = (await call('hr', 'GET', 'assets/summary')).body;
  assert.ok(sum.total > 0 && sum.unacknowledged >= 1);
});

test('asset requests: manager → HR approval, fulfilled by assigning an asset', async () => {
  const req = await call('employee', 'POST', 'asset-requests', { category: 'Mobile', reason: 'On-call rotation' });
  assert.equal(req.status, 201);
  assert.equal((await call('employee', 'POST', 'asset-requests', { category: 'Mobile' })).status, 400);
  assert.equal((await call('manager', 'PUT', `asset-requests/${req.body.id}/decision`, { status: 'approved' })).body.status, 'manager_approved');
  const approvals = (await call('hr', 'GET', 'approvals')).body;
  assert.ok((approvals.items || approvals).some((i) => i.type === 'asset' && i.id === req.body.id));
  assert.equal((await call('hr', 'PUT', `asset-requests/${req.body.id}/decision`, { status: 'approved' })).body.status, 'approved');
  const phone = (await call('hr', 'POST', 'assets', { asset_tag: 'AST-T2', name: 'Pixel 9', category: 'Mobile', cost: 60000 })).body;
  assert.equal((await call('hr', 'POST', `assets/${phone.id}/assign`, { employee_id: 3, request_id: req.body.id })).status, 400); // wrong person
  assert.equal((await call('hr', 'POST', `assets/${phone.id}/assign`, { employee_id: 4, request_id: req.body.id })).status, 200);
  const r = (await call('employee', 'GET', 'asset-requests?mine=1')).body.find((x) => x.id === req.body.id);
  assert.deepEqual([r.status, r.asset_tag], ['fulfilled', 'AST-T2']);
});

test('exit: unreturned assets are recovered at cost in the full & final settlement', async () => {
  const leaver = get("SELECT id FROM employees WHERE status = 'on_notice' LIMIT 1").id;
  run("UPDATE employees SET exit_date = date('now', '+10 day') WHERE id = ?", leaver);
  const held = get("SELECT COALESCE(SUM(cost), 0) AS c FROM assets WHERE assigned_to = ? AND status = 'assigned'", leaver).c;
  assert.ok(held > 0);
  const before = (await call('hr', 'GET', `exit/fnf/preview/${leaver}`)).body;
  assert.equal(before.asset_recovery, held);
  assert.ok(before.unreturned_assets.length >= 1);
  assert.ok((await call('hr', 'GET', 'assets/summary')).body.exit_returns.some((x) => x.employee_id === leaver));
  for (const a of before.unreturned_assets) await call('hr', 'POST', `assets/${a.id}/return`, { condition: 'good' });
  const after = (await call('hr', 'GET', `exit/fnf/preview/${leaver}`)).body;
  assert.equal(after.asset_recovery, 0);
  assert.equal(Math.round(after.net_payable - before.net_payable), Math.round(held));
});

test('pre-boarding: invite → portal details, documents, e-signed offer → HR review → convert to employee', async () => {
  const eng = get("SELECT id FROM departments WHERE name = 'Engineering'").id;
  const buddy = get("SELECT id FROM employees WHERE email = 'employee@peoplehub.demo'").id;
  const body = { name: 'Meenal Joshi', email: 'meenal.joshi@example.com', date_of_joining: '2030-01-06', department_id: eng, manager_id: 3, buddy_id: buddy, annual_ctc: 1500000 };
  assert.equal((await call('employee', 'POST', 'preboarding', body)).status, 403);
  const inv = await call('hr', 'POST', 'preboarding', body);
  assert.equal(inv.status, 201);
  assert.ok(!('token_hash' in inv.body));
  const token = inv.body.portal_url.split('/join/')[1];
  assert.equal((await call('hr', 'POST', 'preboarding', body)).status, 409);
  assert.equal((await call(null, 'GET', 'join/not-a-real-token')).status, 404);

  const portal = (await call(null, 'GET', `join/${token}`)).body;
  assert.equal(portal.name, 'Meenal Joshi');
  assert.ok(portal.progress.blockers.length > 5);
  assert.equal((await call(null, 'PUT', `join/${token}/details`, { bank: { pan: 'BAD' } })).status, 400);
  await call(null, 'PUT', `join/${token}/details`, {
    personal: { date_of_birth: '1996-03-02', gender: 'Female', phone: '+91 90000 11111', blood_group: 'A+' },
    address: { current: 'HSR Layout, Bengaluru' }, emergency: { name: 'Anil Joshi', relation: 'Father', phone: '+91 90000 22222' },
    bank: { bank_name: 'ICICI Bank', account: '123456789012', ifsc: 'ICIC0001234', pan: 'ABCPJ1234K' },
  });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  assert.equal((await call(null, 'POST', `join/${token}/documents`, fileForm(pdf, 'application/pdf', 'photo.pdf', { doc_type: 'photo' }))).status, 415);
  assert.equal((await call(null, 'POST', `join/${token}/documents`, fileForm(PNG, 'image/png', 'me.png', { doc_type: 'photo' }))).status, 201);
  for (const t of ['pan', 'aadhaar', 'education', 'bank_proof']) {
    assert.equal((await call(null, 'POST', `join/${token}/documents`, fileForm(pdf, 'application/pdf', `${t}.pdf`, { doc_type: t }))).status, 201);
  }
  const early = await call(null, 'POST', `join/${token}/submit`);
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Offer acceptance/);
  assert.equal((await call(null, 'POST', `join/${token}/accept-offer`, { signature: 'M Joshi' })).status, 400);
  assert.ok((await call(null, 'POST', `join/${token}/accept-offer`, { signature: 'meenal  joshi' })).body.offer_accepted_at);
  assert.equal((await call(null, 'POST', `join/${token}/submit`)).body.status, 'submitted');
  assert.equal((await call(null, 'PUT', `join/${token}/details`, { address: { current: 'x' } })).status, 400); // locked after submit

  const id = inv.body.id;
  let rec = (await call('hr', 'GET', `preboarding/${id}`)).body;
  assert.equal((await call('hr', 'POST', `preboarding/${id}/convert`)).status, 400); // documents not verified
  const aadhaar = rec.documents.find((d) => d.doc_type === 'aadhaar');
  assert.equal((await call('hr', 'PUT', `preboarding/${id}/documents/${aadhaar.id}`, { status: 'rejected' })).status, 400); // needs a note
  rec = (await call('hr', 'PUT', `preboarding/${id}/documents/${aadhaar.id}`, { status: 'rejected', note: 'Back side missing' })).body;
  assert.equal(rec.status, 'in_progress');
  assert.equal((await call(null, 'POST', `join/${token}/documents`, fileForm(pdf, 'application/pdf', 'aadhaar-both.pdf', { doc_type: 'aadhaar' }))).status, 201);
  assert.equal((await call(null, 'POST', `join/${token}/submit`)).status, 200);
  rec = (await call('hr', 'GET', `preboarding/${id}`)).body;
  for (const d of rec.documents) await call('hr', 'PUT', `preboarding/${id}/documents/${d.id}`, { status: 'verified' });
  const dl = await call('hr', 'GET', `preboarding/${id}/documents/${rec.documents[1].id}/download`);
  assert.equal(dl.status, 200);

  const conv = await call('hr', 'POST', `preboarding/${id}/convert`);
  assert.equal(conv.status, 201);
  const emp = get('SELECT * FROM employees WHERE id = ?', conv.body.employee_id);
  assert.deepEqual([emp.pan, emp.ifsc, emp.buddy_id, emp.blood_group, emp.department_id], ['ABCPJ1234K', 'ICIC0001234', buddy, 'A+', eng]);
  assert.ok(emp.photo_file);
  assert.match(emp.emergency_contact, /Anil Joshi \(Father\)/);
  const tasks = get("SELECT group_concat(title, '|') AS t FROM onboarding_tasks WHERE employee_id = ?", emp.id).t;
  assert.match(tasks, /Set up development environment/); // Engineering template
  assert.equal(get("SELECT COUNT(*) AS n FROM documents WHERE employee_id = ? AND category = 'Personal'", emp.id).n, 5);
  assert.equal((await call(null, 'GET', `join/${token}`)).body.status, 'converted');
  assert.equal((await call(null, 'POST', `join/${token}/submit`)).status, 400);

  tokens.joiner = (await call(null, 'POST', 'auth/login', { email: 'meenal.joshi@example.com', password: 'Welcome@123' })).body.token;
  const my = (await call('joiner', 'GET', 'onboarding/my')).body;
  assert.equal(my.employee.buddy_name, 'Ananya Iyer');
  assert.ok(my.tasks.length >= 10 && my.done === 0);
  assert.equal((await call('joiner', 'GET', `onboarding/my?employee_id=4`)).status, 403);
});

test('onboarding templates: department-specific checklists, default rules and buddy assignment', async () => {
  const sales = get("SELECT id FROM departments WHERE name = 'Sales'").id;
  assert.equal((await call('employee', 'POST', 'onboarding-templates', { name: 'X' })).status, 403);
  assert.equal((await call('hr', 'POST', 'onboarding-templates', { name: 'Sales onboarding', tasks: [{ title: '' }] })).status, 400);
  const t = await call('hr', 'POST', 'onboarding-templates', {
    name: 'Sales onboarding', type: 'onboarding', department_id: sales,
    tasks: [{ title: 'CRM access', category: 'IT', offset_days: 0 }, { title: 'Shadow three client calls', category: 'Buddy', offset_days: 5 }],
  });
  assert.equal(t.status, 201);
  const newbie = await call('hr', 'POST', 'employees', { first_name: 'Tara', last_name: 'Sen', email: 'tara.sen@example.com', department_id: sales, date_of_joining: '2030-02-01' });
  const titles = get("SELECT group_concat(title, '|') AS t FROM onboarding_tasks WHERE employee_id = ?", newbie.body.id).t;
  assert.equal(titles, 'CRM access|Shadow three client calls');
  const std = (await call('hr', 'GET', 'onboarding-templates')).body.find((x) => x.name === 'Standard onboarding');
  assert.equal((await call('hr', 'DELETE', `onboarding-templates/${std.id}`)).status, 409);
  assert.equal((await call('employee', 'POST', 'onboarding/buddy', { employee_id: newbie.body.id, buddy_id: 4 })).status, 403);
  assert.equal((await call('hr', 'POST', 'onboarding/buddy', { employee_id: newbie.body.id, buddy_id: newbie.body.id })).status, 400);
  assert.equal((await call('hr', 'POST', 'onboarding/buddy', { employee_id: newbie.body.id, buddy_id: 4 })).status, 200);
  assert.equal(get('SELECT buddy_id FROM employees WHERE id = ?', newbie.body.id).buddy_id, 4);
});
