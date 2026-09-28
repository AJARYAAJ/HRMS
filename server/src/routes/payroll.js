import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, scopeSql, isHR } from '../auth.js';
import { crud } from '../crud.js';
import { monthRange, workingDaysBetween, computePayslip, httpError, audit, notify, round2, today, annualTaxNewRegime } from '../utils.js';

export const payrollRouter = Router();

const SLIP_SELECT = `
  SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.emp_code, e.pan, e.uan, e.bank_name,
         e.bank_account, e.date_of_joining, d.name AS department, g.title AS designation, e.avatar_color
  FROM payslips t JOIN employees e ON e.id = t.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN designations g ON g.id = e.designation_id`;

payrollRouter.get('/runs', requireRole('admin', 'hr'), (req, res) => {
  res.json(all('SELECT * FROM payroll_runs ORDER BY month DESC'));
});

/**
 * Loss-of-pay days = days before joining + past working days with no attendance or approved leave
 * (or approved LOP leave, whichever is higher). Future days in the month are assumed paid.
 */
function lopDays(employeeId, start, end, attEnd, workingDays, joinDate) {
  const effStart = joinDate && joinDate > start ? joinDate : start;
  if (effStart > end) return workingDays;
  const notJoined = workingDays - workingDaysBetween(effStart, end);
  const eligiblePast = effStart > attEnd ? 0 : workingDaysBetween(effStart, attEnd);
  const att = get(
    `SELECT SUM(CASE WHEN status IN ('present','leave') THEN 1 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) AS paid
     FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND strftime('%w', date) NOT IN ('0','6')
     AND date NOT IN (SELECT date FROM holidays)`,
    employeeId, effStart, attEnd,
  );
  const lopLeave = get(
    `SELECT COALESCE(SUM(r.days), 0) AS d FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.employee_id = ? AND lt.code = 'LOP' AND r.status = 'approved' AND r.start_date BETWEEN ? AND ?`,
    employeeId, start, end,
  ).d;
  const absent = Math.max(0, eligiblePast - (att?.paid || 0));
  return Math.min(workingDays, notJoined + Math.max(absent, lopLeave));
}

payrollRouter.post('/run', requireRole('admin', 'hr'), (req, res) => {
  const month = req.body.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw httpError(400, 'Month must be in YYYY-MM format');
  if (month > today().slice(0, 7)) throw httpError(400, 'Cannot run payroll for a future month');
  const existing = get('SELECT * FROM payroll_runs WHERE month = ?', month);
  if (existing?.status === 'paid') throw httpError(400, 'Payroll for this month is already paid and locked');
  const { start, end } = monthRange(month);
  const workingDays = workingDaysBetween(start, end);
  const emps = all(
    `SELECT * FROM employees WHERE annual_ctc > 0 AND date_of_joining <= ? AND (status != 'exited' OR exit_date >= ?)`,
    end, start,
  );
  const runId = tx(() => {
    if (existing) run('DELETE FROM payroll_runs WHERE id = ?', existing.id);
    const id = insert('payroll_runs', { month, status: 'processed', processed_by: req.user.id });
    let gross = 0, deductions = 0, net = 0;
    for (const e of emps) {
      const lop = lopDays(e.id, start, end, end < today() ? end : today(), workingDays, e.date_of_joining);
      const paid = Math.max(0, workingDays - lop);
      const slip = computePayslip(e.annual_ctc, workingDays, paid);
      insert('payslips', { run_id: id, employee_id: e.id, month, working_days: workingDays, paid_days: paid, lop_days: lop, ...slip });
      gross += slip.gross; deductions += slip.total_deductions; net += slip.net;
    }
    update('payroll_runs', id, { employees: emps.length, total_gross: round2(gross), total_deductions: round2(deductions), total_net: round2(net) });
    audit(req.user.id, 'run_payroll', 'payroll_runs', id, { month });
    return id;
  });
  res.status(201).json(get('SELECT * FROM payroll_runs WHERE id = ?', runId));
});

payrollRouter.post('/runs/:id/pay', requireRole('admin', 'hr'), (req, res) => {
  const runRow = get('SELECT * FROM payroll_runs WHERE id = ?', req.params.id);
  if (!runRow) throw httpError(404, 'Payroll run not found');
  if (runRow.status === 'paid') throw httpError(400, 'Already marked as paid');
  tx(() => {
    update('payroll_runs', runRow.id, { status: 'paid', paid_at: new Date().toISOString() });
    for (const s of all('SELECT employee_id FROM payslips WHERE run_id = ?', runRow.id)) {
      notify(s.employee_id, `Payslip for ${runRow.month} is ready`, 'Your salary has been credited.', '/payslips');
    }
    audit(req.user.id, 'pay_payroll', 'payroll_runs', runRow.id);
  });
  res.json(get('SELECT * FROM payroll_runs WHERE id = ?', runRow.id));
});

payrollRouter.get('/runs/:id/payslips', requireRole('admin', 'hr'), (req, res) => {
  res.json(all(`${SLIP_SELECT} WHERE t.run_id = ? ORDER BY e.first_name`, req.params.id));
});

payrollRouter.get('/payslips', (req, res) => {
  const scope = scopeSql(req.user, 't.employee_id');
  const employeeId = req.query.employee_id || (isHR(req.user) && req.query.all ? null : req.user.id);
  const where = [scope.sql];
  const params = [...scope.params];
  if (employeeId) { where.push('t.employee_id = ?'); params.push(employeeId); }
  // Employees only see payslips from runs that have been paid.
  if (!isHR(req.user)) where.push("t.run_id IN (SELECT id FROM payroll_runs WHERE status = 'paid')");
  res.json(all(`${SLIP_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.month DESC`, ...params));
});

payrollRouter.get('/payslips/:id', (req, res) => {
  const slip = get(`${SLIP_SELECT} WHERE t.id = ?`, req.params.id);
  if (!slip) throw httpError(404, 'Payslip not found');
  if (slip.employee_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  res.json({ ...slip, company: Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])) });
});

payrollRouter.get('/salaries', requireRole('admin', 'hr'), (req, res) => {
  res.json(all(
    `SELECT e.id, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name, e.annual_ctc, e.avatar_color,
            d.name AS department, g.title AS designation
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id
     WHERE e.status != 'exited' ORDER BY e.first_name`,
  ).map((r) => ({ ...r, monthly: computePayslip(r.annual_ctc, 1, 1) })));
});

payrollRouter.put('/salaries/:id', requireRole('admin', 'hr'), (req, res) => {
  const ctc = Number(req.body.annual_ctc);
  if (!(ctc >= 0)) throw httpError(400, 'Annual CTC must be a positive number');
  const before = get('SELECT annual_ctc FROM employees WHERE id = ?', req.params.id);
  if (!before) throw httpError(404, 'Employee not found');
  update('employees', Number(req.params.id), { annual_ctc: ctc });
  audit(req.user.id, 'revise_salary', 'employees', Number(req.params.id), { from: before.annual_ctc, to: ctc });
  notify(Number(req.params.id), 'Salary revised', `Your annual CTC has been updated to ₹${ctc.toLocaleString('en-IN')}`, '/payslips');
  res.json({ ok: true });
});

payrollRouter.get('/preview', (req, res) => {
  const emp = get('SELECT annual_ctc FROM employees WHERE id = ?', req.user.id);
  res.json({ annual_ctc: emp.annual_ctc, monthly: computePayslip(emp.annual_ctc, 1, 1), annual_tax: annualTaxNewRegime(emp.annual_ctc) });
});

export const taxRouter = crud({
  table: 'tax_declarations',
  label: 'tax declaration',
  link: '/payslips',
  fields: ['employee_id', 'fy', 'section', 'description', 'amount'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  approvers: ['admin', 'hr'],
  filters: ['status', 'fy', 'employee_id'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color
           FROM tax_declarations t JOIN employees e ON e.id = t.employee_id`,
  validate(data) {
    if (data.amount !== undefined && !(Number(data.amount) > 0)) throw httpError(400, 'Amount must be greater than zero');
    return data;
  },
});
