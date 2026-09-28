import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Plus, Star, Rocket, ClipboardCheck, Pencil, MessageSquareHeart, Send, Users, CalendarClock, CheckCircle2, X, Lock, Globe, Eye } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Progress, Avatar, CardSkeleton, EmptyState, Modal, StatCard, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal, EmployeeSelect } from '../components/Form';
import { date, dateTime, timeAgo } from '../lib/format';

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

const VIS = { recipient: ['Shared with them', Eye], manager: ['Private to their manager', Lock], public: ['Public on profile', Globe] };
const COMPETENCIES = ['Communication', 'Ownership', 'Collaboration', 'Technical skill', 'Leadership', 'Customer focus'];

function FeedbackCard({ f, showTo }) {
  const [label, Icon] = VIS[f.visibility] || VIS.recipient;
  return (
    <div className="card card-pad" data-testid="feedback-item">
      <div className="flex items-center gap-3">
        <Avatar name={f.from_name} color={f.from_color} size="sm" />
        <div className="min-w-0 flex-1 text-sm"><b>{f.from_name}</b>{showTo && <> → <b>{f.to_name}</b></>}<div className="text-xs muted">{timeAgo(f.created_at)}</div></div>
        {f.competency && <Badge color="violet">{f.competency}</Badge>}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm">{f.message}</p>
      <div className="mt-3 flex items-center gap-1 text-xs muted"><Icon size={12} /> {label}{f.request_id ? ' · 360° response' : ''}</div>
    </div>
  );
}

function Feedback() {
  const { isManager, user } = useAuth();
  const [scope, setScope] = useState('received');
  const { data = [], isLoading } = useGet('people/feedback', { scope });
  const { data: requests = [] } = useGet('people/feedback/requests');
  const { data: sent = [] } = useGet('people/feedback/requests', { scope: 'sent' });
  const [act] = useAction();
  const give = useDisclosure();
  const ask = useDisclosure();
  const [reviewers, setReviewers] = useState([]);
  const [pick, setPick] = useState(null);
  const [question, setQuestion] = useState('');
  const [subject, setSubject] = useState(null);
  const { data: emps = [] } = useGet('employees');
  const nameOf = (id) => { const e = emps.find((x) => x.id === id); return e ? `${e.first_name} ${e.last_name}` : ''; };
  return (
    <div className="space-y-6">
      {requests.length > 0 && (
        <div className="card card-pad border-brand-200 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/5" data-testid="feedback-requests">
          <h3 className="mb-3 font-semibold">Feedback requested from you ({requests.length})</h3>
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 dark:bg-slate-900">
                <Avatar name={r.subject_name} color={r.subject_color} size="sm" />
                <div className="min-w-0 flex-1 text-sm"><b>{r.subject_name}</b><div className="text-xs muted">Asked by {r.requester_name}{r.question ? ` · “${r.question}”` : ''}</div></div>
                <button className="btn-primary btn-sm" onClick={() => give.onOpen({ to_id: r.subject_id, request_id: r.id, visibility: 'recipient' })} data-testid="respond-request">Respond</button>
                <button className="btn-ghost btn-sm" onClick={() => act(`people/feedback/requests/${r.id}/decline`, { success: 'Request declined' })}>Decline</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[['received', 'Received'], ['given', 'Given'], ...(isManager ? [['team', 'My team']] : []), ['requests', `360° requests (${sent.length})`]].map(([v, l]) => (
            <button key={v} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', scope === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')} onClick={() => setScope(v)}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => { setReviewers([]); setQuestion(''); setSubject(null); ask.onOpen(); }} data-testid="request-feedback"><Users size={16} /> Request 360° feedback</button>
          <button className="btn-primary" onClick={() => give.onOpen({ visibility: 'recipient' })} data-testid="give-feedback"><MessageSquareHeart size={16} /> Give feedback</button>
        </div>
      </div>
      {scope === 'requests' ? (
        <DataTable rows={sent} searchKeys={['subject_name', 'reviewer_name']} exportName="feedback-requests"
          empty={<EmptyState icon={Users} title="No requests sent" message="Ask peers for 360° feedback about yourself or your team." />}
          columns={[
            { key: 'subject_name', header: 'About' }, { key: 'reviewer_name', header: 'Reviewer' },
            { key: 'question', header: 'Question', width: 'minmax(200px, 2fr)', render: (r) => r.question || '—' },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status === 'completed' ? 'approved' : r.status === 'declined' ? 'rejected' : 'pending'}>{r.status}</Badge> },
            { key: 'created_at', header: 'Sent', render: (r) => timeAgo(r.created_at) },
          ]} />
      ) : isLoading ? <CardSkeleton lines={4} /> : data.length === 0 ? <div className="card"><EmptyState icon={MessageSquareHeart} title="No feedback yet" message="Continuous feedback helps people grow between review cycles." /></div> : (
        <div className="grid gap-4 md:grid-cols-2">{data.map((f) => <FeedbackCard key={f.id} f={f} showTo={scope !== 'received'} />)}</div>
      )}
      <FormModal open={give.open} onClose={give.onClose} title={give.payload?.request_id ? 'Respond to feedback request' : 'Give feedback'} submitLabel="Send feedback" initial={give.payload || {}}
        fields={[
          { name: 'to_id', label: 'To', type: 'employee', required: true, full: true, filter: (e) => e.id !== user.id },
          { name: 'competency', label: 'Competency', type: 'select', options: COMPETENCIES },
          { name: 'visibility', label: 'Visibility', type: 'select', noEmpty: true, options: Object.entries(VIS).map(([k, [l]]) => [k, l]) },
          { name: 'message', label: 'Feedback', type: 'textarea', required: true, full: true, placeholder: 'Be specific: what happened, the impact, and what to keep or change.' },
        ]}
        onSubmit={(v) => act('people/feedback', { body: v, success: 'Feedback sent' })} />
      <Modal open={ask.open} onClose={ask.onClose} title="Request 360° feedback"
        footer={<><button className="btn-secondary" onClick={ask.onClose}>Cancel</button><button className="btn-primary" disabled={!reviewers.length} data-testid="send-feedback-request"
          onClick={async () => { if (await act('people/feedback/requests', { body: { reviewer_ids: reviewers, question, subject_id: subject || undefined }, success: `Feedback requested from ${reviewers.length} colleague(s)` })) ask.onClose(); }}><Send size={16} /> Send requests</button></>}>
        <div className="space-y-4">
          {isManager && <div><label className="label">About</label><EmployeeSelect value={subject} onChange={setSubject} placeholder="Myself" filter={(e) => e.manager_id === user.id} /></div>}
          <div><label className="label" htmlFor="rev-pick">Reviewers (up to 10)</label>
            <div className="flex gap-2"><div className="flex-1"><EmployeeSelect id="rev-pick" value={pick} onChange={setPick} filter={(e) => e.id !== (subject || user.id) && !reviewers.includes(e.id)} /></div>
              <button type="button" className="btn-secondary" disabled={!pick || reviewers.length >= 10} onClick={() => { setReviewers([...reviewers, pick]); setPick(null); }} data-testid="add-reviewer">Add</button></div>
            <div className="mt-2 flex flex-wrap gap-2">{reviewers.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{nameOf(id)}<button onClick={() => setReviewers(reviewers.filter((x) => x !== id))} aria-label={`Remove ${nameOf(id)}`}><X size={12} /></button></span>)}</div>
          </div>
          <div><label className="label" htmlFor="rev-q">Question (optional)</label><textarea id="rev-q" className="input min-h-20" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should I keep doing, and what could I do better?" /></div>
        </div>
      </Modal>
    </div>
  );
}

function OneOnOnes() {
  const { user } = useAuth();
  const { data = [], isLoading } = useGet('people/one-on-ones');
  const { data: emps = [] } = useGet('employees');
  const me = emps.find((e) => e.id === user.id);
  const [act] = useAction();
  const add = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({});
  const open = data.find((o) => o.id === openId);
  const upcoming = data.filter((o) => o.status === 'scheduled');
  const past = data.filter((o) => o.status !== 'scheduled');
  const openMeeting = (o) => { setOpenId(o.id); setDraft({ agenda: o.agenda || '', notes: o.notes || '', action_items: o.action_items || '' }); };
  const other = (o) => (o.manager_id === user.id ? [o.employee_name, o.employee_color, 'Report'] : [o.manager_name, o.manager_color, 'Manager']);
  const Row = ({ o }) => { const [n, c, rel] = other(o); return (
    <button onClick={() => openMeeting(o)} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-brand-300 dark:border-slate-800" data-testid="one-on-one">
      <Avatar name={n} color={c} size="sm" />
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{n} <span className="font-normal muted">· {rel}</span></div><div className="truncate text-xs muted">{o.agenda || 'No agenda yet'}</div></div>
      <div className="text-right text-xs"><div className="font-semibold">{dateTime(o.scheduled_at)}</div><div className="muted">{o.duration_mins} min</div></div>
      <Badge status={o.status === 'completed' ? 'done' : o.status === 'cancelled' ? 'rejected' : 'pending'}>{o.status}</Badge>
    </button>
  ); };
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()} data-testid="schedule-1on1"><CalendarClock size={16} /> Schedule 1:1</button></div>
      {isLoading ? <CardSkeleton lines={4} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card card-pad"><h3 className="mb-3 font-semibold">Upcoming ({upcoming.length})</h3><div className="space-y-2">{upcoming.length ? upcoming.slice().reverse().map((o) => <Row key={o.id} o={o} />) : <p className="text-sm muted">Nothing scheduled.</p>}</div></div>
          <div className="card card-pad"><h3 className="mb-3 font-semibold">Past ({past.length})</h3><div className="space-y-2">{past.length ? past.map((o) => <Row key={o.id} o={o} />) : <p className="text-sm muted">No past meetings.</p>}</div></div>
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="Schedule a one-on-one" submitLabel="Schedule" initial={{ duration_mins: 30 }}
        fields={[
          { name: 'with_id', label: 'With', type: 'employee', required: true, full: true, filter: (e) => e.manager_id === user.id || (me && e.id === me.manager_id) },
          { name: 'scheduled_at', label: 'When', type: 'datetime-local', required: true },
          { name: 'duration_mins', label: 'Duration (minutes)', type: 'select', noEmpty: true, options: [15, 30, 45, 60] },
          { name: 'agenda', label: 'Agenda', type: 'textarea', full: true, placeholder: 'Wins, blockers, growth, feedback…' },
        ]}
        onSubmit={(v) => act('people/one-on-ones', { body: v, success: 'One-on-one scheduled' })} />
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open ? `1:1 · ${other(open)[0]}` : ''} size="lg"
        footer={open && <>
          {open.status === 'scheduled' && <button className="btn-ghost text-rose-600" onClick={async () => { if (await act(`people/one-on-ones/${open.id}`, { method: 'PUT', body: { status: 'cancelled' }, success: 'Meeting cancelled' })) setOpenId(null); }}>Cancel meeting</button>}
          <button className="btn-secondary" onClick={() => act(`people/one-on-ones/${open.id}`, { method: 'PUT', body: draft, success: 'Notes saved' })} data-testid="save-1on1">Save notes</button>
          {open.status === 'scheduled' && <button className="btn-primary" data-testid="complete-1on1" onClick={async () => { if (await act(`people/one-on-ones/${open.id}`, { method: 'PUT', body: { ...draft, status: 'completed' }, success: 'Marked complete — action items shared' })) setOpenId(null); }}><CheckCircle2 size={16} /> Complete</button>}
        </>}>
        {open && (
          <div className="space-y-4">
            <div className="text-sm muted">{dateTime(open.scheduled_at)} · {open.duration_mins} min · {open.manager_name} & {open.employee_name}</div>
            {[['agenda', 'Shared agenda'], ['notes', 'Notes'], ['action_items', 'Action items']].map(([k, l]) => (
              <div key={k}><label className="label" htmlFor={`oo-${k}`}>{l}</label><textarea id={`oo-${k}`} className="input min-h-20" value={draft[k] || ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

const PERF_TABS = [{ value: 'goals', label: 'Goals & OKRs' }, { value: 'reviews', label: 'Reviews' }, { value: 'feedback', label: 'Feedback' }, { value: 'one-on-ones', label: 'One-on-ones' }];

export default function Performance() {
  const [params, setParams] = useSearchParams();
  const tab = PERF_TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'goals';
  const Body = { goals: Goals, reviews: Reviews, feedback: Feedback, 'one-on-ones': OneOnOnes }[tab];
  return (
    <div>
      <PageHeader icon={Target} title="Performance" subtitle="Goals & OKRs, reviews, continuous feedback and one-on-ones" />
      <Tabs value={tab} onChange={(t) => setParams(t === 'goals' ? {} : { tab: t }, { replace: true })} tabs={PERF_TABS} />
      <Body />
    </div>
  );
}
