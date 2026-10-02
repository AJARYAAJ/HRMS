import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { all, get, insert, update, run, tx } from '../db.js';
import { signToken, requireRole, isHR, reportIds } from '../auth.js';
import { audit, notify, ensureLeaveBalances, httpError, today } from '../utils.js';
import { verifyCode } from './idcards.js';
import { emailEmployee, appUrl } from '../mailer.js';

export const authRouter = Router();
export const employeesRouter = Router();

const EMP_SELECT = `
  SELECT t.*, d.name AS department, g.title AS designation, l.name AS location, s.name AS shift, c.name AS company_name,
         m.first_name || ' ' || m.last_name AS manager_name
  FROM employees t
  LEFT JOIN departments d ON d.id = t.department_id
  LEFT JOIN designations g ON g.id = t.designation_id
  LEFT JOIN locations l ON l.id = t.location_id
  LEFT JOIN shifts s ON s.id = t.shift_id
  LEFT JOIN employees m ON m.id = t.manager_id
  LEFT JOIN companies c ON c.id = t.company_id`;

const SENSITIVE = ['pan', 'uan', 'bank_name', 'bank_account', 'ifsc', 'annual_ctc', 'address', 'emergency_contact', 'marital_status', 'blood_group'];
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];

export function sanitize(emp, viewer) {
  if (!emp) return emp;
  const { password_hash, photo_file: photoFile, photo_type: _photoType, ...rest } = emp;
  if (photoFile !== undefined) rest.photo_url = photoFile ? `/api/public/photo/${verifyCode(emp.id)}` : null;
  const full = isHR(viewer) || viewer.id === emp.id;
  if (!full) for (const k of SENSITIVE) delete rest[k];
  return rest;
}

// ---------- auth ----------
// Brute-force protection: after LOGIN_MAX_FAILURES failed attempts for the same IP + email within the window,
// further attempts are refused until the window passes. In-memory, so it resets on restart.
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginMax = () => Number(process.env.LOGIN_MAX_FAILURES) || 10;

export function loginHandler(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) throw httpError(400, 'Email and password are required');
  const key = `${req.ip}|${String(email).trim().toLowerCase()}`;
  const now = Date.now();
  const rec = loginFailures.get(key);
  if (rec && now - rec.first < LOGIN_WINDOW_MS && rec.count >= loginMax()) {
    const mins = Math.ceil((LOGIN_WINDOW_MS - (now - rec.first)) / 60000);
    throw httpError(429, `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'} or reset your password.`);
  }
  const user = get('SELECT * FROM employees WHERE lower(email) = lower(?)', email.trim());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    const fresh = !rec || now - rec.first >= LOGIN_WINDOW_MS;
    loginFailures.set(key, { first: fresh ? now : rec.first, count: fresh ? 1 : rec.count + 1 });
    if (loginFailures.size > 10000) loginFailures.clear();
    throw httpError(401, 'Invalid email or password');
  }
  loginFailures.delete(key);
  if (user.status === 'exited') throw httpError(403, 'This account has been deactivated');
  audit(user.id, 'login', 'employees', user.id);
  res.json({ token: signToken(user), user: sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, user.id), user) });
}

authRouter.get('/me', (req, res) => {
  const me = get(`${EMP_SELECT} WHERE t.id = ?`, req.user.id);
  const reports = all('SELECT id FROM employees WHERE manager_id = ?', req.user.id).length;
  res.json({ ...sanitize(me, req.user), direct_reports: reports, custom_fields: customFieldsFor(req.user.id) });
});

authRouter.post('/change-password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = get('SELECT * FROM employees WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) throw httpError(400, 'Current password is incorrect');
  if (!new_password || new_password.length < 8) throw httpError(400, 'New password must be at least 8 characters');
  update('employees', user.id, { password_hash: bcrypt.hashSync(new_password, 10) });
  audit(user.id, 'change_password', 'employees', user.id);
  notify(user.id, 'Your password was changed', "If this wasn't you, contact HR immediately.", '/profile', { email: false });
  res.json({ ok: true });
});

const RESET_TTL_MINUTES = 30;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** Always answers the same way so the endpoint can't be used to discover which emails have accounts. */
export function forgotPasswordHandler(req, res) {
  const email = String(req.body?.email || '').trim();
  if (!email) throw httpError(400, 'Email is required');
  const user = get("SELECT id, first_name FROM employees WHERE lower(email) = lower(?) AND status != 'exited'", email);
  if (user) {
    const recent = get("SELECT COUNT(*) AS n FROM password_resets WHERE employee_id = ? AND created_at > datetime('now', '-15 minutes')", user.id).n;
    if (recent < 3) {
      const token = crypto.randomBytes(32).toString('base64url');
      insert('password_resets', { employee_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60000).toISOString() });
      emailEmployee(user.id, {
        force: true, template: 'password_reset', subject: 'Reset your PeopleHub password', heading: 'Reset your password',
        paragraphs: ['We received a request to reset your password. Click the button below to choose a new one.'],
        cta: { url: `${appUrl()}/reset-password?token=${token}`, label: 'Reset password' },
        footnote: `This link expires in ${RESET_TTL_MINUTES} minutes and can be used once. If you didn't request it, you can ignore this email.`,
      });
      audit(user.id, 'request_password_reset', 'employees', user.id);
    }
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
}

export function resetPasswordHandler(req, res) {
  const { token, password } = req.body || {};
  if (!token) throw httpError(400, 'Reset token is missing');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
  const row = get('SELECT * FROM password_resets WHERE token_hash = ?', hashToken(String(token)));
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) throw httpError(400, 'This reset link is invalid or has expired');
  update('employees', row.employee_id, { password_hash: bcrypt.hashSync(password, 10) });
  run("UPDATE password_resets SET used_at = datetime('now') WHERE employee_id = ? AND used_at IS NULL", row.employee_id);
  audit(row.employee_id, 'reset_password_via_email', 'employees', row.employee_id);
  notify(row.employee_id, 'Your password was changed', "It was reset with an email link. If this wasn't you, contact HR immediately.", '/profile', { email: false });
  emailEmployee(row.employee_id, {
    force: true, template: 'password_changed', subject: 'Your PeopleHub password was changed', heading: 'Password changed',
    paragraphs: ['Your password was just changed using a reset link. If this wasn\'t you, contact HR immediately.'],
  });
  res.json({ ok: true });
}

// Self-service profile fields an employee may edit without HR.
authRouter.put('/profile', (req, res) => {
  const allowed = ['phone', 'address', 'emergency_contact', 'marital_status', 'blood_group', 'bank_name', 'bank_account', 'ifsc', 'email_notifications'];
  const data = Object.fromEntries(allowed.filter((k) => k in req.body).map((k) => [k, req.body[k]]));
  if ('email_notifications' in data) data.email_notifications = data.email_notifications ? 1 : 0;
  tx(() => {
    update('employees', req.user.id, data);
    if (req.body.custom && typeof req.body.custom === 'object') saveCustomFields(req.user.id, req.body.custom, req.user);
  });
  audit(req.user.id, 'update_profile', 'employees', req.user.id);
  res.json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, req.user.id), req.user));
});

// ---------- employees ----------
employeesRouter.get('/', (req, res) => {
  const where = ['1=1'];
  const params = [];
  const { q, department_id, location_id, status, role, manager_id, employment_type, company_id } = req.query;
  if (company_id) { where.push('t.company_id = ?'); params.push(company_id); }
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
  const full = isHR(req.user) || req.user.id === emp.id;
  res.json({ ...sanitize(emp, req.user), reports, can_manage: canSeeTeam, custom_fields: full ? customFieldsFor(emp.id) : [] });
});

/** Custom profile fields (defined by HR in Settings) with this employee's values. */
export function customFieldsFor(employeeId) {
  return all(
    `SELECT f.*, v.value FROM custom_fields f LEFT JOIN custom_field_values v ON v.field_id = f.id AND v.employee_id = ?
     ORDER BY f.section, f.sort_order, f.id`,
    employeeId,
  ).map((f) => ({ ...f, options: f.options ? JSON.parse(f.options) : null }));
}

export function saveCustomFields(employeeId, values, user) {
  const fields = all('SELECT * FROM custom_fields');
  for (const f of fields) {
    if (!(f.field_key in values)) continue;
    if (!isHR(user) && !f.employee_editable) continue;
    let v = values[f.field_key];
    v = v === null || v === undefined ? '' : String(v).trim();
    if (f.required && !v) throw httpError(400, `${f.label} is required`);
    if (v && f.type === 'number' && Number.isNaN(Number(v))) throw httpError(400, `${f.label} must be a number`);
    if (v && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, `${f.label} must be a date`);
    if (v && f.type === 'select' && !JSON.parse(f.options || '[]').includes(v)) throw httpError(400, `${f.label} has an invalid option`);
    run('INSERT OR REPLACE INTO custom_field_values (employee_id, field_id, value) VALUES (?, ?, ?)', employeeId, f.id, v || null);
  }
}

// Probation review: confirm the employee or extend probation.
employeesRouter.post('/:id/confirmation', requireRole('admin', 'hr'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) throw httpError(404, 'Employee not found');
  const { action, extend_days: extendDays, comment } = req.body;
  if (action === 'confirm') {
    update('employees', emp.id, { confirmation_status: 'confirmed' });
    notify(emp.id, 'Congratulations — your employment is confirmed! 🎉', comment || 'You have successfully completed your probation period.', `/employees/${emp.id}`);
  } else if (action === 'extend') {
    const days = Number(extendDays);
    if (!(days >= 15 && days <= 180)) throw httpError(400, 'Extension must be between 15 and 180 days');
    const base = new Date(emp.probation_end_date || today());
    base.setDate(base.getDate() + days);
    update('employees', emp.id, { confirmation_status: 'extended', probation_end_date: base.toISOString().slice(0, 10) });
    notify(emp.id, 'Probation extended', `Your probation has been extended to ${base.toISOString().slice(0, 10)}. ${comment || ''}`.trim(), `/employees/${emp.id}`);
  } else throw httpError(400, 'Action must be confirm or extend');
  audit(req.user.id, `probation_${action}`, 'employees', emp.id, { comment, extend_days: extendDays });
  res.json(sanitize(get(`${EMP_SELECT} WHERE t.id = ?`, emp.id), req.user));
});

const EDITABLE = [
  'emp_code', 'first_name', 'last_name', 'email', 'phone', 'role', 'department_id', 'designation_id', 'location_id',
  'shift_id', 'manager_id', 'date_of_joining', 'date_of_birth', 'gender', 'marital_status', 'blood_group',
  'employment_type', 'status', 'address', 'emergency_contact', 'pan', 'uan', 'bank_name', 'bank_account', 'ifsc', 'annual_ctc',
  'company_id', 'probation_end_date', 'confirmation_status', 'tax_regime', 'buddy_id', 'biometric_id',
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

/**
 * The checklist template for an employee: the one asked for, else the template set for their department, else the
 * default of that type, else the built-in list.
 */
export function templateFor(employeeId, type, templateId = null) {
  const dept = get('SELECT department_id FROM employees WHERE id = ?', employeeId)?.department_id;
  return (templateId && get('SELECT * FROM onboarding_templates WHERE id = ? AND type = ?', templateId, type))
    || (dept && get('SELECT * FROM onboarding_templates WHERE department_id = ? AND type = ? ORDER BY id LIMIT 1', dept, type))
    || get('SELECT * FROM onboarding_templates WHERE type = ? ORDER BY is_default DESC, id LIMIT 1', type)
    || null;
}

export function createTasks(employeeId, type, baseDate, templateId = null) {
  const tpl = templateFor(employeeId, type, templateId);
  const template = tpl
    ? all('SELECT title, category, offset_days FROM onboarding_template_tasks WHERE template_id = ? ORDER BY sort, id', tpl.id).map((t) => [t.title, t.category, t.offset_days])
    : type === 'onboarding' ? ONBOARDING_TEMPLATE : OFFBOARDING_TEMPLATE;
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
  data.company_id ||= get('SELECT id FROM companies ORDER BY id LIMIT 1')?.id ?? null;
  if (!data.probation_end_date) {
    const days = Number(get("SELECT value FROM settings WHERE key = 'probation_days'")?.value) || 90;
    const d = new Date(data.date_of_joining);
    d.setDate(d.getDate() + days);
    data.probation_end_date = d.toISOString().slice(0, 10);
  }
  data.confirmation_status ||= 'probation';
  data.avatar_color = COLORS[Math.floor(Math.random() * COLORS.length)];
  data.password_hash = bcrypt.hashSync(body.password || 'Welcome@123', 10);
  return tx(() => {
    const id = insert('employees', data);
    ensureLeaveBalances(id);
    createTasks(id, 'onboarding', data.date_of_joining, body.template_id || null);
    if (data.manager_id) notify(data.manager_id, 'New team member', `${data.first_name} ${data.last_name} joins your team on ${data.date_of_joining}`, `/employees/${id}`);
    notify(id, 'Welcome to PeopleHub!', 'Complete your profile and onboarding checklist.', '/onboarding', { email: false });
    emailEmployee(id, {
      force: true, template: 'welcome', subject: `Welcome to the team, ${data.first_name}!`, heading: 'Your PeopleHub account is ready',
      paragraphs: ['We are excited to have you on board. Sign in to complete your profile, onboarding checklist and bank details.'],
      details: [['Employee ID', data.emp_code], ['Joining date', data.date_of_joining], ['Sign-in email', data.email], ['Temporary password', body.password || 'Welcome@123']],
      cta: { url: `${appUrl()}/login`, label: 'Sign in to PeopleHub' },
      footnote: 'Please change your password after your first sign-in (Account settings → Change password).',
    });
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
  if ('biometric_id' in data) {
    data.biometric_id = String(data.biometric_id ?? '').trim() || null;
    if (data.biometric_id && get('SELECT id FROM employees WHERE biometric_id = ? AND id != ?', data.biometric_id, emp.id)) throw httpError(409, 'This biometric user ID belongs to another employee');
  }
  tx(() => {
    update('employees', emp.id, data);
    if (req.body.custom && typeof req.body.custom === 'object') saveCustomFields(emp.id, req.body.custom, req.user);
  });
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
  notify(Number(req.params.id), 'Your password was reset by HR', 'Sign in with the temporary password from your email and change it.', '/profile', { email: false });
  emailEmployee(Number(req.params.id), {
    force: true, template: 'password_reset_by_hr', subject: 'Your PeopleHub password was reset', heading: 'Your password was reset by HR',
    paragraphs: [`${req.user.first_name} ${req.user.last_name} reset your password. Use the temporary password below and change it after signing in.`],
    details: [['Temporary password', password]],
    cta: { url: `${appUrl()}/login`, label: 'Sign in' },
  });
  res.json({ ok: true });
});

employeesRouter.delete('/:id', requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) throw httpError(400, 'You cannot delete your own account');
  run('DELETE FROM employees WHERE id = ?', req.params.id);
  audit(req.user.id, 'delete', 'employees', Number(req.params.id));
  res.json({ ok: true });
});
