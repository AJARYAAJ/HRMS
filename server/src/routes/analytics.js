import { Router } from 'express';
import { all, get } from '../db.js';
import { requireRole, isHR, reportIds } from '../auth.js';
import { today, ymd, parseDate, round2, workingDaysBetween, monthRange, offDayChecker } from '../utils.js';

/**
 * Executive analytics across modules: people (headcount, joiners, exits, attrition, tenure), time (attendance,
 * leave), delivery (billable utilisation, project health, pipeline) and, for HR/admin, money (revenue vs payroll).
 */
export const analyticsRouter = Router();
analyticsRouter.use(requireRole('admin', 'hr', 'manager'));

function monthsBack(n) {
  const out = [];
  const d = parseDate(`${today().slice(0, 7)}-01`);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(ymd(m).slice(0, 7));
  }
  return out;
}

const headcountAt = (date) => get(
  "SELECT COUNT(*) AS n FROM employees WHERE date_of_joining <= ? AND (exit_date IS NULL OR exit_date > ?) AND (status != 'exited' OR exit_date IS NOT NULL)", date, date,
).n;

analyticsRouter.get('/', (req, res) => {
  const n = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
  const months = monthsBack(n);
  const t = today();
  const periodStart = `${months[0]}-01`;
  const money = isHR(req.user);

  const series = months.map((m) => {
    const { start, end: monthEnd } = monthRange(m);
    const end = monthEnd < t ? monthEnd : t;
    const headcount = headcountAt(end);
    const joiners = get('SELECT COUNT(*) AS n FROM employees WHERE date_of_joining BETWEEN ? AND ?', start, end).n;
    const exits = get('SELECT COUNT(*) AS n FROM employees WHERE exit_date BETWEEN ? AND ?', start, end).n;
    const att = get(`SELECT SUM(CASE WHEN status = 'present' THEN 1 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) AS present,
      SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) AS leave, COUNT(*) AS records FROM attendance WHERE date BETWEEN ? AND ?`, start, end);
    const wd = end >= start ? workingDaysBetween(start, end) : 0;
    const expected = Math.max(0, wd * headcount - (att.leave || 0));
    const ts = get(`SELECT COALESCE(SUM(hours), 0) AS logged, COALESCE(SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END), 0) AS billable,
      COUNT(DISTINCT employee_id) AS people FROM timesheets WHERE date BETWEEN ? AND ?`, start, end);
    const capacity = wd * 8 * ts.people;
    const row = {
      month: m, headcount, joiners, exits,
      attendance_pct: expected && att.records ? Math.min(100, Math.round(((att.present || 0) / expected) * 100)) : null, // no records = no data
      leave_days: round2(get("SELECT COALESCE(SUM(days), 0) AS v FROM leave_requests WHERE status = 'approved' AND start_date BETWEEN ? AND ?", start, end).v),
      billable_hours: round2(ts.billable), logged_hours: round2(ts.logged),
      utilization_pct: capacity ? Math.round((ts.billable / capacity) * 100) : null,
    };
    if (money) {
      row.revenue = round2(get("SELECT COALESCE(SUM(subtotal), 0) AS v FROM invoices WHERE status NOT IN ('void','draft') AND issue_date BETWEEN ? AND ?", start, end).v);
      row.payroll_cost = round2(get('SELECT COALESCE(SUM(gross), 0) AS v FROM payslips WHERE month = ?', m).v);
      row.collected = round2(get('SELECT COALESCE(SUM(amount), 0) AS v FROM invoice_payments WHERE date BETWEEN ? AND ?', start, end).v);
    }
    return row;
  });

  const now = headcountAt(t);
  const startCount = headcountAt(ymd(new Date(parseDate(periodStart).getTime() - 86400000)));
  const exits = series.reduce((a, r) => a + r.exits, 0);
  const avgHead = series.reduce((a, r) => a + r.headcount, 0) / series.length || 1;
  const tenure = get("SELECT AVG(julianday('now') - julianday(date_of_joining)) / 365.25 AS y FROM employees WHERE status != 'exited'").y || 0;
  const attRows = series.filter((r) => r.attendance_pct != null);
  const utilRows = series.filter((r) => r.utilization_pct != null);
  const enps = get("SELECT id, question FROM surveys WHERE type = 'enps' ORDER BY id DESC LIMIT 1");
  let enpsScore = null;
  if (enps) {
    const votes = all('SELECT option_index AS v FROM survey_votes WHERE survey_id = ?', enps.id).map((r) => r.v);
    if (votes.length) enpsScore = Math.round(((votes.filter((v) => v >= 9).length - votes.filter((v) => v <= 6).length) / votes.length) * 100);
  }
  const pipeline = all("SELECT stage, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value, COALESCE(SUM(value * probability / 100.0), 0) AS weighted FROM opportunities GROUP BY stage");
  const kpis = {
    headcount: now, headcount_change: now - startCount,
    attrition_pct: round2((exits / avgHead) * (12 / n) * 100), // annualised
    avg_tenure_years: round2(tenure),
    attendance_pct: attRows.length ? Math.round(attRows.reduce((a, r) => a + r.attendance_pct, 0) / attRows.length) : null,
    utilization_pct: utilRows.length ? Math.round(utilRows.reduce((a, r) => a + r.utilization_pct, 0) / utilRows.length) : null,
    weighted_pipeline: round2(pipeline.filter((p) => !['won', 'lost'].includes(p.stage)).reduce((a, p) => a + p.weighted, 0)),
    enps: enpsScore,
  };
  if (money) {
    kpis.revenue = round2(series.reduce((a, r) => a + r.revenue, 0));
    kpis.payroll_cost = round2(series.reduce((a, r) => a + r.payroll_cost, 0));
    kpis.revenue_per_employee = now ? round2(kpis.revenue / now) : 0;
  }
  res.json({
    months: n, period_start: periodStart, kpis, series,
    by_department: all(`SELECT COALESCE(d.name, 'Unassigned') AS name, COUNT(*) AS value FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status != 'exited' GROUP BY d.name ORDER BY value DESC`),
    leave_by_type: all(`SELECT lt.name, lt.color, COALESCE(SUM(r.days), 0) AS days FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE r.status = 'approved' AND r.start_date >= ? GROUP BY lt.id ORDER BY days DESC`, periodStart),
    project_health: all("SELECT health AS name, COUNT(*) AS value FROM projects WHERE status = 'active' GROUP BY health"),
    pipeline: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'].map((s) => {
      const p = pipeline.find((x) => x.stage === s);
      return { stage: s, count: p?.count || 0, value: round2(p?.value || 0), weighted: round2(p?.weighted || 0) };
    }),
  });
});

/**
 * Workload & wellbeing (We360-style): who is working long hours, on days off, late into the night or without a
 * break, from attendance punches and (where the desktop agent runs) late-night activity. Managers see their reports.
 */
analyticsRouter.get('/wellbeing', (req, res) => {
  const days = [30, 60, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const end = today();
  const startD = new Date(`${end}T00:00:00`); startD.setDate(startD.getDate() - days + 1);
  const start = ymd(startD);
  const scope = isHR(req.user) ? null : reportIds(req.user.id);
  const emps = all(`SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.emp_code, e.avatar_color, d.name AS department
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.status != 'exited' ${scope ? `AND e.id IN (${scope.length ? scope.join(',') : 0})` : ''} ORDER BY e.first_name`);
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const rows = emps.map((e) => {
    const att = all("SELECT date, clock_in, clock_out, overtime_mins FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND clock_in IS NOT NULL", e.id, start, end);
    const isOff = offDayChecker(e.id);
    const worked = att.filter((a) => a.clock_out);
    const hours = worked.map((a) => Math.max(0, mins(a.clock_out) - mins(a.clock_in)) / 60);
    const avg = hours.length ? hours.reduce((x, y) => x + y, 0) / hours.length : 0;
    const longDays = hours.filter((h) => h >= 10).length;
    const offDays = att.filter((a) => isOff(parseDate(a.date))).length;
    const lateFinishes = worked.filter((a) => mins(a.clock_out) >= 21 * 60).length;
    const overtime = att.reduce((x, a) => x + (a.overtime_mins || 0), 0) / 60;
    const lastLeave = get("SELECT MAX(end_date) AS d FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND end_date <= ?", e.id, end).d;
    const sinceLeave = lastLeave ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${lastLeave}T00:00:00`)) / 86400000) : null;
    const lateNight = get(`SELECT COALESCE(SUM(active_seconds), 0) AS s FROM activity_events WHERE employee_id = ? AND substr(ts, 1, 10) BETWEEN ? AND ?
      AND (CAST(substr(ts, 12, 2) AS INTEGER) >= 22 OR CAST(substr(ts, 12, 2) AS INTEGER) < 6)`, e.id, start, end).s / 3600;
    const flags = [];
    if (avg >= 9.5) flags.push(`Averages ${round2(avg)} h a day`);
    if (longDays >= 4) flags.push(`${longDays} days of 10 h or more`);
    if (offDays >= 2) flags.push(`Worked ${offDays} weekly off / holiday day(s)`);
    if (lateFinishes >= 3) flags.push(`${lateFinishes} finishes after 9 pm`);
    if (lateNight >= 3) flags.push(`${round2(lateNight)} h active between 10 pm and 6 am`);
    if (sinceLeave === null || sinceLeave >= 90) flags.push(sinceLeave === null ? 'No leave on record' : `No leave for ${sinceLeave} days`);
    const score = Math.min(100, Math.round((avg >= 9 ? (avg - 9) * 20 : 0) + longDays * 5 + offDays * 8 + lateFinishes * 4 + lateNight * 3 + (sinceLeave === null || sinceLeave >= 90 ? 15 : 0)));
    return {
      ...e, days_worked: att.length, avg_hours: round2(avg), long_days: longDays, off_days_worked: offDays, late_finishes: lateFinishes,
      overtime_hours: round2(overtime), late_night_hours: round2(lateNight), days_since_leave: sinceLeave, score, risk: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', flags,
    };
  });
  const byDept = Object.values(rows.reduce((m, r) => {
    const k = r.department || 'Unassigned';
    m[k] ||= { department: k, people: 0, avg_hours: 0, overtime_hours: 0, at_risk: 0 };
    m[k].people++; m[k].avg_hours += r.avg_hours; m[k].overtime_hours += r.overtime_hours; if (r.risk !== 'low') m[k].at_risk++;
    return m;
  }, {})).map((d) => ({ ...d, avg_hours: round2(d.avg_hours / d.people), overtime_hours: round2(d.overtime_hours) })).sort((a, b) => b.avg_hours - a.avg_hours);
  // Weekly trend of average daily hours and overtime across the people in scope.
  const ids = emps.map((e) => e.id);
  const weeks = [];
  for (let w = Math.ceil(days / 7) - 1; w >= 0; w--) {
    const we = new Date(`${end}T00:00:00`); we.setDate(we.getDate() - w * 7);
    const ws = new Date(we); ws.setDate(ws.getDate() - 6);
    const recs = ids.length ? all(`SELECT clock_in, clock_out, overtime_mins FROM attendance WHERE employee_id IN (${ids.join(',')}) AND date BETWEEN ? AND ? AND clock_out IS NOT NULL`, ymd(ws), ymd(we)) : [];
    const h = recs.map((r) => Math.max(0, mins(r.clock_out) - mins(r.clock_in)) / 60);
    weeks.push({ week: ymd(ws), avg_hours: h.length ? round2(h.reduce((x, y) => x + y, 0) / h.length) : null, overtime_hours: round2(recs.reduce((x, r) => x + (r.overtime_mins || 0), 0) / 60) });
  }
  res.json({
    days, start, end, people: rows.length,
    summary: {
      high: rows.filter((r) => r.risk === 'high').length, medium: rows.filter((r) => r.risk === 'medium').length,
      avg_hours: rows.length ? round2(rows.reduce((x, r) => x + r.avg_hours, 0) / rows.filter((r) => r.days_worked).length || 0) : 0,
      overtime_hours: round2(rows.reduce((x, r) => x + r.overtime_hours, 0)),
      no_leave_90: rows.filter((r) => r.days_since_leave === null || r.days_since_leave >= 90).length,
    },
    rows: rows.sort((a, b) => b.score - a.score), by_department: byDept, trend: weeks,
  });
});
