import { useState } from 'react';
import { Activity, Gauge, Clock, Coffee, ThumbsDown, AppWindow } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet } from '../lib/hooks';
import { PageHeader, StatCard, StatSkeletons, Avatar, CardSkeleton, Badge, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { minsToHours, todayStr, shortDate } from '../lib/format';
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

export default function Productivity() {
  const [range, setRange] = useState(7);
  const [dept, setDept] = useState('');
  const { data: depts = [] } = useGet('departments');
  const { data, isLoading } = useGet('productivity', { from: daysAgo(range - 1), to: todayStr(), department_id: dept });
  const chart = useChartTheme();
  const t = data?.totals;
  const people = data?.employees?.length || 1;

  return (
    <div className="space-y-6">
      <PageHeader icon={Activity} title="Productivity analytics" subtitle="Activity insights from desktop tracking — productive, neutral, unproductive and idle time"
        actions={<>
          <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select className="input !w-auto" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Date range">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </>} />
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
      <DataTable title="Employee activity" loading={isLoading} rows={data?.employees || []} searchKeys={['employee_name', 'department']} exportName="productivity" initialSort={{ key: 'score', dir: 'desc' }}
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
