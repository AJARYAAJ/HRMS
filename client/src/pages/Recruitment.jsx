import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Plus, MapPin, Users, Star, Mail, Phone, CalendarPlus, UserCheck, GripVertical, Building } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Drawer, CardSkeleton, EmptyState, Skeleton, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, dateTime, timeAgo, todayStr } from '../lib/format';

const STAGES = [
  ['applied', 'Applied', 'bg-slate-400'], ['screening', 'Screening', 'bg-sky-500'], ['interview', 'Interview', 'bg-violet-500'],
  ['offer', 'Offer', 'bg-amber-500'], ['hired', 'Hired', 'bg-emerald-500'], ['rejected', 'Rejected', 'bg-rose-500'],
];

function Jobs({ onPick }) {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('jobs');
  const [act] = useAction();
  const form = useDisclosure();
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end"><button className="btn-primary" onClick={() => form.onOpen()} data-testid="new-job"><Plus size={16} /> New job opening</button></div>}
      {isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((j) => (
            <div key={j.id} className="card card-pad flex flex-col" data-testid="job-card">
              <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{j.title}</h3><Badge status={j.status} /></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
                <span className="flex items-center gap-1"><Building size={12} />{j.department}</span><span className="flex items-center gap-1"><MapPin size={12} />{j.location}</span>
                <span>{j.employment_type}</span><span>{j.experience}</span>
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-sm muted">{j.description}</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="flex items-center gap-3 text-xs"><span className="flex items-center gap-1 font-semibold"><Users size={13} />{j.applicants} applicants</span><span className="muted">{j.hired}/{j.openings} filled</span></div>
                <div className="flex gap-1">
                  {isHR && <button className="btn-ghost btn-sm" onClick={() => form.onOpen(j)}>Edit</button>}
                  <button className="btn-secondary btn-sm" onClick={() => onPick(j.id)}>Pipeline</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <FormModal open={form.open} onClose={form.onClose} title={form.payload ? 'Edit job opening' : 'New job opening'} size="lg"
        initial={form.payload || { status: 'open', employment_type: 'Full-time', openings: 1 }}
        fields={[
          { name: 'title', label: 'Job title', required: true, full: true }, { name: 'department_id', label: 'Department', type: 'lookup', path: 'departments' },
          { name: 'location_id', label: 'Location', type: 'lookup', path: 'locations' }, { name: 'employment_type', label: 'Type', type: 'select', noEmpty: true, options: ['Full-time', 'Contract', 'Intern'] },
          { name: 'experience', label: 'Experience', placeholder: 'e.g. 3-5 years' }, { name: 'openings', label: 'Openings', type: 'number', min: 1 },
          { name: 'hiring_manager_id', label: 'Hiring manager', type: 'employee', filter: (e) => e.role !== 'employee' },
          { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['open', 'Open'], ['on_hold', 'On hold'], ['closed', 'Closed']] },
          { name: 'description', label: 'Job description', type: 'textarea', full: true },
        ]}
        onSubmit={(v) => (form.payload ? act(`jobs/${form.payload.id}`, { method: 'PUT', body: v, success: 'Job updated' }) : act('jobs', { body: v, success: 'Job opening published' }))} />
    </div>
  );
}

function Pipeline({ jobId, setJobId }) {
  const { isHR } = useAuth();
  const { data: jobs = [] } = useGet('jobs');
  const { data = [], isLoading } = useGet('candidates', { job_id: jobId });
  const { data: interviews = [] } = useGet('interviews');
  const [act] = useAction();
  const add = useDisclosure();
  const schedule = useDisclosure();
  const hire = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // Track the dragged card ourselves: dataTransfer payloads are unreliable across browsers.
  const dragged = useRef(null);
  const navigate = useNavigate();
  const open = data.find((c) => c.id === openId);
  const byStage = useMemo(() => Object.fromEntries(STAGES.map(([s]) => [s, data.filter((c) => c.stage === s)])), [data]);
  const move = (id, stage) => act(`candidates/${id}/stage`, { method: 'PUT', body: { stage }, success: `Moved to ${stage}` });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select className="input !w-auto" value={jobId || ''} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)} aria-label="Job filter">
          <option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <button className="btn-primary" onClick={() => add.onOpen()} data-testid="add-candidate"><Plus size={16} /> Add candidate</button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban">
        {STAGES.map(([stage, label, dot]) => (
          <div key={stage} data-stage={stage}
            onDragOver={(e) => { e.preventDefault(); setDragOver(stage); }} onDragLeave={() => setDragOver(null)}
            onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = dragged.current ?? Number(e.dataTransfer.getData('text/plain')); dragged.current = null; const c = data.find((x) => x.id === id); if (c && c.stage !== stage) move(id, stage); }}
            className={cx('flex w-72 shrink-0 flex-col rounded-2xl bg-slate-100/70 p-3 transition dark:bg-slate-900/60', dragOver === stage && 'ring-2 ring-brand-500')}>
            <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold"><span className={cx('h-2 w-2 rounded-full', dot)} />{label}<span className="ml-auto rounded-full bg-white px-2 text-xs dark:bg-slate-800">{byStage[stage]?.length || 0}</span></div>
            <div className="flex min-h-24 flex-col gap-2">
              {isLoading && <><Skeleton className="h-20" /><Skeleton className="h-20" /></>}
              {byStage[stage]?.map((c) => (
                <div key={c.id} draggable onDragStart={(e) => { dragged.current = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.id)); }} onDragEnd={() => setDragOver(null)} onClick={() => setOpenId(c.id)} data-testid="candidate-card"
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex items-start gap-2">
                    <GripVertical size={14} className="mt-0.5 shrink-0 text-slate-300 opacity-0 group-hover:opacity-100" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{c.name}</div>
                      <div className="truncate text-xs muted">{c.job_title}</div>
                      <div className="mt-2 flex items-center justify-between text-[11px] muted">
                        <span>{c.experience_years}y · {c.current_company}</span>
                        <span className="flex">{Array.from({ length: c.rating || 0 }).map((_, i) => <Star key={i} size={10} className="fill-amber-400 text-amber-400" />)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs muted">Tip: drag cards between columns to move candidates through the pipeline.</p>

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name || ''}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><Badge status={open.stage} /><Badge color="slate">{open.source}</Badge></div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-slate-400">Applied for</div><div className="font-medium">{open.job_title}</div></div>
              <div><div className="text-xs text-slate-400">Experience</div><div className="font-medium">{open.experience_years} years</div></div>
              <div><div className="text-xs text-slate-400">Current company</div><div className="font-medium">{open.current_company}</div></div>
              <div><div className="text-xs text-slate-400">Expected CTC</div><div className="font-medium">{money(open.expected_ctc)}</div></div>
              <div className="col-span-2 flex flex-col gap-1 muted"><span className="flex items-center gap-2"><Mail size={14} />{open.email}</span><span className="flex items-center gap-2"><Phone size={14} />{open.phone}</span></div>
            </div>
            <div>
              <label className="label">Move to stage</label>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map(([s, l]) => <button key={s} onClick={() => move(open.id, s)} className={cx('btn-sm btn', open.stage === s ? 'bg-brand-600 text-white' : 'btn-secondary')}>{l}</button>)}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">Interviews</span><button className="btn-ghost btn-sm" onClick={() => schedule.onOpen()} data-testid="schedule-interview"><CalendarPlus size={14} /> Schedule</button></div>
              {interviews.filter((i) => i.candidate_id === open.id).map((i) => (
                <div key={i.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <div className="flex justify-between"><b>{i.round}</b><Badge status={i.status} /></div>
                  <div className="text-xs muted">{dateTime(i.scheduled_at)} · {i.mode} · {i.interviewer_name}</div>
                  {i.feedback && <div className="mt-1 text-xs">“{i.feedback}” {i.rating ? `· ${i.rating}★` : ''}</div>}
                </div>
              ))}
            </div>
            {open.notes && <div><div className="mb-1 text-sm font-semibold">Notes</div><p className="text-sm muted">{open.notes}</p></div>}
            <div className="text-xs muted">Added {timeAgo(open.created_at)}</div>
            {isHR && open.stage !== 'hired' && open.stage !== 'rejected' && (
              <button className="btn-success w-full" onClick={() => hire.onOpen(open)} data-testid="hire-candidate"><UserCheck size={16} /> Hire & create employee</button>
            )}
          </div>
        )}
      </Drawer>

      <FormModal open={add.open} onClose={add.onClose} title="Add candidate" initial={{ job_id: jobId, stage: 'applied', source: 'LinkedIn', rating: 3 }}
        fields={[
          { name: 'name', label: 'Full name', required: true }, { name: 'job_id', label: 'Job', type: 'lookup', path: 'jobs', labelKey: 'title', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone' },
          { name: 'source', label: 'Source', type: 'select', noEmpty: true, options: ['LinkedIn', 'Naukri', 'Referral', 'Careers Page', 'Instahyre', 'Agency'] },
          { name: 'experience_years', label: 'Experience (years)', type: 'number', min: 0 }, { name: 'current_company', label: 'Current company' },
          { name: 'expected_ctc', label: 'Expected CTC (₹)', type: 'number', min: 0 }, { name: 'rating', label: 'Rating (1-5)', type: 'number', min: 1, max: 5 },
          { name: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]}
        onSubmit={(v) => act('candidates', { body: v, success: 'Candidate added' })} />
      <FormModal open={schedule.open} onClose={schedule.onClose} title="Schedule interview" initial={{ round: 'Technical Round 1', mode: 'Video', scheduled_at: `${todayStr()}T15:00` }}
        fields={[
          { name: 'round', label: 'Round', required: true }, { name: 'mode', label: 'Mode', type: 'select', noEmpty: true, options: ['Video', 'In-person', 'Phone'] },
          { name: 'scheduled_at', label: 'Date & time', type: 'datetime-local', required: true }, { name: 'interviewer_id', label: 'Interviewer', type: 'employee', required: true },
        ]}
        onSubmit={(v) => act('interviews', { body: { ...v, candidate_id: open?.id, status: 'scheduled' }, success: 'Interview scheduled · interviewer notified' })} />
      <FormModal open={hire.open} onClose={hire.onClose} title={`Hire ${hire.payload?.name}`} size="sm" submitLabel="Hire"
        initial={hire.payload ? { email: hire.payload.email, annual_ctc: hire.payload.expected_ctc, date_of_joining: todayStr() } : {}}
        fields={[{ name: 'email', label: 'Work email', type: 'email', required: true, full: true }, { name: 'date_of_joining', label: 'Joining date', type: 'date', required: true, full: true },
          { name: 'annual_ctc', label: 'Offered CTC (₹)', type: 'number', full: true }]}
        onSubmit={async (v) => {
          const res = await act(`candidates/${hire.payload.id}/hire`, { body: v, success: 'Hired! Employee profile & onboarding checklist created' });
          if (res?.employee_id) { setOpenId(null); navigate(`/employees/${res.employee_id}`); }
          return res;
        }} />
    </div>
  );
}

function Interviews() {
  const { data = [], isLoading } = useGet('interviews');
  const [act] = useAction();
  const fb = useDisclosure();
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['candidate_name', 'job_title', 'interviewer_name']} exportName="interviews"
        empty={<EmptyState icon={CalendarPlus} title="No interviews scheduled" />}
        columns={[
          { key: 'scheduled_at', header: 'When', render: (r) => dateTime(r.scheduled_at) },
          { key: 'candidate_name', header: 'Candidate', render: (r) => <span className="font-semibold">{r.candidate_name}</span> },
          { key: 'job_title', header: 'Role', width: 'minmax(180px, 1.5fr)' }, { key: 'round', header: 'Round' },
          { key: 'interviewer_name', header: 'Interviewer' }, { key: 'mode', header: 'Mode' },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'fb', header: '', sortable: false, csv: false, render: (r) => r.status === 'scheduled' && <button className="btn-ghost btn-sm" onClick={() => fb.onOpen(r)}>Feedback</button> },
        ]} />
      <FormModal open={fb.open} onClose={fb.onClose} title="Interview feedback" initial={{ rating: 3, status: 'completed' }}
        fields={[{ name: 'rating', label: 'Rating (1-5)', type: 'number', min: 1, max: 5, required: true }, { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: ['completed', 'cancelled', 'no_show'] },
          { name: 'feedback', label: 'Feedback', type: 'textarea', full: true, required: true }]}
        onSubmit={(v) => act(`interviews/${fb.payload.id}`, { method: 'PUT', body: v, success: 'Feedback saved' })} />
    </>
  );
}

export default function Recruitment() {
  const [tab, setTab] = useState('pipeline');
  const [jobId, setJobId] = useState(null);
  return (
    <div>
      <PageHeader icon={Briefcase} title="Recruitment" subtitle="Job openings, candidate pipeline and interview scheduling" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'pipeline', label: 'Pipeline' }, { value: 'jobs', label: 'Job openings' }, { value: 'interviews', label: 'Interviews' }]} />
      {tab === 'jobs' && <Jobs onPick={(id) => { setJobId(id); setTab('pipeline'); }} />}
      {tab === 'pipeline' && <Pipeline jobId={jobId} setJobId={setJobId} />}
      {tab === 'interviews' && <Interviews />}
    </div>
  );
}
