import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Gauge, Clock, Coffee, ThumbsDown, AppWindow, Radio, BellRing, ListChecks, Monitor, Settings2, Plus, Trash2, RefreshCw, Copy, Check, KeyRound, Save, CircleDot, Moon, PowerOff } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, StatCard, StatSkeletons, Avatar, CardSkeleton, Badge, Tabs, Modal, Confirm, EmptyState, cx } from '../components/ui';
import { FormModal } from '../components/Form';
import DataTable from '../components/DataTable';
import { minsToHours, todayStr, shortDate, timeAgo } from '../lib/format';
import { useChartTheme } from '../lib/chart';

const RANGES = [[7, 'Last 7 days'], [14, 'Last 14 days'], [21, 'Last 21 days']];
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

function Split({ r }) {
  const total = r.productive + r.neutral + r.unproductive + r.idle || 1;
  const seg = [['productive', 'bg-emerald-500'], ['neutral', 'bg-sky-400'], ['unproductive', 'bg-rose-500'], ['idle', 'bg-slate-300 dark:bg-slate-600']];
  return (
    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" title={seg.map(([k]) => `${k}: ${minsToHours(r[k])}`).join(' · ')}>
      {seg.map(([k, c]) => <div key={k} className={c} style={{ width: `${(r[k] / total) * 100}%` }} />)}
    </div>
  );
}

function Analytics() {
  const [range, setRange] = useState(7);
  const [dept, setDept] = useState('');
  const { data: depts = [] } = useGet('departments');
  const { data, isLoading } = useGet('productivity', { from: daysAgo(range - 1), to: todayStr(), department_id: dept });
  const chart = useChartTheme();
  const navigate = useNavigate();
  const t = data?.totals;
  const people = data?.employees?.length || 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="input !w-auto" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Date range">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Gauge} label="Productivity score" value={`${data.score}%`} hint="Productive ÷ total tracked time" />
          <StatCard icon={Clock} tone="green" label="Avg productive / person" value={minsToHours(t.productive / people)} hint={`over ${range} days`} />
          <StatCard icon={ThumbsDown} tone="rose" label="Avg unproductive / person" value={minsToHours(t.unproductive / people)} />
          <StatCard icon={Coffee} tone="slate" label="Avg idle / person" value={minsToHours(t.idle / people)} />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 font-semibold">Daily activity breakdown (avg minutes per person)</h3>
          {isLoading ? <CardSkeleton lines={6} className="!border-0 !p-0 !shadow-none" /> : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data.daily} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                  <Tooltip {...chart.tooltip} labelFormatter={shortDate} formatter={(v) => minsToHours(v)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  {[['productive', 'Productive', 2], ['neutral', 'Neutral', 0], ['unproductive', 'Unproductive', 7], ['idle', 'Idle', 6]].map(([k, l, c], i, arr) => (
                    <Bar key={k} dataKey={k} name={l} stackId="a" fill={chart.series[c]} stroke={chart.surface} strokeWidth={2} radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0} barSize={26} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="card card-pad">
          <h3 className="mb-4 flex items-center gap-2 font-semibold"><AppWindow size={16} className="text-brand-500" /> Top apps & websites</h3>
          {isLoading ? <CardSkeleton lines={6} className="!border-0 !p-0 !shadow-none" /> : (
            <div className="space-y-3">
              {data.apps.map((a) => (
                <div key={a.name}>
                  <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{a.name}</span><span className="flex items-center gap-2"><Badge color={a.category === 'productive' ? 'green' : a.category === 'neutral' ? 'blue' : 'red'}>{a.category}</Badge><span className="w-16 text-right text-xs muted">{minsToHours(a.minutes)}</span></span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={cx('h-full rounded-full', a.category === 'productive' ? 'bg-emerald-500' : a.category === 'neutral' ? 'bg-sky-400' : 'bg-rose-500')} style={{ width: `${(a.minutes / data.apps[0].minutes) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <DataTable title="Employee activity" onRowClick={(r) => navigate(`/productivity/${r.id}`)} loading={isLoading} rows={data?.employees || []} searchKeys={['employee_name', 'department']} exportName="productivity" initialSort={{ key: 'score', dir: 'desc' }}
        columns={[
          { key: 'employee_name', header: 'Employee', width: 'minmax(220px, 1.6fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.employee_name}</div><div className="truncate text-xs muted">{r.department}</div></div></div> },
          { key: 'split', header: 'Activity split', width: 'minmax(180px, 1.5fr)', sortable: false, csv: false, render: (r) => <Split r={r} /> },
          { key: 'productive', header: 'Productive', render: (r) => minsToHours(r.productive) },
          { key: 'unproductive', header: 'Unproductive', render: (r) => minsToHours(r.unproductive) },
          { key: 'idle', header: 'Idle', render: (r) => minsToHours(r.idle) },
          { key: 'score', header: 'Score', render: (r) => <Badge color={r.score >= 65 ? 'green' : r.score >= 50 ? 'amber' : 'red'}>{r.score}%</Badge> },
        ]} />
    </div>
  );
}

const ago = (m) => (m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`);
const STATUS_ICON = { active: CircleDot, idle: Moon, offline: PowerOff };

/** Live board: who is active, idle or offline right now and what they're working in. */
function Live() {
  const { data, isLoading } = useGet('activity/live', undefined, { poll: 30000 });
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();
  const rows = (data?.rows || []).filter((r) => !filter || r.status === filter);
  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons count={3} /> : (
        <div className="grid grid-cols-3 gap-4" data-testid="live-counts">
          {[['active', 'Active now', 'green'], ['idle', 'Idle', 'amber'], ['offline', 'Offline', 'slate']].map(([k, l, tone]) => (
            <StatCard key={k} icon={STATUS_ICON[k]} tone={tone} label={l} value={data.counts[k]} onClick={() => setFilter(filter === k ? '' : k)} hint={filter === k ? 'Filtered · click to clear' : 'Click to filter'} />
          ))}
        </div>
      )}
      <DataTable title="Live status" loading={isLoading} rows={rows} searchKeys={['name', 'department']} exportName="live-activity" onRowClick={(r) => navigate(`/productivity/${r.id}`)}
        empty={<EmptyState icon={Radio} title="Nobody matches" />}
        columns={[
          { key: 'name', header: 'Employee', width: 'minmax(220px, 1.6fr)', render: (r) => <div className="flex items-center gap-2" data-testid="live-row"><Avatar name={r.name} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.designation || r.department}</div></div></div> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
          { key: 'current', header: 'Working in', width: 'minmax(200px, 1.6fr)', sortable: false, csv: (r) => r.current?.domain || r.current?.app || '', render: (r) => (r.current ? <div className="min-w-0"><div className="truncate text-sm font-medium">{r.current.domain || r.current.app}</div><div className="truncate text-xs muted">{r.current.title || r.current.category}</div></div> : <span className="muted">{r.last_seen_minutes != null ? `Last seen ${ago(r.last_seen_minutes)}` : 'No agent data'}</span>) },
          { key: 'clock_in', header: 'Clock-in', render: (r) => r.clock_in || '—' },
          { key: 'active_mins', header: 'Active today', render: (r) => minsToHours(r.active_mins) },
          { key: 'score', header: 'Score', render: (r) => (r.active_mins ? <Badge color={r.score >= 65 ? 'green' : r.score >= 50 ? 'amber' : 'red'}>{r.score}%</Badge> : '—') },
        ]} />
    </div>
  );
}

function Alerts() {
  const [type, setType] = useState('');
  const [open, setOpen] = useState('1');
  const { data = [], isLoading } = useGet('activity/alerts', { type, unacknowledged: open });
  const [act] = useAction();
  const navigate = useNavigate();
  return (
    <DataTable title="Activity alerts" loading={isLoading} rows={data} searchKeys={['employee_name', 'message']} exportName="activity-alerts"
      toolbar={<>
        <select className="input !w-auto !py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Alert type"><option value="">All types</option><option value="long_idle">Long idle</option><option value="unproductive">Unproductive</option><option value="overwork">Overwork / burnout</option></select>
        <select className="input !w-auto !py-1.5 text-sm" value={open} onChange={(e) => setOpen(e.target.value)} aria-label="Alert state"><option value="1">Open</option><option value="">All</option></select>
      </>}
      empty={<EmptyState icon={BellRing} title="No alerts" message="Alerts are raised for long idle stretches, unproductive time and overwork." />}
      columns={[
        { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.4fr)', render: (r) => <button className="flex items-center gap-2 text-left hover:underline" onClick={() => navigate(`/productivity/${r.employee_id}`)}><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></button> },
        { key: 'type', header: 'Type', render: (r) => <Badge color={r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'amber' : 'slate'}>{r.type.replace(/_/g, ' ')}</Badge> },
        { key: 'message', header: 'Detail', width: 'minmax(220px, 2fr)' },
        { key: 'date', header: 'Date', render: (r) => shortDate(r.date) },
        { key: '_a', header: '', sortable: false, csv: false, width: '130px', render: (r) => (r.acknowledged ? <span className="text-xs muted">Acknowledged</span> : <button className="btn-secondary btn-sm" data-testid="ack-alert" onClick={() => act(`activity/alerts/${r.id}/ack`, { success: 'Alert acknowledged' })}><Check size={14} /> Acknowledge</button>) },
      ]} />
  );
}

function Rules() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('activity/rules');
  const [act, { isLoading: busy }] = useAction();
  const toast = useToast();
  const form = useDisclosure();
  const [del, setDel] = useState(null);
  return (
    <>
      <DataTable title="App & website classification" loading={isLoading} rows={data} searchKeys={['pattern', 'department']} exportName="app-rules"
        toolbar={isHR && <>
          <button className="btn-secondary btn-sm" disabled={busy} data-testid="reapply-rules" onClick={async () => { const r = await act('activity/rules/reapply', { body: { days: 7 } }); if (r) toast(`Reclassified ${r.changed} of ${r.scanned} events · ${r.days_recomputed} day(s) recomputed`); }}><RefreshCw size={14} /> Re-apply to last 7 days</button>
          <button className="btn-primary btn-sm" onClick={() => form.onOpen()} data-testid="add-rule"><Plus size={14} /> Add rule</button>
        </>}
        columns={[
          { key: 'pattern', header: 'App or domain', width: 'minmax(200px, 1.6fr)', render: (r) => <span className="font-mono text-sm">{r.pattern}</span> },
          { key: 'category', header: 'Category', render: (r) => (isHR ? (
            <select className="input !w-auto !py-1 text-xs" value={r.category} aria-label={`Category for ${r.pattern}`} onChange={(e) => act(`activity/rules/${r.id}`, { method: 'PUT', body: { category: e.target.value }, success: `${r.pattern} marked ${e.target.value}` })}>
              {['productive', 'neutral', 'unproductive'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>) : <Badge status={r.category}>{r.category}</Badge>) },
          { key: 'department', header: 'Applies to', render: (r) => r.department || 'Everyone' },
          ...(isHR ? [{ key: '_a', header: '', sortable: false, csv: false, width: '60px', render: (r) => <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" onClick={() => setDel(r)} aria-label={`Delete rule ${r.pattern}`}><Trash2 size={14} /></button> }] : []),
        ]} />
      <p className="mt-3 text-xs muted">Department rules override company-wide rules. Unmatched apps and sites count as neutral. Changing rules affects new activity; use “Re-apply” to reclassify recent history.</p>
      <FormModal open={form.open} onClose={form.onClose} title="Add classification rule" initial={{ category: 'productive' }}
        fields={[
          { name: 'pattern', label: 'App name or website domain', required: true, full: true, placeholder: 'e.g. figma.com or Visual Studio Code' },
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: [['productive', 'Productive'], ['neutral', 'Neutral'], ['unproductive', 'Unproductive']] },
          { name: 'department_id', label: 'Department (empty = everyone)', type: 'lookup', path: 'departments' },
        ]}
        onSubmit={(v) => act('activity/rules', { body: v, success: 'Rule added' })} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete rule?" confirmLabel="Delete" message={del?.pattern} onConfirm={() => act(`activity/rules/${del.id}`, { method: 'DELETE', success: 'Rule deleted' })} />
    </>
  );
}

function Devices() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('activity/devices');
  const [act] = useAction();
  const toast = useToast();
  const form = useDisclosure();
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const copy = async () => { try { await navigator.clipboard.writeText(token.token); setCopied(true); } catch { toast('Copy failed — select the token and copy it manually', 'error'); } };
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <DataTable title="Agent devices" loading={isLoading} rows={data} searchKeys={['name', 'employee_name', 'platform']} exportName="agent-devices"
          toolbar={<button className="btn-primary btn-sm" onClick={() => form.onOpen()} data-testid="add-device"><Plus size={14} /> Register device</button>}
          empty={<EmptyState icon={Monitor} title="No devices registered" message="Register a device to get a token for the desktop agent." />}
          columns={[
            { key: 'name', header: 'Device', render: (r) => <div><div className="font-semibold">{r.name}</div><div className="text-xs muted">{r.platform || '—'}</div></div> },
            { key: 'employee_name', header: 'Employee', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> },
            { key: 'last_seen_at', header: 'Last seen', render: (r) => (r.last_seen_at ? timeAgo(r.last_seen_at) : 'Never') },
            { key: 'revoked', header: 'Status', render: (r) => (r.revoked ? <Badge color="slate">revoked</Badge> : <Badge color="green">active</Badge>) },
            { key: '_a', header: '', sortable: false, csv: false, width: '100px', render: (r) => (!r.revoked && <button className="btn-ghost btn-sm text-rose-600" onClick={() => setRevoke(r)} data-testid="revoke-device">Revoke</button>) },
          ]} />
      </div>
      <div className="card card-pad text-sm">
        <h3 className="mb-2 flex items-center gap-2 font-semibold"><KeyRound size={16} className="text-brand-500" /> Agent protocol</h3>
        <p className="muted">The desktop agent authenticates with its device token and posts what was in focus once a minute.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{`GET  /api/agent/config
POST /api/agent/heartbeat
Authorization: Device <token>
{ "events": [{ "ts": "…ISO…",
  "app": "Code", "domain": "github.com",
  "title": "PR #42", "active_seconds": 55,
  "idle_seconds": 5 }] }
POST /api/agent/screenshot  (multipart "file")`}</pre>
        <p className="mt-3 muted">Try it locally with <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run agent:simulate</code>.</p>
      </div>
      <FormModal open={form.open} onClose={form.onClose} title="Register a device" submitLabel="Create token" initial={{ platform: 'Windows' }}
        fields={[
          { name: 'name', label: 'Device name', required: true, placeholder: 'Work laptop' },
          { name: 'platform', label: 'Platform', type: 'select', noEmpty: true, options: ['Windows', 'macOS', 'Linux'] },
          ...(isHR ? [{ name: 'employee_id', label: 'Employee (empty = me)', type: 'employee', full: true }] : []),
        ]}
        onSubmit={async (v) => { const r = await act('activity/devices', { body: v, success: 'Device registered' }); if (r) { setCopied(false); setToken(r); } return r; }} />
      <Modal open={!!token} onClose={() => setToken(null)} title="Device token" footer={<button className="btn-primary" onClick={() => setToken(null)}>Done</button>}>
        {token && (
          <div className="space-y-3 text-sm">
            <p>Paste this token into the agent on <b>{token.name}</b>. It is shown <b>only once</b> — store it securely.</p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
              <code className="flex-1 break-all font-mono text-xs" data-testid="device-token">{token.token}</code>
              <button className="btn-secondary btn-sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={!!revoke} onClose={() => setRevoke(null)} danger title="Revoke device?" confirmLabel="Revoke" message={`${revoke?.name} will stop sending activity immediately.`}
        onConfirm={() => act(`activity/devices/${revoke.id}`, { method: 'DELETE', success: 'Device revoked' })} />
    </div>
  );
}

function ActivitySettings() {
  const { isHR } = useAuth();
  const { data, isLoading } = useGet('activity/settings');
  const [act, { isLoading: saving }] = useAction();
  const [draft, setDraft] = useState(null);
  const v = draft || data;
  if (isLoading || !v) return <CardSkeleton lines={6} />;
  const set = (k) => (e) => setDraft({ ...v, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const NUMS = [['screenshot_interval_mins', 'Screenshot interval (minutes)', 1, 120], ['idle_alert_minutes', 'Alert after idle for (minutes)', 5, 240], ['unproductive_alert_minutes', 'Alert after unproductive time (minutes / day)', 10, 480], ['overwork_hours', 'Overwork alert (active hours / day)', 6, 16], ['live_window_minutes', 'Offline after no heartbeat for (minutes)', 1, 30]];
  return (
    <form className="card card-pad max-w-2xl space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      const body = { screenshots_enabled: v.screenshots_enabled === '1', activity_attendance: v.activity_attendance === '1', ...Object.fromEntries(NUMS.map(([k]) => [k, Number(v[k])])) };
      if (await act('activity/settings', { method: 'PUT', body, success: 'Activity settings saved' })) setDraft(null);
    }}>
      {[['screenshots_enabled', 'Capture screenshots', 'Agents upload periodic screenshots, visible to the employee, their managers and HR.'], ['activity_attendance', 'Auto clock-in from activity', 'The first activity of the day marks the employee present (remote) if they have not clocked in.']].map(([k, l, hint]) => (
        <label key={k} className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={v[k] === '1'} onChange={set(k)} disabled={!isHR} data-testid={`setting-${k}`} />
          <span><span className="font-medium">{l}</span><span className="block text-xs muted">{hint}</span></span>
        </label>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        {NUMS.map(([k, l, min, max]) => (
          <div key={k}><label className="label" htmlFor={k}>{l}</label><input id={k} type="number" className="input" min={min} max={max} value={v[k]} onChange={set(k)} disabled={!isHR} /></div>
        ))}
      </div>
      {isHR && <button className="btn-primary" disabled={saving || !draft} data-testid="save-activity-settings"><Save size={16} /> Save settings</button>}
    </form>
  );
}

const TABS = [
  { value: 'analytics', label: 'Analytics', icon: Activity },
  { value: 'live', label: 'Live', icon: Radio },
  { value: 'alerts', label: 'Alerts', icon: BellRing },
  { value: 'rules', label: 'App rules', icon: ListChecks },
  { value: 'devices', label: 'Devices', icon: Monitor },
  { value: 'settings', label: 'Settings', icon: Settings2 },
];

export default function Productivity() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'analytics';
  const Body = { analytics: Analytics, live: Live, alerts: Alerts, rules: Rules, devices: Devices, settings: ActivitySettings }[tab];
  return (
    <div>
      <PageHeader icon={Activity} title="Productivity & activity" subtitle="Live status, timelines, app usage and alerts from the desktop activity agent" />
      <Tabs value={tab} onChange={(t) => setParams(t === 'analytics' ? {} : { tab: t }, { replace: true })} tabs={TABS} />
      <Body />
    </div>
  );
}
