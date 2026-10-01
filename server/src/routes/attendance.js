import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scopeSql, canManage, isHR } from '../auth.js';
import { crud } from '../crud.js';
import {
  today, nowTime, minutes, httpError, monthRange, audit, notify,
  ensureLeaveBalances, parseDate, ymd, notifyHR, workingDaysFor, offDayChecker,
} from '../utils.js';
import { attendancePolicyFor, leaveRulesFor, policyFor, holidayListFilter, ipAllowed } from '../policies.js';

export const attendanceRouter = Router();
export const leaveRouter = Router();

const DEFAULT_SHIFT = { start_time: '09:30', end_time: '18:30', grace_minutes: 15 };
/** Shift for a given day: a roster assignment wins over the employee's default shift. */
export const shiftFor = (employeeId, date = today()) =>
  get('SELECT s.* FROM shift_roster r JOIN shifts s ON s.id = r.shift_id WHERE r.employee_id = ? AND r.date = ?', employeeId, date)
  || get('SELECT s.* FROM shifts s JOIN employees e ON e.shift_id = s.id WHERE e.id = ?', employeeId) || DEFAULT_SHIFT;

/** Great-circle distance in metres. */
export function distanceMetres(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Geofence check against the employee's office. Mode (settings.geofence_mode):
 *   off – ignore location, flag – record inside/outside, enforce – block office clock-ins outside the fence.
 */
function checkGeofence(employeeId, lat, lng, workMode, policy) {
  const mode = policy?.geofence_mode || get("SELECT value FROM settings WHERE key = 'geofence_mode'")?.value || 'flag';
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng);
  if (mode === 'off') return { geo_status: null, latitude: hasFix ? lat : null, longitude: hasFix ? lng : null };
  const loc = get('SELECT l.* FROM locations l JOIN employees e ON e.location_id = l.id WHERE e.id = ?', employeeId);
  if (!hasFix) {
    if (mode === 'enforce' && workMode === 'office' && loc?.latitude != null) throw httpError(400, 'Location access is required to clock in from the office');
    return { geo_status: 'unknown', latitude: null, longitude: null };
  }
  if (loc?.latitude == null || loc?.longitude == null) return { geo_status: 'unknown', latitude: lat, longitude: lng };
  const distance = distanceMetres(lat, lng, loc.latitude, loc.longitude);
  const inside = distance <= (loc.radius_m || 300);
  if (!inside && mode === 'enforce' && workMode === 'office') {
    throw httpError(400, `You are ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`} from ${loc.name}. Move within ${loc.radius_m || 300} m or choose Remote / Field.`);
  }
  return { geo_status: inside ? 'inside' : 'outside', latitude: lat, longitude: lng, distance };
}

/**
 * Day status from punches. The attendance policy can override the shift's grace period and the hours needed
 * for a full or half day (defaults: 75% / 40% of the shift length).
 */
export function evaluateDay(clockIn, clockOut, shift, policy = null) {
  const grace = policy?.grace_minutes ?? shift.grace_minutes ?? 15;
  const late = minutes(clockIn) > minutes(shift.start_time) + grace ? 1 : 0;
  if (!clockOut) return { status: 'present', late };
  const worked = minutes(clockOut) - minutes(clockIn);
  const shiftLen = minutes(shift.end_time) - minutes(shift.start_time);
  const full = policy?.full_day_hours != null ? policy.full_day_hours * 60 : shiftLen * 0.75;
  const half = policy?.half_day_hours != null ? policy.half_day_hours * 60 : shiftLen * 0.4;
  const status = worked >= full ? 'present' : worked >= half ? 'half_day' : 'absent';
  return { status, late };
}

const MODE_ALLOWED = { office: 'allow_web', remote: 'allow_remote', field: 'allow_field' };
const MODE_LABEL = { office: 'office', remote: 'remote', field: 'field' };

/**
 * Automatic clock-out: for employees whose attendance policy enables it, a day still open N hours after the shift
 * ended is closed at the shift's end time (flagged, so it can be regularised). Runs periodically.
 */
export function autoClockOut(now = new Date()) {
  const open = all("SELECT a.* FROM attendance a WHERE a.clock_in IS NOT NULL AND a.clock_out IS NULL AND a.date <= ?", ymd(now));
  let closed = 0;
  for (const rec of open) {
    const policy = attendancePolicyFor(rec.employee_id);
    if (!policy?.auto_clock_out) continue;
    const shift = shiftFor(rec.employee_id, rec.date);
    const end = parseDate(rec.date);
    end.setHours(0, minutes(shift.end_time) + Math.round((policy.auto_clock_out_hours ?? 4) * 60), 0, 0);
    if (now < end) continue;
    const out = minutes(shift.end_time) > minutes(rec.clock_in) ? shift.end_time : rec.clock_in;
    const { status, late } = evaluateDay(rec.clock_in, out, shift, policy);
    update('attendance', rec.id, { clock_out: out, status, late, auto_clock_out: 1, notes: [rec.notes, 'Auto clock-out at shift end'].filter(Boolean).join(' · ') });
    notify(rec.employee_id, 'You were clocked out automatically', `You didn't clock out on ${rec.date}; we recorded ${out} (your shift end). Raise a regularization if that's wrong.`, '/attendance', { email: false });
    closed++;
  }
  return closed;
}

// ---------- attendance ----------
attendanceRouter.get('/today', (req, res) => {
  const record = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  const policy = attendancePolicyFor(req.user.id);
  const modes = Object.keys(MODE_ALLOWED).filter((m) => !policy || policy[MODE_ALLOWED[m]] !== 0);
  res.json({ record: record || null, shift: shiftFor(req.user.id), server_time: nowTime(), date: today(), policy: policy ? { name: policy.name, modes } : null, modes });
});

attendanceRouter.post('/clock-in', (req, res) => {
  const existing = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  if (existing?.clock_in) throw httpError(400, `Already clocked in at ${existing.clock_in}`);
  const time = nowTime();
  const policy = attendancePolicyFor(req.user.id);
  const { late } = evaluateDay(time, null, shiftFor(req.user.id), policy);
  const work_mode = ['office', 'remote', 'field'].includes(req.body?.work_mode) ? req.body.work_mode : 'office';
  if (policy && policy[MODE_ALLOWED[work_mode]] === 0) {
    throw httpError(400, `Your attendance policy (${policy.name}) does not allow ${MODE_LABEL[work_mode]} clock-in`);
  }
  // Office clock-in can be limited to the office network.
  if (work_mode === 'office' && policy?.allowed_ips && !ipAllowed(req.ip, policy.allowed_ips)) {
    throw httpError(400, 'Office clock-in is only allowed from the office network. Connect to office Wi-Fi or choose Remote / Field.');
  }
  const { distance, ...geo } = checkGeofence(req.user.id, Number(req.body?.latitude ?? NaN), Number(req.body?.longitude ?? NaN), work_mode, policy);
  if (existing) update('attendance', existing.id, { clock_in: time, status: 'present', late, work_mode, ...geo });
  else insert('attendance', { employee_id: req.user.id, date: today(), clock_in: time, status: 'present', late, work_mode, ...geo, source: 'web', ip: req.ip });
  audit(req.user.id, 'clock_in', 'attendance', null, { time, work_mode, ...geo, distance });
  res.json(get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today()));
});

attendanceRouter.post('/clock-out', (req, res) => {
  const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.id, today());
  if (!rec?.clock_in) throw httpError(400, 'You have not clocked in today');
  if (rec.clock_out) throw httpError(400, `Already clocked out at ${rec.clock_out}`);
  let time = nowTime();
  if (minutes(time) < minutes(rec.clock_in)) time = rec.clock_in;
  const shift = shiftFor(req.user.id);
  const policy = attendancePolicyFor(req.user.id);
  const { status, late } = evaluateDay(rec.clock_in, time, shift, policy);
  // Time beyond the scheduled shift length counts as overtime (if the policy allows it and it passes the minimum).
  let overtime = Math.max(0, (minutes(time) - minutes(rec.clock_in)) - (minutes(shift.end_time) - minutes(shift.start_time)));
  if (policy && (!policy.overtime_allowed || overtime < (policy.overtime_min_minutes ?? 0))) overtime = 0;
  update('attendance', rec.id, { clock_out: time, status, late, overtime_mins: overtime });
  audit(req.user.id, 'clock_out', 'attendance', rec.id, { time });
  res.json(get('SELECT * FROM attendance WHERE id = ?', rec.id));
});

attendanceRouter.get('/', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !canManage(req.user, employeeId)) throw httpError(403, 'Not allowed to view this attendance');
  const month = req.query.month || today().slice(0, 7);
  const { start, end } = monthRange(month);
  const records = all('SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date', employeeId, start, end);
  const list = holidayListFilter(policyFor('holiday', employeeId)?.id);
  const holidays = all(
    `SELECT h.*, EXISTS(SELECT 1 FROM optional_holiday_choices c WHERE c.holiday_id = h.id AND c.employee_id = ?) AS opted
     FROM holidays h WHERE h.date BETWEEN ? AND ? AND ${list.sql}`, employeeId, start, end, ...list.params,
  ).filter((h) => h.type !== 'Optional' || h.opted);
  const upto = end < today() ? end : today();
  const workingDays = upto >= start ? workingDaysFor(employeeId, start, upto) : 0;
  const off = offDayChecker(employeeId);
  const weeklyOffs = [];
  for (let d = parseDate(start); d <= parseDate(end); d.setDate(d.getDate() + 1)) if (off.weeklyOff(d)) weeklyOffs.push(ymd(d));
  const count = (s) => records.filter((r) => r.status === s).length;
  const overtimeMins = records.reduce((a, r) => a + (r.overtime_mins || 0), 0);
  const workedMins = records.reduce((a, r) => a + (r.clock_out ? minutes(r.clock_out) - minutes(r.clock_in) : 0), 0);
  const daysWithHours = records.filter((r) => r.clock_out).length;
  const present = count('present') + count('half_day') * 0.5;
  res.json({
    records, holidays, weekly_offs: weeklyOffs,
    summary: {
      working_days: workingDays,
      present: count('present'), half_day: count('half_day'), leave: count('leave'),
      absent: Math.max(0, workingDays - count('present') - count('half_day') - count('leave')),
      late: records.filter((r) => r.late).length,
      remote: records.filter((r) => r.work_mode === 'remote').length,
      overtime_hours: Math.round((overtimeMins / 60) * 10) / 10,
      outside_geofence: records.filter((r) => r.geo_status === 'outside').length,
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
    if (!existing) {
      const ownerId = merged.employee_id ?? user.id;
      const policy = attendancePolicyFor(ownerId);
      if (policy?.max_regularizations != null) {
        const used = get(`SELECT COUNT(*) AS n FROM regularizations WHERE employee_id = ? AND substr(date, 1, 7) = ? AND status != 'rejected'`, ownerId, merged.date.slice(0, 7)).n;
        if (used >= policy.max_regularizations) throw httpError(400, `Your attendance policy allows ${policy.max_regularizations} regularization(s) a month; you have used them all for ${merged.date.slice(0, 7)}`);
      }
    }
    return data;
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    notify(emp?.manager_id, 'Regularization request', `${emp.first_name} ${emp.last_name} requested regularization for ${data.date}`, '/approvals');
  },
  onDecision(row, status) {
    if (status !== 'approved') return;
    const { status: dayStatus, late } = evaluateDay(row.clock_in, row.clock_out, shiftFor(row.employee_id, row.date), attendancePolicyFor(row.employee_id));
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
  afterCreate(id, data) {
    // A new leave type joins the default leave plan with its annual quota; HR can fine-tune it in Policies.
    const plan = policyFor('leave');
    if (plan) {
      insert('leave_plan_rules', {
        plan_id: plan.id, leave_type_id: id, annual_quota: Number(data.annual_quota) || 0, accrual: Number(data.annual_quota) > 0 ? 'yearly' : 'none',
        carry_forward_cap: data.carry_forward ? 30 : 0, encashable: data.carry_forward ? 1 : 0, allow_half_day: 1, min_notice_days: 0, probation_allowed: 1, sandwich: 0,
      });
    }
    for (const { id: empId } of all("SELECT id FROM employees WHERE status != 'exited'")) ensureLeaveBalances(empId);
  },
});

const holidaysCrud = crud({
  table: 'holidays', label: 'holiday', fields: ['name', 'date', 'type', 'list_id'], readAll: true, order: 't.date', dateField: 'date', filters: ['list_id'],
  select: 'SELECT t.*, l.name AS list_name FROM holidays t LEFT JOIN holiday_lists l ON l.id = t.list_id',
});

/** Holidays default to the signed-in employee's own holiday list; HR can ask for a specific list (?list_id=) or all (?all=1). */
export const holidaysRouter = Router();
holidaysRouter.get('/', (req, res, next) => {
  if (req.query.all && isHR(req.user)) return next();
  const listId = req.query.list_id && isHR(req.user) ? Number(req.query.list_id) : policyFor('holiday', req.user.id)?.id;
  const f = holidayListFilter(listId, 't');
  res.json(all(`SELECT t.*, l.name AS list_name FROM holidays t LEFT JOIN holiday_lists l ON l.id = t.list_id WHERE ${f.sql} ORDER BY t.date`, ...f.params));
});
holidaysRouter.use(holidaysCrud);

function balancesFor(employeeId, year) {
  ensureLeaveBalances(employeeId, year);
  const lr = leaveRulesFor(employeeId);
  const rows = all(
    `SELECT lt.id AS leave_type_id, lt.name, lt.code, lt.color, lt.paid, b.allocated, b.used, b.carried, b.adjustment,
            COALESCE((SELECT SUM(days) FROM leave_requests r WHERE r.employee_id = b.employee_id
              AND r.leave_type_id = lt.id AND r.status IN ('pending','manager_approved') AND substr(r.start_date,1,4) = ?), 0) AS pending
     FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id
     WHERE b.employee_id = ? AND b.year = ? ORDER BY lt.id`,
    String(year), employeeId, year,
  );
  return rows
    // Under a leave plan only its leave types are offered; other types stay visible only while they hold history.
    .filter((b) => !lr || lr.rules.has(b.leave_type_id) || b.used > 0)
    .map((b) => {
      const rule = lr?.rules.get(b.leave_type_id);
      const unlimited = b.code === 'LOP';
      return {
        ...b,
        available: unlimited ? null : Math.round((b.allocated + b.carried + b.adjustment - b.used - b.pending) * 100) / 100,
        plan: lr?.plan.name || null,
        rule: rule ? {
          accrual: rule.accrual, annual_quota: rule.annual_quota, allow_half_day: !!rule.allow_half_day, min_notice_days: rule.min_notice_days,
          max_consecutive: rule.max_consecutive, probation_allowed: !!rule.probation_allowed, sandwich: !!rule.sandwich,
          carry_forward_cap: rule.carry_forward_cap, encashable: !!rule.encashable,
        } : null,
        applicable: !lr || !!rule,
      };
    });
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
     WHERE r.status IN ('approved','pending','manager_approved') AND r.start_date <= ? AND r.end_date >= ? ORDER BY r.start_date`,
    end, start,
  );
  const list = holidayListFilter(policyFor('holiday', req.user.id)?.id);
  res.json({ leaves, holidays: all(`SELECT * FROM holidays h WHERE date BETWEEN ? AND ? AND ${list.sql} ORDER BY date`, start, end, ...list.params) });
});

function markLeaveAttendance(row) {
  const isOff = offDayChecker(row.employee_id);
  for (let d = parseDate(row.start_date); d <= parseDate(row.end_date); d.setDate(d.getDate() + 1)) {
    const date = ymd(d);
    if (isOff(d)) continue;
    const rec = get('SELECT id, clock_in FROM attendance WHERE employee_id = ? AND date = ?', row.employee_id, date);
    if (rec?.clock_in && row.half_day) continue;
    if (rec) update('attendance', rec.id, { status: 'leave' });
    else insert('attendance', { employee_id: row.employee_id, date, status: 'leave', work_mode: null });
  }
}

/**
 * Leave days between two dates. Weekly offs and holidays are skipped, unless the plan applies the sandwich
 * rule: then offs that fall between two leave days are counted too.
 */
function leaveDays(employeeId, start, end, sandwich) {
  const isOff = offDayChecker(employeeId);
  const working = [];
  for (let d = parseDate(start); d <= parseDate(end); d.setDate(d.getDate() + 1)) if (!isOff(d)) working.push(ymd(d));
  if (!working.length) return 0;
  if (!sandwich) return working.length;
  return Math.round((parseDate(working[working.length - 1]) - parseDate(working[0])) / 86400000) + 1;
}

function checkLeaveRule(rule, m, days, half, user, existing) {
  const hrFiling = isHR(user) && user.id !== m.employee_id;
  if (half && !rule.allow_half_day) throw httpError(400, `${rule.leave_type} cannot be taken as a half day`);
  if (rule.max_consecutive && days > rule.max_consecutive) throw httpError(400, `${rule.leave_type} allows at most ${rule.max_consecutive} consecutive day(s)`);
  if (!existing && !hrFiling && rule.min_notice_days > 0) {
    const notice = Math.round((parseDate(m.start_date) - parseDate(today())) / 86400000);
    if (notice < rule.min_notice_days) throw httpError(400, `${rule.leave_type} must be applied at least ${rule.min_notice_days} day(s) in advance`);
  }
  if (!rule.probation_allowed) {
    const emp = get('SELECT confirmation_status, probation_end_date FROM employees WHERE id = ?', m.employee_id);
    // Not available while the employee is still on probation (confirmation pending and probation not yet over).
    if (emp && emp.confirmation_status !== 'confirmed' && (!emp.probation_end_date || emp.probation_end_date >= today())) {
      throw httpError(400, `${rule.leave_type} is not available during probation`);
    }
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
    const ownerId = m.employee_id ?? user.id;
    const lr = leaveRulesFor(ownerId);
    const rule = lr?.rules.get(Number(m.leave_type_id));
    if (lr && !rule) throw httpError(400, `This leave type is not part of your leave plan (${lr.plan.name})`);
    const days = half ? 0.5 : leaveDays(ownerId, m.start_date, m.end_date, !!rule?.sandwich);
    if (days <= 0) throw httpError(400, 'Selected dates fall on weekly offs or holidays');
    if (rule) checkLeaveRule(rule, { ...m, employee_id: ownerId }, days, half, user, existing);
    const overlap = get(
      `SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('pending','manager_approved','approved')
       AND start_date <= ? AND end_date >= ? AND id != ?`,
      m.employee_id, m.end_date, m.start_date, existing?.id ?? 0,
    );
    if (overlap) throw httpError(409, 'You already have a leave request overlapping these dates');
    const type = get('SELECT * FROM leave_types WHERE id = ?', m.leave_type_id);
    if (!type) throw httpError(400, 'Unknown leave type');
    if (type.code !== 'LOP') {
      const bal = balancesFor(m.employee_id, Number(m.start_date.slice(0, 4))).find((b) => b.leave_type_id === type.id);
      const available = (bal?.available ?? 0) + (['pending', 'manager_approved'].includes(existing?.status) ? existing.days : 0);
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
  if (!['pending', 'manager_approved', 'approved'].includes(row.status)) throw httpError(400, `Cannot cancel a ${row.status} request`);
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
