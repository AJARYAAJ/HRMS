import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR, reportIds, scopeSql } from '../auth.js';
import { audit, httpError, notify, today, ymd, round2 } from '../utils.js';
import { singleFile, removeFile } from '../uploads.js';

/**
 * Workforce activity analytics (We360-style).
 *
 * A desktop agent authenticates with a per-device token and posts heartbeats describing what was in
 * focus (app / website) and how many of those seconds were active vs idle. The server classifies each
 * heartbeat with the app rules, keeps the raw timeline, maintains the daily `productivity` rollup,
 * raises alerts (long idle, unproductive time, overwork) and can accept screenshots when enabled.
 */
export const agentRouter = Router(); // device-token authenticated (used by the agent)
export const activityRouter = Router(); // user authenticated (dashboards & admin)

const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
/** "https://www.YouTube.com/watch?v=1" → "youtube.com", so the same site always aggregates together. */
const normDomain = (d) => String(d || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#:].*$/, '').slice(0, 200) || null;

export const ACTIVITY_DEFAULTS = {
  screenshots_enabled: '0', screenshot_interval_mins: '10', idle_alert_minutes: '30',
  unproductive_alert_minutes: '60', overwork_hours: '10', activity_attendance: '1', live_window_minutes: '3',
};
export function activitySettings() {
  const saved = Object.fromEntries(all("SELECT key, value FROM settings WHERE key LIKE 'activity_%' OR key IN ('screenshots_enabled','screenshot_interval_mins','idle_alert_minutes','unproductive_alert_minutes','overwork_hours','live_window_minutes')").map((r) => [r.key, r.value]));
  return { ...ACTIVITY_DEFAULTS, ...saved };
}

// ---------- classification ----------
export function classifier() {
  const rules = all('SELECT * FROM app_rules ORDER BY department_id IS NULL, length(pattern) DESC');
  return (app, domain, departmentId) => {
    const a = String(app || '').toLowerCase();
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    for (const r of rules) {
      if (r.department_id && r.department_id !== departmentId) continue;
      const p = r.pattern.toLowerCase();
      if ((d && (d === p || d.endsWith(`.${p}`))) || (a && (a === p || a.includes(p)))) return r.category;
    }
    return 'neutral';
  };
}

/** Recompute the daily rollup (productivity table) for one employee/day from raw events. */
export function rollupDay(employeeId, date) {
  const rows = all(
    `SELECT category, SUM(active_seconds) AS active, SUM(idle_seconds) AS idle FROM activity_events
     WHERE employee_id = ? AND substr(ts, 1, 10) = ? GROUP BY category`, employeeId, date,
  );
  if (!rows.length) return;
  const mins = (cat) => Math.round((rows.find((r) => r.category === cat)?.active || 0) / 60);
  const idle = Math.round(rows.reduce((a, r) => a + (r.idle || 0), 0) / 60);
  const apps = all(
    `SELECT COALESCE(NULLIF(domain, ''), app) AS name, category, ROUND(SUM(active_seconds) / 60.0) AS minutes FROM activity_events
     WHERE employee_id = ? AND substr(ts, 1, 10) = ? AND active_seconds > 0 GROUP BY name, category ORDER BY minutes DESC LIMIT 8`, employeeId, date,
  );
  run(`INSERT INTO productivity (employee_id, date, productive_mins, neutral_mins, unproductive_mins, idle_mins, top_apps) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, date) DO UPDATE SET productive_mins = excluded.productive_mins, neutral_mins = excluded.neutral_mins,
       unproductive_mins = excluded.unproductive_mins, idle_mins = excluded.idle_mins, top_apps = excluded.top_apps`,
  employeeId, date, mins('productive'), mins('neutral'), mins('unproductive'), idle, JSON.stringify(apps));
}

/** Raise alerts for a day (one per type per day). Returns the alerts created. */
export function evaluateAlerts(employeeId, date) {
  const s = activitySettings();
  const created = [];
  const raise = (type, severity, message) => {
    const info = run('INSERT OR IGNORE INTO activity_alerts (employee_id, type, severity, message, date) VALUES (?, ?, ?, ?, ?)', employeeId, type, severity, message, date);
    if (info.changes) created.push({ type, message });
  };
  const day = get('SELECT * FROM productivity WHERE employee_id = ? AND date = ?', employeeId, date);
  if (!day) return created;
  const active = day.productive_mins + day.neutral_mins + day.unproductive_mins;
  if (day.unproductive_mins >= Number(s.unproductive_alert_minutes)) raise('unproductive', 'medium', `${day.unproductive_mins} min on unproductive apps/sites`);
  if (active >= Number(s.overwork_hours) * 60) raise('overwork', 'high', `${round2(active / 60)} h of active time — burnout risk`);
  // Longest continuous idle streak from the raw timeline.
  const events = all('SELECT ts, active_seconds, idle_seconds FROM activity_events WHERE employee_id = ? AND substr(ts, 1, 10) = ? ORDER BY ts', employeeId, date);
  let streak = 0;
  let longest = 0;
  for (const e of events) {
    if (e.active_seconds === 0 && e.idle_seconds > 0) { streak += e.idle_seconds; longest = Math.max(longest, streak); } else streak = 0;
  }
  if (longest / 60 >= Number(s.idle_alert_minutes)) raise('long_idle', 'low', `Idle for ${Math.round(longest / 60)} min at a stretch`);
  if (created.length) {
    const mgr = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', employeeId);
    for (const a of created) notify(mgr?.manager_id, `Activity alert: ${mgr.first_name} ${mgr.last_name}`, a.message, `/productivity/${employeeId}`, { email: false });
  }
  return created;
}

// ---------- agent API (device token) ----------
function deviceAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Device ') ? header.slice(7) : req.headers['x-device-token'];
  if (!token) return res.status(401).json({ error: 'Device token required' });
  const device = get(
    `SELECT d.*, e.department_id, e.status AS employee_status FROM agent_devices d JOIN employees e ON e.id = d.employee_id
     WHERE d.token_hash = ? AND d.revoked = 0`, hashToken(String(token)),
  );
  if (!device || device.employee_status === 'exited') return res.status(401).json({ error: 'Invalid or revoked device token' });
  req.device = device;
  next();
}
agentRouter.use(deviceAuth);

agentRouter.get('/config', (req, res) => {
  const s = activitySettings();
  res.json({
    employee_id: req.device.employee_id, device_id: req.device.id, heartbeat_seconds: 60,
    screenshots_enabled: s.screenshots_enabled === '1', screenshot_interval_mins: Number(s.screenshot_interval_mins),
  });
});

agentRouter.post('/heartbeat', (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
  if (!events.length || events.length > 500) throw httpError(400, 'Send between 1 and 500 events per request');
  const classify = classifier();
  const { employee_id: employeeId, department_id: departmentId } = req.device;
  const dates = new Set();
  const now = Date.now();
  tx(() => {
    for (const e of events) {
      const ts = new Date(e.ts || now);
      if (Number.isNaN(ts.getTime()) || ts.getTime() > now + 5 * 60000 || ts.getTime() < now - 7 * 86400000) throw httpError(400, 'Event timestamps must be within the last 7 days');
      const active = Math.max(0, Math.min(3600, Math.round(Number(e.active_seconds) || 0)));
      const idle = Math.max(0, Math.min(3600 - active, Math.round(Number(e.idle_seconds) || 0)));
      // Local wall-clock time, so days and hours line up with attendance.
      const local = `${ymd(ts)} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`;
      insert('activity_events', {
        employee_id: employeeId, device_id: req.device.id, ts: local, app: String(e.app || '').slice(0, 120) || null,
        domain: normDomain(e.domain), title: String(e.title || '').slice(0, 300) || null,
        category: classify(e.app, e.domain, departmentId), active_seconds: active, idle_seconds: idle,
      });
      dates.add(local.slice(0, 10));
    }
    run("UPDATE agent_devices SET last_seen_at = datetime('now') WHERE id = ?", req.device.id);
    for (const d of dates) rollupDay(employeeId, d);
    // Auto attendance: the first activity of the day clocks the employee in (if they haven't already).
    if (activitySettings().activity_attendance === '1' && dates.has(today())) {
      const first = get("SELECT MIN(ts) AS t FROM activity_events WHERE employee_id = ? AND substr(ts, 1, 10) = ? AND active_seconds > 0", employeeId, today()).t;
      if (first && !get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', employeeId, today())) {
        insert('attendance', { employee_id: employeeId, date: today(), clock_in: first.slice(11, 16), status: 'present', work_mode: 'remote', notes: 'Auto clock-in from activity agent' });
      }
    }
  });
  const alerts = [...dates].flatMap((d) => evaluateAlerts(employeeId, d));
  res.status(202).json({ accepted: events.length, alerts: alerts.length });
});

agentRouter.post('/screenshot', singleFile(), (req, res) => {
  if (activitySettings().screenshots_enabled !== '1') { removeFile(req.file.filename); throw httpError(403, 'Screenshots are disabled for this organisation'); }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) { removeFile(req.file.filename); throw httpError(415, 'Screenshots must be PNG, JPEG or WebP'); }
  const id = insert('attachments', {
    entity: 'screenshots', entity_id: req.device.employee_id, stored_name: req.file.filename,
    original_name: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${req.file.filename.split('.').pop()}`,
    mime_type: req.file.mimetype, size: req.file.size, uploaded_by: req.device.employee_id,
  });
  res.status(201).json({ id });
});

// ---------- devices (agent tokens) ----------
activityRouter.get('/devices', (req, res) => {
  const where = isHR(req.user) ? (req.query.employee_id ? 'WHERE d.employee_id = ?' : '') : 'WHERE d.employee_id = ?';
  const params = isHR(req.user) ? (req.query.employee_id ? [req.query.employee_id] : []) : [req.user.id];
  res.json(all(
    `SELECT d.id, d.employee_id, d.name, d.platform, d.last_seen_at, d.revoked, d.created_at, ${NAME('e')} AS employee_name, e.avatar_color
     FROM agent_devices d JOIN employees e ON e.id = d.employee_id ${where} ORDER BY d.id DESC`, ...params,
  ));
});

activityRouter.post('/devices', (req, res) => {
  const employeeId = isHR(req.user) && req.body.employee_id ? Number(req.body.employee_id) : req.user.id;
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Give the device a name, e.g. "Work laptop"');
  if (!get("SELECT id FROM employees WHERE id = ? AND status != 'exited'", employeeId)) throw httpError(404, 'Employee not found');
  const token = `phd_${crypto.randomBytes(24).toString('base64url')}`;
  const id = insert('agent_devices', { employee_id: employeeId, name, platform: req.body.platform || null, token_hash: hashToken(token) });
  audit(req.user.id, 'create_device', 'agent_devices', id, { employee_id: employeeId });
  // The token is shown exactly once; only its hash is stored.
  res.status(201).json({ id, token, employee_id: employeeId, name });
});

activityRouter.delete('/devices/:id', (req, res) => {
  const d = get('SELECT * FROM agent_devices WHERE id = ?', req.params.id);
  if (!d || (d.employee_id !== req.user.id && !isHR(req.user))) throw httpError(404, 'Device not found');
  update('agent_devices', d.id, { revoked: 1 });
  audit(req.user.id, 'revoke_device', 'agent_devices', d.id);
  res.json({ ok: true });
});

// ---------- live board ----------
activityRouter.get('/live', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const scope = scopeSql(req.user, 'e.id');
  const windowMins = Number(activitySettings().live_window_minutes) || 3;
  const date = today();
  const rows = all(
    `SELECT e.id, ${NAME('e')} AS name, e.avatar_color, d.name AS department, g.title AS designation,
            (SELECT MAX(ts) FROM activity_events a WHERE a.employee_id = e.id) AS last_ts,
            p.productive_mins, p.neutral_mins, p.unproductive_mins, p.idle_mins, att.clock_in, att.clock_out
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id
     LEFT JOIN productivity p ON p.employee_id = e.id AND p.date = ?
     LEFT JOIN attendance att ON att.employee_id = e.id AND att.date = ?
     WHERE e.status != 'exited' AND ${scope.sql} ORDER BY e.first_name`, date, date, ...scope.params,
  );
  const now = Date.now();
  const out = rows.map((r) => {
    const last = r.last_ts ? get('SELECT app, domain, title, category, active_seconds FROM activity_events WHERE employee_id = ? AND ts = ? ORDER BY id DESC LIMIT 1', r.id, r.last_ts) : null;
    const ageMin = r.last_ts ? (now - new Date(r.last_ts.replace(' ', 'T')).getTime()) / 60000 : Infinity;
    const status = ageMin <= windowMins ? (last?.active_seconds > 0 ? 'active' : 'idle') : 'offline';
    const active = (r.productive_mins || 0) + (r.neutral_mins || 0) + (r.unproductive_mins || 0);
    return {
      ...r, status, last_seen_minutes: Number.isFinite(ageMin) ? Math.round(ageMin) : null,
      current: status === 'offline' ? null : last && { app: last.app, domain: last.domain, title: last.title, category: last.category },
      active_mins: active, score: active + (r.idle_mins || 0) ? Math.round(((r.productive_mins || 0) / (active + (r.idle_mins || 0))) * 100) : 0,
    };
  });
  res.json({
    counts: { active: out.filter((r) => r.status === 'active').length, idle: out.filter((r) => r.status === 'idle').length, offline: out.filter((r) => r.status === 'offline').length },
    rows: out,
  });
});

// ---------- per-employee detail (timeline) ----------
activityRouter.get('/employee/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id && !isHR(req.user) && !reportIds(req.user.id).includes(id)) throw httpError(403, 'Not allowed');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const emp = get(`SELECT e.id, ${NAME('e')} AS name, e.avatar_color, d.name AS department, g.title AS designation FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id WHERE e.id = ?`, id);
  if (!emp) throw httpError(404, 'Employee not found');
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, productive: 0, neutral: 0, unproductive: 0, idle: 0 }));
  for (const r of all(
    `SELECT CAST(substr(ts, 12, 2) AS INTEGER) AS h, category, SUM(active_seconds) AS active, SUM(idle_seconds) AS idle
     FROM activity_events WHERE employee_id = ? AND substr(ts, 1, 10) = ? GROUP BY h, category`, id, date,
  )) {
    hourly[r.h][r.category] += Math.round(r.active / 60);
    hourly[r.h].idle += Math.round(r.idle / 60);
  }
  const usage = (col) => all(
    `SELECT ${col} AS name, category, ROUND(SUM(active_seconds) / 60.0) AS minutes FROM activity_events
     WHERE employee_id = ? AND substr(ts, 1, 10) = ? AND ${col} IS NOT NULL AND ${col} != '' AND active_seconds > 0
     GROUP BY ${col}, category ORDER BY minutes DESC LIMIT 15`, id, date,
  );
  const span = get("SELECT MIN(ts) AS first, MAX(ts) AS last FROM activity_events WHERE employee_id = ? AND substr(ts, 1, 10) = ?", id, date);
  const totals = get('SELECT * FROM productivity WHERE employee_id = ? AND date = ?', id, date);
  const trendFrom = new Date(`${date}T00:00:00`);
  trendFrom.setDate(trendFrom.getDate() - 13);
  const canSeeShots = isHR(req.user) || reportIds(req.user.id).includes(id) || id === req.user.id;
  res.json({
    employee: emp, date, hourly, apps: usage('app'), domains: usage('domain'),
    first_activity: span?.first?.slice(11, 16) || null, last_activity: span?.last?.slice(11, 16) || null,
    totals: totals || null,
    attendance: get('SELECT clock_in, clock_out, status, work_mode FROM attendance WHERE employee_id = ? AND date = ?', id, date) || null,
    trend: all('SELECT date, productive_mins, neutral_mins, unproductive_mins, idle_mins FROM productivity WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date', id, ymd(trendFrom), date),
    alerts: all('SELECT * FROM activity_alerts WHERE employee_id = ? ORDER BY date DESC, id DESC LIMIT 20', id),
    screenshots: canSeeShots ? all("SELECT id, original_name, mime_type, size, created_at FROM attachments WHERE entity = 'screenshots' AND entity_id = ? AND substr(created_at, 1, 10) = ? ORDER BY id DESC LIMIT 60", id, date) : [],
    devices: all('SELECT id, name, platform, last_seen_at, revoked FROM agent_devices WHERE employee_id = ? ORDER BY id DESC', id),
  });
});

// ---------- alerts ----------
activityRouter.get('/alerts', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const scope = scopeSql(req.user, 'a.employee_id');
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.query.type) { where.push('a.type = ?'); params.push(req.query.type); }
  if (req.query.unacknowledged) where.push('a.acknowledged = 0');
  res.json(all(
    `SELECT a.*, ${NAME('e')} AS employee_name, e.avatar_color FROM activity_alerts a JOIN employees e ON e.id = a.employee_id
     WHERE ${where.join(' AND ')} ORDER BY a.date DESC, a.id DESC LIMIT 500`, ...params,
  ));
});

activityRouter.post('/alerts/:id/ack', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const a = get('SELECT * FROM activity_alerts WHERE id = ?', req.params.id);
  if (!a || (!isHR(req.user) && !reportIds(req.user.id).includes(a.employee_id))) throw httpError(404, 'Alert not found');
  update('activity_alerts', a.id, { acknowledged: 1 });
  res.json({ ok: true });
});

// ---------- classification rules ----------
activityRouter.get('/rules', (req, res) => {
  res.json(all('SELECT r.*, d.name AS department FROM app_rules r LEFT JOIN departments d ON d.id = r.department_id ORDER BY r.category, r.pattern'));
});

activityRouter.post('/rules', requireRole('admin', 'hr'), (req, res) => {
  const pattern = String(req.body.pattern || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!pattern) throw httpError(400, 'Enter an app name or website domain');
  if (!['productive', 'neutral', 'unproductive'].includes(req.body.category)) throw httpError(400, 'Category must be productive, neutral or unproductive');
  const deptId = req.body.department_id || null;
  if (get('SELECT id FROM app_rules WHERE pattern = ? AND department_id IS ?', pattern, deptId)) throw httpError(409, 'A rule for this app/site already exists for that scope');
  const id = insert('app_rules', { pattern, category: req.body.category, department_id: deptId });
  audit(req.user.id, 'create', 'app_rules', id, { pattern, category: req.body.category });
  res.status(201).json(get('SELECT * FROM app_rules WHERE id = ?', id));
});

activityRouter.put('/rules/:id', requireRole('admin', 'hr'), (req, res) => {
  if (!['productive', 'neutral', 'unproductive'].includes(req.body.category)) throw httpError(400, 'Invalid category');
  update('app_rules', Number(req.params.id), { category: req.body.category });
  res.json(get('SELECT * FROM app_rules WHERE id = ?', req.params.id));
});

activityRouter.delete('/rules/:id', requireRole('admin', 'hr'), (req, res) => {
  run('DELETE FROM app_rules WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// Re-classify recent history after changing rules.
activityRouter.post('/rules/reapply', requireRole('admin', 'hr'), (req, res) => {
  const days = Math.max(1, Math.min(31, Number(req.body.days) || 7));
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  const classify = classifier();
  const events = all(
    `SELECT a.id, a.app, a.domain, a.category, a.employee_id, substr(a.ts, 1, 10) AS date, e.department_id FROM activity_events a
     JOIN employees e ON e.id = a.employee_id WHERE substr(a.ts, 1, 10) >= ?`, ymd(from),
  );
  let changed = 0;
  const touched = new Set();
  tx(() => {
    for (const e of events) {
      const cat = classify(e.app, e.domain, e.department_id);
      if (cat !== e.category) { run('UPDATE activity_events SET category = ? WHERE id = ?', cat, e.id); changed++; touched.add(`${e.employee_id}|${e.date}`); }
    }
    for (const k of touched) { const [emp, date] = k.split('|'); rollupDay(Number(emp), date); }
  });
  audit(req.user.id, 'reapply_rules', 'app_rules', null, { days, changed });
  res.json({ scanned: events.length, changed, days_recomputed: touched.size });
});

// ---------- settings ----------
activityRouter.get('/settings', requireRole('admin', 'hr', 'manager'), (req, res) => res.json(activitySettings()));
activityRouter.put('/settings', requireRole('admin', 'hr'), (req, res) => {
  const b = req.body || {};
  const num = (k, min, max) => {
    if (!(k in b)) return;
    const v = Number(b[k]);
    if (!(v >= min && v <= max)) throw httpError(400, `${k.replace(/_/g, ' ')} must be between ${min} and ${max}`);
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v));
  };
  tx(() => {
    for (const k of ['screenshots_enabled', 'activity_attendance']) if (k in b) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, b[k] ? '1' : '0');
    num('screenshot_interval_mins', 1, 120);
    num('idle_alert_minutes', 5, 240);
    num('unproductive_alert_minutes', 10, 480);
    num('overwork_hours', 6, 16);
    num('live_window_minutes', 1, 30);
  });
  audit(req.user.id, 'update', 'settings', null, { activity: Object.keys(b) });
  res.json(activitySettings());
});
