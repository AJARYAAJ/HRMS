import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db, migrate, resetDb, insert, run, get, all, tx } from './db.js';
import { ymd, pad, isWeekend, parseDate, computePayslip, monthRange, workingDaysBetween, ensureLeaveBalances } from './utils.js';
import { createTasks } from './routes/employees.js';

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
  if (reset) resetDb();
  else migrate();
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
    };
    for (const [k, v] of Object.entries(settings)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, v);

    const dept = Object.fromEntries(DEPARTMENTS.map(([name, code, description]) => [name, insert('departments', { name, code, description })]));
    const desig = Object.fromEntries(DESIGNATIONS.map(([title, level]) => [title, insert('designations', { title, level })]));
    const loc = LOCATIONS.map(([name, city, state, address]) => insert('locations', { name, city, state, address }));
    const general = insert('shifts', { name: 'General', start_time: '09:30', end_time: '18:30', grace_minutes: 15 });
    insert('shifts', { name: 'Early', start_time: '07:00', end_time: '16:00', grace_minutes: 10 });
    const late = insert('shifts', { name: 'US Overlap', start_time: '13:00', end_time: '22:00', grace_minutes: 15 });

    [['Casual Leave', 'CL', 12, 1, 0, '#6366f1'], ['Sick Leave', 'SL', 10, 1, 0, '#f43f5e'], ['Earned Leave', 'EL', 18, 1, 1, '#10b981'],
      ['Work From Home', 'WFH', 24, 1, 0, '#0ea5e9'], ['Comp Off', 'CO', 5, 1, 0, '#f59e0b'], ['Loss of Pay', 'LOP', 0, 0, 0, '#64748b']]
      .forEach(([name, code, annual_quota, paid, carry_forward, color]) => insert('leave_types', { name, code, annual_quota, paid, carry_forward, color }));
    for (const [name, date, type] of HOLIDAYS) insert('holidays', { name, date, type });

    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
    let code = 1001;
    const mk = (e) => insert('employees', {
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

    const emps = all("SELECT e.*, d.name AS dept FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'");
    for (const e of emps) {
      ensureLeaveBalances(e.id, year);
      if (e.date_of_joining >= ymd(addDays(today, -45))) createTasks(e.id, 'onboarding', e.date_of_joining);
      if (e.status === 'on_notice') {
        run('UPDATE employees SET exit_date = ? WHERE id = ?', ymd(addDays(today, between(10, 50))), e.id);
        createTasks(e.id, 'offboarding', ymd(addDays(today, -5)));
      }
    }
    // Mark some onboarding tasks done so progress looks realistic.
    run("UPDATE onboarding_tasks SET done = 1 WHERE due_date < ? AND id % 3 != 0", todayStr);

    // ---------- attendance (last 75 days) and productivity (last 21 days) ----------
    const holidaySet = new Set(HOLIDAYS.map((h) => h[1]));
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
      const runId = insert('payroll_runs', { month, status: 'paid', processed_by: hr, processed_at: `${end} 10:00:00`, paid_at: `${end} 18:00:00` });
      let g = 0, dd = 0, n = 0;
      const payees = all(`SELECT * FROM employees WHERE annual_ctc > 0 AND date_of_joining <= ? AND (status != 'exited' OR exit_date >= ?)`, end, start);
      for (const e of payees) {
        const lop = rand() < 0.08 ? between(1, 2) : 0;
        const slip = computePayslip(e.annual_ctc, wd, wd - lop);
        insert('payslips', { run_id: runId, employee_id: e.id, month, working_days: wd, paid_days: wd - lop, lop_days: lop, ...slip });
        g += slip.gross; dd += slip.total_deductions; n += slip.net;
      }
      run('UPDATE payroll_runs SET employees = ?, total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?', payees.length, Math.round(g), Math.round(dd), Math.round(n), runId);
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
    const projects = [['Atlas Payments Platform', 'Internal', 1200], ['Retail Mobile App', 'ShopKart India', 800], ['Data Warehouse Migration', 'FinServe Ltd', 600],
      ['Customer Portal Revamp', 'Internal', 400], ['AI Support Assistant', 'Internal', 500]]
      .map(([name, client, budget_hours]) => insert('projects', { name, client, status: 'active', start_date: ymd(addDays(today, -between(40, 120))), end_date: ymd(addDays(today, between(30, 150))), budget_hours }));
    for (const e of team) {
      for (let i = 13; i >= 1; i--) {
        const d = addDays(today, -i);
        if (isWeekend(d)) continue;
        insert('timesheets', { employee_id: e.id, project_id: pick(projects), date: ymd(d), hours: pick([4, 6, 7, 8, 8, 8]), task: pick(['API development', 'Code review', 'Bug fixes', 'Sprint planning', 'Testing', 'Documentation']),
          billable: rand() < 0.75 ? 1 : 0, status: i <= 3 ? 'pending' : 'approved', approver_id: i <= 3 ? null : engMgr });
      }
    }

    // ---------- assets ----------
    const assetSpecs = [['MacBook Pro 14"', 'Laptop', 185000], ['Dell Latitude 7440', 'Laptop', 110000], ['LG 27" 4K Monitor', 'Monitor', 32000],
      ['iPhone 15', 'Mobile', 79000], ['Logitech MX Keys', 'Accessory', 11000], ['Jabra Evolve2 Headset', 'Accessory', 18000]];
    let tag = 1;
    for (const e of emps) {
      const [name, category, cost] = e.dept === 'Engineering' || e.dept === 'Design' ? assetSpecs[0] : assetSpecs[1];
      insert('assets', { asset_tag: `AST-${String(tag++).padStart(4, '0')}`, name, category, serial_no: `SN${between(100000, 999999)}`, assigned_to: e.id, status: 'assigned', purchase_date: e.date_of_joining, cost });
    }
    for (let i = 0; i < 12; i++) {
      const [name, category, cost] = pick(assetSpecs);
      insert('assets', { asset_tag: `AST-${String(tag++).padStart(4, '0')}`, name, category, serial_no: `SN${between(100000, 999999)}`, assigned_to: null, status: pick(['available', 'available', 'in_repair']), purchase_date: ymd(addDays(today, -between(30, 700))), cost });
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
    for (const [title, category, content] of policies) insert('documents', { title, category, content, employee_id: null });
    insert('documents', { title: 'Offer Letter', category: 'Personal', content: 'Offer letter for Software Engineer role.', employee_id: emp });
    insert('documents', { title: 'Appraisal Letter FY25', category: 'Personal', content: 'Revised compensation effective April.', employee_id: emp });

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
