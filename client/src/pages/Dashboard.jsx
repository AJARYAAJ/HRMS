import { Link, useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, Briefcase, CalendarDays, CheckSquare, Cake, Award, Megaphone, PartyPopper, Plane, Banknote,
  LifeBuoy, Target, ArrowRight, UserPlus, TrendingDown,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { useGet, useAuth } from '../lib/hooks';
import { StatCard, StatSkeletons, CardSkeleton, Avatar, Badge, EmptyState, Progress } from '../components/ui';
import ClockWidget from '../components/ClockWidget';
import { date, shortDate, compactMoney, timeAgo, monthLabel } from '../lib/format';
import { useChartTheme } from '../lib/chart';

function Section({ title, icon: Icon, action, children, className = '' }) {
  return (
    <div className={`card card-pad ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">{Icon && <Icon size={17} className="text-brand-500" />}{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const { user, isHR, isManager } = useAuth();
  const { data, isLoading } = useGet('dashboard');
  const navigate = useNavigate();
  const chart = useChartTheme();
  const team = data?.team;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-violet-500 p-6 text-white shadow-xl shadow-brand-500/20 sm:p-8">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-white/80">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl" data-testid="greeting">{greeting()}, {user?.first_name}! 👋</h1>
            <p className="mt-1 text-white/80">Here's what's happening across your workspace today.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn bg-white/15 text-white backdrop-blur hover:bg-white/25" onClick={() => navigate('/leave?apply=1')}><Plane size={16} /> Apply leave</button>
            {isManager && data?.pending_approvals > 0 && (
              <button className="btn bg-white text-brand-700 hover:bg-white/90" onClick={() => navigate('/approvals')}><CheckSquare size={16} /> {data.pending_approvals} approvals</button>
            )}
          </div>
        </div>
      </div>

      {isLoading ? <StatSkeletons /> : team ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Users} label={isHR ? 'Active employees' : 'Team size'} value={team.headcount} hint={`${team.new_hires_month} joined this month`} onClick={() => navigate('/employees')} />
          <StatCard icon={UserCheck} tone="green" label="Present today" value={`${team.present_today}/${team.headcount}`} hint={`${team.headcount ? Math.round((team.present_today / team.headcount) * 100) : 0}% attendance`} onClick={() => navigate('/attendance?tab=team')} />
          <StatCard icon={CheckSquare} tone="amber" label="Pending approvals" value={data.pending_approvals} hint="Leave, expenses, timesheets" onClick={() => navigate('/approvals')} />
          {isHR && team.last_payroll ? (
            <StatCard icon={Banknote} tone="sky" label={`Payroll · ${monthLabel(team.last_payroll.month)}`} value={compactMoney(team.last_payroll.total_net)} hint={`${team.last_payroll.employees} employees · ${team.last_payroll.status}`} onClick={() => navigate('/payroll')} />
          ) : (
            <StatCard icon={Briefcase} tone="sky" label="Open positions" value={team.open_positions} hint="Across all departments" onClick={() => navigate('/recruitment')} />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={CalendarDays} label="Leave available" value={data?.leave_balances?.reduce((a, b) => a + (b.allocated - b.used), 0) ?? 0} hint="days across leave types" onClick={() => navigate('/leave')} />
          <StatCard icon={Target} tone="green" label="Goal progress" value={`${data?.goals?.avg_progress ?? 0}%`} hint={`${data?.goals?.total ?? 0} active goals`} onClick={() => navigate('/performance')} />
          <StatCard icon={LifeBuoy} tone="amber" label="Open tickets" value={data?.open_tickets ?? 0} hint="Helpdesk requests" onClick={() => navigate('/helpdesk')} />
          <StatCard icon={Plane} tone="sky" label="Next holiday" value={data?.holidays?.[0] ? shortDate(data.holidays[0].date) : '—'} hint={data?.holidays?.[0]?.name} onClick={() => navigate('/leave?tab=holidays')} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {team && (
            <div className="grid gap-6 lg:grid-cols-5">
              <Section title="Attendance trend · last 2 weeks" icon={UserCheck} className="lg:col-span-3">
                <div className="h-60" data-testid="attendance-chart">
                  <ResponsiveContainer>
                    <AreaChart data={team.attendance_trend} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chart.series[0]} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={chart.series[0]} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...chart.tooltip} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="present" name="Present" stroke={chart.series[0]} strokeWidth={2} fill="url(#gPresent)" activeDot={{ r: 5, strokeWidth: 2, stroke: chart.surface }} />
                      <Area type="monotone" dataKey="late" name="Late" stroke={chart.series[1]} strokeWidth={2} fill="transparent" activeDot={{ r: 5, strokeWidth: 2, stroke: chart.surface }} />
                      <Area type="monotone" dataKey="on_leave" name="On leave" stroke={chart.series[2]} strokeWidth={2} fill="transparent" activeDot={{ r: 5, strokeWidth: 2, stroke: chart.surface }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Section>
              <Section title="Headcount by department" icon={Users} className="lg:col-span-2">
                <div className="h-60">
                  <ResponsiveContainer>
                    <BarChart data={team.by_department} layout="vertical" margin={{ left: 10, right: 16 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                      <Tooltip {...chart.tooltip} />
                      <Bar dataKey="value" name="Employees" fill={chart.series[0]} radius={[0, 4, 4, 0]} barSize={14} label={{ position: 'right', fontSize: 11, fill: chart.axis }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Announcements" icon={Megaphone} action={<Link to="/engage" className="text-xs font-semibold text-brand-600 hover:underline">View all</Link>}>
              {isLoading ? <CardSkeleton lines={4} className="!border-0 !p-0 !shadow-none" /> : (
                <div className="space-y-4">
                  {data.announcements.map((a) => (
                    <div key={a.id} className="group">
                      <div className="flex items-center gap-2">
                        {a.pinned ? <Badge color="violet">Pinned</Badge> : <Badge color="slate">{a.category}</Badge>}
                        <span className="text-xs muted">{timeAgo(a.created_at)}</span>
                      </div>
                      <div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{a.title}</div>
                      <p className="line-clamp-2 text-sm muted">{a.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            <Section title="Celebrations" icon={Cake}>
              {isLoading ? <CardSkeleton lines={4} className="!border-0 !p-0 !shadow-none" /> : data.celebrations.length === 0 ? (
                <EmptyState icon={PartyPopper} title="No celebrations this month" />
              ) : (
                <div className="space-y-3">
                  {data.celebrations.slice(0, 6).map((c) => (
                    <Link to={`/employees/${c.id}`} key={`${c.type}-${c.id}`} className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-800">
                      <Avatar name={c.name} color={c.avatar_color} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{c.name}</div>
                        <div className="text-xs muted">{c.type === 'birthday' ? '🎂 Birthday' : `🎉 ${c.years} year work anniversary`}</div>
                      </div>
                      <Badge color={c.diff === 0 ? 'green' : 'slate'}>{c.diff === 0 ? 'Today' : shortDate(c.date)}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Kudos wall" icon={Award} action={<Link to="/engage?kudos=1" className="text-xs font-semibold text-brand-600 hover:underline">Give kudos</Link>}>
              {isLoading ? <CardSkeleton lines={3} className="!border-0 !p-0 !shadow-none" /> : (
                <div className="space-y-3">
                  {data.kudos.map((k) => (
                    <div key={k.id} className="rounded-xl bg-gradient-to-r from-amber-50 to-rose-50 p-3 dark:from-amber-500/5 dark:to-rose-500/5">
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">{k.badge}</div>
                      <div className="mt-0.5 text-sm"><b>{k.from_name}</b> → <b>{k.to_name}</b></div>
                      <p className="text-sm muted">“{k.message}”</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            <Section title="My recent requests" icon={CheckSquare}>
              {isLoading ? <CardSkeleton lines={4} className="!border-0 !p-0 !shadow-none" /> : data.my_requests.length === 0 ? (
                <EmptyState title="No requests yet" message="Leave, expense and regularization requests will show here." />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.my_requests.map((r) => (
                    <div key={`${r.type}-${r.id}`} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="text-sm font-semibold capitalize">{r.type}</div>
                        <div className="text-xs muted">{r.summary} · {timeAgo(r.created_at)}</div>
                      </div>
                      <Badge status={r.status} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>

        <div className="space-y-6">
          <ClockWidget />
          <Section title="Leave balance" icon={CalendarDays} action={<Link to="/leave" className="text-xs font-semibold text-brand-600 hover:underline">Details</Link>}>
            {isLoading ? <CardSkeleton lines={4} className="!border-0 !p-0 !shadow-none" /> : (
              <div className="space-y-3.5">
                {data.leave_balances.map((b) => (
                  <div key={b.code}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{b.name}</span>
                      <span className="muted"><b className="text-slate-800 dark:text-slate-100">{b.allocated - b.used}</b> / {b.allocated}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full" style={{ width: `${b.allocated ? ((b.allocated - b.used) / b.allocated) * 100 : 0}%`, background: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Who's out today" icon={Plane}>
            {isLoading ? <CardSkeleton lines={2} className="!border-0 !p-0 !shadow-none" /> : data.on_leave_today.length === 0 ? (
              <p className="text-sm muted">Everyone's in today 🙌</p>
            ) : (
              <div className="space-y-2.5">
                {data.on_leave_today.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar name={p.name} color={p.avatar_color} size="sm" />
                    <div className="flex-1 text-sm"><div className="font-semibold">{p.name}</div><div className="text-xs muted">{p.leave_type} · back after {shortDate(p.end_date)}</div></div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Upcoming holidays" icon={PartyPopper}>
            {isLoading ? <CardSkeleton lines={3} className="!border-0 !p-0 !shadow-none" /> : (
              <div className="space-y-2">
                {data.holidays.map((h) => (
                  <div key={h.id} className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      <span className="text-[10px] font-bold uppercase">{date(h.date, { month: 'short' })}</span>
                      <span className="text-sm font-bold leading-none">{date(h.date, { day: '2-digit' })}</span>
                    </div>
                    <div className="flex-1"><div className="text-sm font-semibold">{h.name}</div><div className="text-xs muted">{date(h.date, { weekday: 'long' })}</div></div>
                    <Badge color={h.type === 'Public' ? 'blue' : 'slate'}>{h.type}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>
          {data?.new_joiners?.length > 0 && (
            <Section title="New joiners" icon={UserPlus}>
              <div className="space-y-2.5">
                {data.new_joiners.map((p) => (
                  <Link to={`/employees/${p.id}`} key={p.id} className="flex items-center gap-3">
                    <Avatar name={p.name} color={p.avatar_color} size="sm" />
                    <div className="flex-1 text-sm"><div className="font-semibold">{p.name}</div><div className="text-xs muted">{p.designation} · joined {shortDate(p.date_of_joining)}</div></div>
                    <ArrowRight size={14} className="text-slate-400" />
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {team && (
            <Section title="This month" icon={TrendingDown}>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10"><div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{team.new_hires_month}</div><div className="text-xs muted">Joiners</div></div>
                <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-500/10"><div className="text-xl font-bold text-rose-700 dark:text-rose-400">{team.exits_month}</div><div className="text-xs muted">Exits</div></div>
                {isHR && <div className="rounded-xl bg-sky-50 p-3 dark:bg-sky-500/10"><div className="text-xl font-bold text-sky-700 dark:text-sky-400">{team.candidates_active}</div><div className="text-xs muted">Active candidates</div></div>}
                {isHR && <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10"><div className="text-xl font-bold text-amber-700 dark:text-amber-400">{team.open_tickets}</div><div className="text-xs muted">Open tickets</div></div>}
              </div>
            </Section>
          )}
          {data?.goals?.total > 0 && !team && (
            <Section title="My goals" icon={Target}><Progress value={data.goals.avg_progress} /><p className="mt-2 text-xs muted">{data.goals.avg_progress}% average progress</p></Section>
          )}
        </div>
      </div>
    </div>
  );
}
