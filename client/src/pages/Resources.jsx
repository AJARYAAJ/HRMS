import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersRound, Plus, ChevronLeft, ChevronRight, Armchair, Gauge, AlertTriangle, Trash2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, StatCard, StatSkeletons, CardSkeleton, EmptyState, Confirm, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { date, todayStr } from '../lib/format';

const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Sequential single-hue scale for allocation %, with a distinct (violet) step for overallocation.
function cellClass(pct) {
  if (pct > 100) return 'bg-violet-600 text-white';
  if (pct >= 80) return 'bg-brand-600 text-white';
  if (pct >= 50) return 'bg-brand-400 text-white';
  if (pct > 0) return 'bg-brand-200 text-brand-900 dark:bg-brand-500/30 dark:text-brand-100';
  return 'bg-slate-100 text-slate-400 dark:bg-slate-800';
}

function Planner() {
  const [start, setStart] = useState(todayStr());
  const [dept, setDept] = useState('');
  const { data: depts = [] } = useGet('departments');
  const { data, isLoading } = useGet('resources/timeline', { start, weeks: 12, department_id: dept });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          <button className="btn-ghost btn-sm !px-2" onClick={() => setStart(addDays(start, -28))} aria-label="Earlier"><ChevronLeft size={16} /></button>
          <span className="px-2 text-sm font-semibold">{data ? `${date(data.weeks[0], { day: 'numeric', month: 'short' })} – ${date(addDays(data.weeks[data.weeks.length - 1], 6))}` : '…'}</span>
          <button className="btn-ghost btn-sm !px-2" onClick={() => setStart(addDays(start, 28))} aria-label="Later"><ChevronRight size={16} /></button>
        </div>
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs muted">
          {[[0, 'Free'], [40, '1–49%'], [60, '50–79%'], [90, '80–100%'], [120, 'Over 100%']].map(([p, l]) => <span key={l} className="flex items-center gap-1.5"><span className={cx('h-3 w-5 rounded', cellClass(p))} />{l}</span>)}
        </div>
      </div>
      {isLoading ? <CardSkeleton lines={8} /> : (
        <div className="card overflow-x-auto" data-testid="resource-planner">
          <table className="w-full min-w-[900px] text-xs">
            <thead><tr className="border-b border-slate-100 text-slate-400 dark:border-slate-800">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-semibold uppercase tracking-wide dark:bg-slate-900">Person</th>
              {data.weeks.map((w) => <th key={w} className="px-1 py-3 font-semibold">{date(w, { day: '2-digit', month: 'short' })}</th>)}
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60" data-testid="planner-row">
                  <td className="sticky left-0 z-10 bg-white px-4 py-1.5 dark:bg-slate-900"><div className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="xs" /><div className="min-w-0"><div className="truncate text-sm font-medium">{r.name}</div><div className="truncate text-[11px] muted">{r.department}</div></div></div></td>
                  {r.weeks.map((w) => (
                    <td key={w.start} className="px-0.5 py-1">
                      <div className={cx('flex h-9 items-center justify-center rounded-md font-semibold', cellClass(w.pct))} title={w.projects.length ? `${w.pct}% · ${w.projects.join(', ')}` : 'Available'}>{w.pct ? `${w.pct}%` : ''}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Utilisation() {
  const [dept, setDept] = useState('');
  const { data: depts = [] } = useGet('departments');
  const { data, isLoading } = useGet('resources/utilization', { department_id: dept });
  const s = data?.summary;
  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Gauge} label="Billable utilisation" value={`${s.billable_utilization}%`} hint={`Last 4 weeks · ${data.capacity_hours} h capacity each`} />
          <StatCard icon={UsersRound} tone="sky" label="Average allocation" value={`${s.avg_allocation}%`} hint={`${s.full} fully allocated`} />
          <StatCard icon={Armchair} tone="rose" label="On the bench" value={s.bench} hint="Under 20% allocated" />
          <StatCard icon={AlertTriangle} tone="violet" label="Overallocated" value={s.overallocated} hint="Over 100%" />
        </div>
      )}
      <DataTable loading={isLoading} rows={data?.rows || []} searchKeys={['name', 'department', 'designation']} exportName="utilisation" initialSort={{ key: 'allocation_pct', dir: 'asc' }}
        toolbar={<select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        columns={[
          { key: 'name', header: 'Person', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.designation || r.department}</div></div></div> },
          { key: 'allocation_pct', header: 'Allocation', render: (r) => <span className={cx('font-semibold', r.allocation_pct > 100 && 'text-violet-600')}>{r.allocation_pct}%</span> },
          { key: 'projects', header: 'Projects', align: 'right' },
          { key: 'logged_hours', header: 'Logged', align: 'right', render: (r) => `${r.logged_hours} h` },
          { key: 'billable_hours', header: 'Billable', align: 'right', render: (r) => `${r.billable_hours} h` },
          { key: 'utilization_pct', header: 'Utilisation', align: 'right', render: (r) => `${r.utilization_pct}%` },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
    </div>
  );
}

function Allocations() {
  const { isManager } = useAuth();
  const { data = [], isLoading } = useGet('resources/allocations');
  const [act] = useAction();
  const form = useDisclosure();
  const [del, setDel] = useState(null);
  const current = data.filter((a) => a.end_date >= todayStr());
  return (
    <>
      <DataTable loading={isLoading} rows={current} searchKeys={['employee_name', 'project_name', 'client_name', 'role']} exportName="allocations"
        toolbar={isManager && <button className="btn-primary btn-sm" onClick={() => form.onOpen()} data-testid="new-allocation"><Plus size={14} /> Allocate</button>}
        empty={<EmptyState icon={UsersRound} title="No current allocations" />}
        columns={[
          { key: 'employee_name', header: 'Person', width: 'minmax(180px, 1.3fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> },
          { key: 'project_name', header: 'Project', width: 'minmax(180px, 1.4fr)', render: (r) => <Link to={`/projects/${r.project_id}`} className="min-w-0 hover:underline"><div className="truncate font-medium">{r.project_name}</div><div className="truncate text-xs muted">{r.client_name}</div></Link> },
          { key: 'role', header: 'Role', render: (r) => r.role || '—' },
          { key: 'allocation_pct', header: 'Allocation', render: (r) => <Badge color={r.billable ? 'green' : 'slate'}>{r.allocation_pct}%{r.billable ? '' : ' · non-billable'}</Badge> },
          { key: 'start_date', header: 'From', render: (r) => date(r.start_date) },
          { key: 'end_date', header: 'To', render: (r) => date(r.end_date) },
          ...(isManager ? [{ key: '_a', header: '', sortable: false, csv: false, width: '60px', render: (r) => <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label="Remove allocation" onClick={() => setDel(r)}><Trash2 size={14} /></button> }] : []),
        ]} />
      <FormModal open={form.open} onClose={form.onClose} title="Allocate a person to a project" initial={{ allocation_pct: 100, billable: 1, start_date: todayStr(), end_date: addDays(todayStr(), 90) }}
        fields={[
          { name: 'employee_id', label: 'Person', type: 'employee', required: true, full: true },
          { name: 'project_id', label: 'Project', type: 'lookup', path: 'projects', required: true, full: true },
          { name: 'start_date', label: 'From', type: 'date', required: true }, { name: 'end_date', label: 'To', type: 'date', required: true },
          { name: 'allocation_pct', label: 'Allocation (%)', type: 'number', min: 5, max: 100, step: 5, required: true },
          { name: 'role', label: 'Role on project' },
          { name: 'billable', label: 'Billable to the client', type: 'checkbox', full: true },
        ]}
        onSubmit={(v) => act('resources/allocations', { body: v, success: 'Allocation saved', invalidates: ['projects'] })} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Remove allocation?" confirmLabel="Remove" message={del ? `${del.employee_name} on ${del.project_name}` : ''}
        onConfirm={() => act(`resources/allocations/${del.id}`, { method: 'DELETE', success: 'Allocation removed' })} />
    </>
  );
}

export default function Resources() {
  const [tab, setTab] = useState('planner');
  return (
    <div>
      <PageHeader icon={UsersRound} title="Resources" subtitle="Plan who works on what, spot the bench and overallocation, and track utilisation" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'planner', label: 'Planner' }, { value: 'utilisation', label: 'Utilisation' }, { value: 'allocations', label: 'Allocations' }]} />
      {tab === 'planner' && <Planner />}
      {tab === 'utilisation' && <Utilisation />}
      {tab === 'allocations' && <Allocations />}
    </div>
  );
}
