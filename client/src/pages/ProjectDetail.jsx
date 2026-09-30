import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2, CheckCircle2, Clock, IndianRupee, TrendingUp, Wallet, Users, Save, Flag } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { Badge, Tabs, StatCard, StatSkeletons, CardSkeleton, EmptyState, Avatar, Progress } from '../components/ui';
import { FormModal, EmployeeSelect } from '../components/Form';
import { money, date, shortDate } from '../lib/format';
import { useChartTheme } from '../lib/chart';
import { BILLING, HEALTH, PROJECT_FIELDS } from './Projects';

function Team({ projectId, members, canEdit }) {
  const [rows, setRows] = useState(members);
  const [pick, setPick] = useState(null);
  const [act, { isLoading }] = useAction();
  useEffect(() => setRows(members), [members]);
  const set = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const dirty = JSON.stringify(rows.map((r) => [r.employee_id, r.role, Number(r.bill_rate), r.cost_rate])) !== JSON.stringify(members.map((r) => [r.employee_id, r.role, Number(r.bill_rate), r.cost_rate]));
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm" data-testid="project-team">
        <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
          <th className="px-4 py-3">Member</th><th className="px-4 py-3">Role</th><th className="px-4 py-3 text-right">Hours</th>
          {canEdit && <><th className="px-4 py-3">Bill rate (₹/h)</th><th className="px-4 py-3">Cost rate (₹/h)</th><th /></>}
        </tr></thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.employee_id} className="border-b border-slate-50 dark:border-slate-800/60">
              <td className="px-4 py-2"><div className="flex items-center gap-2"><Avatar name={m.name} color={m.avatar_color} size="xs" /><div><div className="font-medium">{m.name}</div><div className="text-xs muted">{m.designation}</div></div></div></td>
              <td className="px-4 py-2">{canEdit ? <input className="input !py-1.5" value={m.role || ''} onChange={set(i, 'role')} aria-label={`Role of ${m.name}`} /> : m.role || '—'}</td>
              <td className="px-4 py-2 text-right">{Math.round(m.hours * 10) / 10}<span className="text-xs muted"> ({Math.round(m.billable_hours)} billable)</span></td>
              {canEdit && <>
                <td className="px-4 py-2"><input type="number" min="0" className="input !py-1.5" value={m.bill_rate ?? 0} onChange={set(i, 'bill_rate')} aria-label={`Bill rate of ${m.name}`} /></td>
                <td className="px-4 py-2"><input type="number" min="0" className="input !py-1.5" placeholder="from salary" value={m.cost_rate ?? ''} onChange={set(i, 'cost_rate')} aria-label={`Cost rate of ${m.name}`} /></td>
                <td className="px-2"><button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label={`Remove ${m.name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState icon={Users} title="No team members yet" />}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
          <div className="w-64"><EmployeeSelect value={pick} onChange={setPick} placeholder="Add a member…" filter={(e) => !rows.some((r) => r.employee_id === e.id)} /></div>
          <button className="btn-secondary btn-sm" disabled={!pick} onClick={() => { setRows([...rows, { employee_id: pick, name: 'New member', role: '', bill_rate: 0, cost_rate: null, hours: 0, billable_hours: 0 }]); setPick(null); }}><Plus size={14} /> Add</button>
          <span className="flex-1" />
          <p className="text-xs muted">Cost rate defaults to annual CTC ÷ 2,000 hours.</p>
          <button className="btn-primary btn-sm" disabled={!dirty || isLoading} data-testid="save-team"
            onClick={() => act(`projects/${projectId}/members`, { method: 'PUT', body: { members: rows.map((r) => ({ employee_id: r.employee_id, role: r.role, bill_rate: Number(r.bill_rate) || 0, cost_rate: r.cost_rate === '' ? null : r.cost_rate })) }, success: 'Team saved' })}>
            <Save size={14} /> Save team
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { isManager, isHR } = useAuth();
  const { data, isLoading, error } = useGet(`projects/${id}/overview`);
  const [tab, setTab] = useState('overview');
  const [act] = useAction();
  const edit = useDisclosure();
  const milestone = useDisclosure();
  const chart = useChartTheme();
  if (error) return <div className="card"><EmptyState title={error.status === 403 ? 'You are not on this project' : 'Project not found'} action={<Link to="/projects" className="btn-secondary">Back to projects</Link>} /></div>;
  const p = data?.project;
  const f = data?.financials;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="btn-ghost btn-sm !px-2" aria-label="Back to projects"><ArrowLeft size={18} /></Link>
          {p ? (
            <div>
              <h1 className="text-xl font-bold" data-testid="project-title">{p.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm muted">
                {p.code && <span className="font-mono text-xs">{p.code}</span>}{p.client_name && <span>· {p.client_name}</span>}
                <Badge status={p.billing_type}>{BILLING.find((b) => b[0] === p.billing_type)?.[1]}</Badge><Badge status={p.health}>{HEALTH.find((h) => h[0] === p.health)?.[1]}</Badge><Badge status={p.status} />
              </div>
            </div>
          ) : <div className="skeleton h-10 w-64" />}
        </div>
        {isManager && p && <button className="btn-secondary" onClick={() => edit.onOpen(p)}><Pencil size={16} /> Edit project</button>}
      </div>

      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Clock} label="Hours logged" value={Math.round(p.logged_hours).toLocaleString('en-IN')} hint={p.budget_hours ? `of ${p.budget_hours} h budget` : `${Math.round(p.billable_hours)} billable`} />
          {f ? <>
            <StatCard icon={IndianRupee} tone="sky" label="Billed" value={money(f.billed)} hint={`${money(f.collected)} collected`} />
            <StatCard icon={Wallet} tone="amber" label="Unbilled (approved time)" value={money(f.unbilled)} />
            <StatCard icon={TrendingUp} tone={f.margin >= 0 ? 'green' : 'rose'} label="Margin" value={f.margin_pct == null ? '—' : `${f.margin_pct}%`} hint={`${money(f.margin)} after ${money(f.cost)} cost`} />
          </> : <StatCard icon={Users} tone="sky" label="Team" value={data.members.length} />}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'team', label: 'Team', count: data?.members.length },
        { value: 'milestones', label: 'Milestones', count: data?.milestones.length }, { value: 'allocations', label: 'Allocations', count: data?.allocations.length },
        ...(isHR ? [{ value: 'invoices', label: 'Invoices', count: data?.invoices.length }] : []),
      ]} />

      {isLoading ? <CardSkeleton lines={6} /> : <>
        {tab === 'overview' && (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="card card-pad xl:col-span-2">
              <h3 className="mb-4 font-semibold">Hours per week</h3>
              {data.weekly_hours.length === 0 ? <p className="text-sm muted">No time logged yet.</p> : (
                <div className="h-64" data-testid="project-hours-chart">
                  <ResponsiveContainer>
                    <BarChart data={data.weekly_hours.map((w) => ({ ...w, non_billable: Math.round((w.hours - w.billable) * 10) / 10, billable: Math.round(w.billable * 10) / 10 }))} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="week_start" tickFormatter={shortDate} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                      <Tooltip {...chart.tooltip} labelFormatter={(l) => `Week of ${shortDate(l)}`} formatter={(v) => `${v} h`} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="billable" name="Billable" stackId="h" fill={chart.series[0]} stroke={chart.surface} strokeWidth={2} barSize={24} />
                      <Bar dataKey="non_billable" name="Non-billable" stackId="h" fill={chart.series[6]} stroke={chart.surface} strokeWidth={2} radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="card card-pad space-y-4 text-sm">
              <h3 className="font-semibold">Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs muted">Manager</div><div className="font-medium">{p.manager_name || '—'}</div></div>
                <div><div className="text-xs muted">Dates</div><div className="font-medium">{date(p.start_date, { day: '2-digit', month: 'short' })} – {date(p.end_date)}</div></div>
                {f && p.budget_amount ? <div className="col-span-2"><div className="mb-1 flex justify-between text-xs"><span className="muted">Budget used (billed + unbilled)</span><span>{f.budget_used_pct}% of {money(p.budget_amount)}</span></div>
                  <Progress value={Math.min(100, f.budget_used_pct)} color={f.budget_used_pct > 100 ? 'bg-rose-500' : f.budget_used_pct > 85 ? 'bg-amber-500' : 'bg-brand-500'} /></div> : null}
              </div>
              {p.description && <p className="muted">{p.description}</p>}
            </div>
          </div>
        )}
        {tab === 'team' && <Team projectId={p.id} members={data.members} canEdit={isManager} />}
        {tab === 'milestones' && (
          <div className="card card-pad space-y-3">
            {p.billing_type !== 'fixed' && <p className="text-xs muted">Milestones drive invoicing on fixed-price projects; on other projects they track delivery.</p>}
            {data.milestones.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800" data-testid="milestone">
                <Flag size={16} className={m.status === 'pending' ? 'text-slate-400' : 'text-emerald-500'} />
                <div className="min-w-0 flex-1"><div className="font-semibold">{m.name}</div><div className="text-xs muted">Due {date(m.due_date)}{m.completed_on ? ` · completed ${date(m.completed_on)}` : ''}</div></div>
                {f && <span className="font-semibold">{money(m.amount)}</span>}
                <Badge status={m.status} />
                {isManager && m.status === 'pending' && <button className="btn-secondary btn-sm" onClick={() => act(`projects/milestones/${m.id}/complete`, { success: 'Milestone completed — ready to invoice', invalidates: ['projects'] })} data-testid="complete-milestone"><CheckCircle2 size={14} /> Complete</button>}
                {isManager && m.status !== 'invoiced' && <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label={`Delete ${m.name}`} onClick={() => act(`projects/milestones/${m.id}`, { method: 'DELETE', invalidates: ['projects'] })}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!data.milestones.length && <p className="text-sm muted">No milestones.</p>}
            {isManager && <button className="btn-secondary btn-sm" onClick={() => milestone.onOpen()} data-testid="add-milestone"><Plus size={14} /> Add milestone</button>}
          </div>
        )}
        {tab === 'allocations' && (
          <div className="card card-pad space-y-2">
            {data.allocations.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800">
                <Avatar name={a.name} color={a.avatar_color} size="xs" />
                <div className="min-w-0 flex-1"><div className="font-medium">{a.name}</div><div className="text-xs muted">{a.role || 'Member'} · {date(a.start_date, { day: '2-digit', month: 'short' })} – {date(a.end_date)}</div></div>
                <Badge color={a.billable ? 'green' : 'slate'}>{a.allocation_pct}%{a.billable ? '' : ' non-billable'}</Badge>
              </div>
            ))}
            {!data.allocations.length && <p className="text-sm muted">No current allocations. Plan people in <Link to="/resources" className="text-brand-600 hover:underline">Resources</Link>.</p>}
          </div>
        )}
        {tab === 'invoices' && (
          <div className="card card-pad space-y-2">
            {data.invoices.map((i) => (
              <Link key={i.id} to={`/finance?invoice=${i.id}`} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm hover:border-brand-300 dark:border-slate-800">
                <div><div className="font-mono text-xs font-semibold">{i.number}</div><div className="text-xs muted">Issued {date(i.issue_date)} · due {date(i.due_date)}</div></div>
                <div className="flex items-center gap-2"><span className="font-semibold">{money(i.total)}</span><Badge status={i.status} /></div>
              </Link>
            ))}
            {!data.invoices.length && <p className="text-sm muted">No invoices yet. Create one in <Link to="/finance" className="text-brand-600 hover:underline">Finance</Link>.</p>}
          </div>
        )}
      </>}

      <FormModal open={edit.open} onClose={edit.onClose} size="lg" title="Edit project" fields={PROJECT_FIELDS} initial={edit.payload || {}}
        onSubmit={(v) => act(`projects/${id}`, { method: 'PUT', body: Object.fromEntries(PROJECT_FIELDS.map((fl) => [fl.name, v[fl.name] ?? null])), success: 'Project updated' })} />
      <FormModal open={milestone.open} onClose={milestone.onClose} title="Add milestone" initial={{}}
        fields={[{ name: 'name', label: 'Milestone', required: true, full: true }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0 }]}
        onSubmit={(v) => act(`projects/${id}/milestones`, { body: v, success: 'Milestone added', invalidates: ['projects'] })} />
    </div>
  );
}
