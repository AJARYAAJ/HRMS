import { useState } from 'react';
import { HeartPulse, Flame, Clock3, CalendarX, Moon } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useGet } from '../lib/hooks';
import { StatCard, StatSkeletons, CardSkeleton, Badge, Avatar, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { useChartTheme } from '../lib/chart';
import { shortDate } from '../lib/format';

const RISK = { high: ['High', 'red'], medium: ['Watch', 'amber'], low: ['OK', 'green'] };

/** We360-style workload & wellbeing: long days, work on days off, late nights and time since the last break. */
export default function Wellbeing() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGet('analytics/wellbeing', { days });
  const chart = useChartTheme();
  const axis = { tick: { fontSize: 11, fill: chart.axis }, axisLine: false, tickLine: false };
  return (
    <div className="space-y-6" data-testid="wellbeing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">From attendance punches and, where the desktop agent runs, late-night activity. Use it to rebalance work — not to rate people.</p>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label="Wellbeing period">
          {[30, 60, 90].map((n) => <button key={n} role="radio" aria-checked={days === n} onClick={() => setDays(n)} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', days === n ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}>{n} days</button>)}
        </div>
      </div>
      {isLoading || !data ? <StatSkeletons count={4} /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="wellbeing-kpis">
          <StatCard icon={Flame} tone="rose" label="High workload" value={data.summary.high} hint={`${data.summary.medium} to watch of ${data.people}`} />
          <StatCard icon={Clock3} tone="sky" label="Average day" value={`${data.summary.avg_hours} h`} hint="Clock-in to clock-out" />
          <StatCard icon={Moon} tone="violet" label="Overtime" value={`${data.summary.overtime_hours} h`} hint={`Last ${data.days} days`} />
          <StatCard icon={CalendarX} tone="amber" label="No leave in 90 days" value={data.summary.no_leave_90} />
        </div>
      )}
      {isLoading || !data ? <CardSkeleton lines={8} /> : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card card-pad" data-testid="chart-hours-trend">
              <h3 className="font-semibold">Average working day</h3><p className="text-xs muted">Hours per day, by week</p>
              <div className="mt-4 h-56"><ResponsiveContainer>
                <LineChart data={data.trend} margin={{ left: -16, right: 12, top: 6 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="week" tickFormatter={shortDate} {...axis} />
                  <YAxis domain={[0, 'auto']} unit="h" {...axis} />
                  <Tooltip {...chart.tooltip} labelFormatter={(w) => `Week of ${shortDate(w)}`} formatter={(v) => `${v} h`} />
                  <Line type="monotone" dataKey="avg_hours" name="Average day" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: chart.surface }} />
                </LineChart>
              </ResponsiveContainer></div>
            </div>
            <div className="card card-pad" data-testid="chart-overtime-trend">
              <h3 className="font-semibold">Overtime</h3><p className="text-xs muted">Total hours beyond shift, by week</p>
              <div className="mt-4 h-56"><ResponsiveContainer>
                <BarChart data={data.trend} margin={{ left: -16, right: 12, top: 6 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="week" tickFormatter={shortDate} {...axis} />
                  <YAxis {...axis} />
                  <Tooltip {...chart.tooltip} labelFormatter={(w) => `Week of ${shortDate(w)}`} formatter={(v) => `${v} h`} />
                  <Bar dataKey="overtime_hours" name="Overtime" fill={chart.series[3]} radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer></div>
            </div>
            <div className="card card-pad" data-testid="chart-team-hours">
              <h3 className="font-semibold">Teams compared</h3><p className="text-xs muted">Average day by department</p>
              <div className="mt-4 h-56"><ResponsiveContainer>
                <BarChart data={data.by_department} layout="vertical" margin={{ left: 24, right: 16 }}>
                  <CartesianGrid stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" unit="h" {...axis} />
                  <YAxis type="category" dataKey="department" width={110} {...axis} />
                  <Tooltip {...chart.tooltip} formatter={(v) => `${v} h`} />
                  <Bar dataKey="avg_hours" name="Average day" fill={chart.series[0]} radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer></div>
            </div>
          </div>
          <DataTable rows={data.rows} searchKeys={['name', 'department', 'emp_code']} testId="wellbeing-table" maxHeight="520px" title={<span className="flex items-center gap-2"><HeartPulse size={16} /> People</span>}
            columns={[
              { key: 'name', header: 'Employee', width: 'minmax(200px, 1.4fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="xs" /><div><div className="font-medium">{r.name}</div><div className="text-xs muted">{r.department || '—'}</div></div></div> },
              { key: 'score', header: 'Workload', render: (r) => <Badge color={RISK[r.risk][1]}>{RISK[r.risk][0]}</Badge>, sortValue: (r) => r.score },
              { key: 'avg_hours', header: 'Avg day', align: 'right', render: (r) => `${r.avg_hours} h` },
              { key: 'long_days', header: '10h+ days', align: 'right' },
              { key: 'off_days_worked', header: 'Days off worked', align: 'right' },
              { key: 'late_night_hours', header: 'Late night', align: 'right', render: (r) => (r.late_night_hours ? `${r.late_night_hours} h` : '—') },
              { key: 'days_since_leave', header: 'Since last leave', align: 'right', render: (r) => (r.days_since_leave === null ? 'Never' : `${r.days_since_leave} d`) },
              { key: 'flags', header: 'Why', width: 'minmax(220px, 2fr)', render: (r) => <span className="text-xs muted">{r.flags.join(' · ') || '—'}</span> },
            ]} />
        </>
      )}
    </div>
  );
}
