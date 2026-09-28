import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scopeSql, canManage, isHR } from '../auth.js';
import { crud } from '../crud.js';
import {
  today, nowTime, minutes, httpError, monthRange, workingDaysBetween, holidaySet, audit, notify,
  ensureLeaveBalances, parseDate, ymd, isWeekend, notifyHR,
} from '../utils.js';

export const attendanceRouter = Router();
export const leaveRouter = Router();

const DEFAULT_SHIFT = { start_time: '09:30', end_time: '18:30', grace_minutes: 15 };
const shiftFor = (employeeId) =>
  get('SELECT s.* FROM shifts s JOIN employees e ON e.shift_id = s.id WHERE e.id = ?', employeeId) || DEFAULT_SHIFT;

export function evaluateDay(clockIn, clockOut, shift) {
  const late = minutes(clockIn) > minutes(shift.start_time) + (shift.grace_minutes ?? 15) ? 1 : 0;
  if (!clockOut) return { status: 'present', late };
  const worked = minutes(clockOut) - minutes(clockIn);
  const shiftLen = minutes(shift.end_time) - minutes(shift.start_time);
  const status = worked >= shiftLen * 0.75 ? 'present' : worked >= shiftLen * 0.4 ? 'half_day' : 'absent';
  return { status, late };
}

// ---------- attendance ----------
attendanceRouter.get('/today', (req, res) => {
  const record = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  res.json({ record: record || null, shift: shiftFor(req.user.id), server_time: nowTime(), date: today() });
});

attendanceRouter.post('/clock-in', (req, res) => {
  const existing = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  if (existing?.clock_in) throw httpError(400, `Already clocked in at ${existing.clock_in}`);
  const time = nowTime();
  const { late } = evaluateDay(time, null, shiftFor(req.user.id));
  const work_mode = ['office', 'remote', 'field'].includes(req.body?.work_mode) ? req.body.work_mode : 'office';
  if (existing) update('attendance', existing.id, { clock_in: time, status: 'present', late, work_mode });
  else insert('attendance', { employee_id: req.user.id, date: today(), clock_in: time, status: 'present', late, work_mode });
  audit(req.user.id, 'clock_in', 'attendance', null, { time, work_mode });
  res.json(get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today()));
});

attendanceRouter.post('/clock-out', (req, res) => {
  const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  if (!rec?.clock_in) throw httpError(400, 'You have not clocked in today');
  if (rec.clock_out) throw httpError(400, `Already clocked out at ${rec.clock_out}`);
  let time = nowTime();
  if (minutes(time) < minutes(rec.clock_in)) time = rec.clock_in;
  const { status, late } = evaluateDay(rec.clock_in, time, shiftFor(req.user.id));
  update('attendance', rec.id, { clock_out: time, status, late });
  audit(req.user.id, 'clock_out', 'attendance', rec.id, { time });
  res.json(get('SELECT * FROM attendance WHERE id = ?', rec.id));
});

attendanceRouter.get('/', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !canManage(req.user, employeeId)) throw httpError(403, 'Not allowed to view this attendance');
  const month = req.query.month || today().slice(0, 7);
  const { start, end } = monthRange(month);
  const records = all('SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date', employeeId, start, end);
  const holidays = all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', start, end);
  const upto = end < today() ? end : today();
  const workingDays = upto >= start ? workingDaysBetween(start, upto) : 0;
  const count = (s) => records.filter((r) => r.status === s).length;
  const workedMins = records.reduce((a, r) => a + (r.clock_out ? minutes(r.clock_out) - minutes(r.clock_in) : 0), 0);
  const daysWithHours = records.filter((r) => r.clock_out).length;
  const present = count('present') + count('half_day') * 0.5;
  res.json({
    records, holidays,
    summary: {
      working_days: workingDays,
      present: count('present'), half_day: count('half_day'), leave: count('leave'),
      absent: Math.max(0, workingDays - count('present') - count('half_day') - count('leave')),
      late: records.filter((r) => r.late).length,
      remote: records.filter((r) => r.work_mode === 'remote').length,
      avg_hours: daysWithHours ? Math.round((workedMins / daysWithHours / 60) * 10) / 10 : 0,
      attendance_pct: workingDays ? Math.round(((present + count('leave')) / workingDays) * 100) : 0,
    },
  });
});

attendanceRouter.get('/team-today', (req, res) => {
  const date = req.query.date || today();
  const scope = scopeSql(req.user, 'e.id');
  const rows = all(
    `SELECT e.id, e.first_name, e.last_name, e.avatar_color, e.emp_code, d.name AS department, g.title AS designation,
            a.clock_in, a.clock_out, a.status, a.late, a.work_mode,
            (SELECT lt.name FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
              WHERE lr.employee_id = e.id AND lr.status = 'approved' AND ? BETWEEN lr.start_date AND lr.end_date) AS on_leave
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN designations g ON g.id = e.designation_id
     LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
     WHERE e.status != 'exited' AND ${scope.sql}
     ORDER BY e.first_name`,
    date, date, ...scope.params,
  );
  const stats = {
    total: rows.length,
    present: rows.filter((r) => r.clock_in).length,
    late: rows.filter((r) => r.late).length,
    on_leave: rows.filter((r) => r.on_leave).length,
    remote: rows.filter((r) => r.work_mode === 'remote' && r.clock_in).length,
  };
  stats.not_in = stats.total - stats.present - stats.on_leave;
  res.json({ date, stats, rows });
});

export const regularizationsRouter = crud({
  table: 'regularizations',
  label: 'attendance regularization',
  link: '/attendance',
  fields: ['employee_id', 'date', 'clock_in', 'clock_out', 'reason', 'status'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  filters: ['status', 'employee_id'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color
           FROM regularizations t JOIN employees e ON e.id = t.employee_id`,
  validate(data, user, existing) {
    const merged = { ...existing, ...data };
    if (!merged.date || !merged.clock_in || !merged.clock_out) throw httpError(400, 'Date, clock-in and clock-out are required');
    if (merged.date > today()) throw httpError(400, 'Cannot regularize a future date');
    if (minutes(merged.clock_out) <= minutes(merged.clock_in)) throw httpError(400, 'Clock-out must be after clock-in');
    return data;
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    notify(emp?.manager_id, 'Regularization request', `${emp.first_name} ${emp.last_name} requested regularization for ${data.date}`, '/approvals');
  },
  onDecision(row, status) {
    if (status !== 'approved') return;
    const { status: dayStatus, late } = evaluateDay(row.clock_in, row.clock_out, shiftFor(row.employee_id));
    const rec = get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', row.employee_id, row.date);
    const data = { clock_in: row.clock_in, clock_out: row.clock_out, status: dayStatus, late, notes: 'Regularized' };
    if (rec) update('attendance', rec.id, data);
    else insert('attendance', { employee_id: row.employee_id, date: row.date, work_mode: 'office', ...data });
  },
});

export const shiftsRouter = crud({
  table: 'shifts', fields: ['name', 'start_time', 'end_time', 'grace_minutes'], readAll: true, order: 't.start_time',
});

// ---------- leave ----------
export const leaveTypesRouter = crud({
  table: 'leave_types', label: 'leave type',
  fields: ['name', 'code', 'annual_quota', 'paid', 'carry_forward', 'color'], readAll: true, order: 't.id',
  afterCreate() {
    for (const { id } of all("SELECT id FROM employees WHERE status != 'exited'")) ensureLeaveBalances(id);
  },
});

export const holidaysRouter = crud({
  table: 'holidays', label: 'holiday', fields: ['name', 'date', 'type'], readAll: true, order: 't.date', dateField: 'date',
});

function balancesFor(employeeId, year) {
  ensureLeaveBalances(employeeId, year);
  return all(
    `SELECT lt.id AS leave_type_id, lt.name, lt.code, lt.color, lt.paid, b.allocated, b.used,
            COALESCE((SELECT SUM(days) FROM leave_requests r WHERE r.employee_id = b.employee_id
              AND r.leave_type_id = lt.id AND r.status = 'pending' AND substr(r.start_date,1,4) = ?), 0) AS pending
     FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id
     WHERE b.employee_id = ? AND b.year = ? ORDER BY lt.id`,
    String(year), employeeId, year,
  ).map((b) => ({ ...b, available: b.code === 'LOP' ? null : b.allocated - b.used - b.pending }));
}

leaveRouter.get('/balances', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !canManage(req.user, employeeId)) throw httpError(403, 'Not allowed');
  res.json(balancesFor(employeeId, Number(req.query.year) || new Date().getFullYear()));
});

leaveRouter.get('/calendar', (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const { start, end } = monthRange(month);
  const leaves = all(
    `SELECT r.id, r.start_date, r.end_date, r.days, r.status, lt.name AS leave_type, lt.color,
            e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color
     FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.status IN ('approved','pending') AND r.start_date <= ? AND r.end_date >= ? ORDER BY r.start_date`,
    end, start,
  );
  res.json({ leaves, holidays: all('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', start, end) });
});

function markLeaveAttendance(row) {
  const holidays = holidaySet();
  for (let d = parseDate(row.start_date); d <= parseDate(row.end_date); d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    if (isWeekend(d) || holidays.has(date)) continue;
    const rec = get('SELECT id, clock_in FROM attendance WHERE employee_id = ? AND date = ?', row.employee_id, date);
    if (rec?.clock_in && row.half_day) continue;
    if (rec) update('attendance', rec.id, { status: 'leave' });
    else insert('attendance', { employee_id: row.employee_id, date, status: 'leave', work_mode: null });
  }
}

const requestsCrud = crud({
  table: 'leave_requests',
  label: 'leave request',
  link: '/leave',
  fields: ['employee_id', 'leave_type_id', 'start_date', 'end_date', 'half_day', 'reason'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  write: ['admin', 'hr'],
  filters: ['status', 'employee_id', 'leave_type_id'],
  select: `SELECT t.*, lt.name AS leave_type, lt.color, lt.code,
                  e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color,
                  a.first_name || ' ' || a.last_name AS approver_name
           FROM leave_requests t JOIN employees e ON e.id = t.employee_id
           JOIN leave_types lt ON lt.id = t.leave_type_id
           LEFT JOIN employees a ON a.id = t.approver_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.leave_type_id || !m.start_date || !m.end_date) throw httpError(400, 'Leave type, start and end date are required');
    if (m.end_date < m.start_date) throw httpError(400, 'End date cannot be before start date');
    const half = m.half_day ? 1 : 0;
    if (half && m.start_date !== m.end_date) throw httpError(400, 'Half-day leave must be a single day');
    const days = half ? 0.5 : workingDaysBetween(m.start_date, m.end_date);
    if (days <= 0) throw httpError(400, 'Selected dates fall on weekends or holidays');
    const overlap = get(
      `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending','approved')
       AND start_date <= ? AND end_date >= ? AND id != ?`,
      m.employee_id, m.end_date, m.start_date, existing?.id ?? 0,
    );
    if (overlap) throw httpError(409, 'You already have a leave request overlapping these dates');
    const type = get('SELECT * FROM leave_types WHERE id = ?', m.leave_type_id);
    if (!type) throw httpError(400, 'Unknown leave type');
    if (type.code !== 'LOP') {
      const bal = balancesFor(m.employee_id, Number(m.start_date.slice(0, 4))).find((b) => b.leave_type_id === type.id);
      const available = (bal?.available ?? 0) + (existing?.status === 'pending' ? existing.days : 0);
      if (days > available) throw httpError(400, `Insufficient ${type.name} balance: ${available} day(s) available, ${days} requested`);
    }
    return { ...data, days, half_day: half };
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    const msg = `${emp.first_name} ${emp.last_name} applied for ${data.days} day(s) from ${data.start_date}`;
    if (emp.manager_id) notify(emp.manager_id, 'Leave request awaiting approval', msg, '/approvals');
    else notifyHR('Leave request awaiting approval', msg, '/approvals');
  },
  onDecision(row, status) {
    if (status !== 'approved') return;
    ensureLeaveBalances(row.employee_id, Number(row.start_date.slice(0, 4)));
    run('UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      row.days, row.employee_id, row.leave_type_id, Number(row.start_date.slice(0, 4)));
    markLeaveAttendance(row);
  },
});

leaveRouter.post('/requests/:id/cancel', (req, res) => {
  const row = get('SELECT * FROM leave_requests WHERE id = ?', req.params.id);
  if (!row) throw httpError(404, 'Leave request not found');
  if (row.employee_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  if (!['pending', 'approved'].includes(row.status)) throw httpError(400, `Cannot cancel a ${row.status} request`);
  if (row.status === 'approved') {
    run('UPDATE leave_balances SET used = MAX(0, used - ?) WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      row.days, row.employee_id, row.leave_type_id, Number(row.start_date.slice(0, 4)));
    run("DELETE FROM attendance WHERE employee_id = ? AND status = 'leave' AND clock_in IS NULL AND date BETWEEN ? AND ?",
      row.employee_id, row.start_date, row.end_date);
  }
  update('leave_requests', row.id, { status: 'cancelled' });
  audit(req.user.id, 'cancel', 'leave_requests', row.id);
  res.json({ ok: true });
});

leaveRouter.use('/requests', requestsCrud);
leaveRouter.use('/types', leaveTypesRouter);
