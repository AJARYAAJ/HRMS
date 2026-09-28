import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useGet, useAction, useAuth } from '../lib/hooks';
import { PageHeader, Tabs, CardSkeleton, Badge } from '../components/ui';
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

export default function Settings() {
  const [tab, setTab] = useState('company');
  return (
    <div>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Company profile, leave policy, holiday calendar and email delivery" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'company', label: 'Company' }, { value: 'leave', label: 'Leave policy' }, { value: 'holidays', label: 'Holidays' }, { value: 'email', label: 'Email' }]} />
      {tab === 'company' && <Company />}
      {tab === 'email' && <EmailSettings />}
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
