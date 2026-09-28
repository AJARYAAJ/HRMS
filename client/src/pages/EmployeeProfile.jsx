import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Mail, Phone, MapPin, Briefcase, Calendar, Pencil, UserMinus, KeyRound, Building2, User, Landmark, Laptop, FileText, Clock, ArrowLeft } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { Avatar, Badge, Tabs, Skeleton, CardSkeleton, EmptyState, Modal, MonthPicker, Progress } from '../components/ui';
import { FormModal } from '../components/Form';
import { employeeFields } from './Employees';
import { date, money, thisMonth, todayStr, titleCase } from '../lib/format';

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{value || '—'}</div>
    </div>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <div className="card card-pad">
      <h3 className="mb-4 flex items-center gap-2 font-semibold">{Icon && <Icon size={16} className="text-brand-500" />}{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function AttendanceTab({ id }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading } = useGet('attendance', { employee_id: id, month });
  if (isLoading) return <CardSkeleton lines={5} />;
  const s = data.summary;
  return (
    <div className="card card-pad space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Attendance summary</h3><MonthPicker value={month} onChange={setMonth} /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Attendance', `${s.attendance_pct}%`], ['Present', s.present], ['Leave', s.leave], ['Late', s.late], ['Avg hours', `${s.avg_hours}h`]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60"><div className="text-lg font-bold">{v}</div><div className="text-xs muted">{l}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {data.records.map((r) => <div key={r.id} title={`${r.date}: ${r.status}`} className={`h-6 w-6 rounded ${r.status === 'present' ? 'bg-emerald-500' : r.status === 'leave' ? 'bg-violet-500' : r.status === 'half_day' ? 'bg-amber-400' : 'bg-rose-500'}`} />)}
      </div>
    </div>
  );
}

function LeaveTab({ id }) {
  const { data = [], isLoading } = useGet('leave/balances', { employee_id: id });
  if (isLoading) return <CardSkeleton lines={4} />;
  return (
    <div className="card card-pad grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.filter((b) => b.code !== 'LOP').map((b) => (
        <div key={b.leave_type_id}>
          <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{b.name}</span><span className="muted">{b.available} / {b.allocated}</span></div>
          <Progress value={b.allocated ? (b.available / b.allocated) * 100 : 0} />
        </div>
      ))}
    </div>
  );
}

function AssetsTab({ id }) {
  const { data = [], isLoading } = useGet('assets', { assigned_to: id });
  if (isLoading) return <CardSkeleton lines={3} />;
  if (!data.length) return <div className="card"><EmptyState icon={Laptop} title="No assets assigned" /></div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((a) => (
        <div key={a.id} className="card flex items-center gap-3 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10"><Laptop size={18} /></div>
          <div className="flex-1"><div className="font-semibold">{a.name}</div><div className="text-xs muted">{a.asset_tag} · {a.serial_no}</div></div>
          <Badge status={a.status} />
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ id }) {
  const { data = [], isLoading } = useGet('documents', { employee_id: id });
  const personal = data.filter((d) => d.employee_id);
  if (isLoading) return <CardSkeleton lines={3} />;
  if (!personal.length) return <div className="card"><EmptyState icon={FileText} title="No personal documents" /></div>;
  return (
    <div className="card divide-y divide-slate-100 dark:divide-slate-800">
      {personal.map((d) => (
        <div key={d.id} className="flex items-center gap-3 p-4"><FileText size={18} className="text-brand-500" /><div className="flex-1"><div className="font-medium">{d.title}</div><div className="text-xs muted">{d.content}</div></div><Badge color="slate">{d.category}</Badge></div>
      ))}
    </div>
  );
}

export default function EmployeeProfile() {
  const { id } = useParams();
  const { user, isHR, isAdmin } = useAuth();
  const { data: e, isLoading, error } = useGet(`employees/${id}`);
  const [tab, setTab] = useState('overview');
  const edit = useDisclosure();
  const offboard = useDisclosure();
  const [exitDate, setExitDate] = useState(todayStr());
  const [reason, setReason] = useState('Resignation');
  const [act] = useAction();
  const navigate = useNavigate();

  if (error) return <div className="card"><EmptyState title="Employee not found" action={<Link to="/employees" className="btn-secondary">Back to directory</Link>} /></div>;
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="card flex items-center gap-5 p-6"><Skeleton className="h-20 w-20 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></div></div>
        <CardSkeleton lines={6} />
      </div>
    );
  }
  const name = `${e.first_name} ${e.last_name}`;
  const self = user.id === e.id;
  const canSeePrivate = isHR || self;
  const tenure = e.date_of_joining ? Math.max(0, (Date.now() - new Date(e.date_of_joining)) / (365.25 * 86400000)) : 0;

  return (
    <div className="space-y-6">
      <button className="btn-ghost btn-sm -ml-2" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
      <div className="card overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={name} color={e.avatar_color} size="xl" className="-mt-10 ring-4" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="profile-name">{name}</h1>
              <Badge status={e.status} /><Badge status={e.role} />
            </div>
            <div className="mt-0.5 muted">{e.designation} · {e.department || 'Leadership'} · {e.emp_code}</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm muted">
              <span className="flex items-center gap-1.5"><Mail size={14} />{e.email}</span>
              {e.phone && <span className="flex items-center gap-1.5"><Phone size={14} />{e.phone}</span>}
              <span className="flex items-center gap-1.5"><MapPin size={14} />{e.location}</span>
            </div>
          </div>
          {isHR && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" onClick={() => edit.onOpen()} data-testid="edit-employee"><Pencil size={14} /> Edit</button>
              <button className="btn-secondary btn-sm" onClick={() => act(`employees/${e.id}/reset-password`, { body: {}, success: 'Password reset to Welcome@123' })}><KeyRound size={14} /> Reset password</button>
              {e.status === 'active' && !self && <button className="btn-secondary btn-sm text-rose-600" onClick={() => offboard.onOpen()}><UserMinus size={14} /> Offboard</button>}
            </div>
          )}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'attendance', label: 'Attendance' }, { value: 'leave', label: 'Leave' },
        { value: 'assets', label: 'Assets' }, ...(canSeePrivate ? [{ value: 'documents', label: 'Documents' }] : []),
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Panel title="Job information" icon={Briefcase}>
              <Info label="Employee ID" value={e.emp_code} /><Info label="Designation" value={e.designation} /><Info label="Department" value={e.department} />
              <Info label="Reporting manager" value={e.manager_id ? <Link className="text-brand-600 hover:underline" to={`/employees/${e.manager_id}`}>{e.manager_name}</Link> : '—'} />
              <Info label="Employment type" value={e.employment_type} /><Info label="Shift" value={e.shift} />
              <Info label="Date of joining" value={date(e.date_of_joining)} /><Info label="Tenure" value={`${tenure.toFixed(1)} years`} />
              {e.exit_date && <Info label="Last working day" value={date(e.exit_date)} />}
            </Panel>
            <Panel title="Personal" icon={User}>
              <Info label="Date of birth" value={date(e.date_of_birth, { day: '2-digit', month: 'long' })} /><Info label="Gender" value={e.gender} />
              {canSeePrivate && <><Info label="Blood group" value={e.blood_group} /><Info label="Marital status" value={e.marital_status} />
                <Info label="Emergency contact" value={e.emergency_contact} /><Info label="Address" value={e.address} /></>}
            </Panel>
            {canSeePrivate && (
              <Panel title="Payroll & statutory" icon={Landmark}>
                <Info label="Annual CTC" value={money(e.annual_ctc)} /><Info label="PAN" value={e.pan} /><Info label="UAN" value={e.uan} />
                <Info label="Bank" value={e.bank_name} /><Info label="Account" value={e.bank_account ? `•••• ${String(e.bank_account).slice(-4)}` : '—'} /><Info label="IFSC" value={e.ifsc} />
              </Panel>
            )}
          </div>
          <div className="space-y-6">
            <div className="card card-pad">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><Building2 size={16} className="text-brand-500" /> Direct reports ({e.reports.length})</h3>
              {e.reports.length === 0 ? <p className="text-sm muted">No direct reports.</p> : (
                <div className="space-y-2">
                  {e.reports.map((r) => (
                    <Link key={r.id} to={`/employees/${r.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <Avatar name={`${r.first_name} ${r.last_name}`} color={r.avatar_color} size="sm" />
                      <div className="min-w-0"><div className="truncate text-sm font-semibold">{r.first_name} {r.last_name}</div><div className="truncate text-xs muted">{r.designation}</div></div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="card card-pad space-y-3 text-sm">
              <div className="flex items-center gap-2 muted"><Calendar size={14} /> Joined {date(e.date_of_joining)}</div>
              <div className="flex items-center gap-2 muted"><Clock size={14} /> {titleCase(e.employment_type)} · {e.shift || 'General'} shift</div>
            </div>
          </div>
        </div>
      )}
      {tab === 'attendance' && <AttendanceTab id={e.id} />}
      {tab === 'leave' && <LeaveTab id={e.id} />}
      {tab === 'assets' && <AssetsTab id={e.id} />}
      {tab === 'documents' && <DocumentsTab id={e.id} />}

      <FormModal open={edit.open} onClose={edit.onClose} title={`Edit ${name}`} size="lg" fields={employeeFields(isAdmin)} initial={e}
        onSubmit={(v) => act(`employees/${e.id}`, { method: 'PUT', body: v, success: 'Employee updated', invalidates: [`employees`] })} />
      <Modal open={offboard.open} onClose={offboard.onClose} title={`Offboard ${name}`} size="sm"
        footer={<><button className="btn-secondary" onClick={offboard.onClose}>Cancel</button>
          <button className="btn-danger" onClick={async () => { if (await act(`employees/${e.id}/offboard`, { body: { exit_date: exitDate, reason }, success: 'Offboarding initiated' })) offboard.onClose(); }}>Start offboarding</button></>}>
        <div className="space-y-4">
          <div><label className="label" htmlFor="exit-date">Last working day</label><input id="exit-date" type="date" className="input" value={exitDate} onChange={(ev) => setExitDate(ev.target.value)} /></div>
          <div><label className="label" htmlFor="exit-reason">Reason</label>
            <select id="exit-reason" className="input" value={reason} onChange={(ev) => setReason(ev.target.value)}>
              {['Resignation', 'Termination', 'Retirement', 'End of contract', 'Absconding'].map((r) => <option key={r}>{r}</option>)}
            </select></div>
          <p className="text-xs muted">An offboarding checklist (asset recovery, access revocation, F&F settlement) will be created.</p>
        </div>
      </Modal>
    </div>
  );
}
