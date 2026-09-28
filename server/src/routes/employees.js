import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, update, run, tx } from '../db.js';
import { signToken, requireRole, isHR, reportIds } from '../auth.js';
import { audit, notify, ensureLeaveBalances, httpError, today } from '../utils.js';

export const authRouter = Router();
export const employeesRouter = Router();

const EMP_SELECT = `
  SELECT t.*, d.name AS department, g.title AS designation, l.name AS location, s.name AS shift,
         m.first_name || ' ' || m.last_name AS manager_name
  FROM employees t
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN designations g ON g.id = t.designation_id
  LEFT JOIN locations l ON l.id = t.location_id
  LEFT JOIN shifts s ON s.id = t.shift_id
  LEFT JOIN employees m ON m.id = t.manager_id`;

const SENSITIVE = ['pan', 'uan', 'bank_name', 'bank_account', 'ifsc', 'annual_ctc', 'address', 'emergency_contact', 'marital_status', 'blood_group'];
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];

export function sanitize(emp, viewer) {
  if (!emp) return emp;
  const { password_hash, ...rest } = emp;
  const full = isHR(viewer) || viewer.id === emp.id;
  if (!full) for (const k of SENSITIVE) delete rest[k];
  return rest;
}

// ---------- auth ----------
export function loginHandler(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) throw httpError(400, 'Email and password are required');
  const user = get('SELECT * FROM employees WHERE lower(email) = lower(?)', email.trim());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    throw httpError(401, 'Invalid email or password');
  }
  if (user.status === 'exited') throw httpError(403, 'This account has been deactivated');
  audit(user.id, 'login', 'employees', user.id);
  res.json({ token: signToken(user), user: sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, user.id), user) });
}

authRouter.get('/me', (req, res) => {
  const me = get(`${EMP_SELECT} WHERE t.id = ?`, req.user.id);
  const reports = all('SELECT id FROM employees WHERE manager_id = ?', req.user.id).length;
  res.json({ ...sanitize(me, req.user), direct_reports: reports });
});

authRouter.post('/change-password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = get('SELECT * FROM employees WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) throw httpError(400, 'Current password is incorrect');
  if (!new_password || new_password.length < 8) throw httpError(400, 'New password must be at least 8 characters');
  update('employees', user.id, { password_hash: bcrypt.hashSync(new_password, 10) });
  audit(user.id, 'change_password', 'employees', user.id);
  res.json({ ok: true });
});

// Self-service profile fields an employee may edit without HR.
authRouter.put('/profile', (req, res) => {
  const allowed = ['phone', 'address', 'emergency_contact', 'marital_status', 'blood_group', 'bank_name', 'bank_account', 'ifsc'];
  const data = Object.fromEntries(allowed.filter((k) => k in req.body).map((k) => [k, req.body[k]]));
  update('employees', req.user.id, data);
  audit(req.user.id, 'update_profile', 'employees', req.user.id);
  res.json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, req.user.id), req.user));
});

// ---------- employees ----------
employeesRouter.get('/', (req, res) => {
  const where = ['1=1'];
  const params = [];
  const { q, department_id, location_id, status, role, manager_id, employment_type } = req.query;
  if (q) {
    where.push(`(t.first_name || ' ' || t.last_name LIKE ? OR t.email LIKE ? OR t.emp_code LIKE ? OR g.title LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (department_id) { where.push('t.department_id = ?'); params.push(department_id); }
  if (location_id) { where.push('t.location_id = ?'); params.push(location_id); }
  if (role) { where.push('t.role = ?'); params.push(role); }
  if (manager_id) { where.push('t.manager_id = ?'); params.push(manager_id); }
  if (employment_type) { where.push('t.employment_type = ?'); params.push(employment_type); }
  if (status && status !== 'all') { where.push('t.status = ?'); params.push(status); }
  else if (!status) where.push("t.status != 'exited'");
  const rows = all(`${EMP_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.first_name, t.last_name`, ...params);
  res.json(rows.map((r) => sanitize(r, req.user)));
});

employeesRouter.get('/org-chart', (req, res) => {
  const rows = all(`${EMP_SELECT} WHERE t.status != 'exited' ORDER BY t.first_name`);
  res.json(rows.map((r) => ({
    id: r.id, name: `${r.first_name} ${r.last_name}`, designation: r.designation, department: r.department,
    manager_id: r.manager_id, avatar_color: r.avatar_color,
  })));
});

employeesRouter.get('/:id', (req, res) => {
  const emp = get(`${EMP_SELECT} WHERE t.id = ?`, req.params.id);
  if (!emp) throw httpError(404, 'Employee not found');
  const reports = all(`${EMP_SELECT} WHERE t.manager_id = ? AND t.status != 'exited'`, emp.id).map((r) => sanitize(r, req.user));
  const canSeeTeam = isHR(req.user) || req.user.id === emp.id || reportIds(req.user.id).includes(emp.id);
  res.json({ ...sanitize(emp, req.user), reports, can_manage: canSeeTeam });
});

const EDITABLE = [
  'emp_code', 'first_name', 'last_name', 'email', 'phone', 'role', 'department_id', 'designation_id', 'location_id',
  'shift_id', 'manager_id', 'date_of_joining', 'date_of_birth', 'gender', 'marital_status', 'blood_group',
  'employment_type', 'status', 'address', 'emergency_contact', 'pan', 'uan', 'bank_name', 'bank_account', 'ifsc', 'annual_ctc',
];

function nextEmpCode() {
  const row = get("SELECT emp_code FROM employees WHERE emp_code LIKE 'EMP%' ORDER BY CAST(substr(emp_code, 4) AS INTEGER) DESC LIMIT 1");
  const n = row ? Number(row.emp_code.slice(3)) + 1 : 1001;
  return `EMP${n}`;
}

export const ONBOARDING_TEMPLATE = [
  ['Send offer letter & collect signed copy', 'HR', -7],
  ['Collect KYC documents (PAN, Aadhaar, bank)', 'HR', 0],
  ['Provision laptop & accessories', 'IT', 0],
  ['Create email, Slack and SSO accounts', 'IT', 0],
  ['Assign buddy & schedule team introduction', 'Manager', 1],
  ['Complete POSH & information security training', 'Learning', 7],
  ['Set 30-60-90 day goals', 'Manager', 14],
  ['Probation check-in', 'Manager', 90],
];

export const OFFBOARDING_TEMPLATE = [
  ['Accept resignation & confirm last working day', 'HR', 0],
  ['Knowledge transfer to team', 'Manager', 7],
  ['Recover laptop and company assets', 'IT', 0],
  ['Revoke system access', 'IT', 0],
  ['Exit interview', 'HR', 0],
  ['Full & final settlement', 'Finance', 30],
  ['Issue relieving & experience letter', 'HR', 30],
];

export function createTasks(employeeId, type, baseDate) {
  const template = type === 'onboarding' ? ONBOARDING_TEMPLATE : OFFBOARDING_TEMPLATE;
  const base = new Date(baseDate || today());
  for (const [title, category, offset] of template) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    insert('onboarding_tasks', { employee_id: employeeId, type, title, category, due_date: d.toISOString().slice(0, 10), done: 0 });
  }
}

export function createEmployee(body, actorId) {
  const data = Object.fromEntries(EDITABLE.filter((k) => k in body).map((k) => [k, body[k]]));
  if (!data.first_name || !data.last_name || !data.email) throw httpError(400, 'First name, last name and email are required');
  if (get('SELECT id FROM employees WHERE lower(email) = lower(?)', data.email)) throw httpError(409, 'An employee with this email already exists');
  data.emp_code ||= nextEmpCode();
  data.date_of_joining ||= today();
  data.role ||= 'employee';
  data.status ||= 'active';
  data.avatar_color = COLORS[Math.floor(Math.random() * COLORS.length)];
  data.password_hash = bcrypt.hashSync(body.password || 'Welcome@123', 10);
  return tx(() => {
    const id = insert('employees', data);
    ensureLeaveBalances(id);
    createTasks(id, 'onboarding', data.date_of_joining);
    if (data.manager_id) notify(data.manager_id, 'New team member', `${data.first_name} ${data.last_name} joins your team on ${data.date_of_joining}`, `/employees/${id}`);
    notify(id, 'Welcome to PeopleHub!', 'Complete your profile and onboarding checklist.', '/onboarding');
    audit(actorId, 'create', 'employees', id);
    return id;
  });
}

employeesRouter.post('/', requireRole('admin', 'hr'), (req, res) => {
  const id = createEmployee(req.body, req.user.id);
  res.status(201).json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, id), req.user));
});

employeesRouter.put('/:id', requireRole('admin', 'hr'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) throw httpError(404, 'Employee not found');
  const data = Object.fromEntries(EDITABLE.filter((k) => k in req.body).map((k) => [k, req.body[k]]));
  if (data.role === 'admin' && req.user.role !== 'admin') throw httpError(403, 'Only admins can grant the admin role');
  if (data.manager_id && Number(data.manager_id) === emp.id) throw httpError(400, 'An employee cannot report to themselves');
  if (data.email && get('SELECT id FROM employees WHERE lower(email) = lower(?) AND id != ?', data.email, emp.id)) throw httpError(409, 'Email already in use');
  update('employees', emp.id, data);
  audit(req.user.id, 'update', 'employees', emp.id, { fields: Object.keys(data) });
  res.json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, emp.id), req.user));
});

// Initiate separation: mark on notice, set exit date and generate the offboarding checklist.
employeesRouter.post('/:id/offboard', requireRole('admin', 'hr'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) throw httpError(404, 'Employee not found');
  const exitDate = req.body.exit_date || today();
  tx(() => {
    update('employees', emp.id, { status: 'on_notice', exit_date: exitDate });
    run("DELETE FROM onboarding_tasks WHERE employee_id = ? AND type = 'offboarding'", emp.id);
    createTasks(emp.id, 'offboarding', today());
    audit(req.user.id, 'offboard', 'employees', emp.id, { exit_date: exitDate, reason: req.body.reason });
  });
  res.json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, emp.id), req.user));
});

employeesRouter.post('/:id/reset-password', requireRole('admin', 'hr'), (req, res) => {
  const password = req.body.password || 'Welcome@123';
  update('employees', Number(req.params.id), { password_hash: bcrypt.hashSync(password, 10) });
  audit(req.user.id, 'reset_password', 'employees', Number(req.params.id));
  res.json({ ok: true });
});

employeesRouter.delete('/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) throw httpError(400, 'You cannot delete your own account');
  run('DELETE FROM employees WHERE id = ?', req.params.id);
  audit(req.user.id, 'delete', 'employees', Number(req.params.id));
  res.json({ ok: true });
});
