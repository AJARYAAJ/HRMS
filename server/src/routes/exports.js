import { Router } from 'express';
import { all, get, insert } from '../db.js';
import { requireRole } from '../auth.js';
import { audit, httpError } from '../utils.js';
import { buildXlsx, buildCsv } from '../xlsx.js';

/**
 * Bulk export centre: any dataset to CSV or Excel, with a date range, department/company/status filters and a
 * choice of columns. Every export is logged (who, what, how many rows) for data-protection audits.
 */
export const exportsRouter = Router();
exportsRouter.use(requireRole('admin', 'hr'));

const N = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const EMP = 'LEFT JOIN employees e ON e.id = t.employee_id LEFT JOIN departments d ON d.id = e.department_id';

/**
 * Each dataset: SQL `from` (aliased t, with e/d joined where employees are involved), columns as [key, label, expr],
 * which date column the range applies to, and which filters make sense.
 */
const MODULES = {
  employees: {
    group: 'People', label: 'Employees', description: 'Directory with job, contact, statutory and salary details',
    from: `employees t LEFT JOIN departments d ON d.id = t.department_id LEFT JOIN designations g ON g.id = t.designation_id
      LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN employees m ON m.id = t.manager_id`,
    dept: 'd.id', company: 't.company_id', date: 't.date_of_joining', status: { col: 't.status', values: ['active', 'on_notice', 'exited'] },
    columns: [
      ['emp_code', 'Employee ID', 't.emp_code'], ['name', 'Name', N('t')], ['email', 'Email', 't.email'], ['phone', 'Phone', 't.phone'],
      ['department', 'Department', 'd.name'], ['designation', 'Designation', 'g.title'], ['location', 'Location', 'l.name'], ['company', 'Company', 'c.name'],
      ['manager', 'Reporting manager', N('m')], ['role', 'Role', 't.role'], ['employment_type', 'Employment type', 't.employment_type'], ['status', 'Status', 't.status'],
      ['date_of_joining', 'Date of joining', 't.date_of_joining'], ['exit_date', 'Exit date', 't.exit_date'], ['date_of_birth', 'Date of birth', 't.date_of_birth'],
      ['gender', 'Gender', 't.gender'], ['blood_group', 'Blood group', 't.blood_group'], ['pan', 'PAN', 't.pan'], ['uan', 'UAN', 't.uan'],
      ['bank_name', 'Bank', 't.bank_name'], ['bank_account', 'Bank account', 't.bank_account'], ['ifsc', 'IFSC', 't.ifsc'], ['annual_ctc', 'Annual CTC', 't.annual_ctc'],
    ],
    defaults: ['emp_code', 'name', 'email', 'department', 'designation', 'location', 'manager', 'status', 'date_of_joining'],
    order: 't.emp_code',
  },
  attendance: {
    group: 'Time', label: 'Attendance', description: 'Daily records with clock-in/out, mode, late marks and overtime',
    from: `attendance t ${EMP}`, dept: 'd.id', company: 'e.company_id', date: 't.date', status: { col: 't.status', values: ['present', 'half_day', 'absent', 'leave'] },
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['department', 'Department', 'd.name'], ['date', 'Date', 't.date'],
      ['status', 'Status', 't.status'], ['clock_in', 'Clock in', 't.clock_in'], ['clock_out', 'Clock out', 't.clock_out'], ['work_mode', 'Mode', 't.work_mode'],
      ['late', 'Late', "CASE WHEN t.late = 1 THEN 'Yes' ELSE '' END"], ['overtime_mins', 'Overtime (min)', 't.overtime_mins'], ['geo_status', 'Location check', 't.geo_status']],
    order: 't.date, e.first_name',
  },
  leave_requests: {
    group: 'Time', label: 'Leave requests', description: 'Applications with type, dates, days and approval status',
    from: `leave_requests t ${EMP} LEFT JOIN leave_types lt ON lt.id = t.leave_type_id LEFT JOIN employees a ON a.id = t.approver_id`,
    dept: 'd.id', company: 'e.company_id', date: 't.start_date', status: { col: 't.status', values: ['pending', 'manager_approved', 'approved', 'rejected', 'cancelled'] },
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['department', 'Department', 'd.name'], ['leave_type', 'Leave type', 'lt.name'],
      ['start_date', 'From', 't.start_date'], ['end_date', 'To', 't.end_date'], ['days', 'Days', 't.days'], ['reason', 'Reason', 't.reason'],
      ['status', 'Status', 't.status'], ['approver', 'Approver', N('a')]],
    order: 't.start_date',
  },
  leave_balances: {
    group: 'Time', label: 'Leave balances', description: 'Allocated, used and remaining leave per type and year',
    from: `leave_balances t ${EMP} JOIN leave_types lt ON lt.id = t.leave_type_id`, dept: 'd.id', company: 'e.company_id', year: 't.year',
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['department', 'Department', 'd.name'], ['year', 'Year', 't.year'],
      ['leave_type', 'Leave type', 'lt.name'], ['allocated', 'Allocated', 't.allocated'], ['used', 'Used', 't.used'], ['remaining', 'Remaining', 't.allocated - t.used']],
    order: 'e.first_name, lt.id',
  },
  timesheets: {
    group: 'Time', label: 'Timesheets', description: 'Hours by person, project and day with billable flag',
    from: `timesheets t ${EMP} LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = p.client_id`,
    dept: 'd.id', company: 'e.company_id', date: 't.date', status: { col: 't.status', values: ['pending', 'approved', 'rejected'] },
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['date', 'Date', 't.date'], ['client', 'Client', 'COALESCE(c.name, p.client)'],
      ['project', 'Project', 'p.name'], ['task', 'Task', 't.task'], ['hours', 'Hours', 't.hours'], ['billable', 'Billable', "CASE WHEN t.billable = 1 THEN 'Yes' ELSE 'No' END"],
      ['status', 'Status', 't.status'], ['invoiced', 'Invoiced', "CASE WHEN t.invoice_id IS NOT NULL THEN 'Yes' ELSE '' END"]],
    order: 't.date',
  },
  payslips: {
    group: 'Payroll', label: 'Payslips (salary register)', description: 'Earnings, deductions and net pay per employee per month',
    from: `payslips t ${EMP} LEFT JOIN companies c ON c.id = t.company_id`, dept: 'd.id', company: 't.company_id', month: 't.month',
    columns: [['month', 'Month', 't.month'], ['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['department', 'Department', 'd.name'], ['company', 'Company', 'c.name'],
      ['working_days', 'Working days', 't.working_days'], ['paid_days', 'Paid days', 't.paid_days'], ['lop_days', 'LOP days', 't.lop_days'],
      ['basic', 'Basic', 't.basic'], ['hra', 'HRA', 't.hra'], ['special', 'Special allowance', 't.special'], ['gross', 'Gross', 't.gross'],
      ['pf', 'PF', 't.pf'], ['esi', 'ESI', 't.esi'], ['pt', 'Professional tax', 't.pt'], ['tds', 'TDS', 't.tds'], ['loan_deduction', 'Loan EMI', 't.loan_deduction'],
      ['reimbursement', 'Reimbursements', 't.reimbursement'], ['total_deductions', 'Total deductions', 't.total_deductions'], ['net', 'Net pay', 't.net'],
      ['bank_account', 'Bank account', 'e.bank_account'], ['ifsc', 'IFSC', 'e.ifsc']],
    order: 't.month, e.emp_code',
  },
  expenses: {
    group: 'Payroll', label: 'Expense claims', description: 'Claims with category, amount, status and reimbursement',
    from: `expenses t ${EMP}`, dept: 'd.id', company: 'e.company_id', date: 't.date', status: { col: 't.status', values: ['pending', 'manager_approved', 'approved', 'rejected', 'reimbursed'] },
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['department', 'Department', 'd.name'], ['date', 'Date', 't.date'],
      ['category', 'Category', 't.category'], ['amount', 'Amount', 't.amount'], ['description', 'Description', 't.description'], ['status', 'Status', 't.status']],
    order: 't.date',
  },
  loans: {
    group: 'Payroll', label: 'Loans & advances', description: 'Amount, EMI, outstanding balance and status',
    from: `loans t ${EMP}`, dept: 'd.id', company: 'e.company_id', date: 'substr(t.created_at, 1, 10)', status: { col: 't.status', values: ['pending', 'manager_approved', 'approved', 'rejected', 'closed'] },
    columns: [['emp_code', 'Employee ID', 'e.emp_code'], ['name', 'Employee', N('e')], ['type', 'Type', 't.type'], ['amount', 'Amount', 't.amount'], ['emi', 'EMI', 't.emi'],
      ['tenure_months', 'Months', 't.tenure_months'], ['outstanding', 'Outstanding', 't.outstanding'], ['status', 'Status', 't.status'], ['disbursed_on', 'Disbursed on', 't.disbursed_on']],
    order: 't.id',
  },
  travel: {
    group: 'Payroll', label: 'Travel requests', description: 'Trips, costs, advances and approval status',
    from: `travel_requests t ${EMP}`, dept: 'd.id', company: 'e.company_id', date: 't.depart_date', status: { col: 't.status', values: ['pending', 'manager_approved', 'approved', 'rejected'] },
    columns: [['name', 'Employee', N('e')], ['purpose', 'Purpose', 't.purpose'], ['from_city', 'From', 't.from_city'], ['to_city', 'To', 't.to_city'],
      ['depart_date', 'Departure', 't.depart_date'], ['return_date', 'Return', 't.return_date'], ['mode', 'Mode', 't.mode'], ['estimated_cost', 'Estimated cost', 't.estimated_cost'],
      ['advance_amount', 'Advance', 't.advance_amount'], ['status', 'Status', 't.status']],
    order: 't.depart_date',
  },
  clients: {
    group: 'Professional services', label: 'Clients', description: 'Accounts with billing details and receivables',
    from: 'clients t LEFT JOIN employees o ON o.id = t.owner_id', status: { col: 't.status', values: ['active', 'inactive'] },
    columns: [['name', 'Client', 't.name'], ['code', 'Code', 't.code'], ['industry', 'Industry', 't.industry'], ['email', 'Billing email', 't.email'], ['phone', 'Phone', 't.phone'],
      ['gstin', 'GSTIN', 't.gstin'], ['payment_terms_days', 'Payment terms (days)', 't.payment_terms_days'], ['owner', 'Owner', N('o')], ['status', 'Status', 't.status'],
      ['outstanding', 'Outstanding', "COALESCE((SELECT SUM(total - amount_paid) FROM invoices i WHERE i.client_id = t.id AND i.status IN ('sent','partially_paid')), 0)"]],
    order: 't.name',
  },
  projects: {
    group: 'Professional services', label: 'Projects', description: 'Projects with client, billing, budget and hours',
    from: 'projects t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN employees m ON m.id = t.manager_id', date: 't.start_date',
    status: { col: 't.status', values: ['active', 'on_hold', 'completed'] },
    columns: [['code', 'Code', 't.code'], ['name', 'Project', 't.name'], ['client', 'Client', 'COALESCE(c.name, t.client)'], ['billing_type', 'Billing', 't.billing_type'],
      ['manager', 'Manager', N('m')], ['start_date', 'Start', 't.start_date'], ['end_date', 'End', 't.end_date'], ['budget_hours', 'Budget hours', 't.budget_hours'],
      ['budget_amount', 'Budget amount', 't.budget_amount'], ['logged_hours', 'Logged hours', 'COALESCE((SELECT SUM(hours) FROM timesheets s WHERE s.project_id = t.id), 0)'],
      ['health', 'Health', 't.health'], ['status', 'Status', 't.status']],
    order: 't.name',
  },
  opportunities: {
    group: 'Professional services', label: 'Opportunities', description: 'Pipeline with stage, value, probability and close date',
    from: 'opportunities t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN employees o ON o.id = t.owner_id', date: 't.expected_close',
    status: { col: 't.stage', values: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] },
    columns: [['name', 'Opportunity', 't.name'], ['account', 'Account', 'COALESCE(c.name, t.prospect)'], ['stage', 'Stage', 't.stage'], ['value', 'Value', 't.value'],
      ['probability', 'Probability %', 't.probability'], ['weighted', 'Weighted value', 'ROUND(t.value * t.probability / 100.0)'], ['expected_close', 'Expected close', 't.expected_close'],
      ['source', 'Source', 't.source'], ['owner', 'Owner', N('o')], ['lost_reason', 'Lost reason', 't.lost_reason']],
    order: 't.expected_close',
  },
  invoices: {
    group: 'Professional services', label: 'Invoices', description: 'Invoice register with tax, payments and balance',
    from: 'invoices t JOIN clients c ON c.id = t.client_id LEFT JOIN projects p ON p.id = t.project_id', date: 't.issue_date',
    status: { col: 't.status', values: ['draft', 'sent', 'partially_paid', 'paid', 'void'] },
    columns: [['number', 'Invoice', 't.number'], ['client', 'Client', 'c.name'], ['gstin', 'Client GSTIN', 'c.gstin'], ['project', 'Project', 'p.name'],
      ['issue_date', 'Issue date', 't.issue_date'], ['due_date', 'Due date', 't.due_date'], ['subtotal', 'Taxable value', 't.subtotal'], ['tax_rate', 'GST %', 't.tax_rate'],
      ['tax_amount', 'GST', 't.tax_amount'], ['total', 'Total', 't.total'], ['amount_paid', 'Paid', 't.amount_paid'], ['balance', 'Balance', 'ROUND(t.total - t.amount_paid, 2)'], ['status', 'Status', 't.status']],
    order: 't.issue_date',
  },
  allocations: {
    group: 'Professional services', label: 'Resource allocations', description: 'Who is allocated to which project, when and how much',
    from: `resource_allocations t ${EMP} JOIN projects p ON p.id = t.project_id`, dept: 'd.id', company: 'e.company_id', date: 't.start_date',
    columns: [['name', 'Person', N('e')], ['department', 'Department', 'd.name'], ['project', 'Project', 'p.name'], ['role', 'Role', 't.role'],
      ['allocation_pct', 'Allocation %', 't.allocation_pct'], ['billable', 'Billable', "CASE WHEN t.billable = 1 THEN 'Yes' ELSE 'No' END"],
      ['start_date', 'From', 't.start_date'], ['end_date', 'To', 't.end_date']],
    order: 't.start_date',
  },
  assets: {
    group: 'Other', label: 'Assets', description: 'Inventory with allocation, status and cost',
    from: 'assets t LEFT JOIN employees e ON e.id = t.assigned_to LEFT JOIN departments d ON d.id = e.department_id', date: 't.purchase_date',
    status: { col: 't.status', values: ['available', 'assigned', 'in_repair', 'retired'] },
    columns: [['asset_tag', 'Asset tag', 't.asset_tag'], ['name', 'Asset', 't.name'], ['category', 'Category', 't.category'], ['serial_no', 'Serial no.', 't.serial_no'],
      ['assigned_to', 'Assigned to', N('e')], ['department', 'Department', 'd.name'], ['status', 'Status', 't.status'], ['purchase_date', 'Purchased', 't.purchase_date'], ['cost', 'Cost', 't.cost']],
    order: 't.asset_tag',
  },
  candidates: {
    group: 'Other', label: 'Candidates', description: 'Recruitment pipeline with stage and source',
    from: 'candidates t LEFT JOIN job_openings j ON j.id = t.job_id', date: 'substr(t.created_at, 1, 10)',
    status: { col: 't.stage', values: ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] },
    columns: [['name', 'Candidate', 't.name'], ['email', 'Email', 't.email'], ['phone', 'Phone', 't.phone'], ['job', 'Job', 'j.title'], ['stage', 'Stage', 't.stage'],
      ['source', 'Source', 't.source'], ['experience_years', 'Experience (yrs)', 't.experience_years'], ['current_company', 'Current company', 't.current_company'],
      ['expected_ctc', 'Expected CTC', 't.expected_ctc'], ['applied_on', 'Applied on', 'substr(t.created_at, 1, 10)']],
    order: 't.created_at',
  },
  tickets: {
    group: 'Other', label: 'Helpdesk tickets', description: 'Tickets with category, priority, assignee and resolution',
    from: `tickets t ${EMP} LEFT JOIN employees a ON a.id = t.assignee_id`, dept: 'd.id', company: 'e.company_id', date: 'substr(t.created_at, 1, 10)',
    status: { col: 't.status', values: ['open', 'in_progress', 'resolved', 'closed'] },
    columns: [['id', 'Ticket #', 't.id'], ['name', 'Raised by', N('e')], ['category', 'Category', 't.category'], ['subject', 'Subject', 't.subject'], ['priority', 'Priority', 't.priority'],
      ['status', 'Status', 't.status'], ['assignee', 'Assignee', N('a')], ['created', 'Created', 'substr(t.created_at, 1, 10)'], ['resolution', 'Resolution', 't.resolution']],
    order: 't.id',
  },
};

exportsRouter.get('/modules', (req, res) => {
  res.json(Object.entries(MODULES).map(([key, m]) => ({
    key, group: m.group, label: m.label, description: m.description,
    filters: { date: !!m.date, month: !!m.month, year: !!m.year, department: !!m.dept, company: !!m.company, status: m.status?.values || null },
    columns: m.columns.map(([k, l]) => ({ key: k, label: l })), defaults: m.defaults || m.columns.map(([k]) => k),
  })));
});

exportsRouter.get('/history', (req, res) => {
  res.json(all(`SELECT x.*, ${N('e')} AS by_name FROM export_jobs x LEFT JOIN employees e ON e.id = x.created_by ORDER BY x.id DESC LIMIT 100`)
    .map((r) => ({ ...r, module_label: MODULES[r.module]?.label || r.module })));
});

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

exportsRouter.post('/', (req, res) => {
  const { module, format = 'xlsx', filters = {} } = req.body || {};
  const m = MODULES[module];
  if (!m) throw httpError(400, 'Choose what to export');
  if (!['csv', 'xlsx'].includes(format)) throw httpError(400, 'Format must be csv or xlsx');
  const wanted = Array.isArray(req.body.columns) && req.body.columns.length ? req.body.columns : (m.defaults || m.columns.map(([k]) => k));
  const cols = wanted.map((k) => m.columns.find(([key]) => key === k)).filter(Boolean);
  if (!cols.length) throw httpError(400, 'Choose at least one column');
  const where = ['1=1'];
  const params = [];
  if (m.date && isDate(filters.from)) { where.push(`${m.date} >= ?`); params.push(filters.from); }
  if (m.date && isDate(filters.to)) { where.push(`${m.date} <= ?`); params.push(filters.to); }
  if (m.month && /^\d{4}-\d{2}$/.test(filters.month || '')) { where.push(`${m.month} = ?`); params.push(filters.month); }
  if (m.year && Number(filters.year)) { where.push(`${m.year} = ?`); params.push(Number(filters.year)); }
  if (m.dept && Number(filters.department_id)) { where.push(`${m.dept} = ?`); params.push(Number(filters.department_id)); }
  if (m.company && Number(filters.company_id)) { where.push(`${m.company} = ?`); params.push(Number(filters.company_id)); }
  if (m.status && filters.status) {
    if (!m.status.values.includes(filters.status)) throw httpError(400, 'Invalid status filter');
    where.push(`${m.status.col} = ?`); params.push(filters.status);
  }
  const rows = all(`SELECT ${cols.map(([k, , expr]) => `${expr} AS "${k}"`).join(', ')} FROM ${m.from} WHERE ${where.join(' AND ')} ORDER BY ${m.order || 1} LIMIT 100000`, ...params);
  const headers = cols.map(([, l]) => l);
  const data = rows.map((r) => cols.map(([k]) => r[k]));
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${module}-${stamp}.${format}`;
  insert('export_jobs', { module, format, filters: JSON.stringify(filters), columns: cols.map(([k]) => k).join(','), row_count: rows.length, created_by: req.user.id });
  audit(req.user.id, 'export', module, null, { rows: rows.length, format, columns: cols.length });
  res.set({ 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Row-Count': String(rows.length), 'Access-Control-Expose-Headers': 'X-Row-Count, Content-Disposition' });
  if (format === 'csv') res.type('text/csv; charset=utf-8').send(buildCsv(headers, data));
  else res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buildXlsx(m.label, headers, data));
});

export const EXPORT_MODULES = MODULES;
export const exportCount = () => get('SELECT COUNT(*) AS n FROM export_jobs').n;
