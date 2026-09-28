import { Router } from 'express';
import { all, get } from '../db.js';
import { isHR, reportIds, scopeSql, requireRole } from '../auth.js';
import { today, monthRange, pad, ymd, httpError } from '../utils.js';
import { approvalFlows, approvalHistory, FLOW_LABELS, saveApprovalFlows } from '../workflow.js';

export const dashboardRouter = Router();
export const reportsRouter = Router();
export const productivityRouter = Router();
export const searchRouter = Router();
export const approvalsRouter = Router();

const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Employees with a birthday or work anniversary in the next `days` days. */
function celebrations(days = 30) {
  const emps = all(`SELECT id, first_name, last_name, avatar_color, date_of_birth, date_of_joining FROM employees WHERE status != 'exited'`);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = [];
  const inWindow = (md) => {
    if (!md) return null;
    const [, m, d] = md.split('-').map(Number);
    let next = new Date(base.getFullYear(), m - 1, d);
    if (next < base) next = new Date(base.getFullYear() + 1, m - 1, d);
    const diff = Math.round((next - base) / 86400000);
    return diff <= days ? { diff, date: ymd(next) } : null;
  };
  for (const e of emps) {
    const b = inWindow(e.date_of_birth);
    if (b) out.push({ type: 'birthday', ...b, id: e.id, name: `${e.first_name} ${e.last_name}`, avatar_color: e.avatar_color });
    const a = e.date_of_joining && e.date_of_joining.slice(0, 4) < String(now.getFullYear()) ? inWindow(e.date_of_joining) : null;
    if (a) out.push({ type: 'anniversary', ...a, years: Number(a.date.slice(0, 4)) - Number(e.date_of_joining.slice(0, 4)), id: e.id, name: `${e.first_name} ${e.last_name}`, avatar_color: e.avatar_color });
  }
  return out.sort((x, y) => x.diff - y.diff).slice(0, 12);
}

// Every approvable request type: table, how to summarise it, and which date to sort by.
const APPROVAL_TYPES = [
  { type: 'leave', table: 'leave_requests', join: 'JOIN leave_types lt ON lt.id = t.leave_type_id',
    summary: "lt.name || ' · ' || (CASE WHEN t.days = CAST(t.days AS INTEGER) THEN CAST(t.days AS INTEGER) ELSE t.days END) || ' day(s) · ' || t.start_date || ' → ' || t.end_date", detail: 't.reason' },
  { type: 'regularization', table: 'regularizations', summary: "'Attendance ' || t.date || ' · ' || t.clock_in || '–' || t.clock_out", detail: 't.reason' },
  { type: 'attendance_request', table: 'attendance_requests',
    summary: "(CASE t.type WHEN 'wfh' THEN 'Work from home' WHEN 'on_duty' THEN 'On duty' WHEN 'comp_off' THEN 'Comp-off credit' ELSE 'Overtime' END) || ' · ' || t.date || COALESCE(' → ' || t.end_date, '') || COALESCE(' · ' || t.hours || 'h', '')", detail: 't.reason' },
  { type: 'expense', table: 'expenses', summary: "t.category || ' · ₹' || t.amount || ' · ' || t.date", detail: 't.description' },
  { type: 'timesheet', table: 'timesheets', join: 'LEFT JOIN projects p ON p.id = t.project_id', created: 't.date',
    summary: "COALESCE(p.name, 'General') || ' · ' || t.hours || 'h · ' || t.date", detail: 't.task' },
  { type: 'travel', table: 'travel_requests', summary: "t.from_city || ' → ' || t.to_city || ' · ' || t.depart_date || COALESCE(' · advance ₹' || NULLIF(t.advance_amount, 0), '')", detail: 't.purpose' },
  { type: 'loan', table: 'loans', summary: "(CASE t.type WHEN 'advance' THEN 'Salary advance' ELSE 'Loan' END) || ' · ₹' || t.amount || ' · ' || t.tenure_months || ' month(s)'", detail: 't.reason' },
  { type: 'resignation', table: 'resignations', summary: "'Resignation · requested last day ' || t.requested_lwd", detail: 't.reason' },
  { type: 'tax', table: 'tax_declarations', summary: "'Sec ' || t.section || ' · ₹' || t.amount || ' · FY ' || t.fy", detail: 't.description' },
];

export function pendingApprovals(user) {
  if (user.role === 'employee') return [];
  const hr = isHR(user);
  const scope = hr ? null : reportIds(user.id);
  if (scope && !scope.length) return [];
  const flows = approvalFlows();
  const items = [];
  for (const cfg of APPROVAL_TYPES) {
    const flow = flows[cfg.table] || 'manager';
    if (!hr && flow === 'hr') continue;
    // Managers act on fresh requests; HR sees fresh requests plus those a manager has already approved.
    const statuses = hr ? "('pending','manager_approved')" : "('pending')";
    const where = [`t.status IN ${statuses}`];
    if (scope) where.push(`t.employee_id IN (${scope.join(',')})`);
    if (user.role !== 'admin') where.push(`t.employee_id != ${Number(user.id)}`);
    items.push(...all(
      `SELECT t.id, t.employee_id, t.status AS stage, ${NAME('e')} AS employee_name, e.avatar_color, ${cfg.created || 't.created_at'} AS created_at,
              ${cfg.summary} AS summary, ${cfg.detail} AS detail
       FROM ${cfg.table} t JOIN employees e ON e.id = t.employee_id ${cfg.join || ''} WHERE ${where.join(' AND ')}`,
    ).map((r) => ({ ...r, type: cfg.type, flow })));
  }
  return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

approvalsRouter.get('/', (req, res) => res.json(pendingApprovals(req.user)));

approvalsRouter.get('/flows', (req, res) => {
  const flows = approvalFlows();
  res.json(Object.entries(FLOW_LABELS).map(([key, label]) => ({ key, label, flow: flows[key] })));
});
approvalsRouter.put('/flows', requireRole('admin', 'hr'), (req, res) => res.json(saveApprovalFlows(req.body || {})));

// Decision trail for one request (who approved at which level, with comments).
approvalsRouter.get('/history', (req, res) => {
  const { entity, id } = req.query;
  if (!APPROVAL_TYPES.some((t) => t.table === entity)) throw httpError(400, 'Unknown request type');
  const row = get(`SELECT employee_id FROM ${entity} WHERE id = ?`, Number(id));
  if (!row) throw httpError(404, 'Request not found');
  if (row.employee_id !== req.user.id && !isHR(req.user) && !reportIds(req.user.id).includes(row.employee_id)) throw httpError(403, 'Not allowed');
  res.json(approvalHistory(entity, Number(id)));
});

dashboardRouter.get('/', (req, res) => {
  const u = req.user;
  const t = today();
  const year = new Date().getFullYear();
  const data = {
    today: t,
    attendance: get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', u.id, t) || null,
    leave_balances: all(
      `SELECT lt.name, lt.code, lt.color, b.allocated, b.used FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id
       WHERE b.employee_id = ? AND b.year = ? AND lt.code != 'LOP' ORDER BY lt.id`, u.id, year),
    holidays: all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 5', t),
    celebrations: celebrations(30),
    announcements: all(`SELECT a.*, ${NAME('e')} AS author_name FROM announcements a LEFT JOIN employees e ON e.id = a.author_id ORDER BY a.pinned DESC, a.id DESC LIMIT 4`),
    on_leave_today: all(
      `SELECT e.id, ${NAME('e')} AS name, e.avatar_color, lt.name AS leave_type, r.end_date FROM leave_requests r
       JOIN employees e ON e.id = r.employee_id JOIN leave_types lt ON lt.id = r.leave_type_id
       WHERE r.status = 'approved' AND ? BETWEEN r.start_date AND r.end_date`, t),
    new_joiners: all(
      `SELECT e.id, ${NAME('e')} AS name, e.avatar_color, g.title AS designation, e.date_of_joining FROM employees e
       LEFT JOIN designations g ON g.id = e.designation_id WHERE e.date_of_joining >= ? AND e.status != 'exited' ORDER BY e.date_of_joining DESC LIMIT 5`,
      addDays(t, -45)),
    kudos: all(
      `SELECT k.id, k.badge, k.message, k.created_at, ${NAME('f')} AS from_name, ${NAME('x')} AS to_name, x.avatar_color AS to_color
       FROM kudos k JOIN employees f ON f.id = k.from_id JOIN employees x ON x.id = k.to_id ORDER BY k.id DESC LIMIT 4`),
    my_requests: all(
      `SELECT 'leave' AS type, t.id, lt.name || ' · ' || (CASE WHEN t.days = CAST(t.days AS INTEGER) THEN CAST(t.days AS INTEGER) ELSE t.days END) || 'd' AS summary, t.status, t.created_at FROM leave_requests t
       JOIN leave_types lt ON lt.id = t.leave_type_id WHERE t.employee_id = ?
       UNION ALL SELECT 'expense', id, category || ' · ₹' || amount, status, created_at FROM expenses WHERE employee_id = ?
       UNION ALL SELECT 'regularization', id, 'Attendance ' || date, status, created_at FROM regularizations WHERE employee_id = ?
       ORDER BY created_at DESC LIMIT 5`, u.id, u.id, u.id),
    goals: get('SELECT COUNT(*) AS total, ROUND(AVG(progress)) AS avg_progress FROM goals WHERE employee_id = ?', u.id),
    pending_approvals: pendingApprovals(u).length,
    open_tickets: get("SELECT COUNT(*) AS n FROM tickets WHERE employee_id = ? AND status IN ('open','in_progress')", u.id).n,
  };

  if (isHR(u) || u.role === 'manager') {
    const scope = scopeSql(u, 'e.id');
    const month = t.slice(0, 7);
    const headcount = get(`SELECT COUNT(*) AS n FROM employees e WHERE e.status != 'exited' AND ${scope.sql}`, ...scope.params).n;
    const present = get(`SELECT COUNT(*) AS n FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date = ? AND a.clock_in IS NOT NULL AND ${scope.sql}`, t, ...scope.params).n;
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(t, -i);
      const day = new Date(d).getDay();
      if (day === 0 || day === 6) continue;
      const r = get(
        `SELECT SUM(a.clock_in IS NOT NULL) AS present, SUM(a.late) AS late, SUM(a.status = 'leave') AS on_leave
         FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date = ? AND ${scope.sql}`, d, ...scope.params);
      trend.push({ date: d.slice(5), present: r.present || 0, late: r.late || 0, on_leave: r.on_leave || 0 });
    }
    data.team = {
      headcount, present_today: present,
      new_hires_month: get(`SELECT COUNT(*) AS n FROM employees e WHERE substr(e.date_of_joining,1,7) = ? AND ${scope.sql}`, month, ...scope.params).n,
      exits_month: get(`SELECT COUNT(*) AS n FROM employees e WHERE substr(e.exit_date,1,7) = ? AND ${scope.sql}`, month, ...scope.params).n,
      open_positions: get("SELECT COALESCE(SUM(openings),0) AS n FROM job_openings WHERE status = 'open'").n,
      attendance_trend: trend,
      by_department: all(
        `SELECT COALESCE(d.name,'Unassigned') AS name, COUNT(*) AS value FROM employees e LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.status != 'exited' AND ${scope.sql} GROUP BY d.name ORDER BY value DESC`, ...scope.params),
    };
    if (isHR(u)) {
      data.team.last_payroll = get('SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 1') || null;
      data.team.candidates_active = get("SELECT COUNT(*) AS n FROM candidates WHERE stage NOT IN ('hired','rejected')").n;
      data.team.open_tickets = get("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('open','in_progress')").n;
    }
  }
  res.json(data);
});

// ---------- reports ----------
reportsRouter.use(requireRole('admin', 'hr', 'manager'));

reportsRouter.get('/headcount', (req, res) => {
  const scope = scopeSql(req.user, 'e.id');
  const group = (col, label) => all(
    `SELECT COALESCE(${col}, 'Unassigned') AS name, COUNT(*) AS value FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN locations l ON l.id = e.location_id
     WHERE e.status != 'exited' AND ${scope.sql} GROUP BY ${col} ORDER BY value DESC`, ...scope.params,
  ).map((r) => ({ ...r, group: label }));
  const trend = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const { end } = monthRange(month);
    trend.push({
      month,
      headcount: get(`SELECT COUNT(*) AS n FROM employees e WHERE e.date_of_joining <= ? AND (e.exit_date IS NULL OR e.exit_date > ? OR e.status != 'exited') AND ${scope.sql}`, end, end, ...scope.params).n,
      joiners: get(`SELECT COUNT(*) AS n FROM employees e WHERE substr(e.date_of_joining,1,7) = ? AND ${scope.sql}`, month, ...scope.params).n,
      exits: get(`SELECT COUNT(*) AS n FROM employees e WHERE e.status = 'exited' AND substr(e.exit_date,1,7) = ? AND ${scope.sql}`, month, ...scope.params).n,
    });
  }
  res.json({
    department: group('d.name', 'Department'), location: group('l.name', 'Location'),
    gender: group('e.gender', 'Gender'), employment_type: group('e.employment_type', 'Employment type'), trend,
  });
});

reportsRouter.get('/attendance', (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  const { start, end } = monthRange(month);
  const scope = scopeSql(req.user, 'e.id');
  res.json(all(
    `SELECT e.id, e.emp_code, ${NAME('e')} AS employee_name, d.name AS department,
            SUM(a.status = 'present') AS present, SUM(a.status = 'half_day') AS half_day, SUM(a.status = 'leave') AS leave,
            SUM(a.late) AS late, SUM(a.work_mode = 'remote') AS remote,
            ROUND(AVG(CASE WHEN a.clock_out IS NOT NULL THEN
              ((CAST(substr(a.clock_out,1,2) AS REAL)*60 + CAST(substr(a.clock_out,4,2) AS REAL)) -
               (CAST(substr(a.clock_in,1,2) AS REAL)*60 + CAST(substr(a.clock_in,4,2) AS REAL))) / 60.0 END), 1) AS avg_hours
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN attendance a ON a.employee_id = e.id AND a.date BETWEEN ? AND ?
     WHERE e.status != 'exited' AND ${scope.sql} GROUP BY e.id ORDER BY e.first_name`, start, end, ...scope.params,
  ));
});

reportsRouter.get('/leave', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const scope = scopeSql(req.user, 'b.employee_id');
  res.json({
    by_type: all(
      `SELECT lt.name, lt.color, SUM(b.allocated) AS allocated, SUM(b.used) AS used FROM leave_balances b
       JOIN leave_types lt ON lt.id = b.leave_type_id WHERE b.year = ? AND lt.code != 'LOP' AND ${scope.sql} GROUP BY lt.id`, year, ...scope.params),
    by_month: all(
      `SELECT substr(r.start_date,1,7) AS month, SUM(r.days) AS days, COUNT(*) AS requests FROM leave_requests r
       WHERE r.status = 'approved' AND substr(r.start_date,1,4) = ? AND ${scopeSql(req.user, 'r.employee_id').sql}
       GROUP BY month ORDER BY month`, String(year), ...scopeSql(req.user, 'r.employee_id').params),
  });
});

reportsRouter.get('/payroll', requireRole('admin', 'hr'), (req, res) => {
  res.json({
    runs: all('SELECT month, total_gross, total_deductions, total_net, employees FROM payroll_runs ORDER BY month'),
    by_department: all(
      `SELECT COALESCE(d.name, 'Unassigned') AS name, ROUND(SUM(e.annual_ctc)) AS value, COUNT(*) AS employees FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited' GROUP BY d.name ORDER BY value DESC`),
  });
});

reportsRouter.get('/recruitment', (req, res) => {
  const stages = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
  const counts = all('SELECT stage, COUNT(*) AS n FROM candidates GROUP BY stage');
  res.json({
    funnel: stages.map((s) => ({ stage: s, count: counts.find((c) => c.stage === s)?.n || 0 })),
    by_source: all("SELECT COALESCE(source,'Other') AS name, COUNT(*) AS value FROM candidates GROUP BY source ORDER BY value DESC"),
  });
});

// ---------- productivity (activity tracking) ----------
productivityRouter.get('/', (req, res) => {
  const to = req.query.to || today();
  const from = req.query.from || addDays(to, -6);
  const scope = scopeSql(req.user, 'e.id');
  const where = [`p.date BETWEEN ? AND ?`, scope.sql];
  const params = [from, to, ...scope.params];
  if (req.query.employee_id) { where.push('e.id = ?'); params.push(req.query.employee_id); }
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(req.query.department_id); }
  const W = where.join(' AND ');
  const employees = all(
    `SELECT e.id, ${NAME('e')} AS employee_name, e.avatar_color, d.name AS department,
            SUM(p.productive_mins) AS productive, SUM(p.neutral_mins) AS neutral, SUM(p.unproductive_mins) AS unproductive,
            SUM(p.idle_mins) AS idle, COUNT(*) AS days
     FROM productivity p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${W} GROUP BY e.id ORDER BY productive DESC`, ...params,
  ).map((r) => {
    const active = r.productive + r.neutral + r.unproductive;
    return { ...r, active, score: active + r.idle ? Math.round((r.productive / (active + r.idle)) * 100) : 0 };
  });
  const daily = all(
    `SELECT p.date, ROUND(AVG(p.productive_mins)) AS productive, ROUND(AVG(p.neutral_mins)) AS neutral,
            ROUND(AVG(p.unproductive_mins)) AS unproductive, ROUND(AVG(p.idle_mins)) AS idle
     FROM productivity p JOIN employees e ON e.id = p.employee_id WHERE ${W} GROUP BY p.date ORDER BY p.date`, ...params,
  );
  const apps = {};
  for (const r of all(`SELECT p.top_apps FROM productivity p JOIN employees e ON e.id = p.employee_id WHERE ${W}`, ...params)) {
    for (const a of JSON.parse(r.top_apps || '[]')) {
      apps[a.name] ||= { name: a.name, category: a.category, minutes: 0 };
      apps[a.name].minutes += a.minutes;
    }
  }
  const totals = employees.reduce((acc, r) => {
    for (const k of ['productive', 'neutral', 'unproductive', 'idle']) acc[k] += r[k];
    return acc;
  }, { productive: 0, neutral: 0, unproductive: 0, idle: 0 });
  const all4 = totals.productive + totals.neutral + totals.unproductive + totals.idle;
  res.json({
    from, to, employees, daily, totals,
    score: all4 ? Math.round((totals.productive / all4) * 100) : 0,
    apps: Object.values(apps).sort((a, b) => b.minutes - a.minutes).slice(0, 10),
  });
});

// ---------- global search ----------
searchRouter.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ employees: [], jobs: [], documents: [] });
  const like = `%${q}%`;
  res.json({
    employees: all(
      `SELECT e.id, ${NAME('e')} AS name, e.avatar_color, e.email, g.title AS designation FROM employees e
       LEFT JOIN designations g ON g.id = e.designation_id
       WHERE e.status != 'exited' AND (${NAME('e')} LIKE ? OR e.email LIKE ? OR e.emp_code LIKE ?) LIMIT 8`, like, like, like),
    jobs: all("SELECT id, title FROM job_openings WHERE title LIKE ? AND status = 'open' LIMIT 5", like),
    documents: all('SELECT id, title, category FROM documents WHERE employee_id IS NULL AND title LIKE ? LIMIT 5', like),
  });
});

export { httpError };
