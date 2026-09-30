import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, CalendarCheck, Timer, Home, AlarmClock, Percent, Plus, Users } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, StatCard, StatSkeletons, Badge, Avatar, MonthPicker, CardSkeleton, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import ClockWidget from '../components/ClockWidget';
import { thisMonth, todayStr, date, hoursBetween, titleCase } from '../lib/format';

const DAY_STYLE = {
  present: 'bg-emerald-500', half_day: 'bg-amber-400', leave: 'bg-violet-500', absent: 'bg-rose-500', holiday: 'bg-sky-400', weekend: 'bg-slate-200 dark:bg-slate-700',
};

function Calendar({ month, records, holidays, weeklyOffs }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const byDate = Object.fromEntries(records.map((r) => [r.date, r]));
  const hol = Object.fromEntries(holidays.map((h) => [h.date, h]));
  const offs = weeklyOffs ? new Set(weeklyOffs) : null; // from the employee's weekly-off policy
  const today = todayStr();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5" data-testid="attendance-calendar">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const ds = `${month}-${String(d).padStart(2, '0')}`;
          const dow = new Date(y, m - 1, d).getDay();
          const rec = byDate[ds];
          const status = hol[ds] ? 'holiday' : rec?.status || ((offs ? offs.has(ds) : dow === 0 || dow === 6) ? 'weekend' : ds < today ? 'absent' : null);
          const hrs = rec?.clock_out ? hoursBetween(rec.clock_in, rec.clock_out) : null;
          return (
            <div key={ds} title={hol[ds]?.name || titleCase(status || '')} className={cx('group relative flex aspect-square flex-col rounded-xl border p-1.5 text-left transition sm:p-2',
              ds === today ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-100 dark:border-slate-800', 'hover:shadow-md')}>
              <span className={cx('text-xs font-semibold', status === 'weekend' && 'text-slate-400')}>{d}</span>
              {status && status !== 'weekend' && <span className={cx('mt-auto h-1.5 w-full rounded-full', DAY_STYLE[status])} />}
              {hrs !== null && <span className="hidden text-[10px] font-medium muted sm:block">{hrs.toFixed(1)}h</span>}
              {rec?.late ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" title="Late" /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs muted">
        {Object.entries({ present: 'Present', half_day: 'Half day', leave: 'On leave', absent: 'Absent', holiday: 'Holiday' }).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={cx('h-2.5 w-2.5 rounded-full', DAY_STYLE[k])} />{l}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Late mark</span>
      </div>
    </div>
  );
}

function MyAttendance() {
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading } = useGet('attendance', { month });
  const { data: regs = [], isLoading: regLoading } = useGet('regularizations', { mine: 1 });
  const reg = useDisclosure();
  const [act] = useAction();
  const s = data?.summary;

  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Percent} label="Attendance" value={`${s.attendance_pct}%`} hint={`${s.present} of ${s.working_days} working days`} />
          <StatCard icon={Timer} tone="sky" label="Avg. hours / day" value={`${s.avg_hours}h`} hint="Based on completed days" />
          <StatCard icon={AlarmClock} tone="amber" label="Late marks" value={s.late} hint={`${s.half_day} half days`} />
          <StatCard icon={Home} tone="green" label="Remote days" value={s.remote} hint={`${s.leave} leave days · ${s.overtime_hours}h overtime`} />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Monthly calendar</h3>
            <div className="flex gap-2">
              <MonthPicker value={month} onChange={setMonth} />
              <button className="btn-secondary btn-sm" onClick={() => reg.onOpen()} data-testid="regularize-btn"><Plus size={14} /> Regularize</button>
            </div>
          </div>
          {isLoading ? <CardSkeleton lines={8} className="!border-0 !p-0 !shadow-none" /> : <Calendar month={month} records={data.records} holidays={data.holidays} weeklyOffs={data.weekly_offs} />}
        </div>
        <div className="space-y-6">
          <ClockWidget compact />
          <div className="card card-pad">
            <h3 className="mb-3 font-semibold">Regularization requests</h3>
            {regLoading ? <CardSkeleton lines={3} className="!border-0 !p-0 !shadow-none" /> : regs.length === 0 ? <p className="text-sm muted">No requests yet.</p> : (
              <div className="space-y-2.5">
                {regs.slice(0, 6).map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <div><div className="text-sm font-semibold">{date(r.date)}</div><div className="text-xs muted">{r.clock_in} – {r.clock_out} · {r.reason}</div></div>
                    <Badge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <DataTable title="Daily log" loading={isLoading} rows={[...(data?.records || [])].reverse()} exportName={`attendance-${month}`} maxHeight="420px"
        columns={[
          { key: 'date', header: 'Date', render: (r) => <span className="font-medium">{date(r.date, { weekday: 'short', day: '2-digit', month: 'short' })}</span> },
          { key: 'clock_in', header: 'In' }, { key: 'clock_out', header: 'Out' },
          { key: 'hours', header: 'Hours', sortValue: (r) => hoursBetween(r.clock_in, r.clock_out), render: (r) => (r.clock_out ? `${hoursBetween(r.clock_in, r.clock_out).toFixed(1)}h` : '—'), csv: (r) => (r.clock_out ? hoursBetween(r.clock_in, r.clock_out).toFixed(2) : '') },
          { key: 'work_mode', header: 'Mode', render: (r) => (r.work_mode ? titleCase(r.work_mode) : '—') },
          { key: 'overtime_mins', header: 'Overtime', render: (r) => (r.overtime_mins ? `${(r.overtime_mins / 60).toFixed(1)}h` : '—'), csv: (r) => r.overtime_mins || 0 },
          { key: 'geo_status', header: 'Location', render: (r) => (r.geo_status && r.geo_status !== 'unknown' ? <Badge status={r.geo_status}>{r.geo_status === 'inside' ? 'At office' : 'Outside'}</Badge> : '—') },
          { key: 'status', header: 'Status', render: (r) => <div className="flex gap-1"><Badge status={r.status} />{r.late ? <Badge status="late">Late</Badge> : null}</div> },
        ]} />
      <FormModal open={reg.open} onClose={reg.onClose} title="Attendance regularization" submitLabel="Submit request"
        initial={{ date: todayStr(), clock_in: '09:30', clock_out: '18:30' }}
        fields={[
          { name: 'date', label: 'Date', type: 'date', required: true, max: todayStr() },
          { name: 'reason', label: 'Reason', type: 'select', required: true, options: ['Forgot to clock in', 'Forgot to clock out', 'Client visit', 'System issue', 'Working from another office'] },
          { name: 'clock_in', label: 'Clock in', type: 'time', required: true },
          { name: 'clock_out', label: 'Clock out', type: 'time', required: true },
        ]}
        onSubmit={(v) => act('regularizations', { body: v, success: 'Regularization submitted for approval' })} />
    </div>
  );
}

function TeamAttendance() {
  const [day, setDay] = useState(todayStr());
  const { data, isLoading } = useGet('attendance/team-today', { date: day });
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    const r = data?.rows || [];
    if (filter === 'present') return r.filter((x) => x.clock_in);
    if (filter === 'late') return r.filter((x) => x.late);
    if (filter === 'leave') return r.filter((x) => x.on_leave);
    if (filter === 'not_in') return r.filter((x) => !x.clock_in && !x.on_leave);
    return r;
  }, [data, filter]);
  const st = data?.stats;
  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons count={4} /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Users} label="Total" value={st.total} onClick={() => setFilter('all')} />
          <StatCard icon={CalendarCheck} tone="green" label="Checked in" value={st.present} hint={`${st.remote} remote`} onClick={() => setFilter('present')} />
          <StatCard icon={AlarmClock} tone="amber" label="Late" value={st.late} onClick={() => setFilter('late')} />
          <StatCard icon={Clock} tone="rose" label="Not in / On leave" value={`${st.not_in} / ${st.on_leave}`} onClick={() => setFilter('not_in')} />
        </div>
      )}
      <DataTable loading={isLoading} rows={rows} searchKeys={['first_name', 'last_name', 'department', 'emp_code']} exportName={`team-attendance-${day}`}
        toolbar={<>
          <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter status">
            <option value="all">All</option><option value="present">Checked in</option><option value="late">Late</option><option value="leave">On leave</option><option value="not_in">Not checked in</option>
          </select>
          <input type="date" className="input !w-auto" value={day} max={todayStr()} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
        </>}
        columns={[
          { key: 'name', header: 'Employee', width: 'minmax(220px, 2fr)', sortValue: (r) => r.first_name, csv: (r) => `${r.first_name} ${r.last_name}`, render: (r) => (
            <div className="flex items-center gap-3"><Avatar name={`${r.first_name} ${r.last_name}`} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.first_name} {r.last_name}</div><div className="truncate text-xs muted">{r.designation}</div></div></div>
          ) },
          { key: 'department', header: 'Department' },
          { key: 'clock_in', header: 'In', render: (r) => r.clock_in || '—' },
          { key: 'clock_out', header: 'Out', render: (r) => r.clock_out || '—' },
          { key: 'work_mode', header: 'Mode', render: (r) => (r.clock_in ? titleCase(r.work_mode) : '—') },
          { key: 'status', header: 'Status', sortValue: (r) => (r.on_leave ? 'leave' : r.clock_in ? 'present' : 'z'), csv: (r) => (r.on_leave ? 'On leave' : r.clock_in ? (r.late ? 'Late' : 'Present') : 'Not in'), render: (r) => (
            r.on_leave ? <Badge status="leave">{r.on_leave}</Badge> : r.clock_in ? (r.late ? <Badge status="late">Late</Badge> : <Badge status="present" />) : <Badge color="red">Not in</Badge>
          ) },
        ]} />
    </div>
  );
}

const REQ_TYPES = [['wfh', 'Work from home'], ['on_duty', 'On duty (client / field visit)'], ['comp_off', 'Comp-off credit (worked on a weekend/holiday)'], ['overtime', 'Overtime']];
const REQ_LABEL = Object.fromEntries(REQ_TYPES.map(([k, v]) => [k, v.split(' (')[0]]));

function Requests() {
  const { data = [], isLoading } = useGet('attendance-requests', { mine: 1 });
  const [act] = useAction();
  const add = useDisclosure();
  const [type, setType] = useState('wfh');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm muted">Request work from home or on-duty days in advance, claim a comp-off when you worked on a weekend or holiday, or log approved overtime.</p>
        <button className="btn-primary" onClick={() => { setType('wfh'); add.onOpen(); }} data-testid="new-attendance-request"><Plus size={16} /> New request</button>
      </div>
      <DataTable loading={isLoading} rows={data} maxHeight="460px" exportName="attendance-requests"
        columns={[
          { key: 'type', header: 'Type', render: (r) => <span className="font-semibold">{REQ_LABEL[r.type]}</span> },
          { key: 'date', header: 'Date(s)', render: (r) => `${date(r.date)}${r.end_date && r.end_date !== r.date ? ` → ${date(r.end_date)}` : ''}` },
          { key: 'hours', header: 'Hours', render: (r) => r.hours ?? '—' },
          { key: 'reason', header: 'Reason', width: 'minmax(200px, 2fr)' },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="New attendance request" submitLabel="Submit" initial={{ type, date: todayStr() }}
        fields={[
          { name: 'type', label: 'Request type', type: 'select', noEmpty: true, options: REQ_TYPES, full: true },
          { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'end_date', label: 'Until (optional)', type: 'date', hidden: (v) => !['wfh', 'on_duty'].includes(v.type) },
          { name: 'hours', label: 'Overtime hours', type: 'number', min: 0.5, max: 12, step: 0.5, hidden: (v) => v.type !== 'overtime' },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => act('attendance-requests', { body: v, success: 'Request sent to your manager' })} />
    </div>
  );
}

export default function Attendance() {
  const { isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'me';
  return (
    <div>
      <PageHeader icon={Clock} title="Attendance" subtitle="Clock in/out, monthly calendar, regularizations and team presence" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: 'me', label: 'My attendance' }, { value: 'requests', label: 'Requests' }, ...(isManager ? [{ value: 'team', label: 'Team attendance' }] : [])]} />
      {tab === 'team' && isManager ? <TeamAttendance /> : tab === 'requests' ? <Requests /> : <MyAttendance />}
    </div>
  );
}
