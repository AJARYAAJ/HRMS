import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Briefcase, Clock, ArrowLeft, CheckCircle2, Loader2, Search, Building } from 'lucide-react';
import { FileDrop } from '../components/Files';
import { Skeleton, EmptyState, cx } from '../components/ui';
import { timeAgo } from '../lib/format';

/** Public careers site (no sign-in): browse open roles and apply with a resume. */
export default function Careers() {
  const { jobId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('/api/careers').then((r) => r.json()).then(setData).catch(() => setError('Could not load open positions'));
  }, []);
  const job = jobId && data?.jobs.find((j) => String(j.id) === jobId);
  const jobs = (data?.jobs || []).filter((j) => !q || `${j.title} ${j.department} ${j.location}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      <header className="bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 text-white">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <Link to="/careers" className="flex items-center gap-3"><img src="/favicon.svg" alt="" className="h-10 w-10 rounded-xl ring-2 ring-white/30" /><span className="text-lg font-bold">{data?.company.name || 'Careers'}</span></Link>
          {!job && (
            <>
              <h1 className="mt-10 text-4xl font-extrabold tracking-tight">Build what's next with us</h1>
              <p className="mt-3 max-w-2xl text-lg text-white/80">We're hiring across engineering, design, sales and more. Find a role where you'll do the best work of your career.</p>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto -mt-6 max-w-5xl px-6 pb-16">
        {error && <div className="card p-6 text-rose-600">{error}</div>}
        {!data && !error && <div className="card space-y-3 p-6">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
        {data && !jobId && (
          <div className="space-y-4">
            <div className="card flex items-center gap-3 p-3">
              <Search size={18} className="ml-2 text-slate-400" />
              <input className="w-full bg-transparent py-2 text-sm outline-none" placeholder="Search roles, teams or locations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
              <span className="whitespace-nowrap pr-2 text-sm muted">{jobs.length} open roles</span>
            </div>
            {jobs.length === 0 ? <div className="card"><EmptyState icon={Briefcase} title="No open roles right now" message="Check back soon." /></div> : jobs.map((j) => (
              <Link key={j.id} to={`/careers/${j.id}`} className="card flex flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center" data-testid="career-job">
                <div className="flex-1">
                  <div className="text-lg font-semibold text-slate-900 dark:text-white">{j.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm muted">
                    <span className="flex items-center gap-1"><Building size={14} />{j.department}</span>
                    <span className="flex items-center gap-1"><MapPin size={14} />{j.location}</span>
                    <span className="flex items-center gap-1"><Briefcase size={14} />{j.employment_type}</span>
                    {j.experience && <span className="flex items-center gap-1"><Clock size={14} />{j.experience}</span>}
                  </div>
                </div>
                <span className="btn-primary btn-sm self-start sm:self-auto">View & apply</span>
              </Link>
            ))}
          </div>
        )}
        {data && jobId && !job && <div className="card"><EmptyState title="This position is no longer open" action={<Link to="/careers" className="btn-secondary">See all roles</Link>} /></div>}
        {job && <JobDetail job={job} />}
        <p className="mt-10 text-center text-xs muted">Powered by PeopleHub · <Link to="/login" className="hover:underline">Employee sign-in</Link></p>
      </main>
    </div>
  );
}

function JobDetail({ job }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', experience_years: '', current_company: '', expected_ctc: '', cover_letter: '', website: '' });
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ busy: false, error: '', done: null });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setState({ busy: false, error: 'Please attach your resume', done: null });
    setState({ busy: true, error: '', done: null });
    const body = new FormData();
    for (const [k, v] of Object.entries(f)) if (v) body.append(k, v);
    body.append('file', file);
    const res = await fetch(`/api/careers/jobs/${job.id}/apply`, { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    setState({ busy: false, error: res.ok ? '' : json.error || 'Something went wrong', done: res.ok ? json.application_id : null });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="card card-pad lg:col-span-3">
        <Link to="/careers" className="btn-ghost btn-sm -ml-2"><ArrowLeft size={14} /> All roles</Link>
        <h1 className="mt-3 text-2xl font-bold">{job.title}</h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm muted">
          <span>{job.department}</span><span>{job.location}</span><span>{job.employment_type}</span>{job.experience && <span>{job.experience}</span>}<span>Posted {timeAgo(job.created_at)}</span>
        </div>
        <p className="mt-6 whitespace-pre-wrap leading-relaxed">{job.description}</p>
        <h3 className="mt-6 font-semibold">Why join us</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm muted">
          <li>Hybrid work with flexible hours</li><li>Health insurance for you and your family</li><li>Learning budget and mentorship</li><li>{job.openings > 1 ? `${job.openings} openings on this team` : 'A high-impact role on a growing team'}</li>
        </ul>
      </div>
      <div className="lg:col-span-2">
        {state.done ? (
          <div className="card card-pad text-center" data-testid="application-done">
            <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
            <h2 className="mt-3 text-xl font-bold">Application received!</h2>
            <p className="mt-1 text-sm muted">Reference <b>{state.done}</b>. We've emailed you a confirmation and will be in touch if there's a match.</p>
            <Link to="/careers" className="btn-secondary mt-4">Browse more roles</Link>
          </div>
        ) : (
          <form className="card card-pad space-y-4" onSubmit={submit} data-testid="apply-form">
            <h2 className="text-lg font-semibold">Apply for this role</h2>
            {[['name', 'Full name', 'text', true], ['email', 'Email', 'email', true], ['phone', 'Phone', 'tel'], ['current_company', 'Current company'], ['experience_years', 'Years of experience', 'number'], ['expected_ctc', 'Expected CTC (₹ per year)', 'text']].map(([k, l, type = 'text', req]) => (
              <div key={k}><label className="label" htmlFor={`apply-${k}`}>{l}{req && <span className="text-rose-500"> *</span>}</label><input id={`apply-${k}`} type={type} className="input" required={req} value={f[k]} onChange={set(k)} /></div>
            ))}
            {/* Honeypot for bots — hidden from people and screen readers. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" value={f.website} onChange={set('website')} />
            <FileDrop file={file} onChange={setFile} label="Resume (PDF or Word)" hint="Up to 10 MB" testId="resume-upload" />
            <div><label className="label" htmlFor="apply-cover">Cover letter (optional)</label><textarea id="apply-cover" className="input min-h-24" value={f.cover_letter} onChange={set('cover_letter')} /></div>
            {state.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{state.error}</p>}
            <button className={cx('btn-primary w-full py-2.5')} disabled={state.busy} data-testid="submit-application">{state.busy && <Loader2 size={16} className="animate-spin" />} Submit application</button>
          </form>
        )}
      </div>
    </div>
  );
}
