import { all, get } from './db.js';
import { round2, annualTaxNewRegime } from './utils.js';

/** Financial year label (April–March) for a date, e.g. 2026-09-28 → "2026-27". */
export function fyOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export const fyMonths = (fy) => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start, 3 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};

export function payrollSettings() {
  const s = Object.fromEntries(all("SELECT key, value FROM settings WHERE key LIKE 'payroll_%'").map((r) => [r.key, r.value]));
  return {
    basicPct: Number(s.payroll_basic_pct) || 50,
    hraPct: Number(s.payroll_hra_pct) || 40,
  };
}

/** Old-regime slabs (below 60 years): 0–2.5L nil, 2.5–5L 5%, 5–10L 20%, above 10L 30%; 87A rebate up to ₹5L; 4% cess. */
export function annualTaxOldRegime(taxable) {
  const t = Math.max(0, taxable);
  if (t <= 500000) return 0;
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]]) {
    if (t > prev) tax += (Math.min(t, limit) - prev) * rate;
    prev = limit;
  }
  return round2(tax * 1.04);
}

/**
 * Old-regime deductions from approved declarations, with statutory caps:
 * 80C ₹1.5L (employee PF counts towards it), 80D ₹25k, HRA exemption (rent − 10% of basic, max 40% of basic),
 * 24(b) ₹2L, 80CCD(1B) ₹50k, 80E uncapped.
 */
export function oldRegimeDeductions(employeeId, fy, annualBasic, annualPf, { includePending = false } = {}) {
  const statuses = includePending ? "('approved','pending')" : "('approved')";
  const rows = all(`SELECT section, SUM(amount) AS amount FROM tax_declarations WHERE employee_id = ? AND fy = ? AND status IN ${statuses} GROUP BY section`, employeeId, fy);
  const by = Object.fromEntries(rows.map((r) => [r.section, r.amount]));
  const d = {
    standard: 50000,
    '80C': Math.min(150000, (by['80C'] || 0) + annualPf),
    '80D': Math.min(25000, by['80D'] || 0),
    HRA: by.HRA ? Math.max(0, Math.min(by.HRA - annualBasic * 0.1, annualBasic * 0.4)) : 0,
    '24b': Math.min(200000, by['24b'] || 0),
    '80CCD': Math.min(50000, by['80CCD'] || 0),
    '80E': by['80E'] || 0,
  };
  return { items: d, total: round2(Object.values(d).reduce((a, b) => a + b, 0)) };
}

/** Annual tax for an employee under both regimes, plus which one applies. */
export function taxProfile(employee, fy, opts = {}) {
  const { basicPct } = payrollSettings();
  const annualGross = employee.annual_ctc || 0;
  const annualBasic = annualGross * (basicPct / 100);
  const annualPf = Math.min(annualBasic / 12, 15000) * 0.12 * 12;
  const ded = oldRegimeDeductions(employee.id, fy, annualBasic, annualPf, opts);
  const oldTaxable = Math.max(0, annualGross - ded.total);
  const regimes = {
    new: { taxable: Math.max(0, annualGross - 75000), deductions: 75000, tax: annualTaxNewRegime(annualGross) },
    old: { taxable: oldTaxable, deductions: ded.total, deduction_items: ded.items, tax: annualTaxOldRegime(oldTaxable) },
  };
  const selected = employee.tax_regime === 'old' ? 'old' : 'new';
  return {
    fy, annual_gross: annualGross, selected, regimes,
    recommended: regimes.old.tax < regimes.new.tax ? 'old' : 'new',
    savings: round2(Math.abs(regimes.old.tax - regimes.new.tax)),
    annual_tax: regimes[selected].tax,
  };
}

export const employeeById = (id) => get('SELECT * FROM employees WHERE id = ?', id);
