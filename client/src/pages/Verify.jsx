import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, ShieldX, ShieldAlert } from 'lucide-react';

/** Public page opened by scanning an ID card's QR code. Shows only what the card itself shows. */
export default function Verify() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    fetch(`/api/public/verify/${encodeURIComponent(code)}`)
      .then(async (r) => setState({ loading: false, ok: r.ok, data: await r.json() }))
      .catch(() => setState({ loading: false, ok: false, data: { error: 'Could not reach the server' } }));
  }, [code]);
  const d = state.data || {};
  const Icon = !state.ok ? ShieldX : d.current ? BadgeCheck : ShieldAlert;
  const tone = !state.ok ? 'text-rose-600 bg-rose-50 dark:bg-rose-500/10' : d.current ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' : 'text-amber-600 bg-amber-50 dark:bg-amber-500/10';
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="card w-full max-w-sm p-6 text-center" data-testid="verify-result">
        {state.loading ? <p className="muted">Checking…</p> : (
          <>
            <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone}`}><Icon size={30} /></div>
            <h1 className="mt-3 text-xl font-bold">{!state.ok ? 'Not verified' : d.current ? 'Verified employee' : 'Former employee'}</h1>
            {state.ok ? (
              <div className="mt-4 space-y-1">
                {d.photo_url && <img src={d.photo_url} alt={d.name} className="mx-auto mb-3 h-24 w-24 rounded-full object-cover" />}
                <div className="text-lg font-semibold" data-testid="verify-name">{d.name}</div>
                <div className="text-sm muted">{[d.designation, d.department].filter(Boolean).join(' · ')}</div>
                <div className="text-sm font-medium">{d.company}</div>
                <div className="text-xs muted">Employee ID {d.emp_code}</div>
                <div className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${tone}`} data-testid="verify-status">{d.status}</div>
                <p className="pt-3 text-[11px] muted">Checked {new Date(d.checked_at).toLocaleString()}</p>
              </div>
            ) : <p className="mt-2 text-sm muted">{d.error || 'This ID card could not be verified.'}</p>}
          </>
        )}
      </div>
    </div>
  );
}
