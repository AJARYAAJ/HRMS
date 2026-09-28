import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { isHR, reportIds, scopeSql } from '../auth.js';
import { crud } from '../crud.js';
import { httpError, notify, today, monthRange } from '../utils.js';

export const workRouter = Router();

const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const STATUSES = ['todo', 'in_progress', 'review', 'done'];

// ---------- tasks ----------
const TASK_SELECT = `SELECT t.*, p.name AS project_name, ${NAME('a')} AS assignee_name, a.avatar_color AS assignee_color, ${NAME('c')} AS creator_name
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN employees a ON a.id = t.assignee_id LEFT JOIN employees c ON c.id = t.created_by`;

function canAssign(user, assigneeId) {
  if (!assigneeId || Number(assigneeId) === user.id || isHR(user)) return true;
  return reportIds(user.id).includes(Number(assigneeId));
}
const canEditTask = (t, user) => t.assignee_id === user.id || t.created_by === user.id || isHR(user) || reportIds(user.id).includes(t.assignee_id);

workRouter.get('/tasks', (req, res) => {
  const u = req.user;
  const scope = req.query.scope || 'mine';
  const where = [];
  const params = [];
  if (scope === 'mine') { where.push('(t.assignee_id = ? OR t.created_by = ?)'); params.push(u.id, u.id); }
  else if (scope === 'team') {
    const ids = isHR(u) ? null : [u.id, ...reportIds(u.id)];
    if (ids) where.push(`(t.assignee_id IN (${ids.join(',')}) OR t.created_by IN (${ids.join(',')}))`);
  } else if (!isHR(u)) throw httpError(403, 'Not allowed');
  if (req.query.project_id) { where.push('t.project_id = ?'); params.push(req.query.project_id); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  res.json(all(`${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_date IS NULL, t.due_date, t.id DESC LIMIT 2000`, ...params));
});

workRouter.post('/tasks', (req, res) => {
  const b = req.body;
  if (!b.title?.trim()) throw httpError(400, 'Title is required');
  const assignee = b.assignee_id ? Number(b.assignee_id) : req.user.id;
  if (!canAssign(req.user, assignee)) throw httpError(403, 'You can assign tasks to yourself or your team');
  if (b.status && !STATUSES.includes(b.status)) throw httpError(400, 'Invalid status');
  if (b.priority && !['low', 'medium', 'high', 'urgent'].includes(b.priority)) throw httpError(400, 'Invalid priority');
  const id = insert('tasks', {
    title: b.title.trim(), description: b.description || null, project_id: b.project_id || null, assignee_id: assignee, created_by: req.user.id,
    priority: b.priority || 'medium', status: b.status || 'todo', due_date: b.due_date || null, estimate_hours: b.estimate_hours || null,
  });
  if (assignee !== req.user.id) notify(assignee, 'New task assigned to you', `${b.title}${b.due_date ? ` · due ${b.due_date}` : ''}`, '/tasks');
  res.status(201).json(get(`${TASK_SELECT} WHERE t.id = ?`, id));
});

workRouter.put('/tasks/:id', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ?', req.params.id);
  if (!t || !canEditTask(t, req.user)) throw httpError(404, 'Task not found');
  const data = {};
  for (const k of ['title', 'description', 'project_id', 'priority', 'due_date', 'estimate_hours']) if (k in req.body) data[k] = req.body[k];
  if ('assignee_id' in req.body && Number(req.body.assignee_id) !== t.assignee_id) {
    if (!canAssign(req.user, req.body.assignee_id)) throw httpError(403, 'You can assign tasks to yourself or your team');
    data.assignee_id = Number(req.body.assignee_id);
    notify(data.assignee_id, 'Task assigned to you', t.title, '/tasks');
  }
  if ('status' in req.body) {
    if (!STATUSES.includes(req.body.status)) throw httpError(400, 'Invalid status');
    data.status = req.body.status;
    data.completed_at = req.body.status === 'done' ? new Date().toISOString() : null;
    if (req.body.status === 'done' && t.created_by && t.created_by !== req.user.id) notify(t.created_by, 'Task completed ✅', t.title, '/tasks', { email: false });
  }
  update('tasks', t.id, data);
  res.json(get(`${TASK_SELECT} WHERE t.id = ?`, t.id));
});

workRouter.delete('/tasks/:id', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id = ?', req.params.id);
  if (!t) throw httpError(404, 'Task not found');
  if (t.created_by !== req.user.id && !isHR(req.user)) throw httpError(403, 'Only the creator can delete this task');
  run('DELETE FROM tasks WHERE id = ?', t.id);
  res.json({ ok: true });
});

// ---------- travel requests ----------
export const travelRouter = crud({
  table: 'travel_requests', label: 'travel request', link: '/travel',
  fields: ['employee_id', 'purpose', 'from_city', 'to_city', 'depart_date', 'return_date', 'mode', 'estimated_cost', 'advance_amount', 'billable'],
  owner: 'employee_id', selfService: true, approval: true, filters: ['status', 'employee_id'], order: 't.depart_date DESC',
  select: `SELECT t.*, ${NAME('e')} AS employee_name, e.avatar_color, ${NAME('a')} AS approver_name
           FROM travel_requests t JOIN employees e ON e.id = t.employee_id LEFT JOIN employees a ON a.id = t.approver_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.purpose || !m.from_city || !m.to_city || !m.depart_date) throw httpError(400, 'Purpose, route and departure date are required');
    if (!existing && m.depart_date < today()) throw httpError(400, 'Departure date cannot be in the past');
    if (m.return_date && m.return_date < m.depart_date) throw httpError(400, 'Return date cannot be before departure');
    if (m.advance_amount && Number(m.advance_amount) > Number(m.estimated_cost || 0)) throw httpError(400, 'Advance cannot exceed the estimated cost');
    return data;
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    notify(emp?.manager_id, 'Travel request awaiting approval', `${emp.first_name} ${emp.last_name}: ${data.from_city} → ${data.to_city} on ${data.depart_date}`, '/approvals');
  },
});

// ---------- unified calendar ----------
workRouter.get('/calendar', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const { start, end } = monthRange(month);
  const u = req.user;
  const events = [];
  const push = (type, date, title, extra = {}) => events.push({ type, date, title, ...extra });

  for (const h of all(
    `SELECT h.* FROM holidays h WHERE h.date BETWEEN ? AND ? AND (h.type != 'Optional'
       OR EXISTS (SELECT 1 FROM optional_holiday_choices c WHERE c.holiday_id = h.id AND c.employee_id = ?))`, start, end, u.id,
  )) push('holiday', h.date, h.name, { subtitle: h.type });

  for (const l of all(
    `SELECT r.*, ${NAME('e')} AS name, e.avatar_color, lt.name AS leave_type, lt.color FROM leave_requests r
     JOIN employees e ON e.id = r.employee_id JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.status = 'approved' AND r.start_date <= ? AND r.end_date >= ?`, end, start,
  )) push('leave', l.start_date < start ? start : l.start_date, `${l.name} · ${l.leave_type}`, { end: l.end_date > end ? end : l.end_date, color: l.color, employee_id: l.employee_id });

  const scope = scopeSql(u, 'i.interviewer_id');
  for (const i of all(
    `SELECT i.*, c.name AS candidate, j.title AS job FROM interviews i JOIN candidates c ON c.id = i.candidate_id LEFT JOIN job_openings j ON j.id = c.job_id
     WHERE substr(i.scheduled_at, 1, 10) BETWEEN ? AND ? AND i.status = 'scheduled' AND (${scope.sql} OR i.interviewer_id = ?)`, start, end, ...scope.params, u.id,
  )) push('interview', i.scheduled_at.slice(0, 10), `Interview: ${i.candidate}`, { time: i.scheduled_at.slice(11, 16), subtitle: i.job });

  for (const o of all(
    `SELECT o.*, ${NAME('m')} AS manager, ${NAME('e')} AS employee FROM one_on_ones o JOIN employees m ON m.id = o.manager_id JOIN employees e ON e.id = o.employee_id
     WHERE substr(o.scheduled_at, 1, 10) BETWEEN ? AND ? AND o.status = 'scheduled' AND (o.manager_id = ? OR o.employee_id = ?)`, start, end, u.id, u.id,
  )) push('one_on_one', o.scheduled_at.slice(0, 10), `1:1 with ${o.manager_id === u.id ? o.employee : o.manager}`, { time: o.scheduled_at.slice(11, 16) });

  const mm = month.slice(5, 7);
  for (const e of all(`SELECT id, ${NAME('e')} AS name, e.avatar_color, date_of_birth, date_of_joining FROM employees e WHERE status != 'exited'`)) {
    if (e.date_of_birth?.slice(5, 7) === mm) push('birthday', `${month}-${e.date_of_birth.slice(8, 10)}`, `🎂 ${e.name}`, { employee_id: e.id });
    if (e.date_of_joining?.slice(5, 7) === mm && e.date_of_joining.slice(0, 4) < month.slice(0, 4)) {
      push('anniversary', `${month}-${e.date_of_joining.slice(8, 10)}`, `🎉 ${e.name} · ${Number(month.slice(0, 4)) - Number(e.date_of_joining.slice(0, 4))} yrs`, { employee_id: e.id });
    }
  }

  for (const t of all(`SELECT id, title, due_date, priority FROM tasks WHERE assignee_id = ? AND status != 'done' AND due_date BETWEEN ? AND ?`, u.id, start, end)) {
    push('task', t.due_date, `Due: ${t.title}`, { subtitle: t.priority });
  }

  const tScope = scopeSql(u, 't.employee_id');
  for (const t of all(
    `SELECT t.*, ${NAME('e')} AS name FROM travel_requests t JOIN employees e ON e.id = t.employee_id
     WHERE t.status = 'approved' AND t.depart_date <= ? AND COALESCE(t.return_date, t.depart_date) >= ? AND ${tScope.sql}`, end, start, ...tScope.params,
  )) push('travel', t.depart_date < start ? start : t.depart_date, `✈️ ${t.name} · ${t.to_city}`, { end: (t.return_date || t.depart_date) > end ? end : (t.return_date || t.depart_date) });

  if (isHR(u)) {
    for (const e of all(`SELECT ${NAME('e')} AS name, probation_end_date FROM employees e WHERE status = 'active' AND confirmation_status IN ('probation','extended') AND probation_end_date BETWEEN ? AND ?`, start, end)) {
      push('probation', e.probation_end_date, `Probation review: ${e.name}`);
    }
  }
  res.json({ month, events: events.sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || ''))) });
});

