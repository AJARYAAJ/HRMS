import { all, insert, run } from './db.js';

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

export function holidaySet() {
  return new Set(all('SELECT date FROM holidays').map((h) => h.date));
}

/** Working days between two dates inclusive, excluding weekends and holidays. */
export function workingDaysBetween(start, end, holidays = holidaySet()) {
  let count = 0;
  for (let d = parseDate(start); d <= parseDate(end); d.setDate(d.getDate() + 1)) {
    if (!isWeekend(d) && !holidays.has(ymd(d))) count++;
  }
  return count;
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

/** Salary breakup and statutory deductions for one month. */
export function computePayslip(annualCtc, workingDays, paidDays) {
  const monthlyCtc = annualCtc / 12;
  const factor = workingDays ? paidDays / workingDays : 1;
  const fullBasic = monthlyCtc * 0.5;
  const basic = round2(fullBasic * factor);
  const hra = round2(fullBasic * 0.4 * factor);
  const gross = round2(monthlyCtc * factor);
  const special = round2(gross - basic - hra);
  const pf = round2(Math.min(basic, 15000) * 0.12);
  const esi = gross <= 21000 ? round2(gross * 0.0075) : 0;
  const pt = gross > 15000 ? 200 : gross > 10000 ? 150 : 0;
  const tds = round2(annualTaxNewRegime(annualCtc) / 12);
  const total_deductions = round2(pf + esi + pt + tds);
  return { basic, hra, special, gross, pf, esi, pt, tds, total_deductions, net: round2(gross - total_deductions) };
}

export function notify(employeeId, title, body, link) {
  if (!employeeId) return;
  insert('notifications', { employee_id: employeeId, title, body, link });
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

export function ensureLeaveBalances(employeeId, year = new Date().getFullYear()) {
  run(
    `INSERT OR IGNORE INTO leave_balances (employee_id, leave_type_id, year, allocated, used)
     SELECT ?, id, ?, annual_quota, 0 FROM leave_types`,
    employeeId,
    year,
  );
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
