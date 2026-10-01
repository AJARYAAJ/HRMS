import { Router } from 'express';
import { isIPv4 } from 'node:net';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, canManage } from '../auth.js';
import { audit, httpError, notify, monthRange, ensureLeaveBalances, round2 } from '../utils.js';
import { POLICY_KINDS, policyFor, leaveRulesFor, parsePattern, expenseCategoriesFor, attendancePolicyFor } from '../policies.js';

/**
 * Policies & settings hub: leave plans, holiday lists, weekly-off policies, attendance (tracking) policies and
 * expense policies. Each can be marked the organisation default and assigned to employees in bulk.
 */
export const policiesRouter = Router();
const HR = requireRole('admin', 'hr');
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;

const num = (v, { min = 0, max = Infinity, allowNull = true, label = 'Value' } = {}) => {
  if (v === '' || v === null || v === undefined) {
    if (allowNull) return null;
    throw httpError(400, `${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} must be between ${min} and ${max === Infinity ? 'any' : max}`);
  return n;
};
/** Normalises "10.0.0.0/8, 203.0.113.7" and rejects anything that is not an IPv4 address or CIDR range. */
function cleanIpRanges(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const parts = String(v).split(/[\s,]+/).filter(Boolean);
  for (const p of parts) {
    const [ip, bits] = p.split('/');
    if (!isIPv4(ip) || (bits !== undefined && !(Number(bits) >= 0 && Number(bits) <= 32 && /^\d+$/.test(bits)))) throw httpError(400, `"${p}" is not an IP address or range like 203.0.113.0/24`);
  }
  return parts.join(', ');
}
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/** Per-kind editable fields and validation. */
const SPECS = {
  leave: { fields: ['name', 'description'], clean: (b) => ({}) },
  holiday: { fields: ['name', 'description', 'optional_limit'], clean: (b) => ({ optional_limit: num(b.optional_limit, { max: 30, label: 'Optional holiday limit' }) ?? 2 }) },
  weekly_off: {
    fields: ['name', 'description', 'pattern'],
    clean(b) {
      const p = typeof b.pattern === 'string' ? parsePattern(b.pattern) : b.pattern || {};
      const out = {};
      for (const [day, rule] of Object.entries(p)) {
        if (!/^[0-6]$/.test(day) || !rule) continue;
        if (rule === 'all') out[day] = 'all';
        else {
          const weeks = String(rule).split(',').map((w) => Number(w.trim())).filter((w) => w >= 1 && w <= 5);
          if (weeks.length) out[day] = [...new Set(weeks)].sort().join(',');
        }
      }
      if (Object.values(out).filter((r) => r === 'all').length > 3) throw httpError(400, 'A weekly-off policy can have at most three full days off every week');
      return { pattern: JSON.stringify(out) };
    },
  },
  attendance: {
    fields: ['name', 'description', 'allow_web', 'allow_remote', 'allow_field', 'geofence_mode', 'grace_minutes', 'full_day_hours', 'half_day_hours',
      'late_penalty_every', 'late_penalty_days', 'penalty_leave_type_id', 'max_regularizations', 'overtime_allowed', 'overtime_min_minutes',
      'allow_biometric', 'allowed_ips', 'auto_clock_out', 'auto_clock_out_hours'],
    clean(b) {
      const out = {
        allow_web: flag(b.allow_web ?? 1), allow_remote: flag(b.allow_remote ?? 1), allow_field: flag(b.allow_field ?? 1),
        geofence_mode: ['off', 'flag', 'enforce'].includes(b.geofence_mode) ? b.geofence_mode : null,
        grace_minutes: num(b.grace_minutes, { max: 240, label: 'Grace period' }),
        full_day_hours: num(b.full_day_hours, { min: 1, max: 16, label: 'Full-day hours' }),
        half_day_hours: num(b.half_day_hours, { min: 0.5, max: 12, label: 'Half-day hours' }),
        late_penalty_every: num(b.late_penalty_every, { max: 31, label: 'Late marks per penalty' }) ?? 0,
        late_penalty_days: num(b.late_penalty_days, { min: 0.5, max: 5, label: 'Penalty days' }) ?? 0.5,
        penalty_leave_type_id: b.penalty_leave_type_id ? Number(b.penalty_leave_type_id) : null,
        max_regularizations: num(b.max_regularizations, { max: 31, label: 'Regularizations per month' }),
        overtime_allowed: flag(b.overtime_allowed ?? 1),
        overtime_min_minutes: num(b.overtime_min_minutes, { max: 600, label: 'Minimum overtime' }) ?? 30,
        allow_biometric: flag(b.allow_biometric ?? 1),
        allowed_ips: cleanIpRanges(b.allowed_ips),
        auto_clock_out: flag(b.auto_clock_out ?? 0),
        auto_clock_out_hours: num(b.auto_clock_out_hours, { min: 0, max: 12, label: 'Auto clock-out delay' }) ?? 4,
      };
      if (!out.allow_web && !out.allow_remote && !out.allow_field) throw httpError(400, 'Allow at least one way to clock in');
      if (out.full_day_hours != null && out.half_day_hours != null && out.half_day_hours >= out.full_day_hours) throw httpError(400, 'Half-day hours must be less than full-day hours');
      if (out.penalty_leave_type_id && !get('SELECT id FROM leave_types WHERE id = ?', out.penalty_leave_type_id)) throw httpError(400, 'Unknown leave type');
      return out;
    },
  },
  expense: { fields: ['name', 'description'], clean: () => ({}) },
};

const kindOf = (k) => {
  const key = k.replace(/-/g, '_');
  if (!POLICY_KINDS[key]) throw httpError(404, 'Unknown policy type');
  return key;
};

function listPolicies(kind) {
  const { table, column } = POLICY_KINDS[kind];
  const rows = all(`SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.${column} = t.id AND e.status != 'exited') AS assigned FROM ${table} t ORDER BY t.is_default DESC, t.name`);
  const unassigned = get(`SELECT COUNT(*) AS n FROM employees WHERE ${column} IS NULL AND status != 'exited'`).n;
  return rows.map((r) => {
    const extra = {};
    if (kind === 'leave') extra.rules = all('SELECT r.*, lt.name AS leave_type, lt.code, lt.color FROM leave_plan_rules r JOIN leave_types lt ON lt.id = r.leave_type_id WHERE r.plan_id = ? ORDER BY lt.id', r.id);
    if (kind === 'holiday') {
      extra.holidays = all(`SELECT * FROM holidays WHERE list_id = ?${r.is_default ? ' OR list_id IS NULL' : ''} ORDER BY date`, r.id);
      extra.locations = all('SELECT id, name FROM locations WHERE holiday_list_id = ?', r.id);
    }
    if (kind === 'weekly_off') extra.pattern = parsePattern(r.pattern);
    if (kind === 'expense') extra.categories = all('SELECT * FROM expense_categories WHERE policy_id = ? ORDER BY name', r.id);
    if (kind === 'attendance' && r.penalty_leave_type_id) extra.penalty_leave_type = get('SELECT name FROM leave_types WHERE id = ?', r.penalty_leave_type_id)?.name;
    // Employees without an explicit assignment follow the default.
    return { ...r, ...extra, is_default: !!r.is_default, effective: r.assigned + (r.is_default ? unassigned : 0) };
  });
}

// ---------- self service: what applies to me ----------
policiesRouter.get('/my', (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user.id);
  if (employeeId !== req.user.id && !canManage(req.user, employeeId)) throw httpError(403, 'Not allowed');
  const leave = leaveRulesFor(employeeId);
  const weekly = policyFor('weekly_off', employeeId);
  const { policy: expense, categories } = expenseCategoriesFor(employeeId);
  const att = attendancePolicyFor(employeeId);
  res.json({
    leave_plan: leave ? { id: leave.plan.id, name: leave.plan.name, rules: [...leave.rules.values()] } : null,
    holiday_list: policyFor('holiday', employeeId),
    weekly_off: weekly ? { ...weekly, pattern: parsePattern(weekly.pattern) } : null,
    attendance: att,
    expense: expense ? { ...expense, categories } : null,
  });
});

// ---------- assignments ----------
policiesRouter.get('/assignments', HR, (req, res) => {
  const cols = Object.values(POLICY_KINDS).map((k) => `e.${k.column}`).join(', ');
  const emps = all(`SELECT e.id, e.emp_code, ${NAME('e')} AS name, e.avatar_color, e.location_id, d.name AS department, l.name AS location, ${cols}
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN locations l ON l.id = e.location_id
    WHERE e.status != 'exited' ORDER BY e.first_name, e.last_name`);
  const names = {};
  for (const [kind, { table }] of Object.entries(POLICY_KINDS)) names[kind] = Object.fromEntries(all(`SELECT id, name FROM ${table}`).map((r) => [r.id, r.name]));
  res.json(emps.map((e) => {
    const effective = {};
    for (const kind of Object.keys(POLICY_KINDS)) {
      const p = policyFor(kind, e.id);
      effective[kind] = p ? { id: p.id, name: p.name, explicit: e[POLICY_KINDS[kind].column] === p.id } : null;
    }
    return { ...e, effective };
  }));
});

policiesRouter.post('/assign', HR, (req, res) => {
  const kind = kindOf(req.body.kind || '');
  const { table, column } = POLICY_KINDS[kind];
  const ids = [...new Set((req.body.employee_ids || []).map(Number).filter(Boolean))];
  if (!ids.length) throw httpError(400, 'Choose at least one employee');
  const policyId = req.body.policy_id ? Number(req.body.policy_id) : null;
  const policy = policyId ? get(`SELECT * FROM ${table} WHERE id = ?`, policyId) : null;
  if (policyId && !policy) throw httpError(404, 'Policy not found');
  tx(() => {
    for (const id of ids) {
      run(`UPDATE employees SET ${column} = ? WHERE id = ?`, policyId, id);
      if (kind === 'leave') ensureLeaveBalances(id);
    }
  });
  const label = policy?.name || 'the organisation default';
  for (const id of ids) notify(id, 'Your policies were updated', `You now follow ${label}.`, '/leave', { email: false });
  audit(req.user.id, 'assign_policy', table, policyId, { employees: ids.length });
  res.json({ ok: true, updated: ids.length });
});

// ---------- attendance penalties (late marks) ----------
policiesRouter.get('/penalties', HR, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  res.json(all(`SELECT p.*, ${NAME('e')} AS employee_name, e.emp_code, e.avatar_color, lt.name AS leave_type
    FROM attendance_penalties p JOIN employees e ON e.id = p.employee_id LEFT JOIN leave_types lt ON lt.id = p.leave_type_id
    WHERE p.month = ? ORDER BY e.first_name`, month));
});

/** Reverses a penalty's effect on the leave balance (penalties charged to LOP are read by payroll instead). */
function unapply(p) {
  if (p.status === 'applied' && p.leave_type_id) {
    run('UPDATE leave_balances SET adjustment = adjustment + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', p.days, p.employee_id, p.leave_type_id, Number(p.month.slice(0, 4)));
  }
}

/**
 * Applies late-mark penalties for a month under each employee's attendance policy: every N late marks deduct
 * the policy's days from the chosen leave type (or count as loss of pay in payroll). Re-running recalculates;
 * waived penalties stay waived.
 */
policiesRouter.post('/penalties/run', HR, (req, res) => {
  const month = req.body.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw httpError(400, 'Choose a month');
  const { start, end } = monthRange(month);
  const year = Number(month.slice(0, 4));
  let applied = 0;
  let days = 0;
  tx(() => {
    for (const e of all("SELECT id FROM employees WHERE status != 'exited'")) {
      const policy = attendancePolicyFor(e.id);
      const prev = get('SELECT * FROM attendance_penalties WHERE employee_id = ? AND month = ?', e.id, month);
      if (prev?.status === 'waived') continue;
      if (prev) { unapply(prev); run('DELETE FROM attendance_penalties WHERE id = ?', prev.id); }
      if (!policy?.late_penalty_every) continue;
      const late = get("SELECT COUNT(*) AS n FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND late = 1 AND status IN ('present','half_day')", e.id, start, end).n;
      const d = Math.floor(late / policy.late_penalty_every) * policy.late_penalty_days;
      if (!d) continue;
      insert('attendance_penalties', { employee_id: e.id, month, late_count: late, days: d, leave_type_id: policy.penalty_leave_type_id, status: 'applied', decided_by: req.user.id });
      if (policy.penalty_leave_type_id) {
        ensureLeaveBalances(e.id, year);
        run(`INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated, used) VALUES (?, ?, ?, 0, 0)`, e.id, policy.penalty_leave_type_id, year);
        run('UPDATE leave_balances SET adjustment = adjustment - ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', d, e.id, policy.penalty_leave_type_id, year);
      }
      applied++;
      days += d;
    }
  });
  for (const p of all("SELECT p.*, lt.name AS lt FROM attendance_penalties p LEFT JOIN leave_types lt ON lt.id = p.leave_type_id WHERE month = ? AND status = 'applied'", month)) {
    notify(p.employee_id, 'Late-mark penalty applied', `${p.late_count} late marks in ${month}: ${p.days} day(s) deducted from ${p.lt || 'pay (loss of pay)'}.`, '/attendance');
  }
  audit(req.user.id, 'run_penalties', 'attendance_penalties', null, { month, applied, days });
  res.json({ month, applied, days: round2(days) });
});

policiesRouter.post('/penalties/:id/waive', HR, (req, res) => {
  const p = get('SELECT * FROM attendance_penalties WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Penalty not found');
  if (p.status === 'waived') throw httpError(400, 'Already waived');
  tx(() => {
    unapply(p);
    update('attendance_penalties', p.id, { status: 'waived', decided_by: req.user.id, comment: req.body.comment || null });
  });
  notify(p.employee_id, 'Late-mark penalty waived', `Your ${p.month} penalty of ${p.days} day(s) was waived.`, '/attendance');
  audit(req.user.id, 'waive', 'attendance_penalties', p.id, { comment: req.body.comment });
  res.json({ ok: true });
});

// ---------- leave plan rules ----------
const ACCRUALS = ['yearly', 'monthly', 'none'];
function cleanRule(b) {
  const accrual = ACCRUALS.includes(b.accrual) ? b.accrual : 'yearly';
  return {
    annual_quota: num(b.annual_quota, { max: 365, allowNull: false, label: 'Annual quota' }),
    accrual,
    carry_forward_cap: num(b.carry_forward_cap, { max: 365, label: 'Carry-forward cap' }) ?? 0,
    encashable: flag(b.encashable), allow_half_day: flag(b.allow_half_day ?? 1),
    min_notice_days: num(b.min_notice_days, { max: 90, label: 'Notice' }) ?? 0,
    max_consecutive: num(b.max_consecutive, { min: 0.5, max: 365, label: 'Max consecutive days' }),
    probation_allowed: flag(b.probation_allowed ?? 1), sandwich: flag(b.sandwich),
    gender: ['Male', 'Female'].includes(b.gender) ? b.gender : null,
  };
}
const refreshPlan = (planId) => {
  const def = get('SELECT is_default FROM leave_plans WHERE id = ?', planId)?.is_default;
  for (const { id } of all(`SELECT id FROM employees WHERE status != 'exited' AND (leave_plan_id = ?${def ? ' OR leave_plan_id IS NULL' : ''})`, planId)) ensureLeaveBalances(id);
};

policiesRouter.post('/leave/:id/rules', HR, (req, res) => {
  const plan = get('SELECT * FROM leave_plans WHERE id = ?', req.params.id);
  if (!plan) throw httpError(404, 'Leave plan not found');
  const typeId = Number(req.body.leave_type_id);
  if (!get('SELECT id FROM leave_types WHERE id = ?', typeId)) throw httpError(400, 'Choose a leave type');
  if (get('SELECT id FROM leave_plan_rules WHERE plan_id = ? AND leave_type_id = ?', plan.id, typeId)) throw httpError(409, 'This leave type is already in the plan');
  const id = insert('leave_plan_rules', { plan_id: plan.id, leave_type_id: typeId, ...cleanRule(req.body) });
  refreshPlan(plan.id);
  audit(req.user.id, 'create', 'leave_plan_rules', id);
  res.status(201).json(get('SELECT * FROM leave_plan_rules WHERE id = ?', id));
});

policiesRouter.put('/leave/:id/rules/:ruleId', HR, (req, res) => {
  const rule = get('SELECT * FROM leave_plan_rules WHERE id = ? AND plan_id = ?', req.params.ruleId, req.params.id);
  if (!rule) throw httpError(404, 'Rule not found');
  update('leave_plan_rules', rule.id, cleanRule({ ...rule, ...req.body }));
  refreshPlan(rule.plan_id);
  audit(req.user.id, 'update', 'leave_plan_rules', rule.id);
  res.json(get('SELECT * FROM leave_plan_rules WHERE id = ?', rule.id));
});

policiesRouter.delete('/leave/:id/rules/:ruleId', HR, (req, res) => {
  const rule = get('SELECT * FROM leave_plan_rules WHERE id = ? AND plan_id = ?', req.params.ruleId, req.params.id);
  if (!rule) throw httpError(404, 'Rule not found');
  run('DELETE FROM leave_plan_rules WHERE id = ?', rule.id);
  audit(req.user.id, 'delete', 'leave_plan_rules', rule.id);
  res.json({ ok: true });
});

// ---------- expense categories ----------
function cleanCategory(b) {
  const kind = ['amount', 'mileage', 'per_diem'].includes(b.kind) ? b.kind : 'amount';
  const name = String(b.name || '').trim();
  if (!name) throw httpError(400, 'Category name is required');
  const out = {
    name, kind,
    rate: kind === 'amount' ? null : num(b.rate, { min: 0.01, allowNull: false, label: kind === 'mileage' ? 'Rate per km' : 'Rate per day' }),
    per_claim_limit: num(b.per_claim_limit, { min: 1, label: 'Per-claim limit' }),
    monthly_limit: num(b.monthly_limit, { min: 1, label: 'Monthly limit' }),
    receipt_above: num(b.receipt_above, { label: 'Receipt threshold' }),
  };
  if (out.per_claim_limit && out.monthly_limit && out.per_claim_limit > out.monthly_limit) throw httpError(400, 'The per-claim limit cannot exceed the monthly limit');
  return out;
}

policiesRouter.post('/expense/:id/categories', HR, (req, res) => {
  const policy = get('SELECT * FROM expense_policies WHERE id = ?', req.params.id);
  if (!policy) throw httpError(404, 'Expense policy not found');
  const data = cleanCategory(req.body);
  if (get('SELECT id FROM expense_categories WHERE policy_id = ? AND lower(name) = lower(?)', policy.id, data.name)) throw httpError(409, 'A category with this name already exists');
  const id = insert('expense_categories', { policy_id: policy.id, ...data });
  audit(req.user.id, 'create', 'expense_categories', id);
  res.status(201).json(get('SELECT * FROM expense_categories WHERE id = ?', id));
});

policiesRouter.put('/expense/:id/categories/:catId', HR, (req, res) => {
  const cat = get('SELECT * FROM expense_categories WHERE id = ? AND policy_id = ?', req.params.catId, req.params.id);
  if (!cat) throw httpError(404, 'Category not found');
  const data = cleanCategory({ ...cat, ...req.body });
  if (get('SELECT id FROM expense_categories WHERE policy_id = ? AND lower(name) = lower(?) AND id != ?', cat.policy_id, data.name, cat.id)) throw httpError(409, 'A category with this name already exists');
  update('expense_categories', cat.id, data);
  audit(req.user.id, 'update', 'expense_categories', cat.id);
  res.json(get('SELECT * FROM expense_categories WHERE id = ?', cat.id));
});

policiesRouter.delete('/expense/:id/categories/:catId', HR, (req, res) => {
  const cat = get('SELECT * FROM expense_categories WHERE id = ? AND policy_id = ?', req.params.catId, req.params.id);
  if (!cat) throw httpError(404, 'Category not found');
  run('DELETE FROM expense_categories WHERE id = ?', cat.id);
  audit(req.user.id, 'delete', 'expense_categories', cat.id);
  res.json({ ok: true });
});

// ---------- holiday list ↔ locations ----------
policiesRouter.put('/holiday/:id/locations', HR, (req, res) => {
  const list = get('SELECT * FROM holiday_lists WHERE id = ?', req.params.id);
  if (!list) throw httpError(404, 'Holiday list not found');
  const ids = (req.body.location_ids || []).map(Number).filter(Boolean);
  tx(() => {
    run('UPDATE locations SET holiday_list_id = NULL WHERE holiday_list_id = ?', list.id);
    for (const id of ids) run('UPDATE locations SET holiday_list_id = ? WHERE id = ?', list.id, id);
  });
  audit(req.user.id, 'update', 'holiday_lists', list.id, { locations: ids });
  res.json({ ok: true });
});

// ---------- generic plan CRUD (must come after the specific routes above) ----------
policiesRouter.get('/:kind', HR, (req, res) => res.json(listPolicies(kindOf(req.params.kind))));

policiesRouter.post('/:kind', HR, (req, res) => {
  const kind = kindOf(req.params.kind);
  const { table } = POLICY_KINDS[kind];
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  if (get(`SELECT id FROM ${table} WHERE lower(name) = lower(?)`, name)) throw httpError(409, 'A policy with this name already exists');
  const hasDefault = !!get(`SELECT id FROM ${table} WHERE is_default = 1`);
  const id = tx(() => {
    const newId = insert(table, { name, description: req.body.description || null, ...SPECS[kind].clean(req.body), is_default: hasDefault ? 0 : 1 });
    // A new leave plan can start as a copy of another plan's rules.
    if (kind === 'leave' && req.body.copy_from) {
      run(`INSERT INTO leave_plan_rules (plan_id, leave_type_id, annual_quota, accrual, carry_forward_cap, encashable, allow_half_day, min_notice_days, max_consecutive, probation_allowed, sandwich, gender)
           SELECT ?, leave_type_id, annual_quota, accrual, carry_forward_cap, encashable, allow_half_day, min_notice_days, max_consecutive, probation_allowed, sandwich, gender
           FROM leave_plan_rules WHERE plan_id = ?`, newId, Number(req.body.copy_from));
    }
    if (kind === 'expense' && req.body.copy_from) {
      run(`INSERT INTO expense_categories (policy_id, name, kind, rate, per_claim_limit, monthly_limit, receipt_above)
           SELECT ?, name, kind, rate, per_claim_limit, monthly_limit, receipt_above FROM expense_categories WHERE policy_id = ?`, newId, Number(req.body.copy_from));
    }
    return newId;
  });
  audit(req.user.id, 'create', table, id);
  res.status(201).json(listPolicies(kind).find((p) => p.id === id));
});

policiesRouter.put('/:kind/:id', HR, (req, res) => {
  const kind = kindOf(req.params.kind);
  const { table } = POLICY_KINDS[kind];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
  if (!row) throw httpError(404, 'Policy not found');
  const merged = { ...row, ...req.body };
  const name = String(merged.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  if (get(`SELECT id FROM ${table} WHERE lower(name) = lower(?) AND id != ?`, name, row.id)) throw httpError(409, 'A policy with this name already exists');
  update(table, row.id, { name, description: merged.description || null, ...SPECS[kind].clean(merged) });
  audit(req.user.id, 'update', table, row.id);
  res.json(listPolicies(kind).find((p) => p.id === row.id));
});

policiesRouter.post('/:kind/:id/default', HR, (req, res) => {
  const kind = kindOf(req.params.kind);
  const { table } = POLICY_KINDS[kind];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
  if (!row) throw httpError(404, 'Policy not found');
  tx(() => {
    // Holidays without a list belong to the current default; pin them to it so they don't move with the default.
    const old = kind === 'holiday' && get('SELECT id FROM holiday_lists WHERE is_default = 1');
    if (old) run('UPDATE holidays SET list_id = ? WHERE list_id IS NULL', old.id);
    run(`UPDATE ${table} SET is_default = 0`);
    run(`UPDATE ${table} SET is_default = 1 WHERE id = ?`, row.id);
  });
  if (kind === 'leave') for (const { id } of all("SELECT id FROM employees WHERE leave_plan_id IS NULL AND status != 'exited'")) ensureLeaveBalances(id);
  audit(req.user.id, 'set_default', table, row.id);
  res.json({ ok: true });
});

policiesRouter.delete('/:kind/:id', HR, (req, res) => {
  const kind = kindOf(req.params.kind);
  const { table, column } = POLICY_KINDS[kind];
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
  if (!row) throw httpError(404, 'Policy not found');
  if (row.is_default && get(`SELECT COUNT(*) AS n FROM ${table}`).n > 1) throw httpError(409, 'Make another policy the default before deleting this one');
  tx(() => {
    run(`UPDATE employees SET ${column} = NULL WHERE ${column} = ?`, row.id);
    if (kind === 'holiday') {
      run('UPDATE locations SET holiday_list_id = NULL WHERE holiday_list_id = ?', row.id);
      run('DELETE FROM holidays WHERE list_id = ?', row.id);
    }
    run(`DELETE FROM ${table} WHERE id = ?`, row.id);
  });
  audit(req.user.id, 'delete', table, row.id);
  res.json({ ok: true });
});
