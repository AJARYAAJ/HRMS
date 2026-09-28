import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Gauge, Coffee, ThumbsDown, Globe, AppWindow, Monitor, BellRing, Camera, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet } from '../lib/hooks';
import { Avatar, Badge, StatCard, StatSkeletons, CardSkeleton, EmptyState, cx } from '../components/ui';
import { FilePreview } from '../components/Files';
import { attachmentObjectUrl } from '../lib/files';
import { minsToHours, todayStr, shortDate, date as fmtDate, timeAgo } from '../lib/format';
import { useChartTheme } from '../lib/chart';

const SERIES = [['productive', 'Productive', 2], ['neutral', 'Neutral', 0], ['unproductive', 'Unproductive', 7], ['idle', 'Idle', 6]];
const CAT_COLOR = { productive: 'green', neutral: 'blue', unproductive: 'red' };
const BAR = { productive: 'bg-emerald-500', neutral: 'bg-sky-400', unproductive: 'bg-rose-500' };
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Thumb({ file, onOpen }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let u;
    attachmentObjectUrl(file.id).then((x) => { u = x; if (alive) setUrl(x); else URL.revokeObjectURL(x); }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [file.id]);
  return (
    <button onClick={() => onOpen(file)} className="group overflow-hidden rounded-xl border border-slate-200 text-left dark:border-slate-700" data-testid="screenshot">
      <div className="flex aspect-video items-center justify-center bg-slate-100 dark:bg-slate-800">
        {url ? <img src={url} alt={file.original_name} className="h-full w-full object-cover transition group-hover:scale-105" /> : <Loader2 size={16} className="animate-spin text-slate-400" />}
      </div>
      <div className="px-2 py-1 text-[11px] muted">{file.created_at?.slice(11, 16)}</div>
    </button>
  );
}

function UsageList({ title, icon: Icon, rows }) {
  const max = rows[0]?.minutes || 1;
  return (
    <div className="card card-pad">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon size={16} className="text-brand-500" /> {title}</h3>
      {rows.length === 0 ? <p className="text-sm muted">No activity recorded.</p> : (
        <div className="space-y-3">
          {rows.map((a) => (
            <div key={`${a.name}-${a.category}`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm"><span className="truncate font-medium">{a.name}</span><span className="flex shrink-0 items-center gap-2"><Badge color={CAT_COLOR[a.category]}>{a.category}</Badge><span className="w-14 text-right text-xs muted">{minsToHours(a.minutes)}</span></span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={cx('h-full rounded-full', BAR[a.category])} style={{ width: `${(a.minutes / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One person's day (We360-style): hourly timeline, apps & sites, trend, alerts, screenshots and devices. */
export default function ActivityDetail() {
  const { id } = useParams();
  const [day, setDay] = useState(todayStr());
  const { data, isLoading, error } = useGet(`activity/employee/${id}`, { date: day });
  const chart = useChartTheme();
  const [preview, setPreview] = useState(null);
  const t = data?.totals;
  const active = t ? t.productive_mins + t.neutral_mins + t.unproductive_mins : 0;
  const score = t && active + t.idle_mins ? Math.round((t.productive_mins / (active + t.idle_mins)) * 100) : 0;
  const hours = (data?.hourly || []).filter((h, i, arr) => {
    const used = (x) => x.productive + x.neutral + x.unproductive + x.idle > 0;
    const first = arr.findIndex(used);
    const last = arr.length - 1 - [...arr].reverse().findIndex(used);
    return first === -1 ? i >= 8 && i <= 19 : i >= Math.min(first, 9) && i <= Math.max(last, 18);
  }).map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }));

  if (error) {
    return <div className="card"><EmptyState icon={Monitor} title={error.status === 403 ? 'You can’t view this person’s activity' : 'Could not load activity'} message={error.data?.error} action={<Link to="/" className="btn-secondary">Go to dashboard</Link>} /></div>;
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/productivity" className="btn-ghost btn-sm !px-2" aria-label="Back to productivity"><ArrowLeft size={18} /></Link>
          {data ? (
            <>
              <Avatar name={data.employee.name} color={data.employee.avatar_color} size="lg" />
              <div><h1 className="text-xl font-bold" data-testid="activity-employee">{data.employee.name}</h1><p className="text-sm muted">{[data.employee.designation, data.employee.department].filter(Boolean).join(' · ')}</p></div>
            </>
          ) : <div className="skeleton h-10 w-56" />}
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
          <button className="btn-ghost btn-sm !px-2" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
          <input type="date" className="bg-transparent px-1 text-sm font-semibold outline-none" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" data-testid="activity-date" />
          <button className="btn-ghost btn-sm !px-2" onClick={() => setDay(addDays(day, 1))} disabled={day >= todayStr()} aria-label="Next day"><ChevronRight size={16} /></button>
        </div>
      </div>

      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Gauge} label="Productivity" value={`${score}%`} hint={t ? `${minsToHours(t.productive_mins)} productive` : 'No activity'} />
          <StatCard icon={Clock} tone="green" label="Active time" value={minsToHours(active)} hint={data.first_activity ? `${data.first_activity} – ${data.last_activity}` : undefined} />
          <StatCard icon={ThumbsDown} tone="rose" label="Unproductive" value={minsToHours(t?.unproductive_mins || 0)} />
          <StatCard icon={Coffee} tone="slate" label="Idle" value={minsToHours(t?.idle_mins || 0)} hint={data.attendance?.clock_in ? `Clocked in ${data.attendance.clock_in}${data.attendance.clock_out ? ` · out ${data.attendance.clock_out}` : ''}` : 'Not clocked in'} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 font-semibold">Hourly timeline · {fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
          {isLoading ? <CardSkeleton lines={6} className="!border-0 !p-0 !shadow-none" /> : (
            <div className="h-72" data-testid="hourly-chart">
              <ResponsiveContainer>
                <BarChart data={hours} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} unit="m" domain={[0, 60]} />
                  <Tooltip {...chart.tooltip} formatter={(v) => `${v} min`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  {SERIES.map(([k, l, c], i) => <Bar key={k} dataKey={k} name={l} stackId="a" fill={chart.series[c]} stroke={chart.surface} strokeWidth={2} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} barSize={22} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="card card-pad">
          <h3 className="mb-4 font-semibold">Last 14 days</h3>
          {isLoading ? <CardSkeleton lines={6} className="!border-0 !p-0 !shadow-none" /> : data.trend.length === 0 ? <p className="text-sm muted">No history yet.</p> : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data.trend.map((r) => ({ date: r.date, productive: r.productive_mins, neutral: r.neutral_mins, unproductive: r.unproductive_mins, idle: r.idle_mins }))} margin={{ left: -20, right: 4 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: chart.axis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: chart.axis }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                  <Tooltip {...chart.tooltip} labelFormatter={shortDate} formatter={(v) => minsToHours(v)} />
                  {SERIES.map(([k, l, c], i) => <Bar key={k} dataKey={k} name={l} stackId="a" fill={chart.series[c]} stroke={chart.surface} strokeWidth={2} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} onClick={(p) => setDay(p.date)} className="cursor-pointer" />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {!isLoading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <UsageList title="Applications" icon={AppWindow} rows={data.apps} />
          <UsageList title="Websites" icon={Globe} rows={data.domains} />
        </div>
      )}

      {!isLoading && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="card card-pad xl:col-span-2">
            <h3 className="mb-4 flex items-center gap-2 font-semibold"><Camera size={16} className="text-brand-500" /> Screenshots <span className="text-xs font-normal muted">({data.screenshots.length})</span></h3>
            {data.screenshots.length === 0 ? <EmptyState icon={Camera} title="No screenshots for this day" message="Screenshots appear here when enabled in activity settings and the desktop agent is running." /> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="screenshots">
                {data.screenshots.map((s) => <Thumb key={s.id} file={s} onOpen={setPreview} />)}
              </div>
            )}
          </div>
          <div className="space-y-6">
            <div className="card card-pad">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><BellRing size={16} className="text-brand-500" /> Alerts</h3>
              {data.alerts.length === 0 ? <p className="text-sm muted">No alerts.</p> : (
                <div className="space-y-2" data-testid="employee-alerts">
                  {data.alerts.slice(0, 8).map((a) => (
                    <div key={a.id} className="rounded-xl border border-slate-100 p-2.5 text-sm dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2"><Badge color={a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'slate'}>{a.type.replace(/_/g, ' ')}</Badge><span className="text-xs muted">{shortDate(a.date)}</span></div>
                      <div className="mt-1">{a.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card card-pad">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><Monitor size={16} className="text-brand-500" /> Devices</h3>
              {data.devices.length === 0 ? <p className="text-sm muted">No agent installed.</p> : data.devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-sm last:border-0 dark:border-slate-800">
                  <div><div className="font-medium">{d.name}</div><div className="text-xs muted">{d.platform || 'Unknown OS'} · {d.last_seen_at ? `seen ${timeAgo(d.last_seen_at)}` : 'never connected'}</div></div>
                  {d.revoked ? <Badge color="slate">revoked</Badge> : <Badge color="green">active</Badge>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
