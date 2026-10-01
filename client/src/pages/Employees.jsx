import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, LayoutGrid, List, Mail, Phone, MapPin, Upload, Download } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { FileDrop } from '../components/Files';
import { uploadForm, invalidateFiles, authFetch } from '../lib/files';
import { PageHeader, Avatar, Badge, CardSkeleton, EmptyState, Modal, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { date, todayStr } from '../lib/format';

export const employeeFields = (isAdmin) => [
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'email', label: 'Work email', type: 'email', required: true },
  { name: 'phone', label: 'Phone' },
  { name: 'company_id', label: 'Company (legal entity)', type: 'lookup', path: 'companies' },
  { name: 'department_id', label: 'Department', type: 'lookup', path: 'departments' },
  { name: 'designation_id', label: 'Designation', type: 'lookup', path: 'designations', labelKey: 'title' },
  { name: 'location_id', label: 'Location', type: 'lookup', path: 'locations' },
  { name: 'shift_id', label: 'Shift', type: 'lookup', path: 'shifts', labelKey: (s) => `${s.name} (${s.start_time}–${s.end_time})` },
  { name: 'biometric_id', label: 'Biometric device user ID', placeholder: 'ID enrolled on the attendance device' },
  { name: 'manager_id', label: 'Reporting manager', type: 'employee' },
  { name: 'role', label: 'Access role', type: 'select', noEmpty: true, options: [['employee', 'Employee'], ['manager', 'Manager'], ['hr', 'HR'], ...(isAdmin ? [['admin', 'Admin']] : [])] },
  { name: 'employment_type', label: 'Employment type', type: 'select', noEmpty: true, options: ['Full-time', 'Part-time', 'Contract', 'Intern'] },
  { name: 'date_of_joining', label: 'Date of joining', type: 'date', required: true },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Non-binary', 'Prefer not to say'] },
  { name: 'annual_ctc', label: 'Annual CTC (₹)', type: 'number', min: 0 },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['active', 'Active'], ['on_notice', 'On notice'], ['exited', 'Exited']] },
  { name: 'probation_end_date', label: 'Probation ends', type: 'date' },
  { name: 'confirmation_status', label: 'Confirmation', type: 'select', options: [['probation', 'On probation'], ['extended', 'Probation extended'], ['confirmed', 'Confirmed']] },
  { name: 'pan', label: 'PAN' },
  { name: 'uan', label: 'UAN (PF)' },
  { name: 'bank_name', label: 'Bank name' },
  { name: 'bank_account', label: 'Account number' },
  { name: 'ifsc', label: 'IFSC' },
  { name: 'address', label: 'Address', type: 'textarea', full: true },
];

function ImportModal({ open, onClose }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) { setFile(null); setResult(null); } }, [open]);
  const send = async (dryRun) => {
    setBusy(true);
    try {
      const r = await uploadForm(`hr/employees-import${dryRun ? '?dry_run=1' : ''}`, {}, file);
      setResult(r);
      if (!dryRun) {
        toast(`${r.created} employee(s) imported${r.invalid ? ` · ${r.invalid} row(s) skipped` : ''}`);
        invalidateFiles('employees', 'dashboard', 'onboarding');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = async () => {
    const res = await authFetch('/api/hr/employees-import/template');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'employee-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal open={open} onClose={onClose} title="Import employees from CSV" size="lg">
      <div className="space-y-4">
        <p className="text-sm muted">Columns: first_name, last_name, email (required), phone, department, designation, location, company, manager_email, date_of_joining, date_of_birth, gender, employment_type, role, annual_ctc. Each new employee gets a welcome email and an onboarding checklist.</p>
        <button type="button" className="btn-ghost btn-sm -ml-2" onClick={downloadTemplate}><Download size={14} /> Download template</button>
        <FileDrop file={file} onChange={(f) => { setFile(f); setResult(null); }} label="CSV file" hint="Up to 1,000 rows" testId="import-drop" />
        {result && (
          <div className="space-y-2" data-testid="import-result">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge color="slate">{result.total} rows</Badge><Badge color="green">{result.valid} valid</Badge>
              {result.invalid > 0 && <Badge color="red">{result.invalid} with errors</Badge>}
              {!result.dry_run && <Badge color="violet">{result.created} created</Badge>}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800">
              {result.rows.map((r) => (
                <div key={r.row} className="flex items-start gap-3 border-b border-slate-50 px-3 py-2 text-sm last:border-0 dark:border-slate-800/60">
                  <span className="w-12 shrink-0 text-xs muted">Row {r.row}</span>
                  <span className="w-44 shrink-0 truncate font-medium">{r.name || '—'}</span>
                  {r.errors.length ? <span className="text-xs text-rose-600">{r.errors.join('; ')}</span> : <span className="text-xs text-emerald-600">Ready</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-secondary" disabled={!file || busy} onClick={() => send(true)} data-testid="validate-import">Validate</button>
          <button className="btn-primary" disabled={!file || busy || (result && result.valid === 0) || (result && !result.dry_run)} onClick={() => send(false)} data-testid="run-import">
            {busy ? 'Working…' : result?.dry_run ? `Import ${result.valid} valid row(s)` : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Employees() {
  const { isHR, isAdmin } = useAuth();
  const [filters, setFilters] = useState({ department_id: '', location_id: '', company_id: '', status: '' });
  const { data: companies = [] } = useGet('companies');
  const importer = useDisclosure();
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
      <select className="input !w-auto" value={filters.company_id} onChange={(e) => setFilters((f) => ({ ...f, company_id: e.target.value }))} aria-label="Company filter">
        <option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        actions={isHR && <>
          <button className="btn-secondary" onClick={() => importer.onOpen()} data-testid="import-employees"><Upload size={16} /> Import CSV</button>
          <button className="btn-primary" onClick={() => add.onOpen()} data-testid="add-employee"><Plus size={16} /> Add employee</button>
        </>} />
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
            { key: 'company_name', header: 'Company' },
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
      <ImportModal open={importer.open} onClose={importer.onClose} />
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
