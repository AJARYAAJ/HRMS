import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, scopeSql, isHR, reportIds } from '../auth.js';
import { crud } from '../crud.js';
import {
  audit, httpError, notify, today, parseDate, ymd, ensureLeaveBalances, offDayChecker, round2,
} from '../utils.js';
import { leaveRulesFor, employeeHolidayFilter, policyFor } from '../policies.js';

export const workforceRouter = Router();

const TYPE_LABEL = { wfh: 'work from home', on_duty: 'on-duty', comp_off: 'comp-off', overtime: 'overtime' };

// ---------- attendance requests: WFH, on-duty, comp-off credit, overtime ----------
export const attendanceRequestsRouter = crud({
  table: 'attendance_requests',
  label: 'attendance request',
  link: '/attendance?tab=requests',
  fields: ['employee_id', 'type', 'date', 'end_date', 'hours', 'reason'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  filters: ['status', 'type', 'employee_id'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color
           FROM attendance_requests t JOIN employees e ON e.id = t.employee_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    const ownerId = m.employee_id ?? user.id;
    if (!TYPE_LABEL[m.type]) throw httpError(400, 'Type must be wfh, on_duty, comp_off or overtime');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw httpError(400, 'Date is required');
    if (!m.reason) throw httpError(400, 'Please add a reason');
    if (['wfh', 'on_duty'].includes(m.type)) {
      const end = m.end_date || m.date;
      if (end < m.date) throw httpError(400, 'End date cannot be before start date');
      const clash = get(
        `SELECT id FROM attendance_requests WHERE employee_id = ? AND type IN ('wfh','on_duty') AND status IN ('pending','manager_approved','approved')
         AND date <= ? AND COALESCE(end_date, date) >= ? AND id != ?`, ownerId, end, m.date, existing?.id ?? 0,
      );
      if (clash) throw httpError(409, 'You already have a WFH / on-duty request for these dates');
      return { ...data, end_date: end, hours: null };
    }
    if (m.date > today()) throw httpError(400, `A ${TYPE_LABEL[m.type]} request must be for a day you already worked`);
    if (m.type === 'comp_off') {
      if (!offDayChecker(ownerId)(parseDate(m.date))) throw httpError(400, 'Comp-off can only be claimed for work on a weekly off or holiday');
      if (!get('SELECT id FROM attendance WHERE employee_id = ? AND date = ? AND clock_in IS NOT NULL', ownerId, m.date)) {
        throw httpError(400, 'No attendance was recorded on that day');
      }
      if (get("SELECT id FROM attendance_requests WHERE employee_id = ? AND type = 'comp_off' AND date = ? AND status != 'rejected' AND id != ?", ownerId, m.date, existing?.id ?? 0)) {
        throw httpError(409, 'Comp-off already claimed for that day');
      }
      return { ...data, end_date: null, hours: null };
    }
    const hours = Number(m.hours);
    if (!(hours >= 0.5 && hours <= 12)) throw httpError(400, 'Overtime must be between 0.5 and 12 hours');
    return { ...data, end_date: null, hours };
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    notify(emp?.manager_id, `New ${TYPE_LABEL[data.type]} request`, `${emp.first_name} ${emp.last_name} · ${data.date}${data.end_date && data.end_date !== data.date ? ` → ${data.end_date}` : ''}`, '/approvals');
  },
  onDecision(row, status) {
    if (status !== 'approved') return;
    if (row.type === 'comp_off') {
      const year = Number(row.date.slice(0, 4));
      ensureLeaveBalances(row.employee_id, year);
      run(`INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated, used)
           SELECT ?, id, ?, 0, 0 FROM leave_types WHERE code = 'CO'`, row.employee_id, year);
      run(`UPDATE leave_balances SET adjustment = adjustment + 1 WHERE employee_id = ? AND year = ?
           AND leave_type_id = (SELECT id FROM leave_types WHERE code = 'CO')`, row.employee_id, year);
      return;
    }
    if (row.type === 'overtime') {
      const rec = get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', row.employee_id, row.date);
      const mins = Math.round(row.hours * 60);
      if (rec) run('UPDATE attendance SET overtime_mins = MAX(COALESCE(overtime_mins, 0), ?) WHERE id = ?', mins, rec.id);
      else insert('attendance', { employee_id: row.employee_id, date: row.date, status: 'present', work_mode: 'office', overtime_mins: mins, notes: 'Overtime (approved)' });
      return;
    }
    // WFH / on-duty: mark each working day present with the right work mode.
    const isOff = offDayChecker(row.employee_id);
    const mode = row.type === 'wfh' ? 'remote' : 'field';
    for (let d = parseDate(row.date); d <= parseDate(row.end_date || row.date); d.setDate(d.getDate() + 1)) {
      const date = ymd(d);
      if (isOff(d)) continue;
      const rec = get('SELECT id, clock_in FROM attendance WHERE employee_id = ? AND date = ?', row.employee_id, date);
      const note = row.type === 'wfh' ? 'Work from home (approved)' : 'On duty (approved)';
      if (rec) update('attendance', rec.id, rec.clock_in ? { work_mode: mode, notes: note } : { work_mode: mode, status: 'present', notes: note });
      else insert('attendance', { employee_id: row.employee_id, date, status: 'present', work_mode: mode, notes: note });
    }
  },
});

// ---------- shift roster ----------
const weekDates = (start) => Array.from({ length: 7 }, (_, i) => { const d = parseDate(start); d.setDate(d.getDate() + i); return ymd(d); });

workforceRouter.get('/roster', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : today();
  const days = weekDates(start);
  const scope = scopeSql(req.user, 'e.id');
  const where = [`e.status != 'exited'`, scope.sql];
  const params = [...scope.params];
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(req.query.department_id); }
  const emps = all(
    `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.avatar_color, e.shift_id, d.name AS department, s.name AS default_shift
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN shifts s ON s.id = e.shift_id
     WHERE ${where.join(' AND ')} ORDER BY d.name, e.first_name`, ...params,
  );
  const entries = all(`SELECT * FROM shift_roster WHERE date BETWEEN ? AND ?`, days[0], days[6]);
  const byKey = Object.fromEntries(entries.map((r) => [`${r.employee_id}|${r.date}`, r]));
  res.json({
    days,
    shifts: all('SELECT * FROM shifts ORDER BY start_time'),
    rows: emps.map((e) => ({ ...e, days: days.map((d) => byKey[`${e.id}|${d}`] || null) })),
  });
});

workforceRouter.put('/roster', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  if (!entries.length) throw httpError(400, 'No roster changes supplied');
  if (entries.length > 2000) throw httpError(400, 'Too many roster changes in one request');
  const team = isHR(req.user) ? null : new Set([req.user.id, ...reportIds(req.user.id)]);
  tx(() => {
    for (const e of entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw httpError(400, 'Invalid roster date');
      if (team && !team.has(Number(e.employee_id))) throw httpError(403, 'You can only roster your own team');
      if (!e.shift_id && !e.week_off) run('DELETE FROM shift_roster WHERE employee_id = ? AND date = ?', e.employee_id, e.date);
      else run(`INSERT INTO shift_roster (employee_id, date, shift_id, week_off) VALUES (?, ?, ?, ?)
                ON CONFLICT(employee_id, date) DO UPDATE SET shift_id = excluded.shift_id, week_off = excluded.week_off`,
        e.employee_id, e.date, e.week_off ? null : e.shift_id, e.week_off ? 1 : 0);
    }
  });
  audit(req.user.id, 'update_roster', 'shift_roster', null, { changes: entries.length });
  // Tell each affected person once.
  for (const id of new Set(entries.map((e) => Number(e.employee_id)))) notify(id, 'Your shift roster was updated', 'Check your schedule for the coming days.', '/attendance', { email: false });
  res.json({ ok: true, changes: entries.length });
});

// Copy one week's roster onto the next (common "repeat last week" action).
workforceRouter.post('/roster/copy-week', requireRole('admin', 'hr', 'manager'), (req, res) => {
  const from = req.body.from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) throw httpError(400, 'Source week start is required');
  const src = weekDates(from);
  const team = isHR(req.user) ? null : [req.user.id, ...reportIds(req.user.id)];
  const rows = all(`SELECT * FROM shift_roster WHERE date BETWEEN ? AND ? ${team ? `AND employee_id IN (${team.join(',')})` : ''}`, src[0], src[6]);
  tx(() => {
    for (const r of rows) {
      const d = parseDate(r.date);
      d.setDate(d.getDate() + 7);
      run(`INSERT INTO shift_roster (employee_id, date, shift_id, week_off) VALUES (?, ?, ?, ?)
           ON CONFLICT(employee_id, date) DO UPDATE SET shift_id = excluded.shift_id, week_off = excluded.week_off`, r.employee_id, ymd(d), r.shift_id, r.week_off);
    }
  });
  res.json({ ok: true, copied: rows.length });
});

// ---------- optional (restricted) holidays ----------
// The employee's holiday list sets how many optional holidays they may pick; the organisation setting is the fallback.
const optionalLimit = (employeeId) => policyFor('holiday', employeeId)?.optional_limit ?? (Number(get("SELECT value FROM settings WHERE key = 'optional_holiday_limit'")?.value) || 2);

workforceRouter.get('/optional-holidays', (req, res) => {
  const year = String(req.query.year || new Date().getFullYear());
  const hf = employeeHolidayFilter(req.user.id);
  const rows = all(
    `SELECT h.*, EXISTS(SELECT 1 FROM optional_holiday_choices c WHERE c.holiday_id = h.id AND c.employee_id = ?) AS chosen,
            (SELECT COUNT(*) FROM optional_holiday_choices c WHERE c.holiday_id = h.id) AS takers
     FROM holidays h WHERE h.type = 'Optional' AND substr(h.date, 1, 4) = ? AND ${hf.sql} ORDER BY h.date`, req.user.id, year, ...hf.params,
  );
  res.json({ limit: optionalLimit(req.user.id), list: policyFor('holiday', req.user.id)?.name || null, used: rows.filter((r) => r.chosen).length, holidays: rows });
});

workforceRouter.post('/optional-holidays/:id', (req, res) => {
  const h = get("SELECT * FROM holidays WHERE id = ? AND type = 'Optional'", req.params.id);
  if (!h) throw httpError(404, 'Optional holiday not found');
  if (h.date <= today()) throw httpError(400, 'You can only change future optional holidays');
  const chosen = get('SELECT 1 FROM optional_holiday_choices WHERE employee_id = ? AND holiday_id = ?', req.user.id, h.id);
  if (chosen) {
    run('DELETE FROM optional_holiday_choices WHERE employee_id = ? AND holiday_id = ?', req.user.id, h.id);
    run("DELETE FROM attendance WHERE employee_id = ? AND date = ? AND status = 'holiday'", req.user.id, h.date);
  } else {
    const used = get(
      `SELECT COUNT(*) AS n FROM optional_holiday_choices c JOIN holidays x ON x.id = c.holiday_id WHERE c.employee_id = ? AND substr(x.date, 1, 4) = ?`,
      req.user.id, h.date.slice(0, 4),
    ).n;
    if (used >= optionalLimit(req.user.id)) throw httpError(400, `You can choose at most ${optionalLimit(req.user.id)} optional holidays a year`);
    if (get("SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending','manager_approved','approved') AND ? BETWEEN start_date AND end_date", req.user.id, h.date)) {
      throw httpError(409, 'You already have leave on that day');
    }
    insert('optional_holiday_choices', { employee_id: req.user.id, holiday_id: h.id });
  }
  audit(req.user.id, chosen ? 'drop_optional_holiday' : 'choose_optional_holiday', 'holidays', h.id);
  res.json({ chosen: !chosen });
});

// ---------- leave year-end processing ----------
/**
 * Opens the next leave year. Unused balance of carry-forward leave moves into next year's `carried` (capped by
 * the employee's leave plan rule, or the organisation cap for types without a plan); anything above the cap is
 * reported as encashable when the rule allows encashment. Next year's entitlement comes from the plan.
 * Safe to re-run: it recalculates next year's carried balances.
 */
workforceRouter.post('/leave-year-end', requireRole('admin', 'hr'), (req, res) => {
  const year = Number(req.body.year) || new Date().getFullYear();
  const orgCap = Number(get("SELECT value FROM settings WHERE key = 'carry_forward_cap'")?.value) || 30;
  const next = year + 1;
  const types = all('SELECT * FROM leave_types');
  const emps = all("SELECT id FROM employees WHERE status != 'exited'");
  let carried = 0;
  let encashable = 0;
  const details = [];
  tx(() => {
    for (const e of emps) {
      ensureLeaveBalances(e.id, year);
      ensureLeaveBalances(e.id, next);
      const lr = leaveRulesFor(e.id);
      for (const t of types) {
        if (t.code === 'LOP') continue;
        const rule = lr?.rules.get(t.id);
        if (lr && !rule) continue;
        const b = get('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', e.id, t.id, year);
        const left = Math.max(0, (b?.allocated || 0) + (b?.carried || 0) + (b?.adjustment || 0) - (b?.used || 0));
        const cap = rule ? Number(rule.carry_forward_cap) || 0 : t.carry_forward ? orgCap : 0;
        const carry = Math.min(left, cap);
        const encash = (rule ? rule.encashable : t.carry_forward) ? Math.max(0, left - cap) : 0;
        carried += carry;
        encashable += encash;
        if (carry || encash) details.push({ employee_id: e.id, leave_type: t.code, carry, encash });
        run(`INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated, used, carried) VALUES (?, ?, ?, ?, 0, ?)
             ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET carried = excluded.carried`, e.id, t.id, next, rule ? 0 : t.annual_quota, carry);
      }
    }
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('leave_year_closed', ?)", String(year));
  });
  audit(req.user.id, 'leave_year_end', 'leave_balances', null, { year, carried, encashable });
  res.json({ year, next_year: next, employees: emps.length, carried_days: round2(carried), encashable_days: round2(encashable), cap: orgCap, details });
});

