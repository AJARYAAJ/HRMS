import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, LayoutGrid, List, Mail, Phone, MapPin } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Avatar, Badge, CardSkeleton, EmptyState, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { date, todayStr } from '../lib/format';

export const employeeFields = (isAdmin) => [
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'email', label: 'Work email', type: 'email', required: true },
  { name: 'phone', label: 'Phone' },
  { name: 'department_id', label: 'Department', type: 'lookup', path: 'departments' },
  { name: 'designation_id', label: 'Designation', type: 'lookup', path: 'designations', labelKey: 'title' },
  { name: 'location_id', label: 'Location', type: 'lookup', path: 'locations' },
  { name: 'shift_id', label: 'Shift', type: 'lookup', path: 'shifts', labelKey: (s) => `${s.name} (${s.start_time}–${s.end_time})` },
  { name: 'manager_id', label: 'Reporting manager', type: 'employee' },
  { name: 'role', label: 'Access role', type: 'select', noEmpty: true, options: [['employee', 'Employee'], ['manager', 'Manager'], ['hr', 'HR'], ...(isAdmin ? [['admin', 'Admin']] : [])] },
  { name: 'employment_type', label: 'Employment type', type: 'select', noEmpty: true, options: ['Full-time', 'Part-time', 'Contract', 'Intern'] },
  { name: 'date_of_joining', label: 'Date of joining', type: 'date', required: true },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Non-binary', 'Prefer not to say'] },
  { name: 'annual_ctc', label: 'Annual CTC (₹)', type: 'number', min: 0 },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['active', 'Active'], ['on_notice', 'On notice'], ['exited', 'Exited']] },
  { name: 'pan', label: 'PAN' },
  { name: 'uan', label: 'UAN (PF)' },
  { name: 'bank_name', label: 'Bank name' },
  { name: 'bank_account', label: 'Account number' },
  { name: 'ifsc', label: 'IFSC' },
  { name: 'address', label: 'Address', type: 'textarea', full: true },
];

export default function Employees() {
  const { isHR, isAdmin } = useAuth();
  const [filters, setFilters] = useState({ department_id: '', location_id: '', status: '' });
  const [view, setView] = useState('table');
  const { data = [], isLoading } = useGet('employees', filters);
  const { data: depts = [] } = useGet('departments');
  const { data: locs = [] } = useGet('locations');
  const navigate = useNavigate();
  const add = useDisclosure();
  const [act] = useAction();
  const [q, setQ] = useState('');

  const toolbar = (
    <>
      <select className="input !w-auto" value={filters.department_id} onChange={(e) => setFilters((f) => ({ ...f, department_id: e.target.value }))} aria-label="Department filter">
        <option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select className="input !w-auto" value={filters.location_id} onChange={(e) => setFilters((f) => ({ ...f, location_id: e.target.value }))} aria-label="Location filter">
        <option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select className="input !w-auto" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Status filter">
        <option value="">Current</option><option value="active">Active</option><option value="on_notice">On notice</option><option value="exited">Exited</option><option value="all">All</option>
      </select>
      <div className="flex rounded-xl border border-slate-200 p-0.5 dark:border-slate-700">
        <button className={cx('rounded-lg p-1.5', view === 'table' && 'bg-slate-100 dark:bg-slate-700')} onClick={() => setView('table')} aria-label="Table view"><List size={16} /></button>
        <button className={cx('rounded-lg p-1.5', view === 'grid' && 'bg-slate-100 dark:bg-slate-700')} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid size={16} /></button>
      </div>
    </>
  );

  const gridRows = data.filter((e) => !q || `${e.first_name} ${e.last_name} ${e.email} ${e.designation}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader icon={Users} title="Employees" subtitle={`${data.length} people in the directory`}
        actions={isHR && <button className="btn-primary" onClick={() => add.onOpen()} data-testid="add-employee"><Plus size={16} /> Add employee</button>} />
      {view === 'table' ? (
        <DataTable loading={isLoading} rows={data} onRowClick={(r) => navigate(`/employees/${r.id}`)} toolbar={toolbar} exportName="employees"
          searchKeys={['first_name', 'last_name', 'email', 'emp_code', 'designation', 'department', (r) => `${r.first_name} ${r.last_name}`]} searchPlaceholder="Search name, email, ID…"
          columns={[
            { key: 'name', header: 'Employee', width: 'minmax(240px, 2fr)', sortValue: (r) => `${r.first_name} ${r.last_name}`, csv: (r) => `${r.first_name} ${r.last_name}`, render: (r) => (
              <div className="flex items-center gap-3"><Avatar name={`${r.first_name} ${r.last_name}`} color={r.avatar_color} size="sm" />
                <div className="min-w-0"><div className="truncate font-semibold text-slate-900 dark:text-white">{r.first_name} {r.last_name}</div><div className="truncate text-xs muted">{r.email}</div></div></div>
            ) },
            { key: 'emp_code', header: 'ID', width: 'minmax(90px, .6fr)' },
            { key: 'designation', header: 'Designation', width: 'minmax(160px, 1.3fr)' },
            { key: 'department', header: 'Department' },
            { key: 'location', header: 'Location' },
            { key: 'manager_name', header: 'Manager' },
            { key: 'date_of_joining', header: 'Joined', render: (r) => date(r.date_of_joining) },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]} />
      ) : (
        <div className="space-y-4">
          <div className="card flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <input className="input md:max-w-xs" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
            <div className="flex flex-1 flex-wrap gap-2 md:justify-end">{toolbar}</div>
          </div>
          {isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}</div> : gridRows.length === 0 ? <div className="card"><EmptyState title="No employees found" /></div> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {gridRows.map((e) => (
                <button key={e.id} onClick={() => navigate(`/employees/${e.id}`)} className="card group p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="flex items-start justify-between"><Avatar name={`${e.first_name} ${e.last_name}`} color={e.avatar_color} size="lg" /><Badge status={e.status} /></div>
                  <div className="mt-3 font-semibold text-slate-900 dark:text-white">{e.first_name} {e.last_name}</div>
                  <div className="text-sm muted">{e.designation}</div>
                  <div className="mt-3 space-y-1 text-xs muted">
                    <div className="flex items-center gap-1.5 truncate"><Mail size={12} />{e.email}</div>
                    {e.phone && <div className="flex items-center gap-1.5"><Phone size={12} />{e.phone}</div>}
                    <div className="flex items-center gap-1.5"><MapPin size={12} />{e.location} · {e.department || '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="Add new employee" size="lg" submitLabel="Create employee"
        initial={{ role: 'employee', employment_type: 'Full-time', status: 'active', date_of_joining: todayStr() }}
        fields={employeeFields(isAdmin)}
        onSubmit={async (v) => {
          const res = await act('employees', { body: v, success: 'Employee created · onboarding checklist generated' });
          if (res?.id) navigate(`/employees/${res.id}`);
          return res;
        }}>
        <p className="rounded-xl bg-slate-50 p-3 text-xs muted dark:bg-slate-800">Default password: <b>Welcome@123</b>. The employee can change it from Account settings.</p>
      </FormModal>
    </div>
  );
}
