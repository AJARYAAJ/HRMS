import { useEffect, useState } from 'react';
import { LogIn, LogOut, MapPin, Home, Briefcase, Navigation } from 'lucide-react';
import { useGet, useAction } from '../lib/hooks';
import { Skeleton, Badge, cx } from './ui';
import { hoursBetween } from '../lib/format';

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function ClockWidget({ compact = false }) {
  const { data, isLoading } = useGet('attendance/today');
  const [act, { isLoading: busy }] = useAction();
  const [mode, setMode] = useState('office');
  const [locating, setLocating] = useState(false);

  // Best-effort location for geofenced attendance; clock-in still works if the user declines.
  const locate = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
    );
  });
  const clockIn = async () => {
    setLocating(true);
    const coords = await locate();
    setLocating(false);
    act('attendance/clock-in', { body: { work_mode: mode, ...coords }, success: 'Clocked in successfully' });
  };
  const now = useNow();
  const rec = data?.record;
  // The attendance policy decides which clock-in modes are allowed.
  const modes = data?.modes || ['office', 'remote', 'field'];
  const activeMode = modes.includes(mode) ? mode : modes[0];
  useEffect(() => { if (activeMode && activeMode !== mode) setMode(activeMode); }, [activeMode, mode]);
  const clockedIn = !!rec?.clock_in && !rec?.clock_out;
  const done = !!rec?.clock_out;
  const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const worked = rec?.clock_in ? hoursBetween(rec.clock_in, rec.clock_out || nowStr) : 0;

  if (isLoading) return <div className="card card-pad space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-10 w-2/3" /><Skeleton className="h-10 w-full" /></div>;

  return (
    <div className={cx('card relative overflow-hidden', compact ? 'p-5' : 'p-6')} data-testid="clock-widget">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-brand-500/20 to-violet-500/20 blur-2xl" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold muted">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <span className="flex gap-1">
            {rec?.geo_status === 'inside' && <Badge status="inside" data-testid="geo-badge"><Navigation size={10} /> At office</Badge>}
            {rec?.geo_status === 'outside' && <Badge status="outside"><Navigation size={10} /> Outside geofence</Badge>}
            {rec?.late ? <Badge status="late">Late</Badge> : rec?.clock_in ? <Badge status="present">On time</Badge> : null}
          </span>
        </div>
        <div className="mt-2 font-mono text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className="mt-1 text-xs muted">Shift {data?.shift?.start_time} – {data?.shift?.end_time}</div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[['Clock in', rec?.clock_in || '--:--'], ['Clock out', rec?.clock_out || '--:--'], ['Worked', worked ? `${Math.floor(worked)}h ${Math.round((worked % 1) * 60)}m` : '0h 0m']].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-slate-50 py-2 dark:bg-slate-800/60">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{l}</div>
              <div className="text-sm font-bold" data-testid={`clock-${l.replace(' ', '-').toLowerCase()}`}>{v}</div>
            </div>
          ))}
        </div>
        {!rec?.clock_in && (
          <div className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[['office', 'Office', Briefcase], ['remote', 'Remote', Home], ['field', 'Field', MapPin]].filter(([v]) => modes.includes(v)).map(([v, l, Icon]) => (
              <button key={v} onClick={() => setMode(v)} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition', mode === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}>
                <Icon size={13} /> {l}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4">
          {done ? (
            <div className="rounded-xl bg-emerald-50 py-2.5 text-center text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Day complete — see you tomorrow! ✨</div>
          ) : clockedIn ? (
            <button className="btn-danger w-full py-2.5" disabled={busy} onClick={() => act('attendance/clock-out', { success: 'Clocked out. Great work today!' })} data-testid="clock-out">
              <LogOut size={16} /> Clock out
            </button>
          ) : (
            <button className="btn-success w-full py-2.5" disabled={busy || locating} onClick={clockIn} data-testid="clock-in">
              <LogIn size={16} /> {locating ? 'Getting location…' : 'Clock in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
