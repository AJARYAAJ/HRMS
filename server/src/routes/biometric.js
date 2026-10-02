import crypto from 'node:crypto';
import express, { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit, httpError, notify, hrIds } from '../utils.js';
import { attendancePolicyFor } from '../policies.js';
import { evaluateDay, shiftFor } from './attendance.js';

/**
 * Biometric / attendance terminals. Devices push punches in two ways:
 *   • ZKTeco / eSSL "iclock" push protocol (ADMS): the device is pointed at this server and posts ATTLOG lines to
 *     /iclock/cdata?SN=<serial>. It is recognised by its registered serial number.
 *   • JSON from a sync bridge or another vendor: POST /api/biometric/punches with the device key in X-Device-Key.
 * Each punch is matched to an employee by the user ID enrolled on the device (employees.biometric_id). The day's
 * first punch becomes the clock-in and the last the clock-out, evaluated against the employee's shift and
 * attendance policy. Unmatched punches wait for HR to map the user ID to an employee.
 */
export const devicesRouter = Router();
export const biometricIngestRouter = Router();
export const iclockRouter = Router();
const HR = requireRole('admin', 'hr');
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const hash = (k) => crypto.createHash('sha256').update(k).digest('hex');
const VERIFY = { 0: 'password', 1: 'fingerprint', 2: 'card', 3: 'password', 4: 'card', 15: 'face' };

/** Accepts "2026-09-30 09:28:11", "2026-09-30T09:28:11" or "2026-09-30T09:28" and returns "YYYY-MM-DD HH:MM:SS". */
export function normaliseTime(t) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t || '').trim());
  if (!m) return null;
  return `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
}

/** Rebuilds one employee-day of attendance from all its punches (first in, last out). */
export function processDay(employeeId, date) {
  const policy = attendancePolicyFor(employeeId);
  if (policy && policy.allow_biometric === 0) return null;
  const punches = all('SELECT punched_at FROM punch_logs WHERE employee_id = ? AND substr(punched_at, 1, 10) = ? ORDER BY punched_at', employeeId, date);
  if (!punches.length) return null;
  const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', employeeId, date);
  const times = punches.map((p) => p.punched_at.slice(11, 16));
  if (rec?.clock_in && rec.source !== 'biometric') times.push(rec.clock_in);
  if (rec?.clock_out && rec.source !== 'biometric') times.push(rec.clock_out);
  times.sort();
  const clockIn = times[0];
  const clockOut = times.length > 1 && times[times.length - 1] !== clockIn ? times[times.length - 1] : null;
  const { status, late } = evaluateDay(clockIn, clockOut, shiftFor(employeeId, date), policy);
  const data = { clock_in: clockIn, clock_out: clockOut, status, late, source: 'biometric', work_mode: 'office' };
  if (rec) update('attendance', rec.id, data);
  else insert('attendance', { employee_id: employeeId, date, ...data });
  return data;
}

/** Stores punches (ignoring duplicates) and updates the affected attendance days. */
export function ingest(device, punches) {
  let accepted = 0;
  let duplicates = 0;
  let unmatched = 0;
  const days = new Set();
  const unknown = new Set();
  tx(() => {
    for (const p of punches) {
      const at = normaliseTime(p.time);
      const bid = String(p.user_id ?? '').trim();
      if (!at || !bid) continue;
      const emp = get("SELECT id FROM employees WHERE biometric_id = ? AND status != 'exited'", bid);
      if (get('SELECT id FROM punch_logs WHERE device_id IS ? AND biometric_id = ? AND punched_at = ?', device.id, bid, at)) { duplicates++; continue; }
      if (!emp && !get('SELECT id FROM punch_logs WHERE biometric_id = ? AND employee_id IS NULL LIMIT 1', bid)) unknown.add(bid);
      insert('punch_logs', { device_id: device.id, biometric_id: bid, employee_id: emp?.id ?? null, punched_at: at, direction: ['in', 'out'].includes(p.direction) ? p.direction : null, verify: p.verify || null });
      accepted++;
      if (emp) days.add(`${emp.id}|${at.slice(0, 10)}`); else unmatched++;
    }
    for (const k of days) { const [e, d] = k.split('|'); processDay(Number(e), d); }
    run('UPDATE biometric_devices SET last_seen_at = ? WHERE id = ?', new Date().toISOString(), device.id);
  });
  // Tell HR (bell + push) the first time a device sends punches for a user ID nobody is mapped to.
  if (unknown.size) {
    const ids = [...unknown];
    const body = `${device.name} sent punches for user ID${ids.length > 1 ? 's' : ''} ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}. Map ${ids.length > 1 ? 'them' : 'it'} to an employee so attendance is marked.`;
    for (const id of hrIds()) notify(id, 'Unmatched biometric punches', body, '/attendance-devices', { email: false });
  }
  return { accepted, duplicates, unmatched };
}

// ---------- JSON push (sync bridges, other vendors) ----------
biometricIngestRouter.post('/punches', (req, res) => {
  const key = req.get('X-Device-Key') || '';
  const device = key && get('SELECT * FROM biometric_devices WHERE key_hash = ? AND active = 1', hash(key));
  if (!device) return res.status(401).json({ error: 'Unknown or disabled device key' });
  const punches = Array.isArray(req.body?.punches) ? req.body.punches.slice(0, 5000) : [];
  if (!punches.length) throw httpError(400, 'Send { punches: [{ user_id, time, direction? }] }');
  res.json(ingest(device, punches));
});

// ---------- ZKTeco / eSSL iclock push protocol ----------
const bySerial = (sn) => (sn ? get('SELECT * FROM biometric_devices WHERE serial_no = ? AND active = 1', String(sn)) : null);
iclockRouter.use(express.text({ type: '*/*', limit: '2mb' }));

iclockRouter.get('/cdata', (req, res) => {
  const device = bySerial(req.query.SN);
  if (!device) return res.status(401).type('text/plain').send('Unknown device');
  run('UPDATE biometric_devices SET last_seen_at = ? WHERE id = ?', new Date().toISOString(), device.id);
  // Handshake: ask for attendance logs in real time.
  res.type('text/plain').send([`GET OPTION FROM: ${device.serial_no}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ErrorDelay=30', 'Delay=10',
    'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=1000000000', 'Realtime=1', 'Encrypt=0'].join('\n'));
});

iclockRouter.post('/cdata', (req, res) => {
  const device = bySerial(req.query.SN);
  if (!device) return res.status(401).type('text/plain').send('Unknown device');
  if (String(req.query.table || '').toUpperCase() !== 'ATTLOG') return res.type('text/plain').send('OK');
  // Each line: PIN \t YYYY-MM-DD HH:MM:SS \t status (0 in, 1 out, …) \t verify type …
  const punches = String(req.body || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const [pin, time, status, verify] = line.split('\t');
    return { user_id: pin, time, direction: status === '0' ? 'in' : status === '1' ? 'out' : null, verify: VERIFY[Number(verify)] || null };
  });
  const r = ingest(device, punches);
  res.type('text/plain').send(`OK: ${r.accepted}`);
});

iclockRouter.get('/getrequest', (req, res) => {
  if (!bySerial(req.query.SN)) return res.status(401).type('text/plain').send('Unknown device');
  res.type('text/plain').send('OK');
});
iclockRouter.post('/devicecmd', (req, res) => res.type('text/plain').send('OK'));

// ---------- HR: devices, punch log, mapping ----------
devicesRouter.use(HR);

devicesRouter.get('/devices', (req, res) => {
  res.json(all(`SELECT d.id, d.name, d.serial_no, d.location_id, d.key_prefix, d.active, d.last_seen_at, d.created_at, l.name AS location,
      (SELECT COUNT(*) FROM punch_logs p WHERE p.device_id = d.id) AS punches,
      (SELECT COUNT(*) FROM punch_logs p WHERE p.device_id = d.id AND p.employee_id IS NULL) AS unmatched,
      (SELECT MAX(punched_at) FROM punch_logs p WHERE p.device_id = d.id) AS last_punch
    FROM biometric_devices d LEFT JOIN locations l ON l.id = d.location_id ORDER BY d.name`));
});

const newKey = () => `bio_${crypto.randomBytes(20).toString('hex')}`;
devicesRouter.post('/devices', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const serial = String(req.body?.serial_no || '').trim();
  if (!name || !serial) throw httpError(400, 'Name and serial number are required');
  if (get('SELECT id FROM biometric_devices WHERE serial_no = ?', serial)) throw httpError(409, 'A device with this serial number exists');
  const key = newKey();
  const id = insert('biometric_devices', { name, serial_no: serial, location_id: req.body.location_id || null, key_hash: hash(key), key_prefix: key.slice(0, 10) });
  audit(req.user.id, 'create', 'biometric_devices', id);
  res.status(201).json({ id, key, serial_no: serial });
});

devicesRouter.put('/devices/:id', (req, res) => {
  const d = get('SELECT * FROM biometric_devices WHERE id = ?', req.params.id);
  if (!d) throw httpError(404, 'Device not found');
  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim() || d.name;
  if (req.body.location_id !== undefined) data.location_id = req.body.location_id || null;
  if (req.body.active !== undefined) data.active = req.body.active ? 1 : 0;
  update('biometric_devices', d.id, data);
  res.json({ ok: true });
});

devicesRouter.post('/devices/:id/rotate-key', (req, res) => {
  const d = get('SELECT * FROM biometric_devices WHERE id = ?', req.params.id);
  if (!d) throw httpError(404, 'Device not found');
  const key = newKey();
  update('biometric_devices', d.id, { key_hash: hash(key), key_prefix: key.slice(0, 10) });
  audit(req.user.id, 'rotate_key', 'biometric_devices', d.id);
  res.json({ key });
});

devicesRouter.delete('/devices/:id', (req, res) => {
  run('DELETE FROM biometric_devices WHERE id = ?', req.params.id);
  audit(req.user.id, 'delete', 'biometric_devices', Number(req.params.id));
  res.json({ ok: true });
});

devicesRouter.get('/punches', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) { where.push('substr(p.punched_at, 1, 10) = ?'); params.push(req.query.date); }
  if (req.query.unmatched === '1') where.push('p.employee_id IS NULL');
  if (req.query.device_id) { where.push('p.device_id = ?'); params.push(Number(req.query.device_id)); }
  res.json(all(`SELECT p.*, d.name AS device, ${NAME('e')} AS employee_name, e.emp_code, e.avatar_color FROM punch_logs p
    LEFT JOIN biometric_devices d ON d.id = p.device_id LEFT JOIN employees e ON e.id = p.employee_id
    WHERE ${where.join(' AND ')} ORDER BY p.punched_at DESC LIMIT 1000`, ...params));
});

/** Links a device user ID to an employee and applies all of that ID's unmatched punches. */
devicesRouter.post('/map', (req, res) => {
  const bid = String(req.body?.biometric_id || '').trim();
  const emp = get("SELECT id, first_name, last_name, biometric_id FROM employees WHERE id = ? AND status != 'exited'", Number(req.body?.employee_id));
  if (!bid || !emp) throw httpError(400, 'Choose the device user ID and an employee');
  const other = get('SELECT id FROM employees WHERE biometric_id = ? AND id != ?', bid, emp.id);
  if (other) throw httpError(409, 'This device user ID already belongs to another employee');
  let days = [];
  tx(() => {
    run('UPDATE employees SET biometric_id = ? WHERE id = ?', bid, emp.id);
    run('UPDATE punch_logs SET employee_id = ? WHERE biometric_id = ? AND employee_id IS NULL', emp.id, bid);
    days = all('SELECT DISTINCT substr(punched_at, 1, 10) AS d FROM punch_logs WHERE employee_id = ? AND biometric_id = ?', emp.id, bid).map((r) => r.d);
    for (const d of days) processDay(emp.id, d);
  });
  audit(req.user.id, 'map_biometric', 'employees', emp.id, { biometric_id: bid, days: days.length });
  res.json({ ok: true, days: days.length });
});
