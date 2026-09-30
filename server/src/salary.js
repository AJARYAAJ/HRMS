import { all, get } from './db.js';

/**
 * Salary structures (Keka-style salary templates). A structure is an ordered list of components:
 *   earning   – % of CTC, % of Basic, a fixed monthly amount, or the balancing figure (Special allowance)
 *   deduction – custom monthly deductions (fixed or % of Basic), on top of statutory PF / ESI / PT / TDS
 * Employer PF and gratuity can be part of CTC (Keka's "CTC includes employer contribution"), in which case they
 * come out of the monthly CTC before the balancing component is worked out. Employer ESI is shown as an employer
 * cost. Earnings are pro-rated for loss of pay; PF and ESI follow the pro-rated wages.
 */
export const CALCS = ['percent_ctc', 'percent_basic', 'fixed', 'balance'];
const round2 = (n) => Math.round(n * 100) / 100;
const ESI_EMPLOYER = 0.0325;
const ESI_EMPLOYEE = 0.0075;
const GRATUITY = 0.0481;

/** Professional tax: the common Karnataka-style monthly slab used by the demo organisation. */
export const professionalTax = (gross) => (gross > 15000 ? 200 : gross > 10000 ? 150 : 0);

function legacyStructure() {
  const s = Object.fromEntries(all("SELECT key, value FROM settings WHERE key LIKE 'payroll_%'").map((r) => [r.key, r.value]));
  return {
    id: null, name: 'Standard', pf_enabled: 1, pf_wage_cap: 15000, pf_employer_in_ctc: 0, esi_enabled: 1, esi_threshold: 21000, pt_enabled: 1, gratuity_in_ctc: 0,
    components: [
      { code: 'BASIC', name: 'Basic', type: 'earning', calc: 'percent_ctc', value: Number(s.payroll_basic_pct) || 50, taxable: 1 },
      { code: 'HRA', name: 'House rent allowance', type: 'earning', calc: 'percent_basic', value: Number(s.payroll_hra_pct) || 40, taxable: 1 },
      { code: 'SPECIAL', name: 'Special allowance', type: 'earning', calc: 'balance', value: 0, taxable: 1 },
    ],
  };
}

export const loadStructure = (id) => {
  const s = id && get('SELECT * FROM salary_structures WHERE id = ?', id);
  return s ? { ...s, components: all('SELECT * FROM salary_components WHERE structure_id = ? ORDER BY sort, id', s.id) } : null;
};

/** The structure an employee is paid on: their own, else the default, else the organisation's basic/HRA settings. */
export function structureFor(employeeId) {
  const emp = employeeId && get('SELECT salary_structure_id FROM employees WHERE id = ?', employeeId);
  return loadStructure(emp?.salary_structure_id)
    || loadStructure(get('SELECT id FROM salary_structures ORDER BY is_default DESC, id LIMIT 1')?.id)
    || legacyStructure();
}

/**
 * Monthly salary under a structure.
 * @returns lines (component-wise), legacy totals (basic, hra, special, gross, pf, esi, pt, tds, total_deductions, net),
 *          employer contributions and warnings (e.g. fixed components exceeding CTC).
 */
export function computeSalary(structure, annualCtc, { workingDays = 1, paidDays = 1, annualTax = 0 } = {}) {
  const monthly = (Number(annualCtc) || 0) / 12;
  const factor = workingDays ? Math.max(0, Math.min(1, paidDays / workingDays)) : 1;
  const comps = structure.components;
  const warnings = [];
  const earnings = comps.filter((c) => c.type === 'earning');
  const basicComp = earnings.find((c) => c.code === 'BASIC');
  const fullBasic = !basicComp ? 0 : basicComp.calc === 'fixed' ? Number(basicComp.value) : monthly * (Number(basicComp.value) / 100);
  const cap = structure.pf_wage_cap ? Number(structure.pf_wage_cap) : Infinity;
  const employerPfFull = structure.pf_enabled ? 0.12 * Math.min(fullBasic, cap) : 0;
  const gratuityFull = structure.gratuity_in_ctc ? fullBasic * GRATUITY : 0;
  const grossTarget = monthly - (structure.pf_employer_in_ctc ? employerPfFull : 0) - gratuityFull;

  const full = new Map();
  for (const c of earnings) {
    if (c.calc === 'balance') continue;
    const v = Number(c.value) || 0;
    full.set(c.code, c.code === 'BASIC' ? fullBasic : c.calc === 'percent_ctc' ? monthly * (v / 100) : c.calc === 'percent_basic' ? fullBasic * (v / 100) : v);
  }
  const fixedSum = [...full.values()].reduce((a, b) => a + b, 0);
  const balance = earnings.find((c) => c.calc === 'balance');
  if (balance) {
    const rest = grossTarget - fixedSum;
    if (rest < 0) warnings.push(`Components add up to more than the CTC by ₹${Math.round(-rest).toLocaleString('en-IN')} a month`);
    full.set(balance.code, Math.max(0, rest));
  } else if (Math.abs(grossTarget - fixedSum) > 1) {
    warnings.push('No balancing component: gross pay does not equal the CTC');
  }

  const lines = earnings.map((c) => ({ code: c.code, name: c.name, type: 'earning', amount: round2((full.get(c.code) || 0) * factor), full: round2(full.get(c.code) || 0), taxable: c.taxable ?? 1 }));
  const gross = round2(lines.reduce((a, l) => a + l.amount, 0));
  const basic = lines.find((l) => l.code === 'BASIC')?.amount || 0;
  const pf = structure.pf_enabled ? round2(0.12 * Math.min(basic, cap)) : 0;
  const esiApplies = structure.esi_enabled && gross <= Number(structure.esi_threshold || 21000) && gross > 0;
  const esi = esiApplies ? round2(gross * ESI_EMPLOYEE) : 0;
  const pt = structure.pt_enabled ? professionalTax(gross) : 0;
  const tds = round2((annualTax || 0) / 12);
  const custom = comps.filter((c) => c.type === 'deduction').map((c) => {
    const v = Number(c.value) || 0;
    const amt = c.calc === 'percent_basic' ? basic * (v / 100) : c.calc === 'percent_ctc' ? monthly * (v / 100) * factor : v;
    return { code: c.code, name: c.name, type: 'deduction', amount: round2(amt) };
  });
  const statutory = [
    pf && { code: 'PF', name: 'Provident fund (employee)', type: 'deduction', amount: pf },
    esi && { code: 'ESI', name: 'ESI (employee)', type: 'deduction', amount: esi },
    pt && { code: 'PT', name: 'Professional tax', type: 'deduction', amount: pt },
    tds && { code: 'TDS', name: 'Income tax (TDS)', type: 'deduction', amount: tds },
  ].filter(Boolean);
  const deductions = [...statutory, ...custom];
  const totalDeductions = round2(deductions.reduce((a, l) => a + l.amount, 0));
  const employer = {
    pf: structure.pf_enabled ? round2(0.12 * Math.min(basic, cap)) : 0,
    esi: esiApplies ? round2(gross * ESI_EMPLOYER) : 0,
    gratuity: structure.gratuity_in_ctc ? round2(basic * GRATUITY) : 0,
  };
  const hra = lines.find((l) => l.code === 'HRA')?.amount || 0;
  return {
    structure: structure.name, lines: [...lines, ...deductions], employer, warnings,
    basic, hra, special: round2(gross - basic - hra), gross, pf, esi, pt, tds,
    total_deductions: totalDeductions, net: round2(gross - totalDeductions), monthly_ctc: round2(monthly),
  };
}

/** Validates and normalises a component list from the API. */
export function cleanComponents(list, httpError) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Add at least one component');
  const seen = new Set();
  const out = list.map((c, i) => {
    const name = String(c.name || '').trim();
    const code = String(c.code || name).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 20);
    if (!name || !code) throw httpError(400, 'Every component needs a name');
    if (seen.has(code)) throw httpError(400, `Component code ${code} is used twice`);
    seen.add(code);
    const type = c.type === 'deduction' ? 'deduction' : 'earning';
    const calc = CALCS.includes(c.calc) ? c.calc : 'fixed';
    if (type === 'deduction' && calc === 'balance') throw httpError(400, 'A deduction cannot be the balancing component');
    const value = calc === 'balance' ? 0 : Number(c.value);
    if (!Number.isFinite(value) || value < 0) throw httpError(400, `${name}: enter a valid amount or percentage`);
    if (calc.startsWith('percent') && value > 100) throw httpError(400, `${name}: percentage cannot exceed 100`);
    if (['PF', 'ESI', 'PT', 'TDS'].includes(code)) throw httpError(400, `${code} is calculated automatically; use another code`);
    return { name: name.slice(0, 60), code, type, calc, value, taxable: c.taxable === 0 || c.taxable === false ? 0 : 1, sort: i };
  });
  const earnings = out.filter((c) => c.type === 'earning');
  if (!earnings.some((c) => c.code === 'BASIC')) throw httpError(400, 'A structure needs a Basic component (code BASIC)');
  if (earnings.find((c) => c.code === 'BASIC').calc === 'percent_basic' || earnings.find((c) => c.code === 'BASIC').calc === 'balance') throw httpError(400, 'Basic must be a % of CTC or a fixed amount');
  if (earnings.filter((c) => c.calc === 'balance').length > 1) throw httpError(400, 'Only one component can be the balancing figure');
  return out;
}
