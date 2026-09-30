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
