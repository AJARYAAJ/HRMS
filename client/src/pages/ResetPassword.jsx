import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(body.error || 'Could not reset password');
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 via-white to-violet-50 p-6 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="card w-full max-w-md p-8 animate-pop">
        <div className="mb-6 flex items-center gap-3"><img src="/favicon.svg" alt="" className="h-10 w-10" /><span className="text-xl font-extrabold">PeopleHub</span></div>
        {done ? (
          <div className="space-y-4 text-center" data-testid="reset-done">
            <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
            <h1 className="text-xl font-bold">Password updated</h1>
            <p className="text-sm muted">You can now sign in with your new password.</p>
            <Link to="/login" className="btn-primary w-full">Go to sign in</Link>
          </div>
        ) : !token ? (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-bold">Invalid reset link</h1>
            <p className="text-sm muted">This link is missing its token. Request a new one from the sign-in page.</p>
            <Link to="/login" className="btn-secondary w-full">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h1 className="flex items-center gap-2 text-xl font-bold"><KeyRound size={20} className="text-brand-500" /> Choose a new password</h1>
            <div><label className="label" htmlFor="new-password">New password</label><input id="new-password" type="password" minLength={8} required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
            <div><label className="label" htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" minLength={8} required className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" role="alert">{error}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
            <p className="text-center text-xs muted">At least 8 characters. <Link to="/login" className="font-semibold text-brand-600">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
