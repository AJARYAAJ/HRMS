import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peoplehub-bio-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads') });
delete process.env.SMTP_HOST;

const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { get, run } = await import('../src/db.js');
const { ipAllowed } = await import('../src/policies.js');
const { autoClockOut } = await import('../src/routes/attendance.js');

let server;
let base;
const tokens = {};
async function call(who, method, url, body, headers = {}) {
  const res = await fetch(`${base}/${url}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastWeekday = () => { const d = new Date(); do d.setDate(d.getDate() - 1); while ([0, 6].includes(d.getDay())); return fmt(d); };

before(async () => {
  seed();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  for (const role of ['admin', 'hr', 'manager', 'employee']) tokens[role] = (await call(null, 'POST', 'api/auth/login', { email: `${role}@peoplehub.demo`, password: 'Password@123' })).body.token;
});
after(() => server.close());

test('IP range matching', () => {
  assert.equal(ipAllowed('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(ipAllowed('::ffff:192.168.1.40', '192.168.1.0/24, 203.0.113.7'), true);
  assert.equal(ipAllowed('203.0.113.7', '192.168.1.0/24, 203.0.113.7'), true);
  assert.equal(ipAllowed('203.0.113.8', '192.168.1.0/24, 203.0.113.7'), false);
  assert.equal(ipAllowed('::1', '10.0.0.0/8'), false);
  assert.equal(ipAllowed('1.2.3.4', null), true);
});

test('devices: JSON punches become first-in / last-out attendance; unmatched punches are mapped later', async () => {
  assert.equal((await call('manager', 'POST', 'api/attendance-devices/devices', { name: 'X', serial_no: 'X' })).status, 403);
  const dev = (await call('hr', 'POST', 'api/attendance-devices/devices', { name: 'Reception', serial_no: 'CQZ7231', location_id: 1 })).body;
  assert.match(dev.key, /^bio_[0-9a-f]{40}$/);
  assert.equal((await call('hr', 'POST', 'api/attendance-devices/devices', { name: 'Dup', serial_no: 'CQZ7231' })).status, 409);
  run("UPDATE employees SET biometric_id = '1004' WHERE id = 4");
  const day = lastWeekday();
  run('DELETE FROM attendance WHERE employee_id = 4 AND date = ?', day);
  assert.equal((await call(null, 'POST', 'api/biometric/punches', { punches: [] }, { 'X-Device-Key': 'bio_wrong' })).status, 401);
  const r = (await call(null, 'POST', 'api/biometric/punches', { punches: [
    { user_id: '1004', time: `${day} 09:52:10` }, { user_id: '1004', time: `${day}T13:05:00` }, { user_id: '1004', time: `${day} 18:41:00` },
    { user_id: '7777', time: `${day} 09:00:00` },
  ] }, { 'X-Device-Key': dev.key })).body;
  assert.deepEqual(r, { accepted: 4, duplicates: 0, unmatched: 1 });
  const att = get('SELECT * FROM attendance WHERE employee_id = 4 AND date = ?', day);
  assert.deepEqual([att.clock_in, att.clock_out, att.source, att.status, att.late], ['09:52', '18:41', 'biometric', 'present', 1]);
  // Re-sending the same punches is harmless.
  assert.equal((await call(null, 'POST', 'api/biometric/punches', { punches: [{ user_id: '1004', time: `${day} 09:52:10` }] }, { 'X-Device-Key': dev.key })).body.duplicates, 1);

  const unmatched = (await call('hr', 'GET', 'api/attendance-devices/punches?unmatched=1')).body;
  assert.ok(unmatched.some((p) => p.biometric_id === '7777'));
  assert.equal((await call('hr', 'POST', 'api/attendance-devices/map', { biometric_id: '1004', employee_id: 3 })).status, 409);
  run('DELETE FROM attendance WHERE employee_id = 3 AND date = ?', day);
  assert.equal((await call('hr', 'POST', 'api/attendance-devices/map', { biometric_id: '7777', employee_id: 3 })).body.days, 1);
  assert.equal(get('SELECT clock_in FROM attendance WHERE employee_id = 3 AND date = ?', day).clock_in, '09:00');
  const devices = (await call('hr', 'GET', 'api/attendance-devices/devices')).body;
  const mine = devices.find((d) => d.serial_no === 'CQZ7231');
  assert.equal(mine.unmatched, 0);
  assert.ok(mine.last_seen_at);
});

test('ZKTeco / eSSL iclock push protocol', async () => {
  run("UPDATE employees SET biometric_id = '2002' WHERE id = 2");
  assert.equal((await call(null, 'GET', 'iclock/cdata?SN=UNKNOWN&options=all')).status, 401);
  const hs = await call(null, 'GET', 'iclock/cdata?SN=CQZ7231&options=all');
  assert.match(hs.body, /GET OPTION FROM: CQZ7231/);
  const day = lastWeekday();
  run('DELETE FROM attendance WHERE employee_id = 2 AND date = ?', day);
  const body = `2002\t${day} 09:20:31\t0\t1\t0\t0\n2002\t${day} 18:05:02\t1\t15\t0\t0\n`;
  const post = await fetch(`${base}/iclock/cdata?SN=CQZ7231&table=ATTLOG&Stamp=9999`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
  assert.equal(await post.text(), 'OK: 2');
  const att = get('SELECT clock_in, clock_out, source FROM attendance WHERE employee_id = 2 AND date = ?', day);
  assert.deepEqual([att.clock_in, att.clock_out, att.source], ['09:20', '18:05', 'biometric']);
  assert.equal(get("SELECT verify FROM punch_logs WHERE biometric_id = '2002' ORDER BY id DESC").verify, 'face');
  assert.equal((await call(null, 'GET', 'iclock/getrequest?SN=CQZ7231')).body, 'OK');
});

test('attendance policy: office clock-in limited to IP ranges; validation of ranges', async () => {
  const std = get("SELECT id FROM attendance_policies WHERE is_default = 1").id;
  assert.equal((await call('hr', 'PUT', `api/policies/attendance/${std}`, { allowed_ips: 'not-an-ip' })).status, 400);
  assert.equal((await call('hr', 'PUT', `api/policies/attendance/${std}`, { allowed_ips: '10.20.0.0/16' })).status, 200);
  run("DELETE FROM attendance WHERE employee_id = 4 AND date = date('now', 'localtime')");
  const office = await call('employee', 'POST', 'api/attendance/clock-in', { work_mode: 'office' });
  assert.equal(office.status, 400);
  assert.match(office.body.error, /office network/);
  assert.equal((await call('employee', 'POST', 'api/attendance/clock-in', { work_mode: 'remote' })).status, 200); // remote is not IP-limited
  await call('hr', 'PUT', `api/policies/attendance/${std}`, { allowed_ips: '127.0.0.1, ::1/128'.split(',')[0] });
  run("DELETE FROM attendance WHERE employee_id = 4 AND date = date('now', 'localtime')");
  assert.equal((await call('employee', 'POST', 'api/attendance/clock-in', { work_mode: 'office' })).status, 200); // loopback allowed
  await call('hr', 'PUT', `api/policies/attendance/${std}`, { allowed_ips: '' });
});

test('automatic clock-out closes forgotten days at shift end', async () => {
  const std = get("SELECT id FROM attendance_policies WHERE is_default = 1").id;
  const day = lastWeekday();
  run('DELETE FROM attendance WHERE employee_id = 4 AND date = ?', day);
  run("INSERT INTO attendance (employee_id, date, clock_in, status, work_mode) VALUES (4, ?, '09:40', 'present', 'office')", day);
  assert.equal(autoClockOut(), 0); // policy has it off
  await call('hr', 'PUT', `api/policies/attendance/${std}`, { auto_clock_out: 1, auto_clock_out_hours: 2 });
  assert.ok(autoClockOut() >= 1);
  const rec = get('SELECT * FROM attendance WHERE employee_id = 4 AND date = ?', day);
  assert.deepEqual([rec.clock_out, rec.auto_clock_out, rec.status], ['18:30', 1, 'present']);
  assert.ok(get("SELECT id FROM notifications WHERE employee_id = 4 AND title = 'You were clocked out automatically'"));
});
