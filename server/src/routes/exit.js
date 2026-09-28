import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR } from '../auth.js';
import { crud } from '../crud.js';
import { audit, httpError, notify, notifyHR, today, round2, ensureLeaveBalances } from '../utils.js';
import { payrollSettings } from '../tax.js';
import { createTasks } from './employees.js';

export const exitRouter = Router();

const setting = (key, fallback) => get('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
export const noticePeriodDays = () => Number(setting('notice_period_days', 60)) || 60;

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

export const resignationsRouter = crud({
  table: 'resignations',
  label: 'resignation',
  link: '/exit',
  fields: ['employee_id', 'reason', 'notes', 'requested_lwd'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  write: ['admin', 'hr'],
  filters: ['status', 'employee_id'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color, e.emp_code, e.date_of_joining,
           g.title AS designation, m.first_name || ' ' || m.last_name AS manager_name,
           (SELECT id FROM exit_interviews x WHERE x.resignation_id = t.id) AS interview_id,
           (SELECT id FROM fnf_settlements f WHERE f.resignation_id = t.id ORDER BY f.id DESC LIMIT 1) AS fnf_id,
           (SELECT status FROM fnf_settlements f WHERE f.resignation_id = t.id ORDER BY f.id DESC LIMIT 1) AS fnf_status
           FROM resignations t JOIN employees e ON e.id = t.employee_id
           LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN employees m ON m.id = e.manager_id`,
  validate(data, user, existing) {
    const ownerId = existing?.employee_id ?? data.employee_id ?? user.id;
    if (!existing && get("SELECT id FROM resignations WHERE employee_id = ? AND status IN ('pending','manager_approved','approved')", ownerId)) {
      throw httpError(409, 'A resignation is already in progress');
    }
    const notice = noticePeriodDays();
    const submitted = existing?.submitted_on || today();
    const lwd = data.requested_lwd || existing?.requested_lwd || addDays(submitted, notice);
    if (lwd < submitted) throw httpError(400, 'Last working day cannot be before the submission date');
    if (!existing && !data.reason) throw httpError(400, 'Please give a reason');
    return { ...data, requested_lwd: lwd, submitted_on: submitted, notice_days: notice };
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    const msg = `${emp.first_name} ${emp.last_name} has resigned (requested last day ${data.requested_lwd})`;
    if (emp.manager_id) notify(emp.manager_id, 'Resignation submitted', msg, '/approvals');
    notifyHR('Resignation submitted', msg, '/exit');
  },
  onDecision(row, status, user) {
    if (status !== 'approved') return;
    const lwd = row.approved_lwd || row.requested_lwd;
    run('UPDATE resignations SET approved_lwd = ? WHERE id = ?', lwd, row.id);
    update('employees', row.employee_id, { status: 'on_notice', exit_date: lwd });
    run("DELETE FROM onboarding_tasks WHERE employee_id = ? AND type = 'offboarding'", row.employee_id);
    createTasks(row.employee_id, 'offboarding', today());
    notify(row.employee_id, 'Please complete your exit interview', 'Your feedback helps us improve. It takes about 3 minutes.', '/exit');
    audit(user.id, 'offboard', 'employees', row.employee_id, { exit_date: lwd, via: 'resignation' });
  },
});

// HR can agree a different last working day (e.g. early release or buy-out).
resignationsRouter.put('/:id/lwd', requireRole('admin', 'hr'), (req, res) => {
  const r = get('SELECT * FROM resignations WHERE id = ?', req.params.id);
  if (!r) throw httpError(404, 'Resignation not found');
  const lwd = req.body.last_working_day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lwd || '') || lwd < r.submitted_on) throw httpError(400, 'Enter a valid last working day on or after the submission date');
  tx(() => {
    run('UPDATE resignations SET approved_lwd = ?, requested_lwd = CASE WHEN status = ? THEN requested_lwd ELSE ? END WHERE id = ?', lwd, 'approved', lwd, r.id);
    if (r.status === 'approved') update('employees', r.employee_id, { exit_date: lwd });
  });
  notify(r.employee_id, 'Last working day updated', `Your last working day is now ${lwd}.`, '/exit');
  audit(req.user.id, 'update_lwd', 'resignations', r.id, { lwd });
  res.json(get('SELECT * FROM resignations WHERE id = ?', r.id));
});

resignationsRouter.post('/:id/withdraw', (req, res) => {
  const r = get('SELECT * FROM resignations WHERE id = ?', req.params.id);
  if (!r) throw httpError(404, 'Resignation not found');
  if (r.employee_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  if (!['pending', 'manager_approved', 'approved'].includes(r.status)) throw httpError(400, `A ${r.status} resignation cannot be withdrawn`);
  if (r.status === 'approved' && !isHR(req.user)) throw httpError(403, 'Your resignation is already approved; ask HR to revoke it');
  tx(() => {
    update('resignations', r.id, { status: 'withdrawn' });
    if (r.status === 'approved') {
      update('employees', r.employee_id, { status: 'active', exit_date: null });
      run("DELETE FROM onboarding_tasks WHERE employee_id = ? AND type = 'offboarding'", r.employee_id);
    }
  });
  notifyHR('Resignation withdrawn', `Resignation #${r.id} was withdrawn`, '/exit');
  audit(req.user.id, 'withdraw', 'resignations', r.id);
  res.json({ ok: true });
});

// ---------- exit interviews ----------
exitRouter.post('/interviews', (req, res) => {
  const r = get('SELECT * FROM resignations WHERE id = ?', req.body.resignation_id);
  if (!r || r.employee_id !== req.user.id) throw httpError(404, 'Resignation not found');
  if (r.status !== 'approved') throw httpError(400, 'The exit interview opens once your resignation is approved');
  if (get('SELECT id FROM exit_interviews WHERE resignation_id = ?', r.id)) throw httpError(409, 'Exit interview already submitted');
  const b = req.body;
  const rating = (v) => (v === undefined || v === null || v === '' ? null : Math.max(1, Math.min(5, Number(v))));
  const id = insert('exit_interviews', {
    employee_id: req.user.id, resignation_id: r.id, primary_reason: b.primary_reason, feedback: b.feedback,
    rating_manager: rating(b.rating_manager), rating_culture: rating(b.rating_culture), rating_growth: rating(b.rating_growth),
    rating_compensation: rating(b.rating_compensation), would_recommend: b.would_recommend ? 1 : 0, would_return: b.would_return ? 1 : 0,
  });
  run("UPDATE onboarding_tasks SET done = 1 WHERE employee_id = ? AND type = 'offboarding' AND title = 'Exit interview'", req.user.id);
  notifyHR('Exit interview submitted', `${req.user.first_name} ${req.user.last_name} completed their exit interview`, '/exit');
  res.status(201).json(get('SELECT * FROM exit_interviews WHERE id = ?', id));
});

exitRouter.get('/interviews', requireRole('admin', 'hr'), (req, res) => {
  const rows = all(
    `SELECT x.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color, d.name AS department
     FROM exit_interviews x JOIN employees e ON e.id = x.employee_id LEFT JOIN departments d ON d.id = e.department_id ORDER BY x.id DESC`,
  );
  const avg = (k) => (rows.filter((r) => r[k]).length ? round2(rows.reduce((a, r) => a + (r[k] || 0), 0) / rows.filter((r) => r[k]).length) : null);
  const reasons = {};
  for (const r of rows) reasons[r.primary_reason || 'Other'] = (reasons[r.primary_reason || 'Other'] || 0) + 1;
  res.json({
    rows,
    summary: {
      count: rows.length, manager: avg('rating_manager'), culture: avg('rating_culture'), growth: avg('rating_growth'), compensation: avg('rating_compensation'),
      recommend_pct: rows.length ? Math.round((rows.filter((r) => r.would_recommend).length / rows.length) * 100) : null,
      reasons: Object.entries(reasons).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    },
  });
});

// ---------- full & final settlement ----------
/**
 * F&F components (Indian practice):
 *  - unpaid salary from the day after the last paid payroll month up to the last working day
 *  - earned-leave encashment at basic ÷ 26 per day
 *  - gratuity when service ≥ 5 years: 15/26 × monthly basic × completed years (> 6 months rounds up)
 *  - notice-period shortfall recovery at gross ÷ 30 per day (can be waived)
 *  - outstanding loans / advances recovered
 */
export function computeFnf(employeeId, { waiveNotice = false, bonus = 0, otherDeductions = 0 } = {}) {
  const emp = get('SELECT * FROM employees WHERE id = ?', employeeId);
  if (!emp) throw httpError(404, 'Employee not found');
  const resignation = get("SELECT * FROM resignations WHERE employee_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1", employeeId);
  const lwd = resignation?.approved_lwd || emp.exit_date;
  if (!lwd) throw httpError(400, 'This employee has no approved exit / last working day');
  const { basicPct } = payrollSettings();
  const monthlyGross = (emp.annual_ctc || 0) / 12;
  const monthlyBasic = monthlyGross * (basicPct / 100);

  const lastPaid = get(
    `SELECT MAX(p.month) AS m FROM payslips p JOIN payroll_runs r ON r.id = p.run_id AND r.status = 'paid' WHERE p.employee_id = ?`, employeeId,
  ).m;
  const lwdMonth = lwd.slice(0, 7);
  let salaryDays = 0;
  let salaryAmount = 0;
  // Walk each unpaid month up to the LWD and pay the calendar days worked in it.
  let cursor = lastPaid ? (() => { const [y, m] = lastPaid.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })() : lwdMonth;
  while (cursor <= lwdMonth) {
    const [y, m] = cursor.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const days = cursor === lwdMonth ? Number(lwd.slice(8, 10)) : daysInMonth;
    salaryDays += days;
    salaryAmount += (monthlyGross / daysInMonth) * days;
    const next = new Date(y, m, 1);
    cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }

  ensureLeaveBalances(employeeId, Number(lwd.slice(0, 4)));
  const el = get(
    `SELECT b.allocated - b.used AS left FROM leave_balances b JOIN leave_types lt ON lt.id = b.leave_type_id
     WHERE b.employee_id = ? AND lt.code = 'EL' AND b.year = ?`, employeeId, Number(lwd.slice(0, 4)),
  );
  const encashDays = Math.max(0, el?.left || 0);
  const encashAmount = (monthlyBasic / 26) * encashDays;

  const serviceYears = daysBetween(emp.date_of_joining, lwd) / 365.25;
  const completedYears = Math.floor(serviceYears) + (serviceYears % 1 > 0.5 ? 1 : 0);
  const gratuity = serviceYears >= 5 ? (15 / 26) * monthlyBasic * completedYears : 0;

  const required = resignation?.notice_days ?? noticePeriodDays();
  const served = resignation ? daysBetween(resignation.submitted_on, lwd) + 1 : required;
  const shortfall = waiveNotice ? 0 : Math.max(0, required - served);
  const noticeRecovery = (monthlyGross / 30) * shortfall;

  const loanRecovery = get("SELECT COALESCE(SUM(outstanding), 0) AS s FROM loans WHERE employee_id = ? AND status = 'approved'", employeeId).s;
  const net = salaryAmount + encashAmount + gratuity + Number(bonus || 0) - noticeRecovery - loanRecovery - Number(otherDeductions || 0);

  return {
    employee_id: employeeId, resignation_id: resignation?.id ?? null, last_working_day: lwd,
    salary_days: salaryDays, salary_amount: round2(salaryAmount),
    leave_encash_days: encashDays, leave_encash_amount: round2(encashAmount),
    service_years: round2(serviceYears), gratuity: round2(gratuity), bonus: round2(Number(bonus || 0)),
    notice_required_days: required, notice_served_days: served, notice_shortfall_days: shortfall, notice_recovery: round2(noticeRecovery),
    loan_recovery: round2(loanRecovery), other_deductions: round2(Number(otherDeductions || 0)), net_payable: round2(net),
  };
}

const FNF_SELECT = `SELECT f.*, e.first_name || ' ' || e.last_name AS employee_name, e.emp_code, e.avatar_color, g.title AS designation
  FROM fnf_settlements f JOIN employees e ON e.id = f.employee_id LEFT JOIN designations g ON g.id = e.designation_id`;

exitRouter.get('/fnf/preview/:employeeId', requireRole('admin', 'hr'), (req, res) => {
  res.json(computeFnf(Number(req.params.employeeId), {
    waiveNotice: req.query.waive_notice === '1', bonus: req.query.bonus, otherDeductions: req.query.other_deductions,
  }));
});

exitRouter.get('/fnf', (req, res) => {
  if (isHR(req.user)) return res.json(all(`${FNF_SELECT} ORDER BY f.id DESC`));
  res.json(all(`${FNF_SELECT} WHERE f.employee_id = ? AND f.status != 'draft' ORDER BY f.id DESC`, req.user.id));
});

exitRouter.get('/fnf/:id', (req, res) => {
  const f = get(`${FNF_SELECT} WHERE f.id = ?`, req.params.id);
  if (!f || (!isHR(req.user) && (f.employee_id !== req.user.id || f.status === 'draft'))) throw httpError(404, 'Settlement not found');
  res.json(f);
});

exitRouter.post('/fnf', requireRole('admin', 'hr'), (req, res) => {
  const b = req.body;
  const calc = computeFnf(Number(b.employee_id), { waiveNotice: !!b.waive_notice, bonus: b.bonus, otherDeductions: b.other_deductions });
  const draft = get("SELECT id FROM fnf_settlements WHERE employee_id = ? AND status = 'draft'", calc.employee_id);
  const data = {
    employee_id: calc.employee_id, resignation_id: calc.resignation_id, last_working_day: calc.last_working_day,
    salary_days: calc.salary_days, salary_amount: calc.salary_amount, leave_encash_days: calc.leave_encash_days,
    leave_encash_amount: calc.leave_encash_amount, gratuity: calc.gratuity, bonus: calc.bonus,
    notice_shortfall_days: calc.notice_shortfall_days, notice_recovery: calc.notice_recovery, loan_recovery: calc.loan_recovery,
    other_deductions: calc.other_deductions, net_payable: calc.net_payable, notes: b.notes || null, created_by: req.user.id, status: 'draft',
  };
  const id = draft ? (update('fnf_settlements', draft.id, data), draft.id) : insert('fnf_settlements', data);
  audit(req.user.id, draft ? 'update' : 'create', 'fnf_settlements', id);
  res.status(201).json(get(`${FNF_SELECT} WHERE f.id = ?`, id));
});

exitRouter.put('/fnf/:id/status', requireRole('admin', 'hr'), (req, res) => {
  const f = get('SELECT * FROM fnf_settlements WHERE id = ?', req.params.id);
  if (!f) throw httpError(404, 'Settlement not found');
  const { status } = req.body;
  const allowed = { draft: ['approved'], approved: ['paid', 'draft'] };
  if (!(allowed[f.status] || []).includes(status)) throw httpError(400, `Cannot move a ${f.status} settlement to ${status}`);
  tx(() => {
    update('fnf_settlements', f.id, { status, paid_at: status === 'paid' ? new Date().toISOString() : null });
    if (status === 'paid') {
      // Loans are settled out of the F&F amount.
      run("UPDATE loans SET outstanding = 0, status = 'closed' WHERE employee_id = ? AND status = 'approved'", f.employee_id);
      update('employees', f.employee_id, { status: 'exited' });
    }
  });
  if (status === 'approved') notify(f.employee_id, 'Your full & final settlement is ready', `Net payable: ₹${f.net_payable.toLocaleString('en-IN')}`, '/exit');
  if (status === 'paid') notify(f.employee_id, 'Full & final settlement paid', `₹${f.net_payable.toLocaleString('en-IN')} has been paid. Thank you for your contributions!`, '/exit');
  audit(req.user.id, `fnf_${status}`, 'fnf_settlements', f.id);
  res.json(get(`${FNF_SELECT} WHERE f.id = ?`, f.id));
});

// Summary for the exit dashboard.
exitRouter.get('/summary', requireRole('admin', 'hr', 'manager'), (req, res) => {
  res.json({
    pending: get("SELECT COUNT(*) AS n FROM resignations WHERE status IN ('pending','manager_approved')").n,
    serving_notice: get("SELECT COUNT(*) AS n FROM employees WHERE status = 'on_notice'").n,
    exits_90d: get("SELECT COUNT(*) AS n FROM employees WHERE status = 'exited' AND exit_date >= date('now', '-90 days')").n,
    fnf_pending: get("SELECT COUNT(*) AS n FROM fnf_settlements WHERE status IN ('draft','approved')").n,
    probation_due: all(
      `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.avatar_color, e.probation_end_date, e.confirmation_status, g.title AS designation
       FROM employees e LEFT JOIN designations g ON g.id = e.designation_id
       WHERE e.status = 'active' AND e.confirmation_status IN ('probation','extended') AND e.probation_end_date <= date('now', '+30 days')
       ORDER BY e.probation_end_date`,
    ),
  });
});
