import { useState } from 'react';
import { PieChart as PieIcon, Users, UserMinus, Clock3, Gauge, IndianRupee, Smile, Crosshair, Hourglass } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useGet, useAuth } from '../lib/hooks';
import { PageHeader, StatCard, StatSkeletons, CardSkeleton, cx } from '../components/ui';
import { useChartTheme } from '../lib/chart';
import { compactMoney, money, monthLabel, titleCase } from '../lib/format';

const short = (m) => monthLabel(m).slice(0, 3);

function Panel({ title, subtitle, children, testId, className }) {
  return (
    <div className={cx('card card-pad', className)} data-testid={testId}>
      <h3 className="font-semibold">{title}</h3>
      {subtitle && <p className="text-xs muted">{subtitle}</p>}
      <div className="mt-4 h-60">{children}</div>
    </div>
  );
}

export default function Analytics() {
  const { isHR } = useAuth();
  const [months, setMonths] = useState(6);
  const { data, isLoading } = useGet('analytics', { months });
  const chart = useChartTheme();
  const axis = { tick: { fontSize: 11, fill: chart.axis }, axisLine: false, tickLine: false };
  const k = data?.kpis;
  return (
    <div className="space-y-6">
      <PageHeader icon={PieIcon} title="Analytics" subtitle="People, time, delivery and money in one view — trends over the selected period"
        actions={<div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label="Period">
          {[3, 6, 12].map((n) => <button key={n} role="radio" aria-checked={months === n} onClick={() => setMonths(n)} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', months === n ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}>{n} months</button>)}
        </div>} />

      {isLoading ? <StatSkeletons count={8} /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="analytics-kpis">
          <StatCard icon={Users} label="Headcount" value={k.headcount} hint={`${k.headcount_change >= 0 ? '+' : ''}${k.headcount_change} in the period`} />
          <StatCard icon={UserMinus} tone="rose" label="Attrition (annualised)" value={`${k.attrition_pct}%`} hint={`Avg tenure ${k.avg_tenure_years} yrs`} />
          <StatCard icon={Clock3} tone="sky" label="Attendance" value={k.attendance_pct == null ? '—' : `${k.attendance_pct}%`} hint="Present ÷ expected days" />
          <StatCard icon={Gauge} tone="green" label="Billable utilisation" value={k.utilization_pct == null ? '—' : `${k.utilization_pct}%`} hint="Of people logging time" />
          {isHR && <StatCard icon={IndianRupee} tone="violet" label="Revenue" value={compactMoney(k.revenue)} hint={`${compactMoney(k.revenue_per_employee)} per employee`} />}
          {isHR && <StatCard icon={Hourglass} tone="amber" label="Payroll cost" value={compactMoney(k.payroll_cost)} hint="Gross salaries in the period" />}
          <StatCard icon={Crosshair} tone="slate" label="Weighted pipeline" value={compactMoney(k.weighted_pipeline)} />
          <StatCard icon={Smile} tone="green" label="eNPS" value={k.enps == null ? '—' : k.enps > 0 ? `+${k.enps}` : k.enps} hint="Latest survey" />
        </div>
      )}

      {isLoading ? <CardSkeleton lines={10} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Headcount" subtitle="Active employees at month end" testId="chart-headcount">
            <ResponsiveContainer>
              <LineChart data={data.series} margin={{ left: -16, right: 12, top: 6 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={short} {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...chart.tooltip} labelFormatter={monthLabel} />
                <Line type="monotone" dataKey="headcount" name="Headcount" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: chart.surface }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Joiners and exits" subtitle="People who joined or left each month" testId="chart-movement">
            <ResponsiveContainer>
              <BarChart data={data.series} margin={{ left: -16, right: 12, top: 6 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={short} {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...chart.tooltip} labelFormatter={monthLabel} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="joiners" name="Joiners" fill={chart.series[2]} radius={[4, 4, 0, 0]} barSize={14} />
                <Bar dataKey="exits" name="Exits" fill={chart.series[7]} radius={[4, 4, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Attendance rate" subtitle="Months without records are left blank" testId="chart-attendance">
            <ResponsiveContainer>
              <LineChart data={data.series} margin={{ left: -16, right: 12, top: 6 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={short} {...axis} />
                <YAxis domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...chart.tooltip} labelFormatter={monthLabel} formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="attendance_pct" name="Attendance" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: chart.surface }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Billable utilisation" subtitle="Billable hours ÷ capacity of people logging time" testId="chart-utilisation">
            <ResponsiveContainer>
              <LineChart data={data.series} margin={{ left: -16, right: 12, top: 6 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={short} {...axis} />
                <YAxis domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...chart.tooltip} labelFormatter={monthLabel} formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="utilization_pct" name="Utilisation" stroke={chart.series[2]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: chart.surface }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          {isHR && (
            <Panel title="Revenue and payroll cost" subtitle="Invoiced (before tax) and gross salaries per month" testId="chart-money" className="lg:col-span-2">
              <ResponsiveContainer>
                <BarChart data={data.series} margin={{ left: 4, right: 12, top: 6 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="month" tickFormatter={short} {...axis} />
                  <YAxis tickFormatter={compactMoney} width={64} {...axis} />
                  <Tooltip {...chart.tooltip} labelFormatter={monthLabel} formatter={(v) => money(v)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey="payroll_cost" name="Payroll cost" fill={chart.series[3]} radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}
          <Panel title="Headcount by department" testId="chart-departments">
            <ResponsiveContainer>
              <BarChart data={data.by_department} layout="vertical" margin={{ left: 24, right: 24 }}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="name" width={120} {...axis} />
                <Tooltip {...chart.tooltip} />
                <Bar dataKey="value" name="People" fill={chart.series[0]} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Pipeline by stage" subtitle="Deal value in each stage" testId="chart-pipeline">
            <ResponsiveContainer>
              <BarChart data={data.pipeline.map((p) => ({ ...p, label: titleCase(p.stage) }))} layout="vertical" margin={{ left: 24, right: 24 }}>
                <CartesianGrid stroke={chart.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={compactMoney} {...axis} />
                <YAxis type="category" dataKey="label" width={100} {...axis} />
                <Tooltip {...chart.tooltip} formatter={(v) => money(v)} />
                <Bar dataKey="value" name="Value" fill={chart.series[6]} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  );
}
