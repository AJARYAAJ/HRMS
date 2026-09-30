import bcrypt from 'bcryptjs';
import { run, insert, tx, get, all } from './db.js';

/**
 * First start in production: create a clean organisation with one administrator instead of demo data.
 * Configure with environment variables:
 *   ADMIN_EMAIL, ADMIN_PASSWORD (min 10 characters), ADMIN_FIRST_NAME, ADMIN_LAST_NAME,
 *   COMPANY_NAME, COMPANY_CITY, COMPANY_STATE
 */
export function bootstrapProduction(env = process.env) {
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || '';
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
    throw new Error('First start in production needs ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) to create the administrator account. Set them in .env and start again. (Set SEED_DEMO=1 instead to load demo data.)');
  }
  const company = (env.COMPANY_NAME || 'My Company').trim();
  const city = (env.COMPANY_CITY || '').trim() || null;
  tx(() => {
    const settings = {
      company_name: company, company_short: company.split(/\s+/)[0], currency: 'INR', timezone: 'Asia/Kolkata', week_off: 'Saturday, Sunday',
      fy_start: 'April', payroll_day: '28', notice_period_days: '30', probation_days: '90', optional_holiday_limit: '2', carry_forward_cap: '30',
      geofence_mode: 'off', payroll_basic_pct: '50', payroll_hra_pct: '40', screenshots_enabled: '0', invoice_tax_rate: '18',
    };
    for (const [k, v] of Object.entries(settings)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, v);
    const companyId = insert('companies', { name: company, legal_name: company, city, state: env.COMPANY_STATE || null });
    const dept = insert('departments', { name: 'Management', code: 'MGT', description: 'Leadership and administration' });
    const desig = insert('designations', { title: 'Administrator', level: 1 });
    const loc = insert('locations', { name: city ? `${city} office` : 'Head office', city, state: env.COMPANY_STATE || null });
    const shift = insert('shifts', { name: 'General', start_time: '09:30', end_time: '18:30', grace_minutes: 15 });
    [['Casual Leave', 'CL', 12, 1, 0, '#0ea5e9'], ['Sick Leave', 'SL', 10, 1, 0, '#f43f5e'], ['Earned Leave', 'EL', 18, 1, 1, '#10b981'], ['Loss of Pay', 'LOP', 0, 0, 0, '#64748b']]
      .forEach(([name, code, annual_quota, paid, carry_forward, color]) => insert('leave_types', { name, code, annual_quota, paid, carry_forward, color }));
    // Default plans, editable in Policies & settings.
    const plan = insert('leave_plans', { name: 'Standard leave plan', description: 'Default plan for all employees', is_default: 1 });
    for (const t of all('SELECT * FROM leave_types')) {
      insert('leave_plan_rules', {
        plan_id: plan, leave_type_id: t.id, annual_quota: t.annual_quota, accrual: t.code === 'LOP' ? 'none' : 'yearly',
        carry_forward_cap: t.carry_forward ? 30 : 0, encashable: t.carry_forward, allow_half_day: 1, min_notice_days: 0, probation_allowed: 1, sandwich: 0,
      });
    }
    const st = insert('salary_structures', { name: 'Standard', description: 'Gross equals CTC', is_default: 1 });
    [['Basic', 'BASIC', 'percent_ctc', 50], ['House rent allowance', 'HRA', 'percent_basic', 40], ['Special allowance', 'SPECIAL', 'balance', 0]]
      .forEach(([name, code, calc, value], sort) => insert('salary_components', { structure_id: st, name, code, type: 'earning', calc, value, taxable: 1, sort }));
    insert('holiday_lists', { name: 'Company holidays', description: 'Add this year\'s holidays in Policies & settings', optional_limit: 2, is_default: 1 });
    insert('weekly_off_policies', { name: 'Saturday & Sunday off', pattern: JSON.stringify({ 0: 'all', 6: 'all' }), is_default: 1 });
    insert('attendance_policies', { name: 'Standard attendance', description: 'Office, remote and field clock-in', is_default: 1 });
    const exp = insert('expense_policies', { name: 'Standard expense policy', is_default: 1 });
    for (const [name, receipt] of [['Travel', 500], ['Food & Meals', 300], ['Internet', null], ['Office Supplies', 1000], ['Training', 0], ['Other', 1000]]) {
      insert('expense_categories', { policy_id: exp, name, kind: 'amount', receipt_above: receipt });
    }
    const today = new Date().toISOString().slice(0, 10);
    insert('employees', {
      emp_code: 'EMP001', first_name: (env.ADMIN_FIRST_NAME || 'Admin').trim(), last_name: (env.ADMIN_LAST_NAME || 'User').trim(), email,
      password_hash: bcrypt.hashSync(password, 12), role: 'admin', status: 'active', department_id: dept, designation_id: desig, location_id: loc,
      shift_id: shift, company_id: companyId, date_of_joining: today, employment_type: 'Full-time', avatar_color: '#4f46e5', confirmation_status: 'confirmed',
    });
  });
  return get('SELECT id, email FROM employees WHERE email = ?', email);
}
