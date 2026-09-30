import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, scopeSql, isHR, canManage } from '../auth.js';
import { crud } from '../crud.js';
import { monthRange, workingDaysBetween, offDayChecker, parseDate, httpError, audit, notify, round2, today } from '../utils.js';
import { computeSalary, structureFor } from '../salary.js';
import { taxProfile, payrollSettings, fyOf, fyMonths } from '../tax.js';

export const payrollRouter = Router();

const SLIP_SELECT = `
  SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.emp_code, e.pan, e.uan, e.bank_name,
         e.bank_account, e.ifsc, e.date_of_joining, d.name AS department, g.title AS designation, e.avatar_color,
         c.name AS company_name
  FROM payslips t JOIN employees e ON e.id = t.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN designations g ON g.id = e.designation_id
  LEFT JOIN companies c ON c.id = t.company_id`;

const RUN_SELECT = `SELECT r.*, c.name AS company_name FROM payroll_runs r LEFT JOIN companies c ON c.id = r.company_id`;

payrollRouter.get('/runs', requireRole('admin', 'hr'), (req, res) => {
  const where = req.query.company_id ? 'WHERE r.company_id = ?' : '';
  res.json(all(`${RUN_SELECT} ${where} ORDER BY r.month DESC, c.name`, ...(req.query.company_id ? [req.query.company_id] : [])));
});

/**
 * Loss-of-pay days = days before joining + past working days with no attendance or approved leave
 * (or approved LOP leave, whichever is higher) + late-mark penalties charged as loss of pay.
 * Working days follow the employee's holiday list and weekly-off policy. Future days in the month are assumed paid.
 */
function lopDays(employeeId, start, end, attEnd, workingDays, joinDate) {
  const effStart = joinDate && joinDate > start ? joinDate : start;
  if (effStart > end) return workingDays;
  const notJoined = workingDays - workingDaysBetween(effStart, end);
  const isOff = offDayChecker(employeeId);
  const eligiblePast = effStart > attEnd ? 0 : workingDaysBetween(effStart, attEnd, isOff.holidays, isOff.weeklyOff);
  const paid = all("SELECT date, status FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND status IN ('present','leave','half_day')", employeeId, effStart, attEnd)
    .filter((r) => !isOff(parseDate(r.date)))
    .reduce((a, r) => a + (r.status === 'half_day' ? 0.5 : 1), 0);
  const lopLeave = get(
    `SELECT COALESCE(SUM(r.days), 0) AS d FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.employee_id = ? AND lt.code = 'LOP' AND r.status = 'approved' AND r.start_date BETWEEN ? AND ?`,
    employeeId, start, end,
  ).d;
  const penalty = get("SELECT COALESCE(SUM(days), 0) AS d FROM attendance_penalties WHERE employee_id = ? AND month = ? AND status = 'applied' AND leave_type_id IS NULL", employeeId, start.slice(0, 7)).d;
  const absent = Math.max(0, eligiblePast - paid);
  return Math.min(workingDays, notJoined + Math.max(absent, lopLeave) + penalty);
}

/** Undo a run's side effects (loan EMIs, reimbursed expenses) so it can be recalculated. */
function reverseRun(runId) {
  for (const r of all('SELECT lr.* FROM loan_repayments lr JOIN payslips p ON p.id = lr.payslip_id WHERE p.run_id = ?', runId)) {
    run("UPDATE loans SET outstanding = outstanding + ?, status = 'approved' WHERE id = ?", r.amount, r.loan_id);
  }
  run("UPDATE expenses SET status = 'approved', payslip_id = NULL WHERE payslip_id IN (SELECT id FROM payslips WHERE run_id = ?)", runId);
  run('DELETE FROM payroll_runs WHERE id = ?', runId);
}

function processCompanyPayroll(month, companyId, userId) {
  const existing = get('SELECT * FROM payroll_runs WHERE month = ? AND company_id IS ?', month, companyId);
  if (existing?.status === 'paid') return { skipped: true, run: existing };
  const { start, end } = monthRange(month);
  const workingDays = workingDaysBetween(start, end);
  const fy = fyOf(start);
  const emps = all(
    `SELECT * FROM employees WHERE annual_ctc > 0 AND date_of_joining <= ? AND (status != 'exited' OR exit_date >= ?) AND company_id IS ?`,
    end, start, companyId,
  );
  const runId = tx(() => {
    if (existing) reverseRun(existing.id);
    const id = insert('payroll_runs', { month, company_id: companyId, status: 'processed', processed_by: userId });
    let gross = 0, deductions = 0, net = 0;
    for (const e of emps) {
      const lop = lopDays(e.id, start, end, end < today() ? end : today(), workingDays, e.date_of_joining);
      const paid = Math.max(0, workingDays - lop);
      const tax = taxProfile(e, fy);
      const structure = structureFor(e.id);
      const calc = computeSalary(structure, e.annual_ctc, { workingDays, paidDays: paid, annualTax: tax.annual_tax });
      const { basic, hra, special, gross: g, pf, esi, pt, tds, total_deductions: td, net: n } = calc;
      const slip = { basic, hra, special, gross: g, pf, esi, pt, tds, total_deductions: td, net: n };
      // Approved, not-yet-paid expense claims are reimbursed with salary.
      const claims = all("SELECT id, amount FROM expenses WHERE employee_id = ? AND status = 'approved' AND payslip_id IS NULL", e.id);
      const reimbursement = round2(claims.reduce((a, c) => a + c.amount, 0));
      // Active loans/advances disbursed on or before month end: deduct one EMI (never more than what's outstanding).
      const loans = all("SELECT * FROM loans WHERE employee_id = ? AND status = 'approved' AND outstanding > 0 AND disbursed_on <= ?", e.id, end);
      const emis = loans.map((l) => ({ loan: l, amount: round2(Math.min(l.emi, l.outstanding)) }));
      const loanDeduction = round2(emis.reduce((a, x) => a + x.amount, 0));
      const totalDeductions = round2(slip.total_deductions + loanDeduction);
      const netPay = round2(slip.gross + reimbursement - totalDeductions);
      const slipId = insert('payslips', {
        run_id: id, employee_id: e.id, company_id: companyId, month, working_days: workingDays, paid_days: paid, lop_days: lop,
        ...slip, total_deductions: totalDeductions, net: netPay, reimbursement, loan_deduction: loanDeduction, tax_regime: tax.selected,
        structure_name: calc.structure, employer_pf: calc.employer.pf, employer_esi: calc.employer.esi, gratuity: calc.employer.gratuity,
      });
      // Component-wise lines as they appear on the payslip.
      calc.lines.forEach((l, i) => insert('payslip_lines', { payslip_id: slipId, code: l.code, name: l.name, type: l.type, amount: l.amount, sort: i }));
      if (loanDeduction) insert('payslip_lines', { payslip_id: slipId, code: 'LOAN', name: 'Loan / advance EMI', type: 'deduction', amount: loanDeduction, sort: 90 });
      [['EMP_PF', 'Employer PF', calc.employer.pf], ['EMP_ESI', 'Employer ESI', calc.employer.esi], ['GRATUITY', 'Gratuity provision', calc.employer.gratuity]]
        .forEach(([code, name, amount], i) => amount && insert('payslip_lines', { payslip_id: slipId, code, name, type: 'employer', amount, sort: 100 + i }));
      for (const c of claims) run("UPDATE expenses SET status = 'reimbursed', payslip_id = ? WHERE id = ?", slipId, c.id);
      for (const { loan, amount } of emis) {
        insert('loan_repayments', { loan_id: loan.id, payslip_id: slipId, month, amount });
        const left = round2(loan.outstanding - amount);
        run('UPDATE loans SET outstanding = ?, status = ? WHERE id = ?', left, left <= 0 ? 'closed' : 'approved', loan.id);
      }
      gross += slip.gross; deductions += totalDeductions; net += netPay;
    }
    update('payroll_runs', id, { employees: emps.length, total_gross: round2(gross), total_deductions: round2(deductions), total_net: round2(net) });
    audit(userId, 'run_payroll', 'payroll_runs', id, { month, company_id: companyId });
    return id;
  });
  return { run: get(`${RUN_SELECT} WHERE r.id = ?`, runId) };
}

payrollRouter.post('/run', requireRole('admin', 'hr'), (req, res) => {
  const month = req.body.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw httpError(400, 'Month must be in YYYY-MM format');
  if (month > today().slice(0, 7)) throw httpError(400, 'Cannot run payroll for a future month');
  const companies = req.body.company_id
    ? all('SELECT id FROM companies WHERE id = ?', req.body.company_id)
    : all('SELECT id FROM companies ORDER BY id');
  if (!companies.length) throw httpError(400, 'Company not found');
  const results = companies.map((c) => processCompanyPayroll(month, c.id, req.user.id));
  const processed = results.filter((r) => !r.skipped).map((r) => r.run);
  if (!processed.length) throw httpError(400, 'Payroll for this month is already paid and locked');
  res.status(201).json({ month, runs: processed, skipped: results.filter((r) => r.skipped).map((r) => r.run) });
});

payrollRouter.post('/runs/:id/pay', requireRole('admin', 'hr'), (req, res) => {
  const runRow = get('SELECT * FROM payroll_runs WHERE id = ?', req.params.id);
  if (!runRow) throw httpError(404, 'Payroll run not found');
  if (runRow.status === 'paid') throw httpError(400, 'Already marked as paid');
  tx(() => {
    update('payroll_runs', runRow.id, { status: 'paid', paid_at: new Date().toISOString() });
    for (const s of all('SELECT employee_id, net FROM payslips WHERE run_id = ?', runRow.id)) {
      notify(s.employee_id, `Payslip for ${runRow.month} is ready`, `Net pay of ₹${s.net.toLocaleString('en-IN')} has been credited to your bank account.`, '/payslips');
    }
    audit(req.user.id, 'pay_payroll', 'payroll_runs', runRow.id);
  });
  res.json(get(`${RUN_SELECT} WHERE r.id = ?`, runRow.id));
});

payrollRouter.get('/runs/:id/payslips', requireRole('admin', 'hr'), (req, res) => {
  res.json(all(`${SLIP_SELECT} WHERE t.run_id = ? ORDER BY e.first_name`, req.params.id));
});

// Bank advice / salary transfer file (NEFT bulk upload format) for a run.
payrollRouter.get('/runs/:id/bank-file', requireRole('admin', 'hr'), (req, res) => {
  const runRow = get(`${RUN_SELECT} WHERE r.id = ?`, req.params.id);
  if (!runRow) throw httpError(404, 'Payroll run not found');
  const rows = all(`${SLIP_SELECT} WHERE t.run_id = ? AND t.net > 0 ORDER BY e.first_name`, runRow.id);
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const lines = [['Beneficiary Name', 'Employee ID', 'Bank', 'Account Number', 'IFSC', 'Amount', 'Narration'].join(',')];
  for (const s of rows) {
    lines.push([s.employee_name, s.emp_code, s.bank_name, s.bank_account, s.ifsc, s.net.toFixed(2), `Salary ${runRow.month}`].map(esc).join(','));
  }
  const missing = rows.filter((s) => !s.bank_account || !s.ifsc).length;
  audit(req.user.id, 'export_bank_file', 'payroll_runs', runRow.id, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bank-transfer-${runRow.month}-${(runRow.company_name || 'company').replace(/\W+/g, '-')}.csv"`);
  res.setHeader('X-Missing-Bank-Details', String(missing));
  res.send(lines.join('\n'));
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

function companyDetails(companyId) {
  const settings = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const c = companyId ? get('SELECT * FROM companies WHERE id = ?', companyId) : null;
  return {
    ...settings,
    company_name: c?.legal_name || c?.name || settings.company_name,
    company_address: c?.address || settings.company_address,
    company_pan: c?.pan || settings.company_pan,
    company_tan: c?.tan || settings.company_tan,
    pf_code: c?.pf_code, esi_code: c?.esi_code,
  };
}
export { companyDetails };

payrollRouter.get('/payslips/:id', (req, res) => {
  const slip = get(`${SLIP_SELECT} WHERE t.id = ?`, req.params.id);
  if (!slip) throw httpError(404, 'Payslip not found');
  if (slip.employee_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  const loans = all(
    `SELECT lr.amount, l.type, l.outstanding FROM loan_repayments lr JOIN loans l ON l.id = lr.loan_id WHERE lr.payslip_id = ?`, slip.id,
  );
  const reimbursed = all('SELECT id, category, amount, date FROM expenses WHERE payslip_id = ?', slip.id);
  const lines = all('SELECT code, name, type, amount FROM payslip_lines WHERE payslip_id = ? ORDER BY sort, id', slip.id);
  res.json({ ...slip, company: companyDetails(slip.company_id), loans, reimbursed, lines });
});

payrollRouter.get('/salaries', requireRole('admin', 'hr'), (req, res) => {
  res.json(all(
    `SELECT e.id, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name, e.annual_ctc, e.avatar_color, e.tax_regime,
            d.name AS department, g.title AS designation, c.name AS company_name
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id
     LEFT JOIN companies c ON c.id = e.company_id
     WHERE e.status != 'exited' ORDER BY e.first_name`,
  ).map((r) => { const st = structureFor(r.id); return { ...r, structure: st.name, monthly: computeSalary(st, r.annual_ctc) }; }));
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

payrollRouter.get('/settings', (req, res) => res.json(payrollSettings()));
payrollRouter.put('/settings', requireRole('admin', 'hr'), (req, res) => {
  const basic = Number(req.body.basicPct);
  const hra = Number(req.body.hraPct);
  if (!(basic >= 30 && basic <= 70)) throw httpError(400, 'Basic must be between 30% and 70% of CTC');
  if (!(hra >= 0 && hra <= 50)) throw httpError(400, 'HRA must be between 0% and 50% of basic');
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('payroll_basic_pct', ?), ('payroll_hra_pct', ?)", String(basic), String(hra));
  // Keep the default salary structure in step with these quick settings.
  const def = get('SELECT id FROM salary_structures ORDER BY is_default DESC, id LIMIT 1');
  if (def) {
    run("UPDATE salary_components SET value = ? WHERE structure_id = ? AND code = 'BASIC' AND calc = 'percent_ctc'", basic, def.id);
    run("UPDATE salary_components SET value = ? WHERE structure_id = ? AND code = 'HRA' AND calc = 'percent_basic'", hra, def.id);
  }
  audit(req.user.id, 'update', 'settings', null, { payroll_basic_pct: basic, payroll_hra_pct: hra });
  res.json(payrollSettings());
});

payrollRouter.get('/preview', (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.user.id);
  const tax = taxProfile(emp, fyOf(today()));
  const st = structureFor(emp.id);
  res.json({ annual_ctc: emp.annual_ctc, structure: st.name, monthly: computeSalary(st, emp.annual_ctc, { annualTax: tax.annual_tax }), annual_tax: tax.annual_tax, regime: tax.selected });
});

// Old vs new regime comparison (pending declarations included so employees can plan before HR verifies).
payrollRouter.get('/regime', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  const emp = get('SELECT * FROM employees WHERE id = ?', employeeId);
  res.json({ verified: taxProfile(emp, fyOf(today())), projected: taxProfile(emp, fyOf(today()), { includePending: true }) });
});

payrollRouter.put('/regime', (req, res) => {
  const regime = req.body.regime;
  if (!['old', 'new'].includes(regime)) throw httpError(400, 'Regime must be old or new');
  update('employees', req.user.id, { tax_regime: regime });
  audit(req.user.id, 'choose_tax_regime', 'employees', req.user.id, { regime });
  res.json({ regime });
});

// Annual tax statement (Form 16 Part B style) for a financial year.
payrollRouter.get('/tax-statement', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !isHR(req.user)) throw httpError(403, 'Not allowed');
  const fy = req.query.fy || fyOf(today());
  if (!/^\d{4}-\d{2}$/.test(fy)) throw httpError(400, 'Invalid financial year');
  const emp = get(
    `SELECT e.*, g.title AS designation FROM employees e LEFT JOIN designations g ON g.id = e.designation_id WHERE e.id = ?`, employeeId,
  );
  if (!emp) throw httpError(404, 'Employee not found');
  const months = fyMonths(fy);
  const slips = all(
    `SELECT t.month, t.gross, t.basic, t.hra, t.special, t.pf, t.esi, t.pt, t.tds, t.net, t.reimbursement, t.company_id FROM payslips t
     JOIN payroll_runs r ON r.id = t.run_id AND r.status = 'paid'
     WHERE t.employee_id = ? AND t.month IN (${months.map(() => '?').join(',')}) ORDER BY t.month`,
    employeeId, ...months,
  );
  const sum = (k) => round2(slips.reduce((a, s) => a + (s[k] || 0), 0));
  const tax = taxProfile(emp, fy);
  const declarations = all("SELECT section, description, amount, status FROM tax_declarations WHERE employee_id = ? AND fy = ? ORDER BY section", employeeId, fy);
  res.json({
    fy, employee: { id: emp.id, name: `${emp.first_name} ${emp.last_name}`, emp_code: emp.emp_code, pan: emp.pan, designation: emp.designation },
    company: companyDetails(emp.company_id), months: slips,
    totals: { gross: sum('gross'), basic: sum('basic'), hra: sum('hra'), special: sum('special'), pf: sum('pf'), esi: sum('esi'), pt: sum('pt'), tds: sum('tds'), net: sum('net') },
    regime: tax.selected, projected_annual_tax: tax.annual_tax, tax_breakup: tax.regimes[tax.selected], declarations,
  });
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

// ---------- loans & salary advances ----------
export const loansRouter = crud({
  table: 'loans',
  label: 'loan request',
  link: '/payslips?tab=loans',
  fields: ['employee_id', 'type', 'amount', 'tenure_months', 'reason'],
  owner: 'employee_id',
  selfService: true,
  approval: true,
  filters: ['status', 'employee_id', 'type'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color,
           COALESCE((SELECT SUM(amount) FROM loan_repayments r WHERE r.loan_id = t.id), 0) AS repaid,
           (SELECT COUNT(*) FROM loan_repayments r WHERE r.loan_id = t.id) AS emis_paid
           FROM loans t JOIN employees e ON e.id = t.employee_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    const amount = Number(m.amount);
    const tenure = Number(m.tenure_months);
    if (!['loan', 'advance'].includes(m.type)) throw httpError(400, 'Type must be loan or advance');
    if (!(amount > 0)) throw httpError(400, 'Amount must be greater than zero');
    if (!(Number.isInteger(tenure) && tenure >= 1 && tenure <= (m.type === 'advance' ? 3 : 36))) {
      throw httpError(400, m.type === 'advance' ? 'Salary advances are repaid within 1–3 months' : 'Loan tenure must be 1–36 months');
    }
    const ownerId = m.employee_id ?? user.id;
    const emp = get('SELECT annual_ctc FROM employees WHERE id = ?', ownerId);
    const monthly = (emp?.annual_ctc || 0) / 12;
    if (m.type === 'advance' && amount > monthly) throw httpError(400, "A salary advance cannot exceed one month's gross salary");
    if (m.type === 'loan' && amount > monthly * 6) throw httpError(400, 'Loans are limited to six months of gross salary');
    if (!existing && get("SELECT id FROM loans WHERE employee_id = ? AND type = ? AND status IN ('pending','manager_approved','approved') AND outstanding > 0", ownerId, m.type)) {
      throw httpError(409, `You already have an active ${m.type === 'advance' ? 'salary advance' : 'loan'}`);
    }
    return { ...data, amount, tenure_months: tenure, emi: round2(amount / tenure), outstanding: amount };
  },
  onDecision(row, status) {
    if (status === 'approved') run('UPDATE loans SET disbursed_on = ? WHERE id = ?', today(), row.id);
  },
});

loansRouter.get('/:id/schedule', (req, res) => {
  const loan = get('SELECT * FROM loans WHERE id = ?', req.params.id);
  if (!loan) throw httpError(404, 'Loan not found');
  if (loan.employee_id !== req.user.id && !canManage(req.user, loan.employee_id)) throw httpError(403, 'Not allowed');
  res.json({ loan, repayments: all('SELECT month, amount, created_at FROM loan_repayments WHERE loan_id = ? ORDER BY month', loan.id) });
});
