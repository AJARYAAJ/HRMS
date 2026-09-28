import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, UserMinus, CheckCircle2, Circle, Plus } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Avatar, Progress, Badge, CardSkeleton, EmptyState, cx } from '../components/ui';
import { FormModal } from '../components/Form';
import { date, shortDate, todayStr } from '../lib/format';

export default function Onboarding() {
  const { isHR } = useAuth();
  const [type, setType] = useState('onboarding');
  const { data = [], isLoading } = useGet('onboarding', { type });
  const [act] = useAction();
  const add = useDisclosure();
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of data) {
      if (!m.has(t.employee_id)) m.set(t.employee_id, { id: t.employee_id, name: t.employee_name, color: t.avatar_color, designation: t.designation, doj: t.date_of_joining, exit: t.exit_date, tasks: [] });
      m.get(t.employee_id).tasks.push(t);
    }
    return [...m.values()];
  }, [data]);

  return (
    <div>
      <PageHeader icon={UserPlus} title="Onboarding & offboarding" subtitle="Structured checklists from offer to first 90 days — and a smooth exit"
        actions={isHR && <button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> Add task</button>} />
      <Tabs value={type} onChange={setType} tabs={[{ value: 'onboarding', label: 'Onboarding' }, { value: 'offboarding', label: 'Offboarding' }]} />
      {isLoading ? <div className="grid gap-4 lg:grid-cols-2"><CardSkeleton lines={6} /><CardSkeleton lines={6} /></div> : groups.length === 0 ? (
        <div className="card"><EmptyState icon={type === 'onboarding' ? UserPlus : UserMinus} title={`No active ${type}`} message={type === 'onboarding' ? 'New hires get a checklist automatically.' : 'Checklists are created when HR initiates an exit.'} /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => {
            const done = g.tasks.filter((t) => t.done).length;
            const pct = Math.round((done / g.tasks.length) * 100);
            return (
              <div key={g.id} className="card card-pad" data-testid="checklist">
                <div className="flex items-center gap-3">
                  <Avatar name={g.name} color={g.color} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/employees/${g.id}`} className="font-semibold hover:underline">{g.name}</Link>
                    <div className="text-xs muted">{g.designation} · {type === 'onboarding' ? `Joined ${date(g.doj)}` : `Last day ${date(g.exit)}`}</div>
                  </div>
                  <Badge color={pct === 100 ? 'green' : 'blue'}>{pct}%</Badge>
                </div>
                <Progress value={pct} className="mt-4" color={pct === 100 ? 'bg-emerald-500' : 'bg-brand-500'} />
                <div className="mt-4 space-y-1">
                  {g.tasks.map((t) => {
                    const overdue = !t.done && t.due_date && t.due_date < todayStr();
                    return (
                      <button key={t.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => act(`onboarding/${t.id}`, { method: 'PUT', body: { done: !t.done } })} data-testid="checklist-task">
                        {t.done ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> : <Circle size={18} className="shrink-0 text-slate-300" />}
                        <span className={cx('flex-1 text-sm', t.done && 'text-slate-400 line-through')}>{t.title}</span>
                        <Badge color="slate">{t.category}</Badge>
                        <span className={cx('w-14 text-right text-xs', overdue ? 'font-semibold text-rose-500' : 'muted')}>{shortDate(t.due_date)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="Add checklist task" initial={{ type, due_date: todayStr(), category: 'HR' }}
        fields={[{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, full: true }, { name: 'title', label: 'Task', required: true, full: true },
          { name: 'category', label: 'Owner', type: 'select', noEmpty: true, options: ['HR', 'IT', 'Manager', 'Finance', 'Learning'] }, { name: 'due_date', label: 'Due date', type: 'date' },
          { name: 'type', label: 'Checklist', type: 'select', noEmpty: true, options: ['onboarding', 'offboarding'] }]}
        onSubmit={(v) => act('onboarding', { body: v, success: 'Task added' })} />
    </div>
  );
}
