import { all, get, insert, run } from './db.js';
import { policyFor, holidayListFilter, weeklyOffChecker, leaveRulesFor, entitlement } from './policies.js';
import { emailEmployee, appUrl } from './mailer.js';

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
export const minutes = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Holidays that are days off for an employee: the public holidays on their holiday list, plus optional
 * (restricted) holidays they opted in to. Without an employee, the default list's public holidays.
 */
export function holidaySet(employeeId) {
  const list = policyFor('holiday', employeeId);
  const f = holidayListFilter(list?.id);
  const rows = employeeId
    ? all(`SELECT date FROM holidays h WHERE type != 'Optional' AND ${f.sql}
           UNION SELECT h.date FROM holidays h JOIN optional_holiday_choices c ON c.holiday_id = h.id WHERE c.employee_id = ?`, ...f.params, employeeId)
    : all(`SELECT date FROM holidays h WHERE type != 'Optional' AND ${f.sql}`, ...f.params);
  return new Set(rows.map((h) => h.date));
}

/** Working days between two dates inclusive, excluding weekly offs (default Sat/Sun) and holidays. */
export function workingDaysBetween(start, end, holidays = holidaySet(), isOff = isWeekend) {
  let count = 0;
  for (let d = parseDate(start); d <= parseDate(end); d.setDate(d.getDate() + 1)) {
    if (!isOff(d) && !holidays.has(ymd(d))) count++;
  }
  return count;
}

/** (Date) => true when it is a weekly off or holiday for this employee under their assigned plans. */
export function offDayChecker(employeeId) {
  const holidays = holidaySet(employeeId);
  const weeklyOff = weeklyOffChecker(employeeId);
  const check = (d) => weeklyOff(d) || holidays.has(ymd(d));
  check.weeklyOff = weeklyOff;
  check.holidays = holidays;
  return check;
}

/** An employee's working days between two dates, using their holiday list and weekly-off policy. */
export function workingDaysFor(employeeId, start, end) {
  const off = offDayChecker(employeeId);
  return workingDaysBetween(start, end, off.holidays, off.weeklyOff);
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}`, days: last };
}

export const round2 = (n) => Math.round(n * 100) / 100;

/** Annual income tax under India's new regime (FY 2025-26) incl. 87A rebate and 4% cess. */
export function annualTaxNewRegime(annualGross) {
  const taxable = Math.max(0, annualGross - 75000);
  if (taxable <= 1200000) return 0;
  const slabs = [
    [400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15],
    [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3],
  ];
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of slabs) {
    if (taxable > prev) tax += (Math.min(taxable, limit) - prev) * rate;
    prev = limit;
  }
  return round2(tax * 1.04);
}

/**
 * Salary breakup and statutory deductions for one month.
 * opts: basicPct / hraPct (salary structure) and annualTax (from the employee's chosen regime; defaults to new regime).
 */
export function computePayslip(annualCtc, workingDays, paidDays, opts = {}) {
  const { basicPct = 50, hraPct = 40 } = opts;
  const monthlyCtc = annualCtc / 12;
  const factor = workingDays ? paidDays / workingDays : 1;
  const fullBasic = monthlyCtc * (basicPct / 100);
  const basic = round2(fullBasic * factor);
  const hra = round2(fullBasic * (hraPct / 100) * factor);
  const gross = round2(monthlyCtc * factor);
  const special = round2(gross - basic - hra);
  const pf = round2(Math.min(basic, 15000) * 0.12);
  const esi = gross <= 21000 ? round2(gross * 0.0075) : 0;
  const pt = gross > 15000 ? 200 : gross > 10000 ? 150 : 0;
  const tds = round2((opts.annualTax ?? annualTaxNewRegime(annualCtc)) / 12);
  const total_deductions = round2(pf + esi + pt + tds);
  return { basic, hra, special, gross, pf, esi, pt, tds, total_deductions, net: round2(gross - total_deductions) };
}

/** In-app notification plus a matching email (unless the employee turned email notifications off). */
export function notify(employeeId, title, body, link, { email = true } = {}) {
  if (!employeeId) return;
  insert('notifications', { employee_id: employeeId, title, body, link });
  if (email) {
    emailEmployee(employeeId, {
      subject: title,
      heading: title,
      paragraphs: body ? [body] : [],
      cta: link ? { url: `${appUrl()}${link}`, label: 'Open in PeopleHub' } : undefined,
      template: 'notification',
    });
  }
}

export function audit(actorId, action, entity, entityId, details) {
  insert('audit_logs', {
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId ?? null,
    details: details ? JSON.stringify(details) : null,
  });
}

export function hrIds() {
  return all("SELECT id FROM employees WHERE role IN ('hr','admin') AND status != 'exited'").map((r) => r.id);
}

export function notifyHR(title, body, link) {
  for (const id of hrIds()) notify(id, title, body, link);
}

/**
 * Makes sure the employee has a balance row for each leave type they are entitled to in a year.
 * With a leave plan, `allocated` is recalculated from the plan (pro-rated for joiners, monthly accrual up to today);
 * carry-forward, comp-offs, penalties and manual corrections live in `carried` / `adjustment`, so recalculation never loses them.
 */
export function ensureLeaveBalances(employeeId, year = new Date().getFullYear()) {
  const lr = leaveRulesFor(employeeId);
  if (!lr) {
    run(
      `INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated, used)
       SELECT ?, id, ?, annual_quota, 0 FROM leave_types`,
      employeeId,
      year,
    );
    return;
  }
  const join = get('SELECT date_of_joining FROM employees WHERE id = ?', employeeId)?.date_of_joining;
  for (const [typeId, rule] of lr.rules) {
    run(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated, used) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET allocated = excluded.allocated`,
      employeeId, typeId, year, entitlement(rule, join, year, today()),
    );
  }
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
