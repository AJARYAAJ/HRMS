import { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import { useGet, useAuth } from '../lib/hooks';
import { PageHeader, Tabs, CardSkeleton, MonthPicker } from '../components/ui';
import DataTable from '../components/DataTable';
import { downloadCsv, monthLabel, compactMoney, money, thisMonth, titleCase } from '../lib/format';
import { useChartTheme, foldOther } from '../lib/chart';

function ChartCard({ title, rows, children, csvName, className = '' }) {
  return (
    <div className={`card card-pad ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        {rows?.length > 0 && <button className="btn-ghost btn-sm" onClick={() => downloadCsv(`${csvName}.csv`, rows)} aria-label={`Export ${title}`}><Download size={14} /></button>}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

function Donut({ rows }) {
  const chart = useChartTheme();
  const data = foldOther(rows, 7);
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke={chart.surface} strokeWidth={2}>
          {data.map((_, i) => <Cell key={i} fill={chart.series[i]} />)}
        </Pie>
        <Tooltip {...chart.tooltip} />
        <Legend iconType="circle" layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Workforce() {
  const { data, isLoading } = useGet('reports/headcount');
  const chart = useChartTheme();
  if (isLoading) return <div className="grid gap-6 lg:grid-cols-2"><CardSkeleton lines={8} /><CardSkeleton lines={8} /></div>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Headcount trend (12 months)" rows={data.trend} csvName="headcount-trend" className="lg:col-span-2">
        <ResponsiveContainer>
          <LineChart data={data.trend} margin={{ left: -10, right: 12 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).slice(0, 3)} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...chart.tooltip} labelFormatter={monthLabel} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="headcount" name="Headcount" stroke={chart.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: chart.surface }} />
            <Line type="monotone" dataKey="joiners" name="Joiners" stroke={chart.series[2]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: chart.surface }} />
            <Line type="monotone" dataKey="exits" name="Exits" stroke={chart.series[1]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: chart.surface }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="By department" rows={data.department} csvName="headcount-department"><Donut rows={data.department} /></ChartCard>
      <ChartCard title="By location" rows={data.location} csvName="headcount-location"><Donut rows={data.location} /></ChartCard>
      <ChartCard title="Gender diversity" rows={data.gender} csvName="headcount-gender"><Donut rows={data.gender} /></ChartCard>
      <ChartCard title="Employment type" rows={data.employment_type} csvName="headcount-type"><Donut rows={data.employment_type} /></ChartCard>
    </div>
  );
}

function AttendanceReport() {
  const [month, setMonth] = useState(thisMonth());
  const { data = [], isLoading } = useGet('reports/attendance', { month });
  return (
    <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'department', 'emp_code']} exportName={`attendance-report-${month}`}
      toolbar={<MonthPicker value={month} onChange={setMonth} />}
      columns={[
        { key: 'emp_code', header: 'ID', width: '90px' }, { key: 'employee_name', header: 'Employee', width: 'minmax(180px, 1.5fr)', render: (r) => <span className="font-semibold">{r.employee_name}</span> },
        { key: 'department', header: 'Department' }, { key: 'present', header: 'Present' }, { key: 'half_day', header: 'Half day' }, { key: 'leave', header: 'Leave' },
        { key: 'late', header: 'Late' }, { key: 'remote', header: 'Remote' }, { key: 'avg_hours', header: 'Avg hrs', render: (r) => r.avg_hours ?? '—' },
      ]} />
  );
}

function LeaveReport() {
  const { data, isLoading } = useGet('reports/leave');
  const chart = useChartTheme();
  if (isLoading) return <div className="grid gap-6 lg:grid-cols-2"><CardSkeleton lines={8} /><CardSkeleton lines={8} /></div>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Leave utilisation by type" rows={data.by_type} csvName="leave-by-type">
        <ResponsiveContainer>
          <BarChart data={data.by_type} margin={{ left: -10, right: 8 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <Tooltip {...chart.tooltip} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="allocated" name="Allocated" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={16} />
            <Bar dataKey="used" name="Used" fill={chart.series[1]} radius={[4, 4, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Leave days taken per month" rows={data.by_month} csvName="leave-by-month">
        <ResponsiveContainer>
          <BarChart data={data.by_month} margin={{ left: -10, right: 8 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).slice(0, 3)} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <Tooltip {...chart.tooltip} labelFormatter={monthLabel} />
            <Bar dataKey="days" name="Days" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function PayrollReport() {
  const { data, isLoading } = useGet('reports/payroll');
  const chart = useChartTheme();
  if (isLoading) return <div className="grid gap-6 lg:grid-cols-2"><CardSkeleton lines={8} /><CardSkeleton lines={8} /></div>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Monthly payroll cost" rows={data.runs} csvName="payroll-cost">
        <ResponsiveContainer>
          <BarChart data={data.runs} margin={{ left: 0, right: 8 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).slice(0, 3)} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compactMoney} width={70} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <Tooltip {...chart.tooltip} formatter={(v) => money(v)} labelFormatter={monthLabel} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="total_net" name="Net" stackId="a" fill={chart.series[0]} stroke={chart.surface} strokeWidth={2} barSize={28} />
            <Bar dataKey="total_deductions" name="Deductions" stackId="a" fill={chart.series[1]} stroke={chart.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Annual CTC by department" rows={data.by_department} csvName="ctc-by-department">
        <ResponsiveContainer>
          <BarChart data={data.by_department} layout="vertical" margin={{ left: 10, right: 30 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <Tooltip {...chart.tooltip} formatter={(v) => money(v)} />
            <Bar dataKey="value" name="Annual CTC" fill={chart.series[0]} radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function RecruitmentReport() {
  const { data, isLoading } = useGet('reports/recruitment');
  const chart = useChartTheme();
  if (isLoading) return <div className="grid gap-6 lg:grid-cols-2"><CardSkeleton lines={8} /><CardSkeleton lines={8} /></div>;
  const funnel = data.funnel.map((f) => ({ ...f, stage: titleCase(f.stage) }));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Hiring funnel" rows={data.funnel} csvName="hiring-funnel">
        <ResponsiveContainer>
          <BarChart data={funnel} margin={{ left: -10, right: 8 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="stage" tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...chart.tooltip} />
            <Bar dataKey="count" name="Candidates" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={30} label={{ position: 'top', fontSize: 11, fill: chart.axis }} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Candidate sources" rows={data.by_source} csvName="candidate-sources"><Donut rows={data.by_source} /></ChartCard>
    </div>
  );
}

export default function Reports() {
  const { isHR } = useAuth();
  const [tab, setTab] = useState('workforce');
  return (
    <div>
      <PageHeader icon={BarChart3} title="Reports & analytics" subtitle="Workforce, attendance, leave, payroll and hiring insights — export any dataset to CSV" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'workforce', label: 'Workforce' }, { value: 'attendance', label: 'Attendance' }, { value: 'leave', label: 'Leave' },
        ...(isHR ? [{ value: 'payroll', label: 'Payroll' }] : []), { value: 'recruitment', label: 'Recruitment' },
      ]} />
      {tab === 'workforce' && <Workforce />}
      {tab === 'attendance' && <AttendanceReport />}
      {tab === 'leave' && <LeaveReport />}
      {tab === 'payroll' && isHR && <PayrollReport />}
      {tab === 'recruitment' && <RecruitmentReport />}
    </div>
  );
}
