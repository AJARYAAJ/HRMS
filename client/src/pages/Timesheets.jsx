import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Timer, Plus, FolderKanban, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, Progress, CardSkeleton, StatCard } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { todayStr, date } from '../lib/format';

const weekStart = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function MyTimesheet({ openNew }) {
  const [start, setStart] = useState(weekStart(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return ymd(d); });
  const { data = [], isLoading } = useGet('timesheets', { mine: 1, from: days[0], to: days[6] });
  const [act] = useAction();
  const byProject = useMemo(() => {
    const m = new Map();
    for (const t of data) {
      const k = t.project_name || 'General';
      if (!m.has(k)) m.set(k, {});
      m.get(k)[t.date] = (m.get(k)[t.date] || 0) + t.hours;
    }
    return [...m.entries()];
  }, [data]);
  const total = data.reduce((a, t) => a + t.hours, 0);
  const billable = data.filter((t) => t.billable).reduce((a, t) => a + t.hours, 0);
  const shift = (n) => setStart((s) => { const d = new Date(s); d.setDate(d.getDate() + n * 7); return d; });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Timer} label="Hours this week" value={total} hint="Target 40h" />
        <StatCard icon={FolderKanban} tone="green" label="Billable" value={`${billable}h`} hint={`${total ? Math.round((billable / total) * 100) : 0}% utilisation`} />
        <StatCard icon={Timer} tone="amber" label="Pending approval" value={data.filter((t) => t.status === 'pending').length} />
        <StatCard icon={Timer} tone="sky" label="Approved" value={data.filter((t) => t.status === 'approved').length} />
      </div>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm !px-2" onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold">{date(days[0], { day: '2-digit', month: 'short' })} – {date(days[6])}</span>
            <button className="btn-secondary btn-sm !px-2" onClick={() => shift(1)} aria-label="Next week"><ChevronRight size={16} /></button>
          </div>
          <button className="btn-primary btn-sm" onClick={openNew} data-testid="log-time"><Plus size={14} /> Log time</button>
        </div>
        {isLoading ? <div className="p-4"><CardSkeleton lines={4} className="!border-0 !p-0 !shadow-none" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 text-left">Project</th>
                {days.map((d) => <th key={d} className="px-2 py-2 text-center">{date(d, { weekday: 'short' })}<div className="font-normal normal-case">{date(d, { day: '2-digit' })}</div></th>)}
                <th className="px-4 py-2 text-right">Total</th>
              </tr></thead>
              <tbody>
                {byProject.length === 0 && <tr><td colSpan={9} className="p-8 text-center muted">No time logged this week.</td></tr>}
                {byProject.map(([p, hrs]) => (
                  <tr key={p} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium">{p}</td>
                    {days.map((d) => <td key={d} className="px-2 py-3 text-center">{hrs[d] ? <span className="rounded-lg bg-brand-50 px-2 py-1 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{hrs[d]}</span> : <span className="text-slate-300">–</span>}</td>)}
                    <td className="px-4 py-3 text-right font-bold">{Object.values(hrs).reduce((a, b) => a + b, 0)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <DataTable title="Entries" loading={isLoading} rows={data} maxHeight="360px"
        columns={[
          { key: 'date', header: 'Date', render: (r) => date(r.date) }, { key: 'project_name', header: 'Project' },
          { key: 'task', header: 'Task', width: 'minmax(180px, 2fr)' }, { key: 'hours', header: 'Hours' },
          { key: 'billable', header: 'Billable', render: (r) => (r.billable ? 'Yes' : 'No') },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'x', header: '', sortable: false, render: (r) => r.status === 'pending' && <button className="text-slate-400 hover:text-rose-500" aria-label="Delete entry" onClick={() => act(`timesheets/${r.id}`, { method: 'DELETE', success: 'Entry deleted' })}><Trash2 size={15} /></button> },
        ]} />
    </div>
  );
}

function Projects() {
  const { isManager } = useAuth();
  const { data = [], isLoading } = useGet('projects');
  const [act] = useAction();
  const add = useDisclosure();
  return (
    <div className="space-y-4">
      {isManager && <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> New project</button></div>}
      {isLoading ? <CardSkeleton lines={4} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const pct = p.budget_hours ? (p.logged_hours / p.budget_hours) * 100 : 0;
            return (
              <div key={p.id} className="card card-pad">
                <div className="flex items-start justify-between"><div><div className="font-semibold">{p.name}</div><div className="text-xs muted">{p.client}</div></div><Badge status={p.status} /></div>
                <div className="mt-4 flex justify-between text-xs muted"><span>{p.logged_hours}h logged</span><span>{p.budget_hours}h budget</span></div>
                <Progress value={pct} className="mt-1.5" color={pct > 90 ? 'bg-rose-500' : 'bg-brand-500'} />
                <div className="mt-3 flex justify-between text-xs muted"><span>{p.members} contributors</span><span>{date(p.start_date)} → {date(p.end_date)}</span></div>
              </div>
            );
          })}
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="New project" initial={{ status: 'active', start_date: todayStr() }}
        fields={[{ name: 'name', label: 'Project name', required: true }, { name: 'client', label: 'Client' }, { name: 'start_date', label: 'Start', type: 'date' },
          { name: 'end_date', label: 'End', type: 'date' }, { name: 'budget_hours', label: 'Budget hours', type: 'number', min: 0 },
          { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: ['active', 'on_hold', 'completed'] }]}
        onSubmit={(v) => act('projects', { body: v, success: 'Project created' })} />
    </div>
  );
}

function TeamTimesheets() {
  const { data = [], isLoading } = useGet('timesheets', { limit: 5000 });
  return (
    <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'project_name', 'task']} exportName="team-timesheets"
      columns={[
        { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> },
        { key: 'date', header: 'Date', render: (r) => date(r.date) }, { key: 'project_name', header: 'Project' }, { key: 'task', header: 'Task' },
        { key: 'hours', header: 'Hours' }, { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
      ]} />
  );
}

export default function Timesheets() {
  const { isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('mine');
  const log = useDisclosure();
  const [act] = useAction();
  useEffect(() => { if (params.get('new') === '1') { log.onOpen(); setParams({}); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader icon={Timer} title="Timesheets" subtitle="Track time against projects and monitor utilisation" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'My timesheet' }, { value: 'projects', label: 'Projects' }, ...(isManager ? [{ value: 'team', label: 'Team entries' }] : [])]} />
      {tab === 'mine' && <MyTimesheet openNew={() => log.onOpen()} />}
      {tab === 'projects' && <Projects />}
      {tab === 'team' && <TeamTimesheets />}
      <FormModal open={log.open} onClose={log.onClose} title="Log time" initial={{ date: todayStr(), hours: 8, billable: 1 }} submitLabel="Log time"
        fields={[
          { name: 'project_id', label: 'Project', type: 'lookup', path: 'projects', required: true },
          { name: 'date', label: 'Date', type: 'date', required: true, max: todayStr() },
          { name: 'hours', label: 'Hours', type: 'number', min: 0.5, max: 24, step: 0.5, required: true },
          { name: 'billable', label: 'Billable', type: 'checkbox' },
          { name: 'task', label: 'Task description', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => act('timesheets', { body: v, success: 'Time logged' })} />
    </div>
  );
}
