import { useMemo, useRef, useState } from 'react';
import { ListTodo, Plus, CalendarClock, Trash2, Flag } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Avatar, Badge, Skeleton, Drawer, Confirm, cx } from '../components/ui';
import { FormModal } from '../components/Form';
import { date, todayStr } from '../lib/format';

const COLUMNS = [['todo', 'To do', 'bg-slate-400'], ['in_progress', 'In progress', 'bg-sky-500'], ['review', 'In review', 'bg-violet-500'], ['done', 'Done', 'bg-emerald-500']];
const PRIORITY = { urgent: 'red', high: 'amber', medium: 'blue', low: 'slate' };

const FIELDS = (isManager) => [
  { name: 'title', label: 'Title', required: true, full: true },
  { name: 'description', label: 'Details', type: 'textarea', full: true },
  { name: 'project_id', label: 'Project', type: 'lookup', path: 'projects' },
  ...(isManager ? [{ name: 'assignee_id', label: 'Assignee (empty = me)', type: 'employee' }] : []),
  { name: 'priority', label: 'Priority', type: 'select', noEmpty: true, options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
  { name: 'due_date', label: 'Due date', type: 'date' },
  { name: 'estimate_hours', label: 'Estimate (hours)', type: 'number', min: 0, step: 0.5 },
];

/** Task board (Zoho/Keka PSA style): kanban with drag-and-drop across statuses. */
export default function Tasks() {
  const { isManager, user } = useAuth();
  const [scope, setScope] = useState('mine');
  const [project, setProject] = useState('');
  const { data = [], isLoading } = useGet('work/tasks', { scope, project_id: project });
  const { data: projects = [] } = useGet('projects');
  const [act] = useAction();
  const form = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [del, setDel] = useState(null);
  const [over, setOver] = useState(null);
  const dragged = useRef(null);
  const open = data.find((t) => t.id === openId);
  const cols = useMemo(() => Object.fromEntries(COLUMNS.map(([k]) => [k, data.filter((t) => t.status === k)])), [data]);
  const move = (id, status) => act(`work/tasks/${id}`, { method: 'PUT', body: { status } });
  const overdue = (t) => t.due_date && t.due_date < todayStr() && t.status !== 'done';

  return (
    <div>
      <PageHeader icon={ListTodo} title="Tasks" subtitle="Plan, assign and track work across projects"
        actions={<button className="btn-primary" onClick={() => form.onOpen()} data-testid="new-task"><Plus size={16} /> New task</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[['mine', 'My tasks'], ...(isManager ? [['team', 'Team']] : [])].map(([v, l]) => (
            <button key={v} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', scope === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')} onClick={() => setScope(v)}>{l}</button>
          ))}
        </div>
        <select className="input !w-auto" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project filter">
          <option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="text-sm muted">{data.filter((t) => t.status !== 'done').length} open · {data.filter(overdue).length} overdue</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="task-board">
        {COLUMNS.map(([status, label, dot]) => (
          <div key={status} data-status={status}
            onDragOver={(e) => { e.preventDefault(); setOver(status); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragged.current; dragged.current = null; const t = data.find((x) => x.id === id); if (t && t.status !== status) move(id, status); }}
            className={cx('flex min-h-40 flex-col rounded-2xl bg-slate-100/70 p-3 dark:bg-slate-900/60', over === status && 'ring-2 ring-brand-500')}>
            <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold"><span className={cx('h-2 w-2 rounded-full', dot)} />{label}<span className="ml-auto rounded-full bg-white px-2 text-xs dark:bg-slate-800">{cols[status]?.length || 0}</span></div>
            <div className="flex flex-col gap-2">
              {isLoading && <><Skeleton className="h-20" /><Skeleton className="h-20" /></>}
              {cols[status]?.map((t) => (
                <div key={t.id} draggable onDragStart={() => { dragged.current = t.id; }} onClick={() => setOpenId(t.id)} data-testid="task-card"
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                  <div className={cx('text-sm font-semibold', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</div>
                  <div className="mt-1 truncate text-xs muted">{t.project_name || 'No project'}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge color={PRIORITY[t.priority]}><Flag size={10} /> {t.priority}</Badge>
                    <div className="flex items-center gap-2">
                      {t.due_date && <span className={cx('flex items-center gap-1 text-[11px]', overdue(t) ? 'font-semibold text-rose-600' : 'muted')}><CalendarClock size={11} />{date(t.due_date, { day: '2-digit', month: 'short' })}</span>}
                      {t.assignee_name && <Avatar name={t.assignee_name} color={t.assignee_color} size="xs" />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <FormModal open={form.open} onClose={form.onClose} title="New task" initial={{ priority: 'medium', project_id: project ? Number(project) : null }} fields={FIELDS(isManager)}
        onSubmit={(v) => act('work/tasks', { body: v, success: 'Task created' })} />
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.title || ''}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><Badge color={PRIORITY[open.priority]}>{open.priority}</Badge>{overdue(open) && <Badge color="red">Overdue</Badge>}</div>
            {open.description && <p className="whitespace-pre-wrap text-sm">{open.description}</p>}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs muted">Project</div><div className="font-medium">{open.project_name || '—'}</div></div>
              <div><div className="text-xs muted">Assignee</div><div className="font-medium">{open.assignee_name || '—'}</div></div>
              <div><div className="text-xs muted">Due</div><div className="font-medium">{date(open.due_date)}</div></div>
              <div><div className="text-xs muted">Created by</div><div className="font-medium">{open.creator_name}</div></div>
            </div>
            <div><div className="label">Status</div>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map(([k, l]) => <button key={k} className={cx('btn btn-sm', open.status === k ? 'bg-brand-600 text-white' : 'btn-secondary')} onClick={() => move(open.id, k)} data-testid={`task-status-${k}`}>{l}</button>)}
              </div></div>
            {(open.created_by === user.id) && <button className="btn-ghost btn-sm text-rose-600" onClick={() => setDel(open)}><Trash2 size={14} /> Delete task</button>}
          </div>
        )}
      </Drawer>
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete task?" confirmLabel="Delete" message={del?.title}
        onConfirm={async () => { await act(`work/tasks/${del.id}`, { method: 'DELETE', success: 'Task deleted' }); setOpenId(null); }} />
    </div>
  );
}
