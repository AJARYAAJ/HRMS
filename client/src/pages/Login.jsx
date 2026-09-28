import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck, Clock, Wallet, Users, Sparkles, MailCheck } from 'lucide-react';
import { Modal } from '../components/ui';
import { useLoginMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';

const DEMO = [
  ['Admin', 'admin@peoplehub.demo', 'Full access'],
  ['HR', 'hr@peoplehub.demo', 'People ops & payroll'],
  ['Manager', 'manager@peoplehub.demo', 'Team & approvals'],
  ['Employee', 'employee@peoplehub.demo', 'Self-service'],
];

export default function Login() {
  const token = useSelector((s) => s.auth.token);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [sent, setSent] = useState('');
  const [sending, setSending] = useState(false);
  const [login, { isLoading }] = useLoginMutation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  if (token) return <Navigate to="/" replace />;

  const submit = async (e, creds) => {
    e?.preventDefault();
    setError('');
    try {
      const res = await login(creds || { email, password }).unwrap();
      dispatch(setCredentials(res));
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err?.data?.error || 'Unable to sign in. Please try again.');
    }
  };

  return (
    <div className="flex min-h-full">
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-xl ring-2 ring-white/30" />
          <span className="text-2xl font-extrabold tracking-tight">PeopleHub</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur"><Sparkles size={14} /> All-in-one HR platform</div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Everything your people need, in one beautiful place.</h1>
          <p className="mt-4 text-lg text-white/80">Core HR, attendance, leave, payroll, recruitment, performance and productivity analytics — built for modern Indian workplaces.</p>
          <div className="mt-10 grid grid-cols-2 gap-4">
            {[[Clock, 'Attendance & shifts'], [Wallet, 'Payroll with PF, ESI, TDS'], [Users, 'Hire to retire'], [ShieldCheck, 'Role-based security']].map(([Icon, label]) => (
              <div key={label} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
                <Icon size={20} /> <span className="text-sm font-semibold">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-10 text-sm text-white/60">© {new Date().getFullYear()} PeopleHub HRMS</div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <span className="text-xl font-extrabold">PeopleHub</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome back 👋</h2>
          <p className="mt-2 muted">Sign in to your workspace to continue.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="label" htmlFor="email">Work email</label>
              <input id="email" type="email" className="input py-2.5" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input id="password" type={show ? 'text' : 'password'} className="input py-2.5 pr-10" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShow((s) => !s)} aria-label="Toggle password visibility">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" role="alert">{error}</div>}
            <div className="flex justify-end -mt-1">
              <button type="button" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400" onClick={() => { setForgot(true); setSent(''); setResetEmail(email); }}>Forgot password?</button>
            </div>
            <button type="submit" className="btn-primary w-full py-2.5" disabled={isLoading}>
              {isLoading && <Loader2 size={16} className="animate-spin" />} Sign in
            </button>
          </form>
          <Modal open={forgot} onClose={() => setForgot(false)} title="Reset your password" size="sm">
            {sent ? (
              <div className="space-y-4 text-center" data-testid="reset-sent">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><MailCheck size={22} /></div>
                <p className="text-sm">{sent}</p>
                <p className="text-xs muted">The link expires in 30 minutes. Check your spam folder if it doesn't arrive.</p>
                <button className="btn-secondary w-full" onClick={() => setForgot(false)}>Back to sign in</button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                setSending(true);
                const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail }) });
                const body = await res.json().catch(() => ({}));
                setSending(false);
                setSent(res.ok ? body.message : body.error || 'Something went wrong');
              }}>
                <p className="text-sm muted">Enter your work email and we'll send you a link to choose a new password.</p>
                <div><label className="label" htmlFor="reset-email">Work email</label><input id="reset-email" type="email" required className="input" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} /></div>
                <button className="btn-primary w-full" disabled={sending}>{sending ? 'Sending…' : 'Send reset link'}</button>
              </form>
            )}
          </Modal>
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> Demo accounts <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map(([role, mail, desc]) => (
                <button key={role} type="button" onClick={() => submit(null, { email: mail, password: 'Password@123' })} data-testid={`demo-${role.toLowerCase()}`}
                  className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <div className="text-sm font-semibold">{role}</div>
                  <div className="text-xs muted">{desc}</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs muted">Password for all demo users: <code className="font-semibold">Password@123</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}
