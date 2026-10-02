import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-push-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get } = await import('../src/db.js');
const { notify } = await import('../src/utils.js');
const { validEndpoint } = await import('../src/push.js');

let server;
let base;
const tokens = {};
async function call(who, method, url, body) {
  const res = await fetch(`${base}/${url}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

// A stand-in for a browser push service: records each delivery and answers with the next queued status.
let push;
const received = [];
const replies = [];
let waiting = null;
function nextPush() {
  if (received.length) return Promise.resolve(received.shift());
  return new Promise((resolve) => { waiting = resolve; });
}

// The browser side of a subscription: an ECDH key pair and an auth secret (RFC 8291).
const browser = crypto.createECDH('prime256v1');
browser.generateKeys();
const auth = crypto.randomBytes(16);
const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** Decrypt an aes128gcm Web Push body the way the browser does. */
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverKey = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const secret = browser.computeSecret(serverKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), serverKey]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['hr', 'manager', 'employee']) tokens[role] = (await call(null, 'POST', 'api/auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
  push = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(replies.shift() || 201).end();
      const delivery = { path: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      if (waiting) { const w = waiting; waiting = null; w(delivery); } else received.push(delivery);
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => push.once('listening', r));
});
after(() => { server.close(); push.close(); });

const endpoint = (name) => `http://127.0.0.1:${push.address().port}/push/${name}`;
const subscription = (name) => ({ endpoint: endpoint(name), keys: { p256dh: b64(browser.getPublicKey()), auth: b64(auth) } });
const employeeId = () => get("SELECT id FROM employees WHERE email = 'employee@peoplehub.demo'").id;

test('push: only real push services are accepted as endpoints', () => {
  assert.equal(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(validEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc'), true);
  assert.equal(validEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(validEndpoint('https://evil.example.com/collect'), false);
  assert.equal(validEndpoint('https://fcm.googleapis.com.evil.example.com/x'), false);
  assert.equal(validEndpoint('http://10.0.0.5/push'), false);
  assert.equal(validEndpoint('not a url'), false);
});

test('push: subscribe, validation, and the device list', async () => {
  const info = await call('employee', 'GET', 'api/notifications/push');
  assert.equal(info.status, 200);
  assert.match(info.body.public_key, /^[A-Za-z0-9_-]{87}$/);
  assert.deepEqual(info.body.devices, []);
  assert.equal((await call('employee', 'GET', 'api/notifications/push')).body.public_key, info.body.public_key); // keys are stable
  assert.equal((await call('employee', 'POST', 'api/notifications/push/test', {})).status, 400); // nothing to send to yet

  assert.equal((await call('employee', 'POST', 'api/notifications/push/subscribe', { subscription: { endpoint: 'https://evil.example.com/x', keys: subscription('a').keys } })).status, 400);
  assert.equal((await call('employee', 'POST', 'api/notifications/push/subscribe', { subscription: { endpoint: endpoint('a'), keys: { p256dh: 'short', auth: 'x' } } })).status, 400);
  assert.equal((await call('employee', 'POST', 'api/notifications/push/subscribe', {})).status, 400);
  assert.equal((await call(null, 'POST', 'api/notifications/push/subscribe', { subscription: subscription('a') })).status, 401);

  const ok = await call('employee', 'POST', 'api/notifications/push/subscribe', { subscription: subscription('laptop'), device: 'Chrome on Windows' });
  assert.equal(ok.status, 201);
  const devices = (await call('employee', 'GET', 'api/notifications/push')).body.devices;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].device, 'Chrome on Windows');
  assert.equal((await call('hr', 'GET', 'api/notifications/push')).body.devices.length, 0); // devices are per user
});

test('push: every bell notification is delivered encrypted to the browser, and the test button works', async () => {
  notify(employeeId(), 'Leave approved', 'Your leave on 12 Oct was approved.', '/leave', { email: false });
  const delivery = await nextPush();
  assert.equal(delivery.path, '/push/laptop');
  assert.equal(delivery.headers['content-encoding'], 'aes128gcm');
  assert.match(delivery.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.ok(Number(delivery.headers.ttl) > 0);
  const payload = decrypt(delivery.body);
  assert.equal(payload.title, 'Leave approved');
  assert.equal(payload.body, 'Your leave on 12 Oct was approved.');
  assert.equal(payload.link, '/leave');
  assert.ok(payload.unread >= 1);
  const bell = (await call('employee', 'GET', 'api/notifications')).body;
  assert.equal(bell.items[0].title, 'Leave approved'); // the same notification is in the bell
  assert.equal(payload.id, bell.items[0].id);

  const t = await call('employee', 'POST', 'api/notifications/push/test', {});
  assert.deepEqual(t.body, { sent: 1, failed: 0 });
  assert.equal(decrypt((await nextPush()).body).title, 'Notifications are on');
  assert.ok(get('SELECT last_used_at FROM push_subscriptions WHERE endpoint = ?', endpoint('laptop')).last_used_at);
});

test('push: expired subscriptions are removed; unsubscribe and takeover by another user', async () => {
  replies.push(410);
  const t = await call('employee', 'POST', 'api/notifications/push/test', {});
  assert.deepEqual(t.body, { sent: 0, failed: 1 });
  await nextPush();
  assert.equal((await call('employee', 'GET', 'api/notifications/push')).body.devices.length, 0);

  await call('employee', 'POST', 'api/notifications/push/subscribe', { subscription: subscription('phone') });
  // Someone else signs in on the same browser: the endpoint moves to them.
  await call('hr', 'POST', 'api/notifications/push/subscribe', { subscription: subscription('phone') });
  assert.equal((await call('employee', 'GET', 'api/notifications/push')).body.devices.length, 0);
  assert.equal((await call('hr', 'GET', 'api/notifications/push')).body.devices.length, 1);
  assert.equal((await call('employee', 'POST', 'api/notifications/push/unsubscribe', { endpoint: endpoint('phone') })).status, 200);
  assert.equal((await call('hr', 'GET', 'api/notifications/push')).body.devices.length, 1); // not theirs to remove
  const id = (await call('hr', 'GET', 'api/notifications/push')).body.devices[0].id;
  await call('hr', 'POST', 'api/notifications/push/unsubscribe', { id });
  assert.equal((await call('hr', 'GET', 'api/notifications/push')).body.devices.length, 0);
  assert.equal((await call('hr', 'POST', 'api/notifications/push/unsubscribe', {})).status, 400);
});

/** Wait for the push sent to one subscription (other recipients' pushes are skipped). */
async function pushTo(name) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const d = await Promise.race([nextPush(), new Promise((r) => setTimeout(() => r(null), 10_000))]);
    if (d?.path === `/push/${name}`) return decrypt(d.body);
  }
  throw new Error(`no push for ${name}`);
}

test('push: real features reach both the bell and the browser (leave request → manager, decision → employee, security alerts)', async () => {
  await call('employee', 'POST', 'api/notifications/push/subscribe', { subscription: subscription('emp') });
  await call('manager', 'POST', 'api/notifications/push/subscribe', { subscription: subscription('mgr') });
  const cl = (await call('employee', 'GET', 'api/leave/types')).body.find((t) => t.code === 'CL');
  const leave = await call('employee', 'POST', 'api/leave/requests', { leave_type_id: cl.id, start_date: '2027-03-02', end_date: '2027-03-02', reason: 'family function' });
  assert.equal(leave.status, 201);
  const toManager = await pushTo('mgr');
  assert.equal((await call('manager', 'GET', 'api/notifications')).body.items.find((n) => n.id === toManager.id)?.title, toManager.title);

  assert.equal((await call('manager', 'PUT', `api/leave/requests/${leave.body.id}/decision`, { status: 'approved' })).status, 200);
  const toEmployee = await pushTo('emp');
  assert.match(toEmployee.title, /approved/i);
  assert.equal((await call('employee', 'GET', 'api/notifications')).body.items[0].id, toEmployee.id);

  assert.equal((await call('employee', 'POST', 'api/auth/change-password', { current_password: 'Password@123', new_password: 'Password@1234' })).status, 200);
  assert.equal((await pushTo('emp')).title, 'Your password was changed');
  await call('employee', 'POST', 'api/auth/change-password', { current_password: 'Password@1234', new_password: 'Password@123' });
  await pushTo('emp');
});
