import { Router } from 'express';
import { all, get } from '../db.js';
import { requireRole, isHR } from '../auth.js';
import { today, ymd, parseDate, round2, workingDaysBetween, monthRange } from '../utils.js';

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
