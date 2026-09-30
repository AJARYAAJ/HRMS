import { all, get } from './db.js';

/**
 * Keka-style assignable plans. Every employee resolves to one plan of each kind: the plan assigned to them,
 * else (for holiday lists) the one set on their location, else the organisation default. When no plan of a
 * kind exists at all, the legacy organisation-wide behaviour applies (Sat/Sun off, every holiday, leave-type quotas).
 */
const KINDS = {
  leave: { table: 'leave_plans', column: 'leave_plan_id' },
  holiday: { table: 'holiday_lists', column: 'holiday_list_id' },
  weekly_off: { table: 'weekly_off_policies', column: 'weekly_off_policy_id' },
  attendance: { table: 'attendance_policies', column: 'attendance_policy_id' },
  expense: { table: 'expense_policies', column: 'expense_policy_id' },
};
export const POLICY_KINDS = KINDS;

const defaultOf = (table) => get(`SELECT * FROM ${table} WHERE is_default = 1 ORDER BY id LIMIT 1`) || get(`SELECT * FROM ${table} ORDER BY id LIMIT 1`);

/** The plan row of `kind` that applies to an employee (or null when the organisation has none). */
export function policyFor(kind, employeeId) {
  const { table, column } = KINDS[kind];
  const emp = employeeId ? get(`SELECT ${column} AS pid, location_id FROM employees WHERE id = ?`, employeeId) : null;
  if (emp?.pid) {
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, emp.pid);
    if (row) return row;
  }
  if (kind === 'holiday' && emp?.location_id) {
    const row = get('SELECT h.* FROM holiday_lists h JOIN locations l ON l.holiday_list_id = h.id WHERE l.id = ?', emp.location_id);
    if (row) return row;
  }
  return defaultOf(table) || null;
}

// ---------- holidays & weekly offs ----------
/** SQL fragment + params selecting the holidays of one list. Holidays without a list belong to the default list. */
export function holidayListFilter(listId, alias = 'h') {
  if (!listId) return { sql: '1=1', params: [] };
  const def = defaultOf('holiday_lists');
  return def?.id === listId
    ? { sql: `(${alias}.list_id = ? OR ${alias}.list_id IS NULL)`, params: [listId] }
    : { sql: `${alias}.list_id = ?`, params: [listId] };
}

export const DEFAULT_PATTERN = { 0: 'all', 6: 'all' };

export function parsePattern(p) {
  try {
    const o = typeof p === 'string' ? JSON.parse(p) : p;
    return o && typeof o === 'object' ? o : DEFAULT_PATTERN;
  } catch {
    return DEFAULT_PATTERN;
  }
}

/** Week of the month a date falls in for "2nd and 4th Saturday" rules: days 1–7 are week 1, 8–14 week 2… */
export const weekOfMonth = (d) => Math.ceil(d.getDate() / 7);

/** Is this date a weekly off under the pattern? Pattern: weekday (0=Sun) → "all" or a list of weeks, e.g. "2,4". */
export function isWeeklyOff(d, pattern = DEFAULT_PATTERN) {
  const rule = pattern[d.getDay()] ?? pattern[String(d.getDay())];
  if (!rule) return false;
  if (rule === 'all') return true;
  return String(rule).split(',').map(Number).includes(weekOfMonth(d));
}

export function weeklyOffChecker(employeeId) {
  const pattern = parsePattern(policyFor('weekly_off', employeeId)?.pattern);
  return (d) => isWeeklyOff(d, pattern);
}

/** Holiday filter for an employee's own list. */
export const employeeHolidayFilter = (employeeId, alias = 'h') => holidayListFilter(policyFor('holiday', employeeId)?.id, alias);

// ---------- leave plans ----------
const roundHalf = (n) => Math.round(n * 2) / 2;

/**
 * Leave rules that apply to an employee, keyed by leave type id. Returns null when no leave plan exists
 * (then every leave type is available with its own annual quota).
 */
export function leaveRulesFor(employeeId) {
  const plan = policyFor('leave', employeeId);
  if (!plan) return null;
  const emp = get('SELECT gender FROM employees WHERE id = ?', employeeId);
  const rules = all('SELECT r.*, lt.code, lt.name AS leave_type FROM leave_plan_rules r JOIN leave_types lt ON lt.id = r.leave_type_id WHERE r.plan_id = ?', plan.id)
    .filter((r) => !r.gender || !emp?.gender || r.gender.toLowerCase() === emp.gender.toLowerCase());
  return { plan, rules: new Map(rules.map((r) => [r.leave_type_id, r])) };
}

/**
 * Entitlement for a leave year under a rule.
 *   yearly  – the full quota on 1 January; joiners get the months left in the year (joining after the 15th skips that month)
 *   monthly – quota / 12 credited at the start of each month worked, up to `asOf`
 *   none    – nothing credited (unpaid leave, comp-off earned by working holidays)
 */
export function entitlement(rule, joinDate, year, asOf) {
  if (!rule || rule.accrual === 'none') return 0;
  const quota = Number(rule.annual_quota) || 0;
  let firstMonth = 1;
  if (joinDate && Number(joinDate.slice(0, 4)) === year) firstMonth = Number(joinDate.slice(5, 7)) + (Number(joinDate.slice(8, 10)) > 15 ? 1 : 0);
  else if (joinDate && Number(joinDate.slice(0, 4)) > year) return 0;
  if (firstMonth > 12) return 0;
  if (rule.accrual === 'monthly') {
    const asOfYear = Number(asOf.slice(0, 4));
    const lastMonth = asOfYear > year ? 12 : asOfYear < year ? 0 : Number(asOf.slice(5, 7));
    return roundHalf((quota / 12) * Math.max(0, lastMonth - firstMonth + 1));
  }
  return roundHalf((quota * (13 - firstMonth)) / 12);
}

// ---------- attendance & expense ----------
export const attendancePolicyFor = (employeeId) => policyFor('attendance', employeeId);

export function expenseCategoriesFor(employeeId) {
  const policy = policyFor('expense', employeeId);
  if (!policy) return { policy: null, categories: [] };
  return { policy, categories: all('SELECT * FROM expense_categories WHERE policy_id = ? ORDER BY name', policy.id) };
}
