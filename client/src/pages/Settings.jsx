import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useGet, useAction, useAuth } from '../lib/hooks';
import { PageHeader, Tabs, CardSkeleton, Badge, cx } from '../components/ui';
import { titleCase } from '../lib/format';
import { FormFields } from '../components/Form';
import CrudTable from '../components/CrudTable';
import EmailSettings from './EmailSettings';

const COMPANY_FIELDS = [
  { name: 'company_name', label: 'Legal company name', required: true, full: true }, { name: 'company_short', label: 'Short name' },
  { name: 'company_email', label: 'HR email', type: 'email' }, { name: 'company_phone', label: 'Phone' },
  { name: 'company_pan', label: 'Company PAN' }, { name: 'company_tan', label: 'TAN' },
  { name: 'timezone', label: 'Timezone', type: 'select', noEmpty: true, options: ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'] },
  { name: 'currency', label: 'Currency', type: 'select', noEmpty: true, options: ['INR', 'USD', 'AED', 'SGD', 'GBP'] },
  { name: 'week_off', label: 'Weekly off', type: 'select', noEmpty: true, options: ['Saturday, Sunday', 'Sunday', 'Friday, Saturday'] },
  { name: 'fy_start', label: 'Financial year starts', type: 'select', noEmpty: true, options: ['April', 'January'] },
  { name: 'payroll_day', label: 'Salary credit day', type: 'number', min: 1, max: 31 },
  { name: 'company_address', label: 'Registered address', type: 'textarea', full: true },
];

function Company() {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useGet('settings');
  const [values, setValues] = useState({});
  const [act, { isLoading: saving }] = useAction();
  useEffect(() => { if (data) setValues(data); }, [data]);
  if (isLoading) return <CardSkeleton lines={8} />;
  return (
    <form className="card card-pad space-y-5" onSubmit={(e) => { e.preventDefault(); act('settings', { method: 'PUT', body: values, success: 'Company settings saved' }); }}>
      <FormFields fields={COMPANY_FIELDS} values={values} setValues={setValues} />
      <div className="flex items-center justify-end gap-3">
        {!isAdmin && <span className="text-xs muted">Only admins can change company settings.</span>}
        <button className="btn-primary" disabled={!isAdmin || saving} data-testid="save-settings"><Save size={16} /> Save changes</button>
      </div>
    </form>
  );
}

function YearEnd() {
  const [act, { isLoading }] = useAction();
  const [result, setResult] = useState(null);
  const year = new Date().getFullYear();
  return (
    <div className="card card-pad mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <h3 className="font-semibold">Leave year-end processing</h3>
        <p className="text-sm muted">Opens {year + 1} balances: annual quotas plus carry-forward of unused leave for carry-forward types (capped); excess days are reported as encashable.</p>
        {result && <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400" data-testid="year-end-result">Processed {result.employees} employees · {result.carried_days} days carried forward · {result.encashable_days} days encashable (cap {result.cap})</p>}
      </div>
      <button className="btn-secondary" disabled={isLoading} data-testid="run-year-end" onClick={async () => { const r = await act('workforce/leave-year-end', { body: { year }, success: `Leave year ${year} closed` }); if (r) setResult(r); }}>Close {year}</button>
    </div>
  );
}

function Workflows() {
  const { data = [], isLoading } = useGet('approvals/flows');
  const [act] = useAction();
  if (isLoading) return <CardSkeleton lines={6} />;
  return (
    <div className="card overflow-hidden" data-testid="workflows">
      <div className="border-b border-slate-100 p-5 dark:border-slate-800">
        <h3 className="font-semibold">Approval workflows</h3>
        <p className="text-sm muted">Choose who approves each request type. Two-step flows go to the reporting manager first, then HR for final approval. HR can always act directly.</p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.map((f) => (
          <div key={f.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1 font-medium">{f.label}</div>
            <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label={f.label}>
              {[['manager', 'Manager'], ['manager_hr', 'Manager → HR'], ['hr', 'HR only']].map(([v, l]) => (
                <button key={v} role="radio" aria-checked={f.flow === v} data-testid={`flow-${f.key}-${v}`}
                  className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition', f.flow === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}
                  onClick={() => f.flow !== v && act('approvals/flows', { method: 'PUT', body: { [f.key]: v }, success: `${f.label}: ${l}` })}>{l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const POLICY_FIELDS = [
  { name: 'notice_period_days', label: 'Notice period (days)', type: 'number', min: 0, max: 180 },
  { name: 'probation_days', label: 'Probation for new joiners (days)', type: 'number', min: 0, max: 365 },
  { name: 'optional_holiday_limit', label: 'Optional holidays per year', type: 'number', min: 0, max: 10 },
  { name: 'carry_forward_cap', label: 'Max carry-forward days', type: 'number', min: 0, max: 120 },
  { name: 'geofence_mode', label: 'Geofenced clock-in', type: 'select', noEmpty: true, options: [['off', 'Off — ignore location'], ['flag', 'Flag clock-ins outside the office'], ['enforce', 'Block office clock-ins outside the geofence']], full: true },
];

function Policies() {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useGet('settings');
  const [values, setValues] = useState({});
  const [act, { isLoading: saving }] = useAction();
  useEffect(() => { if (data) setValues(data); }, [data]);
  if (isLoading) return <CardSkeleton lines={5} />;
  return (
    <form className="card card-pad max-w-3xl space-y-5" onSubmit={(e) => {
      e.preventDefault();
      act('settings', { method: 'PUT', body: Object.fromEntries(POLICY_FIELDS.map((f) => [f.name, values[f.name]])), success: 'HR policies saved' });
    }}>
      <div><h3 className="font-semibold">HR policies</h3><p className="text-sm muted">Defaults used for resignations, probation, holidays, leave year-end and attendance. Office geofences are set per location under Organization → Locations.</p></div>
      <FormFields fields={POLICY_FIELDS} values={values} setValues={setValues} />
      <div className="flex justify-end">{!isAdmin && <span className="mr-3 self-center text-xs muted">Only admins can change policies.</span>}<button className="btn-primary" disabled={!isAdmin || saving} data-testid="save-policies"><Save size={16} /> Save</button></div>
    </form>
  );
}

function CustomFields() {
  return (
    <CrudTable path="custom-fields" label="custom field" searchKeys={['label', 'section']} defaults={{ type: 'text', section: 'Additional', employee_editable: 0, required: 0 }}
      columns={[
        { key: 'label', header: 'Field', render: (r) => <span className="font-semibold">{r.label}</span> },
        { key: 'type', header: 'Type', render: (r) => titleCase(r.type) },
        { key: 'section', header: 'Section' },
        { key: 'options', header: 'Options', render: (r) => (r.options ? JSON.parse(r.options).join(', ') : '—') },
        { key: 'employee_editable', header: 'Employee can edit', render: (r) => (r.employee_editable ? 'Yes' : 'No') },
        { key: 'required', header: 'Required', render: (r) => (r.required ? 'Yes' : 'No') },
      ]}
      fields={[
        { name: 'label', label: 'Label', required: true },
        { name: 'type', label: 'Type', type: 'select', noEmpty: true, options: [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Dropdown']] },
        { name: 'section', label: 'Profile section' },
        { name: 'sort_order', label: 'Order', type: 'number', min: 0 },
        { name: 'options', label: 'Dropdown options (one per line)', type: 'textarea', full: true, hidden: (v) => v.type !== 'select' },
        { name: 'employee_editable', label: 'Employees can edit this field', type: 'checkbox' },
        { name: 'required', label: 'Required', type: 'checkbox' },
      ]} />
  );
}

export default function Settings() {
  const [tab, setTab] = useState('company');
  return (
    <div>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Company profile, leave policy, holiday calendar and email delivery" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'company', label: 'Company' }, { value: 'leave', label: 'Leave policy' }, { value: 'holidays', label: 'Holidays' }, { value: 'workflows', label: 'Approval workflows' }, { value: 'policies', label: 'HR policies' }, { value: 'fields', label: 'Custom fields' }, { value: 'email', label: 'Email' }]} />
      {tab === 'company' && <Company />}
      {tab === 'email' && <EmailSettings />}
      {tab === 'workflows' && <Workflows />}
      {tab === 'policies' && <Policies />}
      {tab === 'fields' && <CustomFields />}
      {tab === 'leave' && <YearEnd />}
      {tab === 'leave' && (
        <CrudTable path="leave/types" label="leave type" searchKeys={['name', 'code']} defaults={{ paid: 1, carry_forward: 0, color: '#6366f1' }}
          columns={[
            { key: 'name', header: 'Leave type', render: (r) => <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: r.color }} />{r.name}</span> },
            { key: 'code', header: 'Code' }, { key: 'annual_quota', header: 'Annual quota', render: (r) => (r.code === 'LOP' ? 'Unlimited' : `${r.annual_quota} days`) },
            { key: 'paid', header: 'Paid', render: (r) => <Badge color={r.paid ? 'green' : 'slate'}>{r.paid ? 'Paid' : 'Unpaid'}</Badge> },
            { key: 'carry_forward', header: 'Carry forward', render: (r) => (r.carry_forward ? 'Yes' : 'No') },
          ]}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Code', required: true }, { name: 'annual_quota', label: 'Annual quota (days)', type: 'number', min: 0 },
            { name: 'color', label: 'Colour', type: 'color' }, { name: 'paid', label: 'Paid leave', type: 'checkbox' }, { name: 'carry_forward', label: 'Carry forward unused balance', type: 'checkbox' }]} />
      )}
      {tab === 'holidays' && (
        <CrudTable path="holidays" label="holiday" searchKeys={['name', 'type']} defaults={{ type: 'Public' }}
          columns={[{ key: 'date', header: 'Date' }, { key: 'name', header: 'Holiday', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'type', header: 'Type', render: (r) => <Badge color={r.type === 'Public' ? 'blue' : 'slate'}>{r.type}</Badge> }]}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'type', label: 'Type', type: 'select', noEmpty: true, options: ['Public', 'Optional'] }]} />
      )}
    </div>
  );
}
