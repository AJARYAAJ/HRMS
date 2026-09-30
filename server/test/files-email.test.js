import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SMTPServer } from 'smtp-server';

// A real SMTP server capturing messages, so delivery is tested end to end over the wire.
const received = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => { raw += c; });
    stream.on('end', () => { received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
  },
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-files-'));
Object.assign(process.env, {
  DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), MAX_UPLOAD_MB: '1',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.server.address().port), SMTP_FROM: 'PeopleHub <hr@peoplehub.test>',
  APP_URL: 'https://hr.example.com',
});

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { flushOutbox } = await import('../src/mailer.js');
const { get } = await import('../src/db.js');

let server;
let base;
const tokens = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function call(role, method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}/api/${url}`, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

const form = (fields, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('file', new Blob([file.data], { type: file.type }), file.name);
  return f;
};

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) {
    tokens[role] = (await call(null, 'POST', 'auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
  }
});
after(() => { server.close(); smtp.close(); });

test('employee attaches a receipt to their expense; the manager can download it byte-for-byte', async () => {
  const exp = (await call('employee', 'POST', 'expenses', { category: 'Travel', amount: 900, date: '2026-09-01', description: 'Cab' })).body;
  const up = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: PDF, type: 'application/pdf', name: 'receipt.pdf' }));
  assert.equal(up.status, 201);
  assert.equal(up.body.original_name, 'receipt.pdf');
  assert.equal(up.body.size, PDF.length);

  const list = await call('manager', 'GET', `attachments?entity=expenses&entity_id=${exp.id}`);
  assert.equal(list.body.length, 1);
  const dl = await call('manager', 'GET', `attachments/${up.body.id}/download`);
  assert.equal(dl.status, 200);
  assert.ok(dl.body.equals(PDF));
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="receipt.pdf"/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  const inline = await call('manager', 'GET', `attachments/${up.body.id}/download?inline=1`);
  assert.match(inline.headers.get('content-disposition'), /^inline/);
});

test('files are private: unrelated employees and anonymous users cannot read them', async () => {
  const exp = (await call('manager', 'POST', 'expenses', { category: 'Food & Meals', amount: 500, date: '2026-09-02', description: 'Team lunch' })).body;
  const up = await call('manager', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: PNG, type: 'image/png', name: 'bill.png' }));
  assert.equal(up.status, 201);
  assert.equal((await call('employee', 'GET', `attachments/${up.body.id}/download`)).status, 403);
  assert.equal((await call('employee', 'GET', `attachments?entity=expenses&entity_id=${exp.id}`)).status, 403);
  assert.equal((await call(null, 'GET', `attachments/${up.body.id}/download`)).status, 401);
  // Employees cannot attach to someone else's record either.
  const denied = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: PDF, type: 'application/pdf', name: 'x.pdf' }));
  assert.equal(denied.status, 403);
});

test('rejects disallowed types, spoofed content and oversized files', async () => {
  const exp = (await call('employee', 'POST', 'expenses', { category: 'Other', amount: 100, date: '2026-09-03', description: 'Test' })).body;
  const exe = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: Buffer.from('MZ'), type: 'application/x-msdownload', name: 'virus.exe' }));
  assert.equal(exe.status, 415);
  const spoofed = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: Buffer.from('<script>alert(1)</script>'), type: 'application/pdf', name: 'fake.pdf' }));
  assert.equal(spoofed.status, 415);
  const big = Buffer.concat([PDF, Buffer.alloc(1.5 * 1024 * 1024)]);
  const tooBig = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }, { data: big, type: 'application/pdf', name: 'big.pdf' }));
  assert.equal(tooBig.status, 413);
  const missing = await call('employee', 'POST', 'attachments', form({ entity: 'expenses', entity_id: exp.id }));
  assert.equal(missing.status, 400);
  // Nothing from the rejected uploads is left on disk: every file belongs to an attachment, pre-boarding document or photo.
  const onDisk = fs.readdirSync(process.env.UPLOAD_DIR).length;
  const known = get('SELECT COUNT(*) AS n FROM attachments').n + get('SELECT COUNT(*) AS n FROM preboarding_documents').n
    + get('SELECT COUNT(*) AS n FROM employees WHERE photo_file IS NOT NULL').n;
  assert.equal(onDisk, known);
});

test('documents: employee uploads a personal file, HR sees it, company PDFs are downloadable', async () => {
  const doc = await call('employee', 'POST', 'documents', form({ title: 'PAN card', category: 'KYC' }, { data: PNG, type: 'image/png', name: 'pan.png' }));
  assert.equal(doc.status, 201);
  assert.equal(doc.body.file_name, 'pan.png');
  const hrView = (await call('hr', 'GET', 'documents?all=1')).body.find((d) => d.id === doc.body.id);
  assert.ok(hrView);
  const managerDl = await call('manager', 'GET', `attachments/${doc.body.file_id}/download`);
  assert.equal(managerDl.status, 403);

  const handbook = (await call('employee', 'GET', 'documents')).body.find((d) => d.title === 'Employee Handbook');
  const pdf = await call('employee', 'GET', `attachments/${handbook.file_id}/download`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

  assert.equal((await call('employee', 'DELETE', `documents/${doc.body.id}`)).status, 200);
  assert.equal((await call('hr', 'GET', `attachments/${doc.body.file_id}/download`)).status, 404);
});

test('approving leave emails the employee over SMTP', async () => {
  received.length = 0;
  const types = (await call('employee', 'GET', 'leave/types')).body;
  const cl = types.find((t) => t.code === 'CL');
  const req = (await call('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: '2027-03-02', end_date: '2027-03-02', reason: 'Errand' })).body;
  await call('manager', 'PUT', `leave/requests/${req.id}/decision`, { status: 'approved' });
  await flushOutbox();
  const toEmployee = received.find((m) => m.to.includes('employee@peoplehub.demo'));
  assert.ok(toEmployee, 'employee should receive an email');
  assert.match(toEmployee.raw, /Subject: Your leave request was approved/);
  assert.match(toEmployee.raw, /From: PeopleHub <hr@peoplehub\.test>/);
  const toManager = received.find((m) => m.to.includes('manager@peoplehub.demo'));
  assert.ok(toManager, 'manager should have been emailed about the new request');
  const row = get("SELECT status, message_id FROM email_outbox WHERE subject = 'Your leave request was approved' ORDER BY id DESC");
  assert.equal(row.status, 'sent');
  assert.ok(row.message_id);
});

test('employees can opt out of notification emails', async () => {
  await call('employee', 'PUT', 'auth/profile', { email_notifications: false });
  received.length = 0;
  await call('hr', 'POST', 'kudos', { to_id: 4, message: 'Great work', badge: '🌟 Star Performer' });
  await flushOutbox();
  assert.equal(received.filter((m) => m.to.includes('employee@peoplehub.demo')).length, 0);
  // The in-app notification is still created.
  assert.ok(get("SELECT id FROM notifications WHERE employee_id = 4 AND body = 'Great work'"));
  await call('employee', 'PUT', 'auth/profile', { email_notifications: true });
});

test('new employees get a welcome email; candidates get interview invitations', async () => {
  received.length = 0;
  await call('hr', 'POST', 'employees', { first_name: 'Zara', last_name: 'Khan', email: 'zara.khan@peoplehub.demo' });
  const cand = (await call('hr', 'POST', 'candidates', { name: 'Dev Patel', email: 'dev.patel@mail.test', job_id: 1 })).body;
  await call('hr', 'POST', 'interviews', { candidate_id: cand.id, interviewer_id: 3, round: 'Technical', scheduled_at: '2027-01-10T11:00', mode: 'Video' });
  await flushOutbox();
  assert.match(received.find((m) => m.to.includes('zara.khan@peoplehub.demo'))?.raw || '', /Subject: Welcome to the team, Zara!/);
  assert.match(received.find((m) => m.to.includes('dev.patel@mail.test'))?.raw || '', /Subject: Interview invitation/);
});

test('forgot password emails a single-use reset link that works once', async () => {
  const res = await call(null, 'POST', 'auth/forgot-password', { email: 'employee@peoplehub.demo' });
  assert.equal(res.status, 200);
  const unknown = await call(null, 'POST', 'auth/forgot-password', { email: 'nobody@peoplehub.demo' });
  assert.deepEqual(unknown.body, res.body); // no account enumeration
  await flushOutbox();
  const mail = get("SELECT html, status FROM email_outbox WHERE template = 'password_reset' ORDER BY id DESC");
  assert.equal(mail.status, 'sent');
  const token = mail.html.match(/reset-password\?token=([\w-]+)/)[1];
  assert.match(mail.html, /https:\/\/hr\.example\.com\/reset-password/);

  assert.equal((await call(null, 'POST', 'auth/reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await call(null, 'POST', 'auth/reset-password', { token, password: 'BrandNew@2026' })).status, 200);
  assert.equal((await call(null, 'POST', 'auth/reset-password', { token, password: 'Another@2026' })).status, 400);
  assert.equal((await call(null, 'POST', 'auth/login', { email: 'employee@peoplehub.demo', password: 'BrandNew@2026' })).status, 200);
});

test('failed deliveries are queued for retry and can be resent; admins can send test emails', async () => {
  const { queueEmail } = await import('../src/mailer.js');
  const port = process.env.SMTP_PORT;
  process.env.SMTP_PORT = '1'; // nothing listens here
  const id = queueEmail({ to: 'x@example.com', subject: 'Will fail', heading: 'x' });
  await flushOutbox();
  let row = get('SELECT status, attempts, last_error FROM email_outbox WHERE id = ?', id);
  assert.equal(row.status, 'retrying');
  assert.equal(row.attempts, 1);
  assert.ok(row.last_error);
  process.env.SMTP_PORT = port;
  const retried = await call('admin', 'POST', `emails/${id}/retry`);
  assert.equal(retried.body.status, 'sent');

  const t = await call('admin', 'POST', 'emails/test', { to: 'ops@example.com' });
  assert.equal(t.body.status, 'sent');
  const status = await call('hr', 'GET', 'emails/status?verify=1');
  assert.equal(status.body.mode, 'smtp');
  assert.equal(status.body.verify.ok, true);
  assert.equal((await call('employee', 'GET', 'emails')).status, 403);
});
