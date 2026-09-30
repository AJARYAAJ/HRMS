import bcrypt from 'bcryptjs';
import { run, insert, tx, get } from './db.js';

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
    const today = new Date().toISOString().slice(0, 10);
    insert('employees', {
      emp_code: 'EMP001', first_name: (env.ADMIN_FIRST_NAME || 'Admin').trim(), last_name: (env.ADMIN_LAST_NAME || 'User').trim(), email,
      password_hash: bcrypt.hashSync(password, 12), role: 'admin', status: 'active', department_id: dept, designation_id: desig, location_id: loc,
      shift_id: shift, company_id: companyId, date_of_joining: today, employment_type: 'Full-time', avatar_color: '#4f46e5', confirmation_status: 'confirmed',
    });
  });
  return get('SELECT id, email FROM employees WHERE email = ?', email);
}
