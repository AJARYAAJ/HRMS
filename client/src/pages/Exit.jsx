import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Calculator, ClipboardList, UserCheck, Star, CalendarClock, Undo2, BadgeIndianRupee } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, CardSkeleton, EmptyState, Modal, Drawer, StatCard, StatSkeletons, Confirm, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import ApprovalTrail from '../components/ApprovalTrail';
import { money, date, todayStr } from '../lib/format';
import { useChartTheme } from '../lib/chart';

const REASONS = ['Better opportunity', 'Compensation', 'Career growth', 'Higher studies', 'Relocation', 'Personal reasons', 'Health', 'Work-life balance', 'Other'];

function Stars({ value, onChange, label }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${label}: ${n} stars`}>
            <Star size={22} className={cx(n <= (value || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600')} />
          </button>
        ))}
      </div>
    </div>
  );
}

function FnfBreakdown({ f }) {
  const rows = [
    ['Salary for unpaid days', `${f.salary_days} days`, f.salary_amount, 1],
    ['Earned leave encashment', `${f.leave_encash_days} days`, f.leave_encash_amount, 1],
    ['Gratuity', f.service_years ? `${f.service_years} yrs service` : '', f.gratuity, 1],
    ['Bonus / incentives', '', f.bonus, 1],
    ['Notice period recovery', f.notice_shortfall_days ? `${f.notice_shortfall_days} days short` : '', f.notice_recovery, -1],
    ['Loan / advance recovery', '', f.loan_recovery, -1],
    ['Other deductions', '', f.other_deductions, -1],
  ];
  return (
    <div className="space-y-1.5 text-sm" data-testid="fnf-breakdown">
      {rows.map(([l, hint, amt, sign]) => (
        <div key={l} className="flex justify-between">
          <span>{l}{hint && <span className="ml-1 text-xs muted">({hint})</span>}</span>
          <span className={cx('font-medium', sign < 0 && amt ? 'text-rose-600 dark:text-rose-400' : '')}>{sign < 0 && amt ? '− ' : ''}{money(amt || 0, true)}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
        <span>Net payable</span><span data-testid="fnf-net">{money(f.net_payable, true)}</span>
      </div>
    </div>
  );
}

// ---------- employee view ----------
function MyExit() {
  const { data: mine = [], isLoading } = useGet('resignations', { mine: 1 });
  const { data: settings } = useGet('settings');
  const { data: fnf = [] } = useGet('exit/fnf');
  const [act] = useAction();
  const resign = useDisclosure();
  const [withdraw, setWithdraw] = useState(false);
  const [iv, setIv] = useState({ primary_reason: '', would_recommend: true });
  const active = mine.find((r) => ['pending', 'manager_approved', 'approved'].includes(r.status));
  const notice = Number(settings?.notice_period_days || 60);
  const defaultLwd = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + notice); return d.toISOString().slice(0, 10); }, [notice]);

  if (isLoading) return <CardSkeleton lines={6} />;
  if (!active) {
    return (
      <div className="card card-pad max-w-2xl space-y-4">
        <h3 className="flex items-center gap-2 font-semibold"><LogOut size={18} className="text-brand-500" /> Resignation</h3>
        <p className="text-sm muted">Thinking of moving on? We're sorry to see you go. Your notice period is <b>{notice} days</b>; your manager and then HR will review your request and confirm your last working day.</p>
        <button className="btn-danger" onClick={() => resign.onOpen()} data-testid="resign-btn">Submit resignation</button>
        {mine.length > 0 && <p className="text-xs muted">Previous requests: {mine.map((r) => `${date(r.submitted_on)} (${r.status})`).join(', ')}</p>}
        <FormModal open={resign.open} onClose={resign.onClose} title="Submit resignation" submitLabel="Submit" initial={{ requested_lwd: defaultLwd, reason: '' }}
          fields={[
            { name: 'reason', label: 'Primary reason', type: 'select', required: true, options: REASONS, full: true },
            { name: 'requested_lwd', label: 'Requested last working day', type: 'date', required: true, min: todayStr(), hint: `Standard notice: ${notice} days (${date(defaultLwd)}). An earlier date may lead to notice-period recovery unless waived.` },
            { name: 'notes', label: 'Anything you would like to share (optional)', type: 'textarea', full: true },
          ]}
          onSubmit={(v) => act('resignations', { body: v, success: 'Resignation submitted to your manager' })} />
      </div>
    );
  }
  const myFnf = fnf.find((f) => f.resignation_id === active.id);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="card card-pad space-y-4 lg:col-span-2" data-testid="my-resignation">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Your resignation</h3>
          <Badge status={active.status}>{active.status === 'manager_approved' ? 'Awaiting HR' : undefined}</Badge>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div><div className="text-xs muted">Submitted</div><div className="font-semibold">{date(active.submitted_on)}</div></div>
          <div><div className="text-xs muted">Requested last day</div><div className="font-semibold">{date(active.requested_lwd)}</div></div>
          <div><div className="text-xs muted">Confirmed last day</div><div className="font-semibold" data-testid="confirmed-lwd">{active.approved_lwd ? date(active.approved_lwd) : '—'}</div></div>
        </div>
        <div className="text-sm"><span className="muted">Reason:</span> {active.reason}</div>
        <ApprovalTrail entity="resignations" id={active.id} status={active.status} flow="manager_hr" />
        <div className="flex flex-wrap gap-2">
          {active.status !== 'approved' && <button className="btn-secondary" onClick={() => setWithdraw(true)} data-testid="withdraw-btn"><Undo2 size={16} /> Withdraw</button>}
          {active.status === 'approved' && <Link to="/onboarding" className="btn-secondary"><ClipboardList size={16} /> Offboarding checklist</Link>}
        </div>
      </div>
      <div className="space-y-6">
        {active.status === 'approved' && !active.interview_id && (
          <form className="card card-pad space-y-4" data-testid="exit-interview" onSubmit={async (e) => { e.preventDefault(); await act('exit/interviews', { body: { ...iv, resignation_id: active.id }, success: 'Thank you for your feedback', invalidates: ['resignations'] }); }}>
            <h3 className="font-semibold">Exit interview</h3>
            <div><label className="label" htmlFor="iv-reason">Main reason for leaving</label>
              <select id="iv-reason" className="input" required value={iv.primary_reason} onChange={(e) => setIv({ ...iv, primary_reason: e.target.value })}><option value="">Select</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            <Stars label="Your manager" value={iv.rating_manager} onChange={(n) => setIv({ ...iv, rating_manager: n })} />
            <Stars label="Culture" value={iv.rating_culture} onChange={(n) => setIv({ ...iv, rating_culture: n })} />
            <Stars label="Growth opportunities" value={iv.rating_growth} onChange={(n) => setIv({ ...iv, rating_growth: n })} />
            <Stars label="Compensation" value={iv.rating_compensation} onChange={(n) => setIv({ ...iv, rating_compensation: n })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={iv.would_recommend} onChange={(e) => setIv({ ...iv, would_recommend: e.target.checked })} /> I would recommend working here</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!iv.would_return} onChange={(e) => setIv({ ...iv, would_return: e.target.checked })} /> I would consider returning</label>
            <textarea className="input min-h-20" placeholder="What could we have done better?" value={iv.feedback || ''} onChange={(e) => setIv({ ...iv, feedback: e.target.value })} aria-label="Exit feedback" />
            <button className="btn-primary w-full" data-testid="submit-interview">Submit</button>
          </form>
        )}
        {active.interview_id && <div className="card card-pad text-sm"><Badge status="completed">Exit interview submitted</Badge></div>}
        <div className="card card-pad">
          <h3 className="mb-3 font-semibold">Full & final settlement</h3>
          {myFnf ? <><Badge status={myFnf.status} /><div className="mt-3"><FnfBreakdown f={myFnf} /></div></> : <p className="text-sm muted">Your settlement is prepared by HR after your last working day.</p>}
        </div>
      </div>
      <Confirm open={withdraw} onClose={() => setWithdraw(false)} title="Withdraw resignation?" confirmLabel="Withdraw" message="Your manager and HR will be notified." onConfirm={() => act(`resignations/${active.id}/withdraw`, { success: 'Resignation withdrawn' })} />
    </div>
  );
}

// ---------- HR / manager views ----------
function Resignations() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('resignations');
  const [open, setOpen] = useState(null);
  const [lwd, setLwd] = useState('');
  const [act] = useAction();
  const r = data.find((x) => x.id === open);
  useEffect(() => { if (r) setLwd(r.approved_lwd || r.requested_lwd); }, [r]);
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'reason', 'designation']} exportName="resignations" onRowClick={(x) => setOpen(x.id)}
        columns={[
          { key: 'employee_name', header: 'Employee', width: 'minmax(210px, 1.6fr)', render: (x) => <div className="flex items-center gap-2"><Avatar name={x.employee_name} color={x.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{x.employee_name}</div><div className="truncate text-xs muted">{x.designation}</div></div></div> },
          { key: 'submitted_on', header: 'Submitted', render: (x) => date(x.submitted_on) },
          { key: 'requested_lwd', header: 'Last day', render: (x) => date(x.approved_lwd || x.requested_lwd) },
          { key: 'reason', header: 'Reason' },
          { key: 'status', header: 'Status', render: (x) => <Badge status={x.status} /> },
          { key: 'fnf_status', header: 'F&F', render: (x) => (x.fnf_status ? <Badge status={x.fnf_status} /> : '—') },
        ]} />
      <Drawer open={!!r} onClose={() => setOpen(null)} title={r ? `Resignation · ${r.employee_name}` : ''}>
        {r && (
          <div className="space-y-5">
            <div className="flex gap-2"><Badge status={r.status} />{r.interview_id ? <Badge color="green">Exit interview done</Badge> : null}</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs muted">Employee ID</div><div className="font-semibold">{r.emp_code}</div></div>
              <div><div className="text-xs muted">Joined</div><div className="font-semibold">{date(r.date_of_joining)}</div></div>
              <div><div className="text-xs muted">Submitted</div><div className="font-semibold">{date(r.submitted_on)}</div></div>
              <div><div className="text-xs muted">Notice</div><div className="font-semibold">{r.notice_days} days</div></div>
              <div className="col-span-2"><div className="text-xs muted">Reason</div><div className="font-semibold">{r.reason}</div>{r.notes && <p className="mt-1 muted">{r.notes}</p>}</div>
            </div>
            <ApprovalTrail entity="resignations" id={r.id} status={r.status} flow="manager_hr" />
            {isHR && ['pending', 'manager_approved', 'approved'].includes(r.status) && (
              <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
                <label className="label" htmlFor="agreed-lwd">Agreed last working day</label>
                <div className="flex gap-2">
                  <input id="agreed-lwd" type="date" className="input" value={lwd} min={r.submitted_on} onChange={(e) => setLwd(e.target.value)} />
                  <button className="btn-secondary" onClick={() => act(`resignations/${r.id}/lwd`, { method: 'PUT', body: { last_working_day: lwd }, success: 'Last working day updated' })}><CalendarClock size={16} /> Update</button>
                </div>
                <p className="mt-2 text-xs muted">Approve or reject from the Approvals inbox.</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}

function Settlements() {
  const { data = [], isLoading } = useGet('exit/fnf');
  const { data: leavers = [] } = useGet('employees', { status: 'on_notice' });
  const [act] = useAction();
  const calc = useDisclosure();
  const [form, setForm] = useState({ employee_id: '', waive_notice: false, bonus: 0, other_deductions: 0 });
  const { data: preview, isFetching } = useGet(calc.open && form.employee_id ? `exit/fnf/preview/${form.employee_id}` : null, { waive_notice: form.waive_notice ? 1 : '', bonus: form.bonus || '', other_deductions: form.other_deductions || '' });
  const [view, setView] = useState(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => { setForm({ employee_id: '', waive_notice: false, bonus: 0, other_deductions: 0 }); calc.onOpen(); }} data-testid="new-fnf"><Calculator size={16} /> New settlement</button></div>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'emp_code']} exportName="fnf-settlements" onRowClick={setView}
        columns={[
          { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (f) => <div className="flex items-center gap-2"><Avatar name={f.employee_name} color={f.avatar_color} size="xs" /><span className="truncate font-medium">{f.employee_name}</span></div> },
          { key: 'last_working_day', header: 'Last day', render: (f) => date(f.last_working_day) },
          { key: 'gratuity', header: 'Gratuity', align: 'right', render: (f) => money(f.gratuity) },
          { key: 'net_payable', header: 'Net payable', align: 'right', render: (f) => <b>{money(f.net_payable)}</b> },
          { key: 'status', header: 'Status', render: (f) => <Badge status={f.status} /> },
        ]} />
      <Modal open={calc.open} onClose={calc.onClose} title="Full & final settlement" size="lg">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div><label className="label" htmlFor="fnf-emp">Employee</label>
              <select id="fnf-emp" className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">Select an employee on notice</option>
                {leavers.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · LWD {date(e.exit_date)}</option>)}
              </select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={form.waive_notice} onChange={(e) => setForm({ ...form, waive_notice: e.target.checked })} /> Waive notice-period shortfall</label>
            <div><label className="label" htmlFor="fnf-bonus">Bonus / incentives (₹)</label><input id="fnf-bonus" type="number" min="0" className="input" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} /></div>
            <div><label className="label" htmlFor="fnf-other">Other deductions (₹)</label><input id="fnf-other" type="number" min="0" className="input" value={form.other_deductions} onChange={(e) => setForm({ ...form, other_deductions: e.target.value })} /></div>
          </div>
          <div className={cx(isFetching && 'opacity-60')}>
            {preview ? <FnfBreakdown f={preview} /> : <p className="text-sm muted">Choose an employee to calculate salary, leave encashment, gratuity and recoveries.</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={calc.onClose}>Cancel</button>
          <button className="btn-primary" disabled={!preview} data-testid="save-fnf" onClick={async () => { if (await act('exit/fnf', { body: form, success: 'Settlement saved as draft' })) calc.onClose(); }}>Save draft</button>
        </div>
      </Modal>
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? `F&F · ${view.employee_name}` : ''}>
        {view && (
          <div className="space-y-5">
            <Badge status={view.status} />
            <FnfBreakdown f={view} />
            <div className="flex gap-2">
              {view.status === 'draft' && <button className="btn-primary" onClick={async () => { const r = await act(`exit/fnf/${view.id}/status`, { method: 'PUT', body: { status: 'approved' }, success: 'Settlement approved — employee notified' }); if (r) setView(r); }} data-testid="approve-fnf">Approve</button>}
              {view.status === 'approved' && <button className="btn-success" onClick={async () => { const r = await act(`exit/fnf/${view.id}/status`, { method: 'PUT', body: { status: 'paid' }, success: 'Marked as paid · employee exited' }); if (r) setView(r); }} data-testid="pay-fnf"><BadgeIndianRupee size={16} /> Mark paid</button>}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Interviews() {
  const { data, isLoading } = useGet('exit/interviews');
  const chart = useChartTheme();
  if (isLoading) return <StatSkeletons />;
  const s = data.summary;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={ClipboardList} label="Interviews" value={s.count} />
        <StatCard icon={Star} tone="amber" label="Manager rating" value={s.manager ?? '—'} hint="out of 5" />
        <StatCard icon={Star} tone="sky" label="Growth rating" value={s.growth ?? '—'} hint="out of 5" />
        <StatCard icon={UserCheck} tone="green" label="Would recommend" value={s.recommend_pct === null ? '—' : `${s.recommend_pct}%`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h3 className="mb-4 font-semibold">Reasons for leaving</h3>
          <div className="h-56"><ResponsiveContainer><BarChart data={s.reasons} layout="vertical" margin={{ left: 20, right: 20 }}>
            <XAxis type="number" hide allowDecimals={false} /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <Tooltip {...chart.tooltip} /><Bar dataKey="value" name="Leavers" fill={chart.series[0]} radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart></ResponsiveContainer></div>
        </div>
        <div className="card card-pad space-y-3">
          <h3 className="font-semibold">Recent feedback</h3>
          {data.rows.slice(0, 5).map((r) => (
            <div key={r.id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><b>{r.employee_name}</b><span className="text-xs muted">{r.department} · {r.primary_reason}</span></div>
              {r.feedback && <p className="mt-1 muted">“{r.feedback}”</p>}
            </div>
          ))}
          {!data.rows.length && <EmptyState title="No exit interviews yet" />}
        </div>
      </div>
    </div>
  );
}

function Probation() {
  const { data, isLoading } = useGet('exit/summary');
  const [act] = useAction();
  const [extend, setExtend] = useState(null);
  if (isLoading) return <CardSkeleton lines={4} />;
  return (
    <div className="card overflow-hidden">
      {data.probation_due.length === 0 ? <EmptyState icon={UserCheck} title="No probation reviews due in the next 30 days" /> : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.probation_due.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="probation-item">
              <div className="flex flex-1 items-center gap-3">
                <Avatar name={p.name} color={p.avatar_color} />
                <div><Link to={`/employees/${p.id}`} className="font-semibold hover:underline">{p.name}</Link><div className="text-xs muted">{p.designation} · probation ends {date(p.probation_end_date)}</div></div>
                <Badge status={p.confirmation_status} />
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" onClick={() => setExtend(p)}>Extend</button>
                <button className="btn-success btn-sm" onClick={() => act(`employees/${p.id}/confirmation`, { body: { action: 'confirm' }, success: `${p.name} confirmed`, invalidates: ['exit'] })} data-testid="confirm-probation">Confirm</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <FormModal open={!!extend} onClose={() => setExtend(null)} title={extend ? `Extend probation · ${extend.name}` : ''} size="sm" initial={{ extend_days: 30 }} submitLabel="Extend"
        fields={[{ name: 'extend_days', label: 'Extend by (days)', type: 'number', min: 15, max: 180, required: true, full: true }, { name: 'comment', label: 'Note to employee', type: 'textarea', full: true }]}
        onSubmit={(v) => act(`employees/${extend.id}/confirmation`, { body: { action: 'extend', ...v }, success: 'Probation extended', invalidates: ['exit'] })} />
    </div>
  );
}

export default function Exit() {
  const { isHR, isManager } = useAuth();
  const [tab, setTab] = useState(isHR ? 'resignations' : 'mine');
  const { data: summary, isLoading } = useGet(isManager ? 'exit/summary' : null);
  return (
    <div className="space-y-6">
      <PageHeader icon={LogOut} title="Exit & full-and-final" subtitle="Resignations, notice periods, exit interviews, settlements and probation reviews" />
      {isHR && (isLoading ? <StatSkeletons /> : summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={LogOut} tone="amber" label="Pending resignations" value={summary.pending} />
          <StatCard icon={CalendarClock} label="Serving notice" value={summary.serving_notice} />
          <StatCard icon={BadgeIndianRupee} tone="sky" label="F&F in progress" value={summary.fnf_pending} />
          <StatCard icon={UserCheck} tone="green" label="Probation reviews due" value={summary.probation_due.length} onClick={() => setTab('probation')} />
        </div>
      ))}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'mine', label: 'My resignation' },
        ...(isManager ? [{ value: 'resignations', label: isHR ? 'Resignations' : 'Team resignations' }] : []),
        ...(isHR ? [{ value: 'fnf', label: 'F&F settlements' }, { value: 'interviews', label: 'Exit interviews' }, { value: 'probation', label: 'Probation' }] : []),
      ]} />
      {tab === 'mine' && <MyExit />}
      {tab === 'resignations' && isManager && <Resignations />}
      {tab === 'fnf' && isHR && <Settlements />}
      {tab === 'interviews' && isHR && <Interviews />}
      {tab === 'probation' && isHR && <Probation />}
    </div>
  );
}
