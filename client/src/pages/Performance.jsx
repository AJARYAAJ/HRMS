import { useState } from 'react';
import { Target, Plus, Star, Rocket, ClipboardCheck, Pencil } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Progress, Avatar, CardSkeleton, EmptyState, Modal, StatCard, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { date } from '../lib/format';

const cycleNow = () => { const d = new Date(); return `H${d.getMonth() < 6 ? 1 : 2} ${d.getFullYear()}`; };

function Stars({ value = 0, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} stars`}>
          <Star size={22} className={cx(n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600')} />
        </button>
      ))}
    </div>
  );
}

function Goals() {
  const { user, isManager } = useAuth();
  const [scope, setScope] = useState('mine');
  const { data = [], isLoading } = useGet('goals', scope === 'mine' ? { mine: 1 } : {});
  const [act] = useAction();
  const form = useDisclosure();
  const avg = data.length ? Math.round(data.reduce((a, g) => a + g.progress, 0) / data.length) : 0;
  const color = (s) => (s === 'completed' ? 'bg-emerald-500' : s === 'at_risk' ? 'bg-amber-500' : s === 'behind' ? 'bg-rose-500' : 'bg-brand-500');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Target} label="Goals" value={data.length} />
        <StatCard icon={Rocket} tone="green" label="Avg. progress" value={`${avg}%`} />
        <StatCard icon={ClipboardCheck} tone="sky" label="Completed" value={data.filter((g) => g.status === 'completed').length} />
        <StatCard icon={Target} tone="amber" label="At risk / behind" value={data.filter((g) => ['at_risk', 'behind'].includes(g.status)).length} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isManager ? (
          <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[['mine', 'My goals'], ['team', 'Team goals']].map(([v, l]) => <button key={v} onClick={() => setScope(v)} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', scope === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}>{l}</button>)}
          </div>
        ) : <div />}
        <button className="btn-primary" onClick={() => form.onOpen()} data-testid="add-goal"><Plus size={16} /> New goal</button>
      </div>
      {isLoading ? <CardSkeleton lines={6} /> : data.length === 0 ? <div className="card"><EmptyState icon={Target} title="No goals yet" message="Set measurable goals aligned with your team's priorities." /></div> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((g) => (
            <div key={g.id} className="card card-pad" data-testid="goal-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {scope === 'team' && <div className="mb-1 flex items-center gap-2 text-xs muted"><Avatar name={g.employee_name} color={g.avatar_color} size="xs" />{g.employee_name}</div>}
                  <div className="font-semibold">{g.title}</div>
                  <div className="mt-0.5 text-xs muted">{g.category} · {g.cycle} · weight {g.weight}% · due {date(g.due_date)}</div>
                </div>
                <div className="flex items-center gap-1"><Badge status={g.status} /><button className="btn-ghost btn-sm !px-1.5" onClick={() => form.onOpen(g)} aria-label="Edit goal"><Pencil size={13} /></button></div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Progress value={g.progress} color={color(g.status)} />
                <span className="w-10 text-right text-sm font-bold">{g.progress}%</span>
              </div>
              {(g.employee_id === user.id || isManager) && g.status !== 'completed' && (
                <input type="range" min="0" max="100" step="5" defaultValue={g.progress} className="mt-3 w-full accent-brand-600" aria-label="Update progress"
                  onMouseUp={(e) => act(`goals/${g.id}`, { method: 'PUT', body: { progress: Number(e.target.value) }, success: 'Progress updated' })}
                  onKeyUp={(e) => act(`goals/${g.id}`, { method: 'PUT', body: { progress: Number(e.target.value) } })} />
              )}
            </div>
          ))}
        </div>
      )}
      <FormModal open={form.open} onClose={form.onClose} title={form.payload ? 'Edit goal' : 'New goal'} initial={form.payload || { cycle: cycleNow(), category: 'Individual', weight: 20, progress: 0, status: 'on_track' }}
        fields={[
          ...(isManager && !form.payload ? [{ name: 'employee_id', label: 'Owner (leave empty for yourself)', type: 'employee', full: true }] : []),
          { name: 'title', label: 'Goal', required: true, full: true }, { name: 'description', label: 'Key results / how it is measured', type: 'textarea', full: true },
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['Individual', 'Team', 'Company', 'Learning'] }, { name: 'cycle', label: 'Cycle' },
          { name: 'weight', label: 'Weight (%)', type: 'number', min: 0, max: 100 }, { name: 'due_date', label: 'Due date', type: 'date' },
          { name: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100 },
          { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['on_track', 'On track'], ['at_risk', 'At risk'], ['behind', 'Behind'], ['completed', 'Completed']] },
        ]}
        onSubmit={(v) => (form.payload ? act(`goals/${form.payload.id}`, { method: 'PUT', body: v, success: 'Goal updated' }) : act('goals', { body: v, success: 'Goal created' }))} />
    </div>
  );
}

function Reviews() {
  const { user, isHR } = useAuth();
  const { data = [], isLoading } = useGet('reviews');
  const [act] = useAction();
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const launch = useDisclosure();
  const toast = useToast();
  const toastLaunch = (n) => toast(n ? `Review cycle launched for ${n} employees` : 'Everyone already has a review in this cycle', n ? 'success' : 'info');
  const isSelf = open && open.employee_id === user.id && open.status === 'self_review';
  const isReviewer = open && (open.reviewer_id === user.id || isHR) && open.employee_id !== user.id && open.status !== 'completed';
  const save = async (submit) => {
    const body = isSelf ? { self_rating: form.self_rating, self_comments: form.self_comments, submit } : { manager_rating: form.manager_rating, strengths: form.strengths, improvements: form.improvements, submit };
    if (await act(`reviews/${open.id}`, { method: 'PUT', body, success: submit ? 'Review submitted' : 'Draft saved' })) setOpen(null);
  };
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end"><button className="btn-primary" onClick={() => launch.onOpen()}><Rocket size={16} /> Launch review cycle</button></div>}
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'reviewer_name', 'cycle']} exportName="reviews" onRowClick={(r) => { setOpen(r); setForm(r); }}
        columns={[
          { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.6fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.employee_name}</div><div className="truncate text-xs muted">{r.designation}</div></div></div> },
          { key: 'cycle', header: 'Cycle' }, { key: 'reviewer_name', header: 'Reviewer' },
          { key: 'self_rating', header: 'Self', render: (r) => (r.self_rating ? `${r.self_rating} ★` : '—') },
          { key: 'manager_rating', header: 'Manager', render: (r) => (r.manager_rating ? `${r.manager_rating} ★` : '—') },
          { key: 'status', header: 'Stage', render: (r) => <Badge status={r.status} /> },
        ]} />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.cycle} review · ${open.employee_name}` : ''} size="lg"
        footer={(isSelf || isReviewer) && <><button className="btn-secondary" onClick={() => save(false)}>Save draft</button><button className="btn-primary" onClick={() => save(true)} data-testid="submit-review">Submit</button></>}>
        {open && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
              <div className="mb-2 text-sm font-semibold">Self assessment</div>
              <Stars value={form.self_rating} onChange={isSelf ? (v) => setForm((f) => ({ ...f, self_rating: v })) : undefined} />
              {isSelf ? <textarea className="input mt-3 min-h-24" placeholder="Key achievements this cycle…" value={form.self_comments || ''} onChange={(e) => setForm((f) => ({ ...f, self_comments: e.target.value }))} aria-label="Self comments" />
                : <p className="mt-2 text-sm muted">{open.self_comments || 'Not submitted yet.'}</p>}
            </div>
            <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
              <div className="mb-2 text-sm font-semibold">Manager evaluation</div>
              <Stars value={form.manager_rating} onChange={isReviewer ? (v) => setForm((f) => ({ ...f, manager_rating: v })) : undefined} />
              {isReviewer ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <textarea className="input min-h-24" placeholder="Strengths" value={form.strengths || ''} onChange={(e) => setForm((f) => ({ ...f, strengths: e.target.value }))} aria-label="Strengths" />
                  <textarea className="input min-h-24" placeholder="Areas of improvement" value={form.improvements || ''} onChange={(e) => setForm((f) => ({ ...f, improvements: e.target.value }))} aria-label="Improvements" />
                </div>
              ) : (
                <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2"><div><b>Strengths:</b> <span className="muted">{open.strengths || '—'}</span></div><div><b>Improve:</b> <span className="muted">{open.improvements || '—'}</span></div></div>
              )}
            </div>
          </div>
        )}
      </Modal>
      <FormModal open={launch.open} onClose={launch.onClose} title="Launch review cycle" size="sm" initial={{ cycle: cycleNow() }} submitLabel="Launch"
        fields={[{ name: 'cycle', label: 'Cycle name', required: true, full: true, hint: 'Creates a review for every active employee with their manager as reviewer.' }]}
        onSubmit={async (v) => { const r = await act('reviews/launch', { body: v }); if (r) toastLaunch(r.created); return r; }} />
    </div>
  );
}

export default function Performance() {
  const [tab, setTab] = useState('goals');
  return (
    <div>
      <PageHeader icon={Target} title="Performance" subtitle="Goals & OKRs, continuous check-ins and review cycles" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'goals', label: 'Goals & OKRs' }, { value: 'reviews', label: 'Reviews' }]} />
      {tab === 'goals' ? <Goals /> : <Reviews />}
    </div>
  );
}
