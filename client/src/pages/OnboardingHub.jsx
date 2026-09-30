import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Send, Copy, CheckCircle2, XCircle, FileText, UserCheck, RefreshCw, Ban, Plus, Trash2, Star, Pencil, Circle, Users, CalendarDays, ShieldCheck, GraduationCap, PartyPopper,
} from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { Badge, Drawer, Avatar, Progress, EmptyState, CardSkeleton, Modal, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { authFetch } from '../lib/files';
import { date, shortDate, todayStr, titleCase } from '../lib/format';

const OWNERS = ['HR', 'IT', 'Manager', 'Buddy', 'Employee', 'Finance', 'Learning', 'Admin'];
const STATUS_LABEL = { invited: 'Invited', in_progress: 'In progress', submitted: 'Submitted', converted: 'Joined', cancelled: 'Cancelled' };
const STATUS_TONE = { invited: 'slate', in_progress: 'blue', submitted: 'amber', converted: 'green', cancelled: 'slate' };

// ---------- pre-boarding (HR) ----------
function LinkBox({ url, onClose }) {
  const toast = useToast();
  return (
    <Modal open={!!url} onClose={onClose} title="Pre-boarding link" size="sm" footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <p className="text-sm muted">We emailed this private link to the new hire. You can also share it yourself — it works for 30 days and needs no password.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 text-xs dark:bg-slate-800" data-testid="portal-url">{url}</code>
        <button className="btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied'))}><Copy size={14} /> Copy</button>
      </div>
    </Modal>
  );
}

function PreboardingDrawer({ id, onClose, onLink }) {
  const { data: p, isLoading } = useGet(id ? `preboarding/${id}` : null);
  const [act] = useAction();
  const reject = useDisclosure();
  const toast = useToast();
  if (!id) return null;
  const view = async (d) => {
    const res = await authFetch(`/api/preboarding/${id}/documents/${d.id}/download`);
    if (!res.ok) return toast('Could not open the file', 'error');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  };
  const det = p?.details || {};
  const open = p && !['converted', 'cancelled'].includes(p.status);
  return (
    <Drawer open={!!id} onClose={onClose} title={p?.name || 'Pre-boarding'} width="max-w-2xl">
      {isLoading || !p ? <CardSkeleton lines={8} /> : (
        <div className="space-y-5" data-testid="preboarding-drawer">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            <span className="text-sm muted">{p.designation || 'Role TBD'} · joins {date(p.date_of_joining)}</span>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs muted"><span>Progress</span><span>{p.progress.pct}%</span></div>
            <Progress value={p.progress.pct} />
            {p.progress.blockers.length > 0 && p.status !== 'converted' && <p className="mt-1 text-xs muted">Waiting for: {p.progress.blockers.join(' · ')}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[['Email', p.email], ['Phone', det.personal?.phone || p.phone], ['Department', p.department], ['Manager', p.manager_name], ['Buddy', p.buddy_name], ['Checklist', p.template_name || 'Automatic'],
              ['Date of birth', det.personal?.date_of_birth], ['Blood group', det.personal?.blood_group], ['Emergency contact', det.emergency?.name && `${det.emergency.name} (${det.emergency.relation || '—'}) ${det.emergency.phone || ''}`],
              ['Bank', det.bank?.bank_name && `${det.bank.bank_name} · ${det.bank.ifsc || ''}`], ['PAN', det.bank?.pan], ['Offer', p.offer_accepted_at ? `Signed ${new Date(p.offer_accepted_at).toLocaleDateString()}` : 'Not signed yet']]
              .map(([k, v]) => <div key={k}><dt className="text-xs muted">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>)}
          </dl>
          {det.address?.current && <div className="text-sm"><div className="text-xs muted">Address</div>{det.address.current}</div>}
          <div>
            <h4 className="mb-2 font-semibold">Documents</h4>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800" data-testid="preboarding-docs">
              {p.doc_types.map((t) => {
                const d = p.documents.find((x) => x.doc_type === t.key);
                return (
                  <div key={t.key} className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid={`pdoc-${t.key}`}>
                    <FileText size={16} className="text-slate-400" />
                    <div className="min-w-0 flex-1"><div className="font-medium">{t.label}{!t.required && <span className="ml-1 text-xs muted">(optional)</span>}</div>
                      {d ? <button className="truncate text-xs text-brand-600 hover:underline" onClick={() => view(d)}>{d.original_name}</button> : <div className="text-xs muted">Not uploaded</div>}
                      {d?.status === 'rejected' && <div className="text-xs text-rose-600">Sent back: {d.note}</div>}</div>
                    {d && <Badge status={d.status === 'verified' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending'}>{titleCase(d.status)}</Badge>}
                    {d && open && d.status !== 'verified' && <button className="btn-ghost btn-sm text-emerald-600" onClick={() => act(`preboarding/${id}/documents/${d.id}`, { method: 'PUT', body: { status: 'verified' }, success: `${t.label} verified` })} data-testid="verify-doc"><CheckCircle2 size={14} /> Verify</button>}
                    {d && open && d.status !== 'rejected' && <button className="btn-ghost btn-sm text-rose-600" onClick={() => reject.onOpen(d)}><XCircle size={14} /> Send back</button>}
                  </div>
                );
              })}
            </div>
          </div>
          {open && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <button className="btn-primary" disabled={p.status !== 'submitted' || !p.progress.verified} data-testid="convert-preboarding"
                title={p.status !== 'submitted' ? 'Waiting for the new hire to submit' : !p.progress.verified ? 'Verify every required document first' : ''}
                onClick={async () => { const r = await act(`preboarding/${id}/convert`, { body: {}, success: 'Employee created — welcome email sent', invalidates: ['employees', 'onboarding'] }); if (r?.employee_id) onClose(); }}>
                <UserCheck size={16} /> Convert to employee
              </button>
              <button className="btn-secondary" onClick={async () => { const r = await act(`preboarding/${id}/resend`, { body: {}, success: 'New link emailed' }); if (r?.portal_url) onLink(r.portal_url); }}><RefreshCw size={16} /> Resend link</button>
              <button className="btn-secondary text-rose-600" onClick={async () => { if (await act(`preboarding/${id}/cancel`, { body: {}, success: 'Invite cancelled' })) onClose(); }}><Ban size={16} /> Cancel</button>
            </div>
          )}
          {p.status === 'converted' && p.employee_id && <Link to={`/employees/${p.employee_id}`} className="btn-secondary">Open employee profile</Link>}
        </div>
      )}
      <FormModal open={reject.open} onClose={reject.onClose} title="Send document back" submitLabel="Send back"
        fields={[{ name: 'note', label: 'What needs fixing?', type: 'textarea', required: true, full: true, placeholder: 'e.g. The back side is missing' }]}
        onSubmit={(v) => act(`preboarding/${id}/documents/${reject.payload.id}`, { method: 'PUT', body: { status: 'rejected', note: v.note }, success: 'Sent back to the new hire' })} />
    </Drawer>
  );
}

export function PreboardingTab() {
  const { data = [], isLoading } = useGet('preboarding');
  const { data: templates = [] } = useGet('onboarding-templates');
  const { data: candidates = [] } = useGet('candidates', { stage: 'offer' });
  const [act] = useAction();
  const invite = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [link, setLink] = useState(null);
  return (
    <div className="space-y-4">
      <DataTable loading={isLoading} rows={data} searchKeys={['name', 'email', 'department', 'designation']} testId="preboarding-table" onRowClick={(r) => setOpenId(r.id)}
        toolbar={<button className="btn-primary" onClick={() => invite.onOpen()} data-testid="invite-hire"><Send size={16} /> Invite new hire</button>}
        empty={<EmptyState icon={Send} title="No one in pre-boarding" message="Invite a new hire to collect their details and documents before day one." />}
        columns={[
          { key: 'name', header: 'New hire', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs muted">{r.email}</div></div> },
          { key: 'designation', header: 'Role', render: (r) => <div><div>{r.designation || '—'}</div><div className="text-xs muted">{r.department || ''}</div></div> },
          { key: 'date_of_joining', header: 'Joins', render: (r) => date(r.date_of_joining) },
          { key: 'pct', header: 'Progress', render: (r) => <div className="w-28"><Progress value={r.pct} /><div className="mt-0.5 text-[11px] muted">{r.pct}%{r.pending_docs ? ` · ${r.pending_docs} to verify` : ''}</div></div> },
          { key: 'status', header: 'Status', render: (r) => <Badge color={r.expired && !['converted', 'cancelled'].includes(r.status) ? 'red' : STATUS_TONE[r.status]}>{r.expired && !['converted', 'cancelled'].includes(r.status) ? 'Link expired' : STATUS_LABEL[r.status]}</Badge> },
        ]} />
      <FormModal open={invite.open} onClose={invite.onClose} title="Invite a new hire" submitLabel="Send invite" size="lg"
        fields={[
          { name: 'candidate_id', label: 'From an offered candidate', type: 'select', options: candidates.map((c) => [c.id, `${c.name} · ${c.job_title || ''}`]), placeholder: 'None — enter details', full: true },
          { name: 'name', label: 'Full name', hidden: (v) => !!v.candidate_id },
          { name: 'email', label: 'Personal email', type: 'email', hidden: (v) => !!v.candidate_id },
          { name: 'date_of_joining', label: 'Joining date', type: 'date', required: true, min: todayStr() },
          { name: 'designation_id', label: 'Designation', type: 'lookup', path: 'designations', labelKey: 'title' },
          { name: 'department_id', label: 'Department', type: 'lookup', path: 'departments' },
          { name: 'location_id', label: 'Location', type: 'lookup', path: 'locations' },
          { name: 'manager_id', label: 'Reporting manager', type: 'employee' },
          { name: 'buddy_id', label: 'Onboarding buddy', type: 'employee' },
          { name: 'template_id', label: 'Onboarding checklist', type: 'select', options: templates.filter((t) => t.type === 'onboarding').map((t) => [t.id, t.name]), placeholder: 'Automatic (by department)' },
          { name: 'annual_ctc', label: 'Annual CTC (₹)', type: 'number', min: 0 },
        ]}
        onSubmit={async (v) => {
          const r = await act('preboarding', { body: { ...v, candidate_id: v.candidate_id ? Number(v.candidate_id) : undefined, template_id: v.template_id ? Number(v.template_id) : undefined }, success: 'Invite sent' });
          if (r?.portal_url) setLink(r.portal_url);
          return !!r;
        }} />
      <PreboardingDrawer id={openId} onClose={() => setOpenId(null)} onLink={setLink} />
      <LinkBox url={link} onClose={() => setLink(null)} />
    </div>
  );
}

// ---------- templates (HR) ----------
function TemplateEditor({ open, onClose, template }) {
  const [act] = useAction();
  const { data: depts = [] } = useGet('departments');
  const [t, setT] = useState(null);
  if (open && !t) setT(template ? { ...template, tasks: template.tasks.map((x) => ({ ...x })) } : { name: '', type: 'onboarding', department_id: '', tasks: [{ title: '', category: 'HR', offset_days: 0 }] });
  if (!open && t) setT(null);
  if (!t) return null;
  const setTask = (i, k, v) => setT((s) => ({ ...s, tasks: s.tasks.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const save = async () => {
    const body = { ...t, department_id: t.department_id ? Number(t.department_id) : null, tasks: t.tasks.filter((x) => x.title.trim()).map((x) => ({ ...x, offset_days: Number(x.offset_days) || 0 })) };
    const ok = await act(template ? `onboarding-templates/${template.id}` : 'onboarding-templates', { method: template ? 'PUT' : 'POST', body, success: 'Template saved' });
    if (ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={template ? `Edit ${template.name}` : 'New checklist template'} size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} data-testid="save-template">Save template</button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="t-name">Name</label><input id="t-name" className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="t-type">Type</label><select id="t-type" className="input" value={t.type} onChange={(e) => setT({ ...t, type: e.target.value })}><option value="onboarding">Onboarding</option><option value="offboarding">Offboarding</option></select></div>
          <div><label className="label" htmlFor="t-dept">Use automatically for</label><select id="t-dept" className="input" value={t.department_id || ''} onChange={(e) => setT({ ...t, department_id: e.target.value })}><option value="">Any department</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        </div>
        <div className="space-y-2" data-testid="template-tasks">
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold uppercase text-slate-400"><span className="col-span-6">Task</span><span className="col-span-3">Owner</span><span className="col-span-2">Day</span></div>
          {t.tasks.map((x, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <input className="input col-span-6" aria-label={`Task ${i + 1}`} value={x.title} onChange={(e) => setTask(i, 'title', e.target.value)} />
              <select className="input col-span-3" aria-label={`Owner ${i + 1}`} value={x.category} onChange={(e) => setTask(i, 'category', e.target.value)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select>
              <input className="input col-span-2" type="number" aria-label={`Day ${i + 1}`} value={x.offset_days} onChange={(e) => setTask(i, 'offset_days', e.target.value)} />
              <button className="col-span-1 text-slate-400 hover:text-rose-600" aria-label={`Remove task ${i + 1}`} onClick={() => setT((s) => ({ ...s, tasks: s.tasks.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button>
            </div>
          ))}
          <button className="btn-ghost btn-sm" onClick={() => setT((s) => ({ ...s, tasks: [...s.tasks, { title: '', category: 'HR', offset_days: 0 }] }))} data-testid="add-template-task"><Plus size={14} /> Add task</button>
          <p className="text-xs muted">Day is relative to the joining day (or last working day for offboarding): -7 is a week before, 30 is a month after.</p>
        </div>
      </div>
    </Modal>
  );
}

export function TemplatesTab() {
  const { data = [], isLoading } = useGet('onboarding-templates');
  const [act] = useAction();
  const edit = useDisclosure();
  if (isLoading) return <CardSkeleton lines={6} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => edit.onOpen(null)} data-testid="new-template"><Plus size={16} /> New template</button></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((t) => (
          <div key={t.id} className="card card-pad" data-testid="template-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2"><h3 className="font-semibold">{t.name}</h3>{t.is_default && <Badge color="violet">Default</Badge>}</div>
                <p className="text-xs muted">{titleCase(t.type)} · {t.department ? `used for ${t.department}` : 'any department'} · {t.tasks.length} tasks</p>
              </div>
              <div className="flex gap-1">
                {!t.is_default && <button className="btn-ghost btn-sm" onClick={() => act(`onboarding-templates/${t.id}/default`, { body: {}, success: `${t.name} is now the default` })} aria-label={`Make ${t.name} default`}><Star size={14} /></button>}
                <button className="btn-ghost btn-sm" onClick={() => edit.onOpen(t)} aria-label={`Edit ${t.name}`}><Pencil size={14} /></button>
                <button className="btn-ghost btn-sm text-rose-600" onClick={() => act(`onboarding-templates/${t.id}`, { method: 'DELETE', success: 'Template deleted' })} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></button>
              </div>
            </div>
            <ol className="mt-3 space-y-1 text-sm">
              {t.tasks.slice(0, 8).map((x) => <li key={x.id} className="flex items-center gap-2"><span className="w-14 shrink-0 text-right text-xs tabular-nums muted">{x.offset_days > 0 ? `Day ${x.offset_days}` : x.offset_days < 0 ? `${x.offset_days}d` : 'Day 0'}</span><span className="flex-1 truncate">{x.title}</span><Badge color="slate">{x.category}</Badge></li>)}
              {t.tasks.length > 8 && <li className="pl-16 text-xs muted">+{t.tasks.length - 8} more</li>}
            </ol>
          </div>
        ))}
      </div>
      <TemplateEditor open={edit.open} template={edit.payload} onClose={edit.onClose} />
    </div>
  );
}

// ---------- the new joiner ----------
export function MyOnboarding() {
  const { data, isLoading } = useGet('onboarding/my');
  const [act] = useAction();
  const { user } = useAuth();
  if (isLoading) return <CardSkeleton lines={8} />;
  if (!data) return null;
  const { employee: e, tasks, done, day } = data;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 100;
  const mine = (t) => ['Employee'].includes(t.category);
  return (
    <div className="space-y-6" data-testid="my-onboarding">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-brand-500 to-violet-500 p-6 text-white">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-100"><PartyPopper size={16} /> {day > 0 ? `Day ${day} at work` : `Joining in ${1 - day} day(s)`}</div>
          <h2 className="mt-1 text-2xl font-bold">Welcome, {e.first_name}!</h2>
          <p className="text-indigo-100">{e.designation || 'Your new role'} · joined {date(e.date_of_joining)}{e.probation_end_date ? ` · probation until ${date(e.probation_end_date)}` : ''}</p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[[Users, 'Your manager', e.manager_name, e.manager_color], [Users, 'Your buddy', e.buddy_name || 'Not assigned yet', e.buddy_color]].map(([Icon, label, name, color]) => (
            <div key={label} className="flex items-center gap-3"><Avatar name={name || '?'} color={color || '#94a3b8'} /><div><div className="text-xs muted">{label}</div><div className="font-medium" data-testid={label === 'Your buddy' ? 'my-buddy' : undefined}>{name || '—'}</div></div></div>
          ))}
          <Link to="/documents" className="flex items-center gap-3 rounded-xl p-1 hover:bg-slate-50 dark:hover:bg-slate-800"><ShieldCheck className="text-amber-500" /><div><div className="text-xs muted">Policies to acknowledge</div><div className="font-medium">{data.pending_policy_acks}</div></div></Link>
          <Link to="/learning" className="flex items-center gap-3 rounded-xl p-1 hover:bg-slate-50 dark:hover:bg-slate-800"><GraduationCap className="text-sky-500" /><div><div className="text-xs muted">Training in progress</div><div className="font-medium">{data.pending_training}</div></div></Link>
        </div>
      </div>
      <div className="card card-pad">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Your first 90 days</h3><span className="text-sm font-semibold text-brand-600">{done}/{tasks.length} done</span></div>
        <Progress value={pct} className="mt-3" />
        <ol className="mt-4 space-y-1">
          {tasks.map((t) => {
            const overdue = !t.done && t.due_date < todayStr();
            const canTick = mine(t) || e.id !== user.id;
            return (
              <li key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800" data-testid="my-task">
                <button disabled={!canTick} onClick={() => act(`onboarding/${t.id}`, { method: 'PUT', body: { done: !t.done }, success: t.done ? undefined : 'Nice — task done' })} aria-label={`${t.done ? 'Reopen' : 'Complete'} ${t.title}`} className="disabled:cursor-default">
                  {t.done ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className={canTick ? 'text-brand-400' : 'text-slate-300'} />}
                </button>
                <span className={cx('flex-1 text-sm', t.done && 'text-slate-400 line-through')}>{t.title}</span>
                <Badge color={mine(t) ? 'violet' : 'slate'}>{mine(t) ? 'You' : t.category}</Badge>
                <span className={cx('flex w-20 items-center justify-end gap-1 text-xs', overdue ? 'font-semibold text-rose-500' : 'muted')}><CalendarDays size={12} />{shortDate(t.due_date)}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs muted">Tasks marked “You” are yours to tick off; the rest are done by HR, IT, your manager or buddy and update as they finish.</p>
      </div>
    </div>
  );
}
