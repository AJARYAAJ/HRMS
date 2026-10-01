import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db, migrate, resetDb, insert, run, get, all, tx } from './db.js';
import { ymd, pad, isWeekend, parseDate, computePayslip, monthRange, workingDaysBetween, ensureLeaveBalances } from './utils.js';
import { createTasks } from './routes/employees.js';
import { classifier, rollupDay, evaluateAlerts } from './routes/activity.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from './uploads.js';
import { buildPdf } from './pdf.js';

function seedFile(entity, entityId, name, buffer, uploadedBy) {
  const stored = `${crypto.randomUUID()}${path.extname(name)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buffer);
  insert('attachments', { entity, entity_id: entityId, stored_name: stored, original_name: name, mime_type: 'application/pdf', size: buffer.length, uploaded_by: uploadedBy });
}

// Deterministic PRNG so every fresh install gets the same demo data.
let s = 42;
const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => Math.floor(a + rand() * (b - a + 1));

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const time = (h, m) => `${pad(h)}:${pad(m)}`;

export const DEMO_PASSWORD = 'Password@123';

const DEPARTMENTS = [
  ['Engineering', 'ENG', 'Builds and runs the product platform'],
  ['Product', 'PRD', 'Product strategy and roadmap'],
  ['Design', 'DSN', 'User experience and visual design'],
  ['Sales', 'SLS', 'New business and account growth'],
  ['Marketing', 'MKT', 'Brand, content and demand generation'],
  ['Human Resources', 'HR', 'People operations, talent and culture'],
  ['Finance', 'FIN', 'Accounting, payroll and compliance'],
  ['Customer Success', 'CS', 'Onboarding and support for customers'],
];
const DESIGNATIONS = [
  ['Chief Executive Officer', 'L8'], ['HR Manager', 'L5'], ['Engineering Manager', 'L6'], ['Software Engineer', 'L2'],
  ['Senior Software Engineer', 'L3'], ['Tech Lead', 'L4'], ['QA Engineer', 'L2'], ['DevOps Engineer', 'L3'],
  ['Product Manager', 'L4'], ['UI/UX Designer', 'L3'], ['Sales Executive', 'L2'], ['Sales Manager', 'L5'],
  ['Marketing Specialist', 'L2'], ['Marketing Manager', 'L5'], ['HR Executive', 'L2'], ['Accountant', 'L2'],
  ['Finance Manager', 'L5'], ['Customer Success Manager', 'L3'], ['Support Engineer', 'L2'], ['Data Analyst', 'L3'],
];
const LOCATIONS = [
  ['Bengaluru HQ', 'Bengaluru', 'Karnataka', 'Outer Ring Road, Bellandur'],
  ['Mumbai Office', 'Mumbai', 'Maharashtra', 'Bandra Kurla Complex'],
  ['Pune Office', 'Pune', 'Maharashtra', 'Hinjewadi Phase 1'],
  ['Remote', 'Remote', '-', 'Work from anywhere'],
];
const FIRST = ['Aditya', 'Neha', 'Vikram', 'Sneha', 'Karan', 'Pooja', 'Arjun', 'Kavya', 'Rahul', 'Divya', 'Siddharth', 'Meera',
  'Nikhil', 'Isha', 'Varun', 'Riya', 'Manish', 'Tanvi', 'Harsh', 'Aishwarya', 'Gaurav', 'Shreya', 'Kunal', 'Nisha', 'Amit',
  'Pallavi', 'Yash', 'Sakshi', 'Rajesh', 'Deepika', 'Suresh', 'Anjali', 'Mohit', 'Swati', 'Abhishek', 'Ritika'];
const LAST = ['Verma', 'Gupta', 'Reddy', 'Patel', 'Singh', 'Kulkarni', 'Joshi', 'Menon', 'Rao', 'Chopra', 'Desai', 'Bose',
  'Pillai', 'Kapoor', 'Agarwal', 'Shetty', 'Bhat', 'Malhotra', 'Saxena', 'Mishra'];

const HOLIDAYS = [
  ['New Year', '2026-01-01', 'Optional'], ['Republic Day', '2026-01-26', 'Public'], ['Holi', '2026-03-04', 'Public'],
  ['Good Friday', '2026-04-03', 'Public'], ['May Day', '2026-05-01', 'Public'], ['Independence Day', '2026-08-15', 'Public'],
  ['Raksha Bandhan', '2026-08-28', 'Optional'], ['Ganesh Chaturthi', '2026-09-14', 'Public'], ['Gandhi Jayanti', '2026-10-02', 'Public'],
  ['Dussehra', '2026-10-20', 'Public'], ['Diwali', '2026-11-09', 'Public'], ['Guru Nanak Jayanti', '2026-11-24', 'Optional'],
  ['Christmas', '2026-12-25', 'Public'], ['New Year', '2027-01-01', 'Optional'], ['Republic Day', '2027-01-26', 'Public'],
];

const APPS = {
  Engineering: [['VS Code', 'productive'], ['GitHub', 'productive'], ['Terminal', 'productive'], ['Jira', 'productive'], ['Slack', 'neutral'], ['YouTube', 'unproductive']],
  Product: [['Jira', 'productive'], ['Confluence', 'productive'], ['Figma', 'productive'], ['Google Meet', 'neutral'], ['Slack', 'neutral'], ['LinkedIn', 'unproductive']],
  Design: [['Figma', 'productive'], ['Adobe Illustrator', 'productive'], ['Miro', 'productive'], ['Slack', 'neutral'], ['Instagram', 'unproductive']],
  Sales: [['Salesforce', 'productive'], ['Gmail', 'productive'], ['Zoom', 'productive'], ['LinkedIn', 'neutral'], ['WhatsApp Web', 'neutral'], ['YouTube', 'unproductive']],
  default: [['Google Sheets', 'productive'], ['Gmail', 'productive'], ['Google Docs', 'productive'], ['Slack', 'neutral'], ['Google Meet', 'neutral'], ['News sites', 'unproductive']],
};

export function seed({ reset = true } = {}) {
  s = 42;
  if (reset) {
    resetDb();
    for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
  } else migrate();
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today);
  const year = today.getFullYear();

  tx(() => {
    const settings = {
      company_name: 'Nimbus Technologies Pvt. Ltd.', company_short: 'Nimbus', company_email: 'people@nimbus.example',
      company_phone: '+91 80 4000 1234', company_address: 'Outer Ring Road, Bellandur, Bengaluru 560103',
      company_pan: 'AABCN1234F', company_tan: 'BLRN01234E', currency: 'INR', timezone: 'Asia/Kolkata',
      week_off: 'Saturday, Sunday', fy_start: 'April', payroll_day: '28',
      notice_period_days: '60', probation_days: '90', optional_holiday_limit: '2', carry_forward_cap: '30', geofence_mode: 'flag',
      payroll_basic_pct: '50', payroll_hra_pct: '40', screenshots_enabled: '1', screenshot_interval_mins: '10',
    };
    for (const [k, v] of Object.entries(settings)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, v);

    const dept = Object.fromEntries(DEPARTMENTS.map(([name, code, description]) => [name, insert('departments', { name, code, description })]));
    // Onboarding / offboarding checklists: a default per type plus one tailored to Engineering.
    const template = (name, type, tasks, o = {}) => {
      const id = insert('onboarding_templates', { name, type, ...o });
      tasks.forEach(([title, category, offset_days], sort) => insert('onboarding_template_tasks', { template_id: id, title, category, offset_days, sort }));
      return id;
    };
    const baseOnboarding = [
      ['Send offer letter & collect signed copy', 'HR', -7], ['Verify pre-boarding documents', 'HR', -3],
      ['Provision laptop & accessories', 'IT', 0], ['Create email, Slack and SSO accounts', 'IT', 0],
      ['Welcome session and office tour', 'Buddy', 0], ['Complete your profile and bank details', 'Employee', 1],
      ['Read and acknowledge company policies', 'Employee', 3], ['Team introduction and first 1:1', 'Manager', 1],
      ['Complete POSH & information security training', 'Learning', 7], ['Set 30-60-90 day goals', 'Manager', 14],
      ['30-day check-in', 'Manager', 30], ['Probation review', 'Manager', 90],
    ];
    template('Standard onboarding', 'onboarding', baseOnboarding, { is_default: 1 });
    template('Engineering onboarding', 'onboarding', [
      ...baseOnboarding.slice(0, 5), ['Set up development environment', 'Employee', 1], ['Codebase walkthrough', 'Buddy', 2],
      ['First pull request merged', 'Employee', 10], ...baseOnboarding.slice(5),
    ], { department_id: dept.Engineering });
    template('Standard offboarding', 'offboarding', [
      ['Accept resignation & confirm last working day', 'HR', 0], ['Knowledge transfer to team', 'Manager', 7],
      ['Recover laptop and company assets', 'IT', 0], ['Revoke system access', 'IT', 0], ['Exit interview', 'HR', 0],
      ['Full & final settlement', 'Finance', 30], ['Issue relieving & experience letter', 'HR', 30],
    ], { is_default: 1 });
    const desig = Object.fromEntries(DESIGNATIONS.map(([title, level]) => [title, insert('designations', { title, level })]));
    // Office coordinates drive geofenced clock-in (Remote has none).
    const COORDS = { 'Bengaluru HQ': [12.9256, 77.6762], 'Mumbai Office': [19.0660, 72.8691], 'Pune Office': [18.5913, 73.7389] };
    const loc = LOCATIONS.map(([name, city, state, address]) => insert('locations', {
      name, city, state, address, latitude: COORDS[name]?.[0] ?? null, longitude: COORDS[name]?.[1] ?? null, radius_m: COORDS[name] ? 300 : null,
    }));
    // A group with two legal entities; payroll runs and payslips are per company.
    const mainCo = insert('companies', {
      name: 'Nimbus Technologies', legal_name: 'Nimbus Technologies Pvt. Ltd.', pan: 'AABCN1234F', tan: 'BLRN01234E', gstin: '29AABCN1234F1Z5',
      pf_code: 'KNBNG0012345000', esi_code: '53000123450001001', address: 'Outer Ring Road, Bellandur, Bengaluru 560103', city: 'Bengaluru', state: 'Karnataka',
    });
    const digitalCo = insert('companies', {
      name: 'Nimbus Digital Services', legal_name: 'Nimbus Digital Services LLP', pan: 'AAKFN5678Q', tan: 'PNEN05678D', gstin: '27AAKFN5678Q1Z2',
      pf_code: 'PUPUN0067890000', esi_code: '33000678900001002', address: 'Hinjewadi Phase 1, Pune 411057', city: 'Pune', state: 'Maharashtra',
    });
    const general = insert('shifts', { name: 'General', start_time: '09:30', end_time: '18:30', grace_minutes: 15 });
    insert('shifts', { name: 'Early', start_time: '07:00', end_time: '16:00', grace_minutes: 10 });
    const late = insert('shifts', { name: 'US Overlap', start_time: '13:00', end_time: '22:00', grace_minutes: 15 });

    [['Casual Leave', 'CL', 12, 1, 0, '#6366f1'], ['Sick Leave', 'SL', 10, 1, 0, '#f43f5e'], ['Earned Leave', 'EL', 18, 1, 1, '#10b981'],
      ['Work From Home', 'WFH', 24, 1, 0, '#0ea5e9'], ['Comp Off', 'CO', 5, 1, 0, '#f59e0b'], ['Loss of Pay', 'LOP', 0, 0, 0, '#64748b'],
      ['Maternity Leave', 'ML', 0, 1, 0, '#ec4899'], ['Paternity Leave', 'PL', 0, 1, 0, '#8b5cf6']]
      .forEach(([name, code, annual_quota, paid, carry_forward, color]) => insert('leave_types', { name, code, annual_quota, paid, carry_forward, color }));

    // ---------- salary structures ----------
    const structure = (name, description, o, comps) => {
      const id = insert('salary_structures', { name, description, ...o });
      comps.forEach(([cname, code, type, calc, value], sort) => insert('salary_components', { structure_id: id, name: cname, code, type, calc, value, taxable: 1, sort }));
      return id;
    };
    structure('Standard', 'Gross equals CTC; employer contributions paid on top', { is_default: 1, pf_employer_in_ctc: 0, gratuity_in_ctc: 0 }, [
      ['Basic', 'BASIC', 'earning', 'percent_ctc', 50], ['House rent allowance', 'HRA', 'earning', 'percent_basic', 40], ['Special allowance', 'SPECIAL', 'earning', 'balance', 0],
    ]);
    const ctcStructure = structure('CTC incl. employer PF & gratuity', 'Sales and field roles: employer PF and gratuity are carved out of CTC', { pf_employer_in_ctc: 1, gratuity_in_ctc: 1 }, [
      ['Basic', 'BASIC', 'earning', 'percent_ctc', 40], ['House rent allowance', 'HRA', 'earning', 'percent_basic', 50], ['Conveyance allowance', 'CONV', 'earning', 'fixed', 1600],
      ['Medical allowance', 'MED', 'earning', 'fixed', 1250], ['Leave travel allowance', 'LTA', 'earning', 'percent_basic', 8.33], ['Special allowance', 'SPECIAL', 'earning', 'balance', 0],
      ['Group health insurance', 'GHI', 'deduction', 'fixed', 450],
    ]);

    // ---------- policies: plans that are assigned to employees (Keka-style) ----------
    const lt = Object.fromEntries(all('SELECT id, code FROM leave_types').map((t) => [t.code, t.id]));
    const rule = (plan_id, code, annual_quota, o = {}) => insert('leave_plan_rules', {
      plan_id, leave_type_id: lt[code], annual_quota, accrual: 'yearly', carry_forward_cap: 0, encashable: 0, allow_half_day: 1,
      min_notice_days: 0, probation_allowed: 1, sandwich: 0, ...o,
    });
    const stdPlan = insert('leave_plans', { name: 'Standard leave plan', description: 'Full-time employees', is_default: 1 });
    rule(stdPlan, 'CL', 12, { max_consecutive: 3 });
    rule(stdPlan, 'SL', 10);
    rule(stdPlan, 'EL', 18, { carry_forward_cap: 30, encashable: 1, min_notice_days: 7, probation_allowed: 0, sandwich: 1, allow_half_day: 0 });
    rule(stdPlan, 'WFH', 24);
    rule(stdPlan, 'CO', 0, { accrual: 'none' });
    rule(stdPlan, 'LOP', 0, { accrual: 'none' });
    rule(stdPlan, 'ML', 182, { gender: 'Female', allow_half_day: 0, probation_allowed: 0, min_notice_days: 30 });
    rule(stdPlan, 'PL', 5, { gender: 'Male', allow_half_day: 0 });
    const internPlan = insert('leave_plans', { name: 'Interns & contract staff', description: 'Monthly accrual, no earned leave' });
    rule(internPlan, 'CL', 12, { accrual: 'monthly' });
    rule(internPlan, 'SL', 6);
    rule(internPlan, 'WFH', 12);
    rule(internPlan, 'CO', 0, { accrual: 'none' });
    rule(internPlan, 'LOP', 0, { accrual: 'none' });

    const karnataka = insert('holiday_lists', { name: 'India – Karnataka', description: 'Bengaluru HQ and remote employees', optional_limit: 2, is_default: 1 });
    const maharashtra = insert('holiday_lists', { name: 'India – Maharashtra', description: 'Mumbai and Pune offices', optional_limit: 2 });
    for (const [name, date, type] of HOLIDAYS) insert('holidays', { name, date, type, list_id: karnataka });
    for (const [name, date, type] of [...HOLIDAYS.filter(([n]) => n !== 'May Day'), ['Gudi Padwa', '2026-03-19', 'Public'], ['Maharashtra Day', '2026-05-01', 'Public']]) {
      insert('holidays', { name, date, type, list_id: maharashtra });
    }
    run('UPDATE locations SET holiday_list_id = ? WHERE id IN (?, ?)', maharashtra, loc[1], loc[2]);

    insert('weekly_off_policies', { name: 'Saturday & Sunday off', description: 'Five-day week', pattern: JSON.stringify({ 0: 'all', 6: 'all' }), is_default: 1 });
    insert('weekly_off_policies', { name: 'Sunday + 2nd & 4th Saturday off', description: 'Alternate Saturdays working (support and operations)', pattern: JSON.stringify({ 0: 'all', 6: '2,4' }) });

    insert('attendance_policies', {
      name: 'Office – standard', description: 'Web, remote and field clock-in; 3 late marks = ½ day casual leave', allow_web: 1, allow_remote: 1, allow_field: 1,
      late_penalty_every: 3, late_penalty_days: 0.5, penalty_leave_type_id: lt.CL, max_regularizations: 4, overtime_allowed: 1, overtime_min_minutes: 30, is_default: 1,
    });
    const fieldAtt = insert('attendance_policies', {
      name: 'Field sales', description: 'Remote or field clock-in only, no geofence, 30 min grace', allow_web: 0, allow_remote: 1, allow_field: 1,
      geofence_mode: 'off', grace_minutes: 30, late_penalty_every: 0, late_penalty_days: 0.5, overtime_allowed: 0, overtime_min_minutes: 30,
    });

    const cat = (policy_id, name, kind, o = {}) => insert('expense_categories', { policy_id, name, kind, ...o });
    const stdExp = insert('expense_policies', { name: 'Standard expense policy', description: 'Limits for all employees', is_default: 1 });
    cat(stdExp, 'Travel', 'amount', { per_claim_limit: 10000, receipt_above: 500 });
    cat(stdExp, 'Local conveyance', 'mileage', { rate: 12, monthly_limit: 6000 });
    cat(stdExp, 'Outstation per diem', 'per_diem', { rate: 1500 });
    cat(stdExp, 'Food & Meals', 'amount', { per_claim_limit: 5000, receipt_above: 300 });
    cat(stdExp, 'Internet', 'amount', { monthly_limit: 1500 });
    cat(stdExp, 'Client Entertainment', 'amount', { per_claim_limit: 5000, receipt_above: 0 });
    cat(stdExp, 'Office Supplies', 'amount', { per_claim_limit: 5000, receipt_above: 1000 });
    cat(stdExp, 'Training', 'amount', { per_claim_limit: 25000, receipt_above: 0 });
    cat(stdExp, 'Relocation', 'amount', { per_claim_limit: 50000, receipt_above: 0 });
    cat(stdExp, 'Other', 'amount', { per_claim_limit: 5000, receipt_above: 1000 });
    const salesExp = insert('expense_policies', { name: 'Sales & field', description: 'Higher travel and client limits for the sales team' });
    cat(salesExp, 'Travel', 'amount', { per_claim_limit: 25000, receipt_above: 1000 });
    cat(salesExp, 'Local conveyance', 'mileage', { rate: 14, monthly_limit: 12000 });
    cat(salesExp, 'Outstation per diem', 'per_diem', { rate: 2000 });
    cat(salesExp, 'Food & Meals', 'amount', { per_claim_limit: 5000, receipt_above: 500 });
    cat(salesExp, 'Internet', 'amount', { monthly_limit: 2000 });
    cat(salesExp, 'Client Entertainment', 'amount', { per_claim_limit: 15000, receipt_above: 0 });
    cat(salesExp, 'Other', 'amount', { per_claim_limit: 5000, receipt_above: 1000 });

    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
    let code = 1001;
    const mk = (e) => insert('employees', {
      company_id: e.location_id === loc[2] || ['Customer Success', 'Marketing'].includes(Object.keys(dept).find((k) => dept[k] === e.department_id)) ? digitalCo : mainCo,
      confirmation_status: 'confirmed', tax_regime: 'new',
      emp_code: `EMP${code++}`, password_hash: hash, shift_id: general, location_id: loc[0], employment_type: 'Full-time',
      status: 'active', avatar_color: pick(colors), gender: pick(['Male', 'Female']), blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
      marital_status: pick(['Single', 'Married']), phone: `+91 9${between(100000000, 999999999)}`,
      pan: `${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))}CPK${between(1000, 9999)}${String.fromCharCode(65 + between(0, 25))}`,
      uan: `10${between(1000000000, 9999999999)}`, bank_name: pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank']),
      bank_account: `${between(10000000, 99999999)}${between(1000, 9999)}`, ifsc: pick(['HDFC0001234', 'ICIC0004321', 'SBIN0005678', 'UTIB0000999']),
      address: `${between(1, 400)}, ${pick(['MG Road', 'Indiranagar', 'Koramangala', 'HSR Layout', 'Whitefield', 'Jayanagar'])}, Bengaluru`,
      emergency_contact: `${pick(FIRST)} ${pick(LAST)} · +91 98${between(10000000, 99999999)}`,
      date_of_birth: `${between(1978, 2001)}-${pad(between(1, 12))}-${pad(between(1, 28))}`,
      ...e,
    });

    const ceo = mk({ first_name: 'Aarav', last_name: 'Sharma', email: 'admin@peoplehub.demo', role: 'admin', gender: 'Male',
      department_id: null, designation_id: desig['Chief Executive Officer'], date_of_joining: '2018-04-02', annual_ctc: 6000000 });
    const hr = mk({ first_name: 'Priya', last_name: 'Nair', email: 'hr@peoplehub.demo', role: 'hr', gender: 'Female', manager_id: ceo,
      department_id: dept['Human Resources'], designation_id: desig['HR Manager'], date_of_joining: '2019-06-10', annual_ctc: 2200000 });
    const engMgr = mk({ first_name: 'Rohan', last_name: 'Mehta', email: 'manager@peoplehub.demo', role: 'manager', gender: 'Male', manager_id: ceo,
      department_id: dept.Engineering, designation_id: desig['Engineering Manager'], date_of_joining: '2019-01-14', annual_ctc: 3600000 });
    const emp = mk({ first_name: 'Ananya', last_name: 'Iyer', email: 'employee@peoplehub.demo', role: 'employee', gender: 'Female', manager_id: engMgr,
      department_id: dept.Engineering, designation_id: desig['Software Engineer'], date_of_joining: '2023-07-03', annual_ctc: 1400000,
      date_of_birth: `1998-${pad(today.getMonth() + 1)}-${pad(Math.min(28, today.getDate() + 3))}` });
    run('UPDATE departments SET head_id = ? WHERE id = ?', engMgr, dept.Engineering);
    run('UPDATE departments SET head_id = ? WHERE id = ?', hr, dept['Human Resources']);

    const heads = {};
    const headSpec = [
      ['Product', 'Product Manager'], ['Design', 'UI/UX Designer'], ['Sales', 'Sales Manager'], ['Marketing', 'Marketing Manager'],
      ['Finance', 'Finance Manager'], ['Customer Success', 'Customer Success Manager'],
    ];
    for (const [d, title] of headSpec) {
      heads[d] = mk({ first_name: pick(FIRST), last_name: pick(LAST), email: `${d.toLowerCase().replace(/\s+/g, '.')}.head@peoplehub.demo`,
        role: 'manager', manager_id: ceo, department_id: dept[d], designation_id: desig[title], location_id: pick(loc.slice(0, 3)),
        date_of_joining: `${between(2018, 2021)}-${pad(between(1, 12))}-${pad(between(1, 28))}`, annual_ctc: between(26, 38) * 100000 });
      run('UPDATE departments SET head_id = ? WHERE id = ?', heads[d], dept[d]);
    }
    heads.Engineering = engMgr;
    heads['Human Resources'] = hr;

    const roster = [
      ['Engineering', ['Senior Software Engineer', 'Software Engineer', 'Tech Lead', 'QA Engineer', 'DevOps Engineer', 'Data Analyst'], 10],
      ['Product', ['Product Manager', 'Data Analyst'], 2], ['Design', ['UI/UX Designer'], 2], ['Sales', ['Sales Executive'], 4],
      ['Marketing', ['Marketing Specialist'], 3], ['Human Resources', ['HR Executive'], 2], ['Finance', ['Accountant'], 2],
      ['Customer Success', ['Support Engineer', 'Customer Success Manager'], 4],
    ];
    const used = new Set();
    for (const [d, titles, n] of roster) {
      for (let i = 0; i < n; i++) {
        let fn, ln;
        do { fn = pick(FIRST); ln = pick(LAST); } while (used.has(fn + ln));
        used.add(fn + ln);
        const recent = rand() < 0.12;
        const doj = recent ? ymd(addDays(today, -between(3, 40))) : `${between(2020, 2025)}-${pad(between(1, 12))}-${pad(between(1, 28))}`;
        const title = pick(titles);
        mk({
          first_name: fn, last_name: ln, email: `${fn}.${ln}@peoplehub.demo`.toLowerCase(), role: 'employee', manager_id: heads[d],
          department_id: dept[d], designation_id: desig[title], location_id: pick(loc), date_of_joining: doj,
          shift_id: d === 'Customer Success' && rand() < 0.5 ? late : general,
          employment_type: rand() < 0.1 ? 'Contract' : rand() < 0.05 ? 'Intern' : 'Full-time',
          status: rand() < 0.04 ? 'on_notice' : 'active',
          annual_ctc: title.includes('Senior') || title.includes('Lead') ? between(22, 34) * 100000 : between(6, 18) * 100000,
        });
      }
    }
    // A few past exits for attrition reporting.
    for (let i = 0; i < 3; i++) {
      mk({ first_name: pick(FIRST), last_name: pick(LAST), email: `former${i + 1}@peoplehub.demo`, role: 'employee', manager_id: heads.Sales,
        department_id: dept.Sales, designation_id: desig['Sales Executive'], date_of_joining: '2022-02-01', status: 'exited',
        exit_date: ymd(addDays(today, -between(30, 200))), annual_ctc: 700000 });
    }

    run('UPDATE employees SET attendance_policy_id = ?, expense_policy_id = ?, salary_structure_id = ? WHERE department_id = ?', fieldAtt, salesExp, ctcStructure, dept.Sales);
    run("UPDATE employees SET leave_plan_id = ? WHERE employment_type IN ('Contract', 'Intern')", internPlan);
    const emps = all("SELECT e.*, d.name AS dept FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'");
    for (const e of emps) {
      ensureLeaveBalances(e.id, year);
      if (e.date_of_joining >= ymd(addDays(today, -45))) createTasks(e.id, 'onboarding', e.date_of_joining);
      // Anyone who joined in the last 6 months is still on probation (90 days by default, some extended).
      if (e.date_of_joining >= ymd(addDays(today, -180))) {
        const end = addDays(new Date(`${e.date_of_joining}T00:00:00`), 90);
        run("UPDATE employees SET probation_end_date = ?, confirmation_status = ? WHERE id = ?", ymd(end), end < today ? 'extended' : 'probation', e.id);
        if (end < today) run('UPDATE employees SET probation_end_date = ? WHERE id = ?', ymd(addDays(today, 12)), e.id);
      }
      if (e.status === 'on_notice') {
        run('UPDATE employees SET exit_date = ? WHERE id = ?', ymd(addDays(today, between(10, 50))), e.id);
        createTasks(e.id, 'offboarding', ymd(addDays(today, -5)));
      }
    }
    // Mark some onboarding tasks done so progress looks realistic.
    run("UPDATE onboarding_tasks SET done = 1 WHERE due_date < ? AND id % 3 != 0", todayStr);

    // ---------- attendance (last 75 days) and productivity (last 21 days) ----------
    const holidaySet = new Set(HOLIDAYS.filter((h) => h[2] !== 'Optional').map((h) => h[1]));
    const attStmt = db.prepare('INSERT INTO attendance (employee_id, date, clock_in, clock_out, status, work_mode, late) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const prodStmt = db.prepare('INSERT INTO productivity (employee_id, date, productive_mins, neutral_mins, unproductive_mins, idle_mins, top_apps) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const e of emps) {
      const start = e.shift_id === late ? 13 * 60 : 9 * 60 + 30;
      for (let i = 75; i >= 0; i--) {
        const d = addDays(today, -i);
        const date = ymd(d);
        if (isWeekend(d) || holidaySet.has(date) || date < e.date_of_joining) continue;
        const isToday = i === 0;
        if (isToday && (e.id === emp || rand() < 0.25)) continue; // demo employee clocks in live
        const r = rand();
        if (!isToday && r < 0.04) continue; // absent
        const inMin = start - 20 + between(0, 50);
        const lateFlag = inMin > start + 15 ? 1 : 0;
        const outMin = inMin + (r < 0.07 ? between(240, 300) : between(510, 590));
        const status = isToday ? 'present' : r < 0.07 ? 'half_day' : 'present';
        const mode = e.location_id === loc[3] || rand() < 0.18 ? 'remote' : 'office';
        attStmt.run(e.id, date, time(Math.floor(inMin / 60), inMin % 60), isToday ? null : time(Math.floor(outMin / 60) % 24, outMin % 60), status, mode, lateFlag);
        if (i <= 21 && !isToday) {
          const total = outMin - inMin;
          const idle = between(20, 70);
          const unprod = between(15, 60);
          const neutral = between(60, 120);
          const prod = Math.max(60, total - idle - unprod - neutral);
          const apps = (APPS[e.dept] || APPS.default).map(([name, category]) => ({ name, category, minutes: category === 'productive' ? Math.round(prod / 3.2) + between(0, 30) : category === 'neutral' ? Math.round(neutral / 2) : unprod }));
          prodStmt.run(e.id, date, prod, neutral, unprod, idle, JSON.stringify(apps));
        }
      }
    }

    // ---------- leave requests ----------
    const types = Object.fromEntries(all('SELECT id, code FROM leave_types').map((t) => [t.code, t.id]));
    const addLeave = (employee_id, code, startOffset, len, status, reason) => {
      let d = addDays(today, startOffset);
      while (isWeekend(d)) d = addDays(d, 1);
      let end = d;
      for (let k = 1; k < len; k++) { end = addDays(end, 1); while (isWeekend(end)) end = addDays(end, 1); }
      const start_date = ymd(d), end_date = ymd(end);
      if (get(`SELECT id FROM leave_requests WHERE employee_id = ? AND start_date <= ? AND end_date >= ?`, employee_id, end_date, start_date)) return;
      const days = workingDaysBetween(start_date, end_date, holidaySet);
      if (!days) return;
      const mgr = get('SELECT manager_id FROM employees WHERE id = ?', employee_id).manager_id;
      insert('leave_requests', { employee_id, leave_type_id: types[code], start_date, end_date, days, reason, status, approver_id: status === 'pending' ? null : mgr });
      if (status === 'approved') {
        run('UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?', days, employee_id, types[code], Number(start_date.slice(0, 4)));
        for (let x = parseDate(start_date); x <= parseDate(end_date); x = addDays(x, 1)) {
          if (isWeekend(x) || holidaySet.has(ymd(x))) continue;
          run(`INSERT INTO attendance (employee_id, date, status, work_mode) VALUES (?, ?, 'leave', NULL)
               ON CONFLICT(employee_id, date) DO UPDATE SET status = 'leave', clock_in = NULL, clock_out = NULL, late = 0`, employee_id, ymd(x));
        }
      }
    };
    const reasons = ['Family function', 'Not feeling well', 'Personal work', 'Vacation with family', 'Medical appointment', 'Festival at hometown'];
    for (const e of emps) {
      if (rand() < 0.6) addLeave(e.id, pick(['CL', 'SL', 'EL']), -between(5, 70), between(1, 3), 'approved', pick(reasons));
      if (rand() < 0.25) addLeave(e.id, pick(['CL', 'EL']), between(3, 30), between(1, 4), rand() < 0.5 ? 'pending' : 'approved', pick(reasons));
    }
    addLeave(emp, 'SL', -20, 1, 'approved', 'Fever');
    addLeave(emp, 'EL', 12, 3, 'pending', 'Trip to Goa with family');
    // Make sure someone is on leave today.
    const onLeave = emps.find((e) => e.manager_id === engMgr && e.id !== emp);
    if (onLeave && !isWeekend(today)) addLeave(onLeave.id, 'CL', 0, 1, 'approved', 'Personal work');

    // Regularization requests pending with Rohan.
    const team = emps.filter((e) => e.manager_id === engMgr);
    for (const e of team.slice(0, 3)) {
      let d = addDays(today, -between(2, 8));
      while (isWeekend(d)) d = addDays(d, -1);
      insert('regularizations', { employee_id: e.id, date: ymd(d), clock_in: '09:35', clock_out: '18:40', reason: 'Forgot to clock out', status: 'pending' });
    }

    // ---------- payroll: last 3 months paid ----------
    for (let i = 3; i >= 1; i--) {
      const md = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const month = `${md.getFullYear()}-${pad(md.getMonth() + 1)}`;
      const { start, end } = monthRange(month);
      const wd = workingDaysBetween(start, end, holidaySet);
      for (const companyId of [mainCo, digitalCo]) {
        const runId = insert('payroll_runs', { month, company_id: companyId, status: 'paid', processed_by: hr, processed_at: `${end} 10:00:00`, paid_at: `${end} 18:00:00` });
        let g = 0, dd = 0, n = 0;
        const payees = all(`SELECT * FROM employees WHERE annual_ctc > 0 AND company_id = ? AND date_of_joining <= ? AND (status != 'exited' OR exit_date >= ?)`, companyId, end, start);
        for (const e of payees) {
          const lop = rand() < 0.08 ? between(1, 2) : 0;
          const slip = computePayslip(e.annual_ctc, wd, wd - lop);
          insert('payslips', { run_id: runId, employee_id: e.id, company_id: companyId, month, working_days: wd, paid_days: wd - lop, lop_days: lop, tax_regime: 'new', ...slip });
          g += slip.gross; dd += slip.total_deductions; n += slip.net;
        }
        run('UPDATE payroll_runs SET employees = ?, total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?', payees.length, Math.round(g), Math.round(dd), Math.round(n), runId);
      }
    }
    const fy = today.getMonth() >= 3 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
    insert('tax_declarations', { employee_id: emp, fy, section: '80C', description: 'PPF & ELSS investments', amount: 150000, status: 'approved', approver_id: hr });
    insert('tax_declarations', { employee_id: emp, fy, section: '80D', description: 'Health insurance premium (self & parents)', amount: 25000, status: 'pending' });
    insert('tax_declarations', { employee_id: engMgr, fy, section: 'HRA', description: 'Rent receipts Apr–Mar', amount: 360000, status: 'pending' });

    // ---------- expenses ----------
    const cats = ['Travel', 'Food & Meals', 'Internet', 'Client Entertainment', 'Office Supplies', 'Training'];
    for (let i = 0; i < 18; i++) {
      const e = pick(emps);
      const status = i < 7 ? 'pending' : pick(['approved', 'approved', 'rejected']);
      insert('expenses', { employee_id: i < 3 ? pick(team).id : e.id, category: pick(cats), amount: between(4, 90) * 50, date: ymd(addDays(today, -between(1, 40))),
        description: pick(['Cab to client office', 'Team lunch', 'Monthly broadband', 'Conference ticket', 'Stationery']), status, approver_id: status === 'pending' ? null : e.manager_id });
    }
    insert('expenses', { employee_id: emp, category: 'Internet', amount: 1199, date: ymd(addDays(today, -6)), description: 'Monthly broadband reimbursement', status: 'pending' });

    // ---------- recruitment ----------
    const jobs = [
      ['Senior Backend Engineer (Node.js)', 'Engineering', 0, '4-7 years', 2], ['Frontend Engineer (React)', 'Engineering', 2, '2-4 years', 1],
      ['Product Designer', 'Design', 0, '3-5 years', 1], ['Enterprise Account Executive', 'Sales', 1, '5+ years', 2],
      ['HR Business Partner', 'Human Resources', 0, '4-6 years', 1], ['Content Marketing Lead', 'Marketing', 3, '3-6 years', 1],
    ].map(([title, d, l, experience, openings], i) => insert('job_openings', {
      title, department_id: dept[d], location_id: loc[l], experience, openings, status: i === 5 ? 'on_hold' : 'open', hiring_manager_id: heads[d],
      description: `We are looking for a ${title} to join our ${d} team. You will collaborate across teams, own outcomes end to end and help us scale.`,
      created_at: `${ymd(addDays(today, -between(5, 40)))} 10:00:00`,
    }));
    const stages = ['applied', 'applied', 'screening', 'screening', 'interview', 'interview', 'offer', 'rejected'];
    const companies = ['Infosys', 'TCS', 'Flipkart', 'Swiggy', 'Razorpay', 'Freshworks', 'Zomato', 'Wipro', 'Paytm', 'CRED'];
    const candIds = [];
    for (let i = 0; i < 28; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      candIds.push(insert('candidates', {
        job_id: pick(jobs), name, email: `${name.toLowerCase().replace(' ', '.')}${i}@mail.example`, phone: `+91 9${between(100000000, 999999999)}`,
        source: pick(['LinkedIn', 'Naukri', 'Referral', 'Careers Page', 'Instahyre', 'Agency']), stage: pick(stages), rating: between(2, 5),
        experience_years: between(1, 9), current_company: pick(companies), expected_ctc: between(8, 35) * 100000,
        notes: 'Strong fundamentals, good communication.', created_at: `${ymd(addDays(today, -between(1, 30)))} 11:00:00`,
      }));
    }
    for (const cid of candIds.filter((_, i) => i % 3 === 0)) {
      const future = rand() < 0.5;
      insert('interviews', {
        candidate_id: cid, interviewer_id: pick([engMgr, hr, ...Object.values(heads)]), round: pick(['Technical Round 1', 'Technical Round 2', 'HR Round', 'Culture Fit']),
        scheduled_at: `${ymd(addDays(today, future ? between(0, 7) : -between(1, 10)))}T${pad(between(10, 17))}:00`, mode: pick(['Video', 'In-person', 'Phone']),
        status: future ? 'scheduled' : 'completed', rating: future ? null : between(2, 5), feedback: future ? null : 'Good problem solving; discuss compensation.',
      });
    }

    // ---------- performance ----------
    const cycle = `H${today.getMonth() < 6 ? 1 : 2} ${year}`;
    const goalTitles = ['Ship quarterly roadmap commitments', 'Improve customer NPS by 5 points', 'Reduce production incidents by 30%',
      'Complete AWS certification', 'Mentor a junior team member', 'Automate monthly reporting', 'Grow pipeline by ₹2Cr', 'Launch new onboarding flow'];
    for (const e of emps) {
      for (let k = 0; k < between(2, 3); k++) {
        const progress = between(0, 100);
        insert('goals', { employee_id: e.id, title: pick(goalTitles), description: 'Measured through quarterly check-ins.', category: pick(['Individual', 'Team', 'Company', 'Learning']),
          cycle, progress, weight: pick([20, 25, 30]), due_date: ymd(addDays(today, between(10, 90))),
          status: progress === 100 ? 'completed' : progress < 30 ? pick(['at_risk', 'behind', 'on_track']) : 'on_track' });
      }
      const prevCycle = `H${today.getMonth() < 6 ? 2 : 1} ${today.getMonth() < 6 ? year - 1 : year}`;
      if (e.manager_id && e.date_of_joining < ymd(addDays(today, -200))) {
        insert('reviews', { employee_id: e.id, reviewer_id: e.manager_id, cycle: prevCycle, self_rating: between(3, 5), manager_rating: between(3, 5),
          self_comments: 'Delivered key projects on time.', strengths: 'Ownership, collaboration', improvements: 'Stakeholder communication', status: 'completed' });
      }
    }
    insert('reviews', { employee_id: emp, reviewer_id: engMgr, cycle, status: 'self_review' });
    for (const e of team.filter((x) => x.id !== emp).slice(0, 3)) {
      insert('reviews', { employee_id: e.id, reviewer_id: engMgr, cycle, self_rating: 4, self_comments: 'Owned the payments migration end to end.', status: 'manager_review' });
    }
    const badges = ['🌟 Star Performer', '🤝 Team Player', '🚀 Go-Getter', '💡 Innovator', '🎯 Customer Hero'];
    const msgs = ['Thanks for jumping in on the release weekend!', 'Amazing demo to the client today.', 'Your onboarding docs saved me hours.',
      'Great mentorship this sprint.', 'Closed the quarter with a bang!', 'Brilliant redesign of the dashboard.'];
    for (let i = 0; i < 12; i++) {
      const from = pick(emps), to = pick(emps);
      if (from.id === to.id) continue;
      insert('kudos', { from_id: from.id, to_id: i === 0 ? emp : to.id, badge: pick(badges), message: pick(msgs), created_at: `${ymd(addDays(today, -between(0, 20)))} 12:00:00` });
    }

    // ---------- projects & timesheets ----------
    // Clients (professional services): the organisations projects are delivered for.
    const clientSpecs = [
      ['ShopKart India', 'SKI', 'Retail & e-commerce', 'accounts@shopkart.example', '29AAKCS1234F1Z5', 'Koramangala, Bengaluru 560034', 30, [['Meera Pillai', 'Head of Digital', 'meera.pillai@shopkart.example']]],
      ['FinServe Ltd', 'FSL', 'Financial services', 'ap@finserve.example', '27AABCF5678K1Z2', 'BKC, Mumbai 400051', 45, [['Rajiv Menon', 'CTO', 'rajiv@finserve.example'], ['Sana Qureshi', 'Procurement', 'sana@finserve.example']]],
      ['MediCare Plus', 'MCP', 'Healthcare', 'finance@medicare.example', '07AAFCM4321L1Z9', 'Saket, New Delhi 110017', 30, [['Dr. Vivek Rao', 'COO', 'vivek@medicare.example']]],
      ['GreenGrid Energy', 'GGE', 'Energy', 'billing@greengrid.example', null, 'Hinjawadi, Pune 411057', 60, [['Nisha Kulkarni', 'Programme Director', 'nisha@greengrid.example']]],
      ['Nimbus (internal)', 'INT', 'Internal', null, null, null, 0, []],
    ];
    const clientIds = {};
    for (const [name, code, industry, email, gstin, billing_address, terms, contacts] of clientSpecs) {
      const id = insert('clients', { name, code, industry, email, gstin, billing_address, payment_terms_days: terms, owner_id: engMgr, status: 'active' });
      clientIds[name] = id;
      contacts.forEach(([cname, designation, cemail], i) => insert('client_contacts', { client_id: id, name: cname, designation, email: cemail, is_primary: i === 0 ? 1 : 0 }));
    }
    const projectSpecs = [
      ['Atlas Payments Platform', 'Nimbus (internal)', 'non_billable', 1200, null, 'on_track'],
      ['Retail Mobile App', 'ShopKart India', 'time_materials', 2600, 5500000, 'on_track'],
      ['Data Warehouse Migration', 'FinServe Ltd', 'fixed', 600, 1800000, 'at_risk'],
      ['Customer Portal Revamp', 'MediCare Plus', 'time_materials', 900, 1800000, 'on_track'],
      ['AI Support Assistant', 'Nimbus (internal)', 'non_billable', 500, null, 'on_track'],
    ];
    const projects = projectSpecs.map(([name, client, billing_type, budget_hours, budget_amount, health], i) => insert('projects', {
      name, client, client_id: clientIds[client], code: `PRJ-${101 + i}`, billing_type, budget_hours, budget_amount, health, manager_id: engMgr, status: 'active',
      start_date: ymd(addDays(today, -between(60, 120))), end_date: ymd(addDays(today, between(30, 150))),
    }));
    for (const e of team) {
      for (let i = 13; i >= 1; i--) {
        const d = addDays(today, -i);
        if (isWeekend(d)) continue;
        insert('timesheets', { employee_id: e.id, project_id: pick(projects), date: ymd(d), hours: pick([4, 6, 7, 8, 8, 8]), task: pick(['API development', 'Code review', 'Bug fixes', 'Sprint planning', 'Testing', 'Documentation']),
          billable: rand() < 0.75 ? 1 : 0, status: i <= 3 ? 'pending' : 'approved', approver_id: i <= 3 ? null : engMgr });
      }
    }

    // Project members with bill rates, milestones, allocations, opportunities and invoice history.
    const rates = [2500, 2200, 1800, 1600, 1500, 1400, 1200];
    projects.forEach((pid, pi) => {
      run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role, bill_rate) VALUES (?, ?, ?, ?)', pid, engMgr, 'Project manager', 3000);
      team.forEach((e, ti) => {
        if ((ti + pi) % 2 === 0 || pi === 1) run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role, bill_rate) VALUES (?, ?, ?, ?)', pid, e.id, ti === 0 ? 'Tech lead' : 'Engineer', rates[ti % rates.length]);
      });
    });
    // Everyone who logged time on a project is a member of it.
    run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role, bill_rate) SELECT DISTINCT project_id, employee_id, \'Engineer\', 1500 FROM timesheets WHERE project_id IS NOT NULL');
    const dwh = projects[2];
    [['Discovery & data audit', -50, 450000, 'invoiced'], ['Schema design sign-off', -20, 450000, 'completed'], ['Migration of core ledgers', 25, 600000, 'pending'], ['Cut-over & hypercare', 70, 300000, 'pending']]
      .forEach(([name, due, amount, status]) => insert('project_milestones', { project_id: dwh, name, due_date: ymd(addDays(today, due)), amount, status, completed_on: status !== 'pending' ? ymd(addDays(today, due)) : null }));
    team.forEach((e, i) => {
      if (i === team.length - 1) return; // one engineer on the bench
      insert('resource_allocations', { employee_id: e.id, project_id: projects[1 + (i % 3)], start_date: ymd(addDays(today, -30)), end_date: ymd(addDays(today, 45 + i * 7)), allocation_pct: i === 0 ? 60 : 100, billable: 1, role: i === 0 ? 'Tech lead' : 'Engineer', created_by: engMgr });
      if (i === 0) insert('resource_allocations', { employee_id: e.id, project_id: projects[0], start_date: ymd(addDays(today, -30)), end_date: ymd(addDays(today, 60)), allocation_pct: 40, billable: 0, role: 'Architect', created_by: engMgr });
      if (i === 1) insert('resource_allocations', { employee_id: e.id, project_id: projects[4], start_date: ymd(addDays(today, -10)), end_date: ymd(addDays(today, 20)), allocation_pct: 25, billable: 0, role: 'Advisor', created_by: engMgr }); // overallocated
    });
    const oppSpecs = [
      ['ShopKart loyalty programme', 'ShopKart India', null, 'negotiation', 1800000, 20, 'Existing client'],
      ['FinServe risk dashboard', 'FinServe Ltd', null, 'proposal', 950000, 35, 'Existing client'],
      ['MediCare telehealth app', 'MediCare Plus', null, 'qualified', 3200000, 50, 'Referral'],
      ['GreenGrid IoT analytics', 'GreenGrid Energy', null, 'lead', 2600000, 60, 'Website'],
      ['EduNext LMS rebuild', null, 'EduNext Learning', 'lead', 1400000, 45, 'LinkedIn'],
      ['Urban Mobility booking engine', null, 'Urban Mobility Co.', 'qualified', 2100000, 30, 'Conference'],
      ['FinServe KYC automation', 'FinServe Ltd', null, 'won', 1250000, -12, 'Existing client'],
      ['Lakeside Hotels website', null, 'Lakeside Hotels', 'lost', 600000, -25, 'Website'],
      ['ShopKart warehouse app', 'ShopKart India', null, 'won', 900000, -40, 'Existing client'],
      ['Harbor Logistics tracking', null, 'Harbor Logistics', 'proposal', 1750000, 15, 'Partner'],
      ['PayQuick wallet audit', null, 'PayQuick', 'negotiation', 480000, 8, 'Referral'],
    ];
    const prob = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
    for (const [name, client, prospect, stage, value, closeIn, source] of oppSpecs) {
      insert('opportunities', {
        name, client_id: client ? clientIds[client] : null, prospect, stage, value, probability: prob[stage], source, owner_id: pick([engMgr, ceo]),
        expected_close: ymd(addDays(today, closeIn)), billing_type: stage === 'won' && value < 1000000 ? 'fixed' : 'time_materials',
        closed_on: ['won', 'lost'].includes(stage) ? ymd(addDays(today, closeIn)) : null, lost_reason: stage === 'lost' ? 'Chose a lower-cost vendor' : null,
        notes: `${source} lead. Decision maker engaged.`,
      });
    }
    // Invoice history: paid, part-paid, overdue and recently sent invoices from earlier months.
    let invNo = 1;
    const mkInvoice = (clientName, projectId, daysAgo, lines, status, paidFraction = 0) => {
      const issue = ymd(addDays(today, -daysAgo));
      const terms = clientSpecs.find((c) => c[0] === clientName)[6];
      const subtotal = lines.reduce((a, l) => a + l[1] * l[2], 0);
      const tax = Math.round(subtotal * 0.18 * 100) / 100;
      const total = subtotal + tax;
      const paid = Math.round(total * paidFraction * 100) / 100;
      const id = insert('invoices', {
        number: `INV-${issue.slice(0, 4)}-${String(invNo++).padStart(4, '0')}`, client_id: clientIds[clientName], project_id: projectId, issue_date: issue,
        due_date: ymd(addDays(today, -daysAgo + terms)), status, subtotal, tax_rate: 18, tax_amount: tax, total, amount_paid: paid, created_by: hr,
        sent_at: `${issue} 10:00:00`, period_start: ymd(addDays(today, -daysAgo - 30)), period_end: ymd(addDays(today, -daysAgo - 1)),
      });
      for (const [description, quantity, rate, kind] of lines) insert('invoice_lines', { invoice_id: id, description, quantity, rate, amount: quantity * rate, kind: kind || 'other' });
      if (paid) insert('invoice_payments', { invoice_id: id, amount: paid, date: ymd(addDays(today, -daysAgo + Math.min(terms, 20))), method: 'Bank transfer', reference: `UTR${between(100000000, 999999999)}`, created_by: hr });
      return id;
    };
    mkInvoice('ShopKart India', projects[1], 150, [['Engineering services — sprint 1–4', 320, 2000]], 'paid', 1);
    mkInvoice('ShopKart India', projects[1], 120, [['Engineering services — sprint 5–8', 300, 2000]], 'paid', 1);
    mkInvoice('ShopKart India', projects[1], 90, [['Engineering services — sprint 9–12', 340, 2000]], 'paid', 1);
    mkInvoice('MediCare Plus', projects[3], 75, [['Portal discovery & UX', 120, 1800]], 'paid', 1);
    mkInvoice('ShopKart India', projects[1], 60, [['Engineering services — sprint 13–16', 310, 2000]], 'partially_paid', 0.5);
    const dwhInv = mkInvoice('FinServe Ltd', dwh, 50, [['Milestone: Discovery & data audit', 1, 450000, 'milestone']], 'sent'); // 5 days overdue
    run("UPDATE project_milestones SET invoice_id = ? WHERE project_id = ? AND status = 'invoiced'", dwhInv, dwh);
    mkInvoice('MediCare Plus', projects[3], 35, [['Portal build — iteration 1', 160, 1700]], 'sent', 0); // overdue
    mkInvoice('ShopKart India', projects[1], 20, [['Engineering services — sprint 17–18', 150, 2000]], 'sent', 0);
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('invoice_tax_rate', '18')");
    // History behind those invoices: approved, already-billed time, so project cost and margin are realistic.
    const history = [[projects[1], team.slice(0, 3), 150, 21], [projects[3], team.slice(3, 5), 75, 36]];
    for (const [pid, people, fromDays, toDays] of history) {
      const invs = all('SELECT id, period_start, period_end FROM invoices WHERE project_id = ? ORDER BY period_start', pid);
      for (let i = fromDays; i >= toDays; i--) {
        const d = addDays(today, -i);
        if (isWeekend(d)) continue;
        const day = ymd(d);
        const inv = invs.find((x) => x.period_start <= day && x.period_end >= day);
        for (const e of people) {
          insert('timesheets', { employee_id: e.id, project_id: pid, date: day, hours: 7, task: pick(['Feature development', 'Code review', 'Testing', 'Sprint planning']), billable: 1, status: 'approved', approver_id: engMgr, invoice_id: inv?.id ?? null });
        }
      }
    }

    // ---------- assets ----------
    const assetSpecs = [['MacBook Pro 14"', 'Laptop', 185000], ['Dell Latitude 7440', 'Laptop', 110000], ['LG 27" 4K Monitor', 'Monitor', 32000],
      ['iPhone 15', 'Mobile', 79000], ['Logitech MX Keys', 'Accessory', 11000], ['Jabra Evolve2 Headset', 'Accessory', 18000]];
    let tag = 1;
    for (const e of emps) {
      const [name, category, cost] = e.dept === 'Engineering' || e.dept === 'Design' ? assetSpecs[0] : assetSpecs[1];
      const bought = e.date_of_joining;
      const warranty = ymd(addDays(new Date(`${bought}T00:00:00`), 3 * 365));
      // The demo employee's laptop is waiting for their acknowledgement; everyone else has confirmed receipt.
      const ack = e.id === emp ? null : `${bought}T10:00:00.000Z`;
      const id = insert('assets', { asset_tag: `AST-${String(tag++).padStart(4, '0')}`, name, category, serial_no: `SN${between(100000, 999999)}`, assigned_to: e.id, status: 'assigned',
        purchase_date: bought, cost, warranty_until: warranty, condition: 'good', assigned_on: bought, acknowledged_at: ack });
      insert('asset_history', { asset_id: id, action: 'created', by_id: hr, condition: 'new', created_at: `${bought} 09:00:00` });
      insert('asset_history', { asset_id: id, action: 'assigned', employee_id: e.id, by_id: hr, condition: 'new', created_at: `${bought} 09:30:00` });
      if (ack) insert('asset_history', { asset_id: id, action: 'acknowledged', employee_id: e.id, by_id: e.id, created_at: `${bought} 10:00:00` });
    }
    for (let i = 0; i < 12; i++) {
      const [name, category, cost] = pick(assetSpecs);
      const bought = ymd(addDays(today, -between(30, 1000)));
      const status = pick(['available', 'available', 'in_repair']);
      const id = insert('assets', { asset_tag: `AST-${String(tag++).padStart(4, '0')}`, name, category, serial_no: `SN${between(100000, 999999)}`, assigned_to: null, status,
        purchase_date: bought, cost, warranty_until: ymd(addDays(new Date(`${bought}T00:00:00`), (category === 'Laptop' ? 3 : 1) * 365)), condition: status === 'in_repair' ? 'damaged' : 'good' });
      insert('asset_history', { asset_id: id, action: 'created', by_id: hr, condition: 'new', created_at: `${bought} 09:00:00` });
    }
    insert('asset_requests', { employee_id: emp, category: 'Monitor', reason: 'Second screen for code reviews', needed_by: ymd(addDays(today, 10)), status: 'pending' });
    const reqBy = emps.find((x) => x.dept === 'Design' && x.id !== emp) || emps[5];
    insert('asset_requests', { employee_id: reqBy.id, category: 'Accessory', reason: 'Drawing tablet for illustrations', status: 'approved', approver_id: hr });

    // ---------- biometric terminal ----------
    // Bengaluru staff are enrolled on the reception terminal with their employee number as the device user ID.
    const bioDevice = insert('biometric_devices', {
      name: 'Reception – Bengaluru HQ', serial_no: 'BLR-HQ-01', location_id: loc[0], last_seen_at: new Date().toISOString(),
      key_hash: crypto.createHash('sha256').update(crypto.randomBytes(20)).digest('hex'), key_prefix: 'bio_demo00',
    });
    run("UPDATE employees SET biometric_id = substr(emp_code, 4) WHERE location_id = ? AND status != 'exited'", loc[0]);
    for (const [bid, mins] of [['9001', 0], ['9001', 545]]) {
      const at = new Date(today); at.setHours(9, 12 + mins, 0, 0);
      insert('punch_logs', { device_id: bioDevice, biometric_id: bid, punched_at: `${ymd(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}:00`, verify: 'fingerprint' });
    }

    // ---------- buddies and pre-boarding ----------
    for (const e of emps.filter((x) => x.date_of_joining >= ymd(addDays(today, -60)))) {
      const peer = emps.find((x) => x.dept === e.dept && x.id !== e.id && x.date_of_joining < ymd(addDays(today, -365)) && x.role === 'employee');
      if (peer) run('UPDATE employees SET buddy_id = ? WHERE id = ?', peer.id, e.id);
    }
    const tokenHash = () => crypto.createHash('sha256').update(crypto.randomBytes(24)).digest('hex');
    const engPeer = emps.find((x) => x.dept === 'Engineering' && x.role === 'employee' && x.id !== emp);
    insert('preboarding', {
      name: 'Rhea Kapoor', email: 'rhea.kapoor@example.com', phone: '+91 98450 11223', designation_id: desig['Software Engineer'], department_id: dept.Engineering,
      location_id: loc[0], manager_id: engMgr, buddy_id: engPeer?.id ?? null, date_of_joining: ymd(addDays(today, 14)), annual_ctc: 1400000,
      token_hash: tokenHash(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), status: 'invited', created_by: hr,
    });
    const kabir = insert('preboarding', {
      name: 'Kabir Malhotra', email: 'kabir.malhotra@example.com', phone: '+91 99001 44556', designation_id: desig['Product Manager'] ?? null, department_id: dept.Product,
      location_id: loc[0], manager_id: heads.Product ?? engMgr, date_of_joining: ymd(addDays(today, 5)), annual_ctc: 2200000,
      token_hash: tokenHash(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), status: 'submitted', created_by: hr,
      submitted_at: new Date(Date.now() - 86400000).toISOString(), offer_accepted_at: new Date(Date.now() - 2 * 86400000).toISOString(), offer_signature: 'Kabir Malhotra · 203.0.113.7',
      details: JSON.stringify({
        personal: { date_of_birth: '1994-06-12', gender: 'Male', marital_status: 'Married', blood_group: 'B+', phone: '+91 99001 44556', personal_email: 'kabir.m@example.com' },
        address: { current: '12, 4th Cross, Indiranagar, Bengaluru 560038', permanent: '12, 4th Cross, Indiranagar, Bengaluru 560038' },
        emergency: { name: 'Sara Malhotra', relation: 'Spouse', phone: '+91 99001 77889' },
        bank: { bank_name: 'HDFC Bank', account: '50100234567890', ifsc: 'HDFC0000123', pan: 'ABKPM1234K', uan: '' },
        family: [{ name: 'Sara Malhotra', relation: 'Spouse', date_of_birth: '1995-02-20' }],
      }),
    });
    const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    for (const [type, label] of [['photo', 'photo.png'], ['pan', 'pan.pdf'], ['aadhaar', 'aadhaar.pdf'], ['education', 'degree.pdf'], ['experience', 'relieving-letter.pdf'], ['bank_proof', 'cancelled-cheque.pdf']]) {
      const isPng = label.endsWith('.png');
      const data = isPng ? PNG1 : buildPdf({ title: label.replace('.pdf', '').replace('-', ' '), company: 'Sample document', body: 'Sample document uploaded during pre-boarding (demo data).' });
      const stored = `${crypto.randomUUID()}${isPng ? '.png' : '.pdf'}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), data);
      insert('preboarding_documents', { preboarding_id: kabir, doc_type: type, stored_name: stored, original_name: label, mime_type: isPng ? 'image/png' : 'application/pdf', size: data.length, status: 'pending' });
    }

    // ---------- helpdesk ----------
    const ticketSpecs = [['IT', 'VPN keeps disconnecting', 'high'], ['Payroll', 'Discrepancy in last month TDS', 'medium'], ['HR', 'Need address proof letter', 'low'],
      ['IT', 'Request for second monitor', 'low'], ['Facilities', 'AC not working on 3rd floor', 'medium'], ['Payroll', 'Update bank account details', 'medium'],
      ['HR', 'Clarification on maternity leave policy', 'low'], ['IT', 'Laptop battery draining quickly', 'high']];
    ticketSpecs.forEach(([category, subject, priority], i) => insert('tickets', {
      employee_id: i === 0 ? emp : pick(emps).id, category, subject, priority, description: `${subject}. Please help at the earliest.`,
      status: pick(['open', 'open', 'in_progress', 'resolved']), assignee_id: category === 'IT' ? null : hr, created_at: `${ymd(addDays(today, -between(0, 15)))} 09:45:00`,
    }));

    // ---------- engagement ----------
    [['Welcome to PeopleHub HRMS 🎉', 'All HR processes — attendance, leave, payroll, reimbursements and reviews — now live in one place. Explore the new portal and update your profile.', 'General', 1],
      [`${cycle} performance cycle kicks off`, 'Self-assessments are open. Please complete yours and align goals with your manager within two weeks.', 'Performance', 0],
      ['Diwali celebrations at Bengaluru HQ', 'Join us for rangoli, sweets and a potluck lunch in the cafeteria. Ethnic wear encouraged!', 'Events', 0],
      ['Updated Work From Home policy', 'Employees can now avail up to 2 WFH days per week with manager approval. See Documents → Policies for details.', 'Policy', 0]]
      .forEach(([title, body, category, pinned], i) => insert('announcements', { title, body, category, pinned, author_id: hr, created_at: `${ymd(addDays(today, -i * 4))} 09:00:00` }));
    insert('surveys', { question: 'Which team activity should we plan next month?', options: JSON.stringify(['Offsite trek', 'Bowling night', 'Hackathon', 'Charity drive']), active: 1 });
    insert('surveys', { question: 'How would you rate our new hybrid work setup?', options: JSON.stringify(['Excellent', 'Good', 'Needs improvement']), active: 1 });
    for (const e of emps.slice(0, 20)) run('INSERT OR IGNORE INTO survey_votes (survey_id, employee_id, option_index) VALUES (1, ?, ?)', e.id, between(0, 3));

    const courses = [['Prevention of Sexual Harassment (POSH)', 'Compliance', 1.5, 1], ['Information Security Essentials', 'Compliance', 2, 1],
      ['Effective Communication', 'Soft Skills', 3, 0], ['Leading High-Performing Teams', 'Leadership', 6, 0], ['Advanced React Patterns', 'Technical', 8, 0], ['Negotiation Masterclass', 'Sales', 4, 0]]
      .map(([title, category, duration_hours, mandatory]) => insert('courses', { title, category, duration_hours, mandatory, description: `${title} — self-paced course with quiz and certificate.` }));
    for (const e of emps) {
      for (const c of courses.slice(0, 2)) {
        const progress = pick([0, 40, 100, 100]);
        insert('enrollments', { course_id: c, employee_id: e.id, progress, status: progress === 100 ? 'completed' : progress ? 'in_progress' : 'enrolled' });
      }
    }

    const policies = [
      ['Employee Handbook', 'Policy', 'Code of conduct, working hours, dress code and workplace expectations for all employees.'],
      ['Leave Policy', 'Policy', 'CL 12, SL 10, EL 18 days per year. EL carries forward up to 30 days. Leaves must be applied in advance except sick leave.'],
      ['Work From Home Policy', 'Policy', 'Up to 2 WFH days per week with manager approval. Core collaboration hours are 11:00–16:00 IST.'],
      ['Travel & Reimbursement Policy', 'Policy', 'Claims must be submitted within 30 days with receipts. Domestic travel economy class; hotel cap ₹6,000/night.'],
      ['POSH Policy', 'Compliance', 'Zero tolerance for harassment. Internal Committee contact: ic@nimbus.example.'],
      ['Holiday List 2026', 'Calendar', 'Public and optional holidays for the calendar year 2026.'],
    ];
    const FOLDERS = { Policy: 'HR policies', Compliance: 'Compliance', Calendar: 'Calendars' };
    for (const [title, category, content] of policies) {
      const docId = insert('documents', { title, category, content, employee_id: null, folder: title.startsWith('Travel') ? 'Finance' : FOLDERS[category], review_on: `${year + 1}-03-31` });
      seedFile('documents', docId, `${title.replace(/[^a-z0-9]+/gi, '-')}.pdf`,
        buildPdf({ title, company: settings.company_name, address: settings.company_address, body: `${content}\n\nEffective from 1 April ${year}. Questions? Contact ${settings.company_email}.`, footer: `${settings.company_name} · Confidential` }), hr);
    }
    // A policy only the sales team sees and acknowledges.
    const salesDoc = insert('documents', { title: 'Sales Incentive Plan FY27', category: 'Policy', folder: 'Sales', employee_id: null, requires_ack: 1, audience_type: 'department', audience_ids: JSON.stringify([dept.Sales]),
      content: 'Quarterly incentive slabs, accelerators above 120% of target, and clawback rules.' });
    seedFile('documents', salesDoc, 'Sales-Incentive-Plan.pdf', buildPdf({ title: 'Sales Incentive Plan FY27', company: settings.company_name, body: 'Quarterly incentive slabs, accelerators above 120% of target, and clawback rules.' }), hr);

    // Employee document checklist: required KYC plus documents that expire.
    const dtype = (name, category, required, has_expiry, description) => insert('document_types', { name, category, required, has_expiry, description });
    const T = {
      pan: dtype('PAN card', 'KYC', 1, 0, 'Permanent Account Number card'), aadhaar: dtype('Aadhaar card', 'KYC', 1, 0, 'Front and back'),
      education: dtype('Highest education certificate', 'Education', 1, 0, 'Degree or final marksheet'), bank: dtype('Bank proof', 'Finance', 1, 0, 'Cancelled cheque or statement'),
      passport: dtype('Passport', 'Travel', 0, 1, 'Needed for international travel'), visa: dtype('Work visa', 'Travel', 0, 1, 'For employees travelling on client assignments'),
    };
    for (const e of emps) {
      if (e.id === emp) continue;
      for (const [k, title] of [['pan', 'PAN card'], ['aadhaar', 'Aadhaar card'], ['education', 'Highest education certificate'], ['bank', 'Bank proof']]) {
        if (rand() < 0.08) continue; // a few gaps for the compliance report
        insert('documents', { title, category: 'KYC', employee_id: e.id, content: 'Verified copy on file', doc_type_id: T[k], verification: rand() < 0.9 ? 'verified' : 'pending', verified_by: hr });
      }
    }
    insert('documents', { title: 'PAN card', category: 'KYC', employee_id: emp, content: 'Verified copy on file', doc_type_id: T.pan, verification: 'verified', verified_by: hr });
    insert('documents', { title: 'Bank proof', category: 'Finance', employee_id: emp, content: 'Cancelled cheque', doc_type_id: T.bank, verification: 'verified', verified_by: hr });
    insert('documents', { title: 'Passport', category: 'Travel', employee_id: emp, content: 'Passport N1234567', doc_type_id: T.passport, verification: 'verified', verified_by: hr, expires_on: ymd(addDays(today, 20)) });
    insert('documents', { title: 'Offer Letter', category: 'Personal', content: 'Offer letter for Software Engineer role.', employee_id: emp });
    insert('documents', { title: 'Appraisal Letter FY25', category: 'Personal', content: 'Revised compensation effective April.', employee_id: emp });

    // ---------- exits: resignations for people already serving notice, one pending, an exit interview, an F&F draft ----------
    for (const e of all("SELECT * FROM employees WHERE status = 'on_notice'")) {
      const submitted = ymd(addDays(new Date(`${e.exit_date}T00:00:00`), -60));
      const rid = insert('resignations', { employee_id: e.id, reason: pick(['Better opportunity', 'Higher studies', 'Relocation', 'Personal reasons']), submitted_on: submitted, requested_lwd: e.exit_date, approved_lwd: e.exit_date, notice_days: 60, status: 'approved', approver_id: hr });
      insert('approval_steps', { entity: 'resignations', entity_id: rid, level: 'manager', approver_id: e.manager_id, decision: 'approved' });
      insert('approval_steps', { entity: 'resignations', entity_id: rid, level: 'hr', approver_id: hr, decision: 'approved' });
    }
    const leaver = team.find((e) => e.id !== emp && e.status === 'active');
    if (leaver) {
      insert('resignations', { employee_id: leaver.id, reason: 'Better opportunity', notes: 'Grateful for the learning here.', submitted_on: ymd(addDays(today, -2)), requested_lwd: ymd(addDays(today, 58)), notice_days: 60, status: 'pending' });
    }
    // A past leaver with a completed exit interview and a settled F&F, for exit analytics.
    const formers = all("SELECT * FROM employees WHERE status = 'exited'");
    formers.forEach((f, i) => {
      const rid = insert('resignations', { employee_id: f.id, reason: pick(['Better opportunity', 'Compensation', 'Relocation']), submitted_on: ymd(addDays(new Date(`${f.exit_date}T00:00:00`), -60)), requested_lwd: f.exit_date, approved_lwd: f.exit_date, notice_days: 60, status: 'approved', approver_id: hr });
      insert('exit_interviews', { employee_id: f.id, resignation_id: rid, primary_reason: pick(['Career growth', 'Compensation', 'Relocation', 'Manager relationship']), rating_manager: between(2, 5), rating_culture: between(3, 5), rating_growth: between(2, 4), rating_compensation: between(2, 4), would_recommend: rand() < 0.7 ? 1 : 0, would_return: rand() < 0.5 ? 1 : 0, feedback: 'Good team, but limited growth path in my role.' });
      const gross = f.annual_ctc / 12;
      insert('fnf_settlements', { employee_id: f.id, resignation_id: rid, last_working_day: f.exit_date, salary_days: 12, salary_amount: Math.round((gross / 30) * 12), leave_encash_days: 6, leave_encash_amount: Math.round((gross * 0.5) / 26 * 6), gratuity: 0, bonus: 0, notice_shortfall_days: 0, notice_recovery: 0, loan_recovery: 0, other_deductions: 0, net_payable: Math.round((gross / 30) * 12 + (gross * 0.5) / 26 * 6), status: i === 0 ? 'paid' : 'approved', created_by: hr, paid_at: i === 0 ? `${f.exit_date} 12:00:00` : null });
    });

    // ---------- attendance requests, roster ----------
    const peer = team.find((e) => e.id !== emp && e.id !== leaver?.id) || team[0];
    insert('attendance_requests', { employee_id: peer.id, type: 'wfh', date: ymd(addDays(today, 3)), end_date: ymd(addDays(today, 4)), reason: 'Home internet installation', status: 'pending' });
    let lastWeekend = addDays(today, -1);
    while (!isWeekend(lastWeekend)) lastWeekend = addDays(lastWeekend, -1);
    run(`INSERT OR IGNORE INTO attendance (employee_id, date, clock_in, clock_out, status, work_mode) VALUES (?, ?, '10:00', '15:30', 'present', 'office')`, emp, ymd(lastWeekend));
    insert('attendance_requests', { employee_id: emp, type: 'overtime', date: ymd(addDays(today, -3)), hours: 2, reason: 'Production release support', status: 'approved', approver_id: engMgr });
    const csTeam = emps.filter((e) => e.dept === 'Customer Success');
    const shiftIds = all('SELECT id FROM shifts ORDER BY start_time').map((r) => r.id);
    let monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    csTeam.forEach((e, i) => {
      for (let d = 0; d < 7; d++) {
        const date = ymd(addDays(monday, d));
        if (d >= 5) insert('shift_roster', { employee_id: e.id, date, shift_id: null, week_off: 1 });
        else insert('shift_roster', { employee_id: e.id, date, shift_id: shiftIds[(i + d) % shiftIds.length], week_off: 0 });
      }
    });

    // ---------- loans & travel ----------
    const loanId = insert('loans', { employee_id: emp, type: 'loan', amount: 120000, tenure_months: 12, emi: 10000, outstanding: 90000, reason: 'Home renovation', status: 'approved', approver_id: hr, disbursed_on: ymd(addDays(today, -95)) });
    for (let i = 3; i >= 1; i--) {
      const md = new Date(today.getFullYear(), today.getMonth() - i, 1);
      insert('loan_repayments', { loan_id: loanId, month: `${md.getFullYear()}-${pad(md.getMonth() + 1)}`, amount: 10000 });
    }
    insert('loans', { employee_id: peer.id, type: 'advance', amount: 30000, tenure_months: 2, emi: 15000, outstanding: 30000, reason: 'Medical emergency', status: 'pending' });
    insert('travel_requests', { employee_id: peer.id, purpose: 'Client workshop with ShopKart', from_city: 'Bengaluru', to_city: 'Mumbai', depart_date: ymd(addDays(today, 9)), return_date: ymd(addDays(today, 11)), mode: 'Flight', estimated_cost: 42000, advance_amount: 10000, billable: 1, status: 'pending' });
    insert('travel_requests', { employee_id: engMgr, purpose: 'Quarterly leadership offsite', from_city: 'Bengaluru', to_city: 'Pune', depart_date: ymd(addDays(today, 16)), return_date: ymd(addDays(today, 17)), mode: 'Flight', estimated_cost: 28000, advance_amount: 0, status: 'approved', approver_id: hr });

    // ---------- tasks ----------
    const taskSpecs = ['Write API docs for payouts', 'Fix flaky reconciliation test', 'Design review: onboarding flow', 'Upgrade Node runtime', 'Prepare sprint demo',
      'Customer escalation follow-up', 'Update runbook for on-call', 'Load-test settlement service', 'Refactor auth middleware', 'Accessibility audit of dashboard'];
    taskSpecs.forEach((title, i) => {
      const assignee = i < 4 ? emp : pick(team).id;
      const status = ['todo', 'in_progress', 'review', 'done'][i % 4];
      insert('tasks', { title, project_id: pick(projects), assignee_id: assignee, created_by: engMgr, priority: pick(['low', 'medium', 'high', 'urgent']), status, due_date: ymd(addDays(today, between(-3, 14))), estimate_hours: between(2, 16), completed_at: status === 'done' ? `${todayStr} 10:00:00` : null });
    });

    // ---------- letters, acknowledgements, custom fields, knowledge base ----------
    const LETTERS = [
      ['Offer Letter', 'offer', 'Date: {{today}}\n\nDear {{candidate_name}},\n\nWe are pleased to offer you the position of {{job_title}} at {{company_name}}. Your annual cost to company will be {{offered_ctc}}, and your expected date of joining is {{joining_date}}.\n\nThis offer is subject to satisfactory background verification and submission of the documents listed in your onboarding checklist. You will be on probation for the first 90 days.\n\nPlease sign and return a copy of this letter to confirm your acceptance.\n\nWe look forward to welcoming you to the team.\n\nWarm regards,\nPeople Team\n{{company_name}}'],
      ['Experience Letter', 'experience', 'Date: {{today}}\n\nTO WHOMSOEVER IT MAY CONCERN\n\nThis is to certify that {{employee_name}} (Employee ID {{emp_code}}) worked with {{company_name}} as {{designation}} in the {{department}} department from {{date_of_joining}} to {{last_working_day}}.\n\nDuring this period we found {{first_name}} to be diligent, reliable and a valued member of the team. We wish {{first_name}} every success in future endeavours.\n\nFor {{company_name}}\nAuthorised Signatory'],
      ['Relieving Letter', 'relieving', 'Date: {{today}}\n\nDear {{employee_name}},\n\nThis is to confirm that your resignation has been accepted and you are relieved from your duties as {{designation}} with effect from the close of business on {{last_working_day}}.\n\nYour full and final settlement will be processed as per company policy. We thank you for your contributions and wish you the very best.\n\nFor {{company_name}}\nHuman Resources'],
      ['Salary Certificate', 'salary', 'Date: {{today}}\n\nTO WHOMSOEVER IT MAY CONCERN\n\nThis is to certify that {{employee_name}} (Employee ID {{emp_code}}) is employed with {{company_name}} as {{designation}} since {{date_of_joining}}. The current annual cost to company is {{annual_ctc}} (gross monthly salary {{monthly_gross}}).\n\nThis certificate is issued on the employee\'s request for the purpose of {{purpose}}.\n\nFor {{company_name}}\nAuthorised Signatory'],
      ['Address Proof Letter', 'address', 'Date: {{today}}\n\nTO WHOMSOEVER IT MAY CONCERN\n\nThis is to certify that {{employee_name}} is a permanent employee of {{company_name}}, working as {{designation}} since {{date_of_joining}}, at our office at {{company_address}}.\n\nThis letter is issued for the purpose of {{purpose}}.\n\nFor {{company_name}}\nHuman Resources'],
      ['Confirmation Letter', 'confirmation', 'Date: {{today}}\n\nDear {{employee_name}},\n\nWe are pleased to inform you that you have successfully completed your probation period, and your employment as {{designation}} with {{company_name}} is confirmed with effect from {{probation_end_date}}.\n\nAll other terms of your appointment remain unchanged. Congratulations, and thank you for your contributions so far.\n\nFor {{company_name}}\nHuman Resources'],
    ];
    for (const [name, type, body] of LETTERS) insert('letter_templates', { name, type, body });
    insert('letter_requests', { employee_id: emp, type: 'Salary Certificate', purpose: 'Home loan application', status: 'pending' });
    run("UPDATE documents SET requires_ack = 1 WHERE title IN ('Employee Handbook', 'POSH Policy') AND employee_id IS NULL");
    const handbook = get("SELECT id FROM documents WHERE title = 'Employee Handbook'");
    for (const e of emps.filter((x) => x.id !== emp).slice(0, 22)) run('INSERT OR IGNORE INTO document_acks (document_id, employee_id) VALUES (?, ?)', handbook.id, e.id);
    [['T-shirt size', 'select', JSON.stringify(['XS', 'S', 'M', 'L', 'XL', 'XXL']), 'Personal', 0, 1], ['LinkedIn profile', 'text', null, 'Personal', 0, 1],
      ["Father's name", 'text', null, 'Family', 0, 0], ['Passport number', 'text', null, 'Identity', 0, 0], ['Passport expiry', 'date', null, 'Identity', 0, 0]]
      .forEach(([label, type, options, section, required, editable], i) => insert('custom_fields', { label, field_key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, ''), type, options, section, required, employee_editable: editable, sort_order: i }));
    const tshirt = get("SELECT id FROM custom_fields WHERE field_key = 't_shirt_size'").id;
    for (const e of emps.slice(0, 25)) run('INSERT INTO custom_field_values (employee_id, field_id, value) VALUES (?, ?, ?)', e.id, tshirt, pick(['S', 'M', 'L', 'XL']));
    [['How do I apply for leave?', 'Leave', 'Go to Leave → Apply leave, pick the leave type and dates. Weekends and holidays are excluded automatically. Your manager is notified instantly and you get an email once it is approved.'],
      ['When is salary credited?', 'Payroll', 'Salary is credited on the last working day of the month. Your payslip appears under Payslips & Tax once payroll is marked paid, and you receive an email.'],
      ['How do I claim reimbursements?', 'Expenses', 'Submit a claim under Expenses with a photo or PDF of the bill. Approved claims are paid with your next salary and shown on the payslip as a reimbursement.'],
      ['How do I choose between the old and new tax regime?', 'Payroll', 'Open Payslips & Tax → Tax planner. It compares both regimes using your declarations and recommends the cheaper one. You can switch before the next payroll run.'],
      ['How do I request an experience or salary certificate?', 'Documents', 'Go to Documents → Request a letter. HR generates it from an approved template and you receive the PDF by email and under My documents.'],
      ['What is the notice period?', 'Exit', 'The standard notice period is 60 days. Submit your resignation under Exit; your manager and then HR approve it and your last working day is confirmed.']]
      .forEach(([title, category, body]) => insert('kb_articles', { title, category, body, created_by: hr, views: between(5, 120), helpful: between(1, 40) }));

    // ---------- feedback, 1:1s, social feed, eNPS ----------
    const fbMsgs = ['Your code reviews are thorough and kind — the team levels up because of them.', 'Great ownership of the incident last week; the postmortem was crisp.',
      'Consider sharing progress earlier so blockers surface sooner.', 'The client demo was polished and well-paced.', 'Thanks for mentoring the interns so patiently.'];
    fbMsgs.forEach((message, i) => insert('feedback', { from_id: i === 2 ? engMgr : pick(team).id, to_id: emp, message, visibility: i === 2 ? 'recipient' : pick(['recipient', 'public']), competency: pick(['Collaboration', 'Ownership', 'Communication', 'Craft']), created_at: `${ymd(addDays(today, -i * 3))} 11:00:00` }));
    insert('feedback_requests', { requester_id: peer.id, subject_id: peer.id, reviewer_id: emp, question: 'How did I do leading the payments migration?', status: 'pending' });
    insert('one_on_ones', { manager_id: engMgr, employee_id: emp, scheduled_at: `${ymd(addDays(today, 2))}T16:00`, duration_mins: 30, agenda: 'Career goals for H2\nFeedback on the migration project', status: 'scheduled', created_by: engMgr });
    insert('one_on_ones', { manager_id: engMgr, employee_id: emp, scheduled_at: `${ymd(addDays(today, -12))}T16:00`, duration_mins: 30, agenda: 'Sprint retro', notes: 'Discussed workload and on-call rotation.', action_items: 'Rohan: rebalance on-call\nAnanya: draft design doc for reconciliation', status: 'completed', created_by: engMgr });
    const postTexts = ['Shipped the new payments reconciliation service to production today 🚀 Huge thanks to the whole platform team!', 'Reminder: Diwali potluck in the cafeteria on Friday. Bring your favourite sweets! 🪔',
      'We just crossed 1,000 customers on the Retail app. Proud of this team! 🎉', 'Looking for volunteers for the charity drive next month — comment below if you are in.'];
    postTexts.forEach((body, i) => {
      const pid = insert('posts', { author_id: [engMgr, hr, heads.Sales, hr][i], body, created_at: `${ymd(addDays(today, -i * 2))} 10:30:00` });
      for (const e of emps.slice(i, i + between(4, 15))) run('INSERT OR IGNORE INTO post_likes (post_id, employee_id) VALUES (?, ?)', pid, e.id);
      insert('post_comments', { post_id: pid, author_id: pick(emps).id, body: pick(['Congrats team! 👏', 'Count me in!', 'Amazing work 🙌', 'So proud of this!']) });
    });
    const enps = insert('surveys', { question: 'How likely are you to recommend Nimbus as a place to work? (0–10)', options: JSON.stringify(Array.from({ length: 11 }, (_, i) => String(i))), active: 1, type: 'enps' });
    for (const e of emps.slice(3, 30)) run('INSERT OR IGNORE INTO survey_votes (survey_id, employee_id, option_index) VALUES (?, ?, ?)', enps, e.id, pick([6, 7, 8, 8, 9, 9, 9, 10, 10, 5]));

    // ---------- activity monitoring: rules, devices, raw timeline for the last 3 working days ----------
    const RULES = [['code', 'productive'], ['vs code', 'productive'], ['github.com', 'productive'], ['terminal', 'productive'], ['jira', 'productive'], ['atlassian.net', 'productive'],
      ['confluence', 'productive'], ['figma', 'productive'], ['figma.com', 'productive'], ['salesforce', 'productive'], ['docs.google.com', 'productive'], ['sheets.google.com', 'productive'],
      ['google sheets', 'productive'], ['google docs', 'productive'], ['gmail', 'productive'], ['mail.google.com', 'productive'], ['zoom', 'productive'], ['miro', 'productive'], ['adobe illustrator', 'productive'],
      ['slack', 'neutral'], ['google meet', 'neutral'], ['whatsapp web', 'neutral'], ['linkedin.com', 'neutral'], ['linkedin', 'neutral'],
      ['youtube.com', 'unproductive'], ['youtube', 'unproductive'], ['instagram.com', 'unproductive'], ['instagram', 'unproductive'], ['netflix.com', 'unproductive'], ['facebook.com', 'unproductive'], ['news sites', 'unproductive'], ['x.com', 'unproductive']];
    for (const [pattern, category] of RULES) insert('app_rules', { pattern, category, department_id: null });
    insert('app_rules', { pattern: 'linkedin.com', category: 'productive', department_id: dept.Sales });
    insert('app_rules', { pattern: 'linkedin', category: 'productive', department_id: dept['Human Resources'] });
    const classify = classifier();
    const evStmt = db.prepare('INSERT INTO activity_events (employee_id, device_id, ts, app, domain, title, category, active_seconds, idle_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const trackedDays = [];
    for (let back = 0; trackedDays.length < 3 && back < 10; back++) { const d = addDays(today, -back); if (!isWeekend(d) && !holidaySet.has(ymd(d))) trackedDays.push(ymd(d)); }
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const tracked = emps.filter((e) => e.id !== ceo).slice(0, 28);
    for (const e of tracked) {
      const deviceId = insert('agent_devices', { employee_id: e.id, name: `${e.first_name}'s laptop`, platform: pick(['Windows 11', 'macOS 15', 'Ubuntu 24.04']), token_hash: crypto.createHash('sha256').update(`seed-${e.id}`).digest('hex'), last_seen_at: `${todayStr} 12:00:00` });
      const apps = (APPS[e.dept] || APPS.default);
      for (const date of trackedDays) {
        const att = get('SELECT clock_in, clock_out FROM attendance WHERE employee_id = ? AND date = ? AND clock_in IS NOT NULL', e.id, date);
        if (!att) continue;
        const [h1, m1] = att.clock_in.split(':').map(Number);
        const startM = h1 * 60 + m1;
        const endM = att.clock_out ? Number(att.clock_out.slice(0, 2)) * 60 + Number(att.clock_out.slice(3, 5)) : date === todayStr ? Math.min(nowMins, startM + 540) : startM + 510;
        const lunch = startM + 240;
        for (let t = startM; t < endM; t += 5) {
          if (t >= lunch && t < lunch + 40) continue; // lunch break: agent offline
          const [appName, cat] = rand() < 0.08 ? pick(apps.filter((a) => a[1] === 'unproductive')) || pick(apps) : pick(apps.filter((a) => a[1] !== 'unproductive'));
          const domain = { GitHub: 'github.com', Jira: 'atlassian.net', YouTube: 'youtube.com', LinkedIn: 'linkedin.com', Instagram: 'instagram.com', Figma: 'figma.com', Gmail: 'mail.google.com', 'Google Sheets': 'sheets.google.com', 'Google Docs': 'docs.google.com' }[appName] || null;
          const idle = rand() < 0.1 ? between(60, 300) : between(0, 40);
          const active = 300 - idle;
          evStmt.run(e.id, deviceId, `${date} ${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`, appName, domain, `${appName} — work`, classify(appName, domain, e.department_id), active, idle);
        }
        rollupDay(e.id, date);
        evaluateAlerts(e.id, date);
      }
    }
    // A few representative alerts for the demo (managers see them on the productivity dashboard).
    for (const [e, type, severity, message] of [[team[1], 'overwork', 'high', '10.8 h of active time — burnout risk'], [team[2], 'long_idle', 'low', 'Idle for 48 min at a stretch'], [tracked[5], 'unproductive', 'medium', '74 min on unproductive apps/sites']]) {
      if (e) run('INSERT OR IGNORE INTO activity_alerts (employee_id, type, severity, message, date) VALUES (?, ?, ?, ?, ?)', e.id, type, severity, message, trackedDays[1] || todayStr);
    }

    // ---------- notifications ----------
    for (const [id, title, body, link] of [
      [emp, 'Leave approved', 'Your Sick Leave was approved by Rohan Mehta', '/leave'],
      [emp, 'New kudos received 🎉', 'Someone appreciated your work!', '/engage'],
      [emp, 'Payslip available', 'Your latest payslip is ready to download.', '/payslips'],
      [engMgr, 'Pending approvals', 'You have leave and regularization requests waiting.', '/approvals'],
      [hr, 'New helpdesk ticket', 'VPN keeps disconnecting', '/helpdesk'],
      [ceo, 'Payroll processed', 'Last month payroll was processed and paid.', '/payroll'],
    ]) insert('notifications', { employee_id: id, title, body, link });
  });
  return { password: DEMO_PASSWORD };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ reset: true });
  console.log(`Database seeded. Sign in with admin@peoplehub.demo / ${DEMO_PASSWORD}`);
}
