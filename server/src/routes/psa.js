import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR } from '../auth.js';
import { crud } from '../crud.js';
import { audit, httpError, today, ymd, parseDate, round2, workingDaysBetween, notify } from '../utils.js';
import { buildPdf } from '../pdf.js';
import { queueEmail } from '../mailer.js';

/**
 * Professional services automation (Keka PSA style): clients, projects with billing, opportunities,
 * resource allocation and utilisation, and finance (invoices, payments, project profitability).
 */
const MGR = ['admin', 'hr', 'manager'];
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const setting = (k, d) => get('SELECT value FROM settings WHERE key = ?', k)?.value || d;
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const HOURS_PER_YEAR = 2000; // for deriving an hourly cost from annual CTC

/** Hourly cost of an employee on a project: the member's cost rate, else CTC ÷ 2,000 hours. */
function costRate(projectId, employeeId) {
  const m = get('SELECT cost_rate FROM project_members WHERE project_id = ? AND employee_id = ?', projectId, employeeId);
  if (m?.cost_rate != null) return m.cost_rate;
  const e = get('SELECT annual_ctc FROM employees WHERE id = ?', employeeId);
  return round2((e?.annual_ctc || 0) / HOURS_PER_YEAR);
}

// ---------- clients ----------
export const clientsRouter = Router();

const clientsCrud = crud({
  table: 'clients', label: 'client', write: MGR, readAll: true, search: ['t.name', 't.code', 't.industry'], filters: ['status', 'owner_id'],
  fields: ['name', 'code', 'industry', 'website', 'email', 'phone', 'billing_address', 'gstin', 'currency', 'payment_terms_days', 'status', 'owner_id', 'notes'],
  order: 't.name',
  select: `SELECT t.*, ${NAME('o')} AS owner_name,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id = t.id AND p.status = 'active') AS active_projects,
    (SELECT COUNT(*) FROM opportunities x WHERE x.client_id = t.id AND x.stage NOT IN ('won','lost')) AS open_opportunities,
    COALESCE((SELECT SUM(total - amount_paid) FROM invoices i WHERE i.client_id = t.id AND i.status IN ('sent','partially_paid')), 0) AS outstanding,
    COALESCE((SELECT SUM(total) FROM invoices i WHERE i.client_id = t.id AND i.status != 'void' AND i.status != 'draft'), 0) AS lifetime_billed
    FROM clients t LEFT JOIN employees o ON o.id = t.owner_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.name?.trim()) throw httpError(400, 'Client name is required');
    if (m.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(m.gstin)) throw httpError(400, 'GSTIN must be 15 characters (e.g. 29ABCDE1234F1Z5)');
    if (m.payment_terms_days != null && !(Number(m.payment_terms_days) >= 0 && Number(m.payment_terms_days) <= 180)) throw httpError(400, 'Payment terms must be 0–180 days');
    if (!existing && get('SELECT id FROM clients WHERE lower(name) = lower(?)', m.name.trim())) throw httpError(409, 'A client with this name already exists');
    return data;
  },
});

clientsRouter.get('/:id/summary', requireRole(...MGR), (req, res) => {
  const c = get('SELECT * FROM clients WHERE id = ?', req.params.id);
  if (!c) throw httpError(404, 'Client not found');
  res.json({
    client: c,
    contacts: all('SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, name', c.id),
    projects: all(`SELECT p.*, ${NAME('m')} AS manager_name FROM projects p LEFT JOIN employees m ON m.id = p.manager_id WHERE p.client_id = ? ORDER BY p.status, p.name`, c.id),
    opportunities: all('SELECT * FROM opportunities WHERE client_id = ? ORDER BY id DESC', c.id),
    invoices: isHR(req.user) ? all('SELECT * FROM invoices WHERE client_id = ? ORDER BY issue_date DESC', c.id) : [],
  });
});

clientsRouter.get('/:id/contacts', requireRole(...MGR), (req, res) => {
  res.json(all('SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, name', req.params.id));
});

clientsRouter.post('/:id/contacts', requireRole(...MGR), (req, res) => {
  if (!get('SELECT id FROM clients WHERE id = ?', req.params.id)) throw httpError(404, 'Client not found');
  const { name, email, phone, designation, is_primary: primary } = req.body || {};
  if (!name?.trim()) throw httpError(400, 'Contact name is required');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Invalid email');
  const id = tx(() => {
    if (primary) run('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', req.params.id);
    return insert('client_contacts', { client_id: Number(req.params.id), name: name.trim(), email: email || null, phone: phone || null, designation: designation || null, is_primary: primary ? 1 : 0 });
  });
  res.status(201).json(get('SELECT * FROM client_contacts WHERE id = ?', id));
});

clientsRouter.delete('/contacts/:cid', requireRole(...MGR), (req, res) => {
  run('DELETE FROM client_contacts WHERE id = ?', req.params.cid);
  res.json({ ok: true });
});

clientsRouter.delete('/:id', requireRole(...MGR), (req, res, next) => {
  if (get('SELECT id FROM invoices WHERE client_id = ? LIMIT 1', req.params.id)) throw httpError(409, 'This client has invoices; mark it inactive instead');
  next();
});

clientsRouter.use('/', clientsCrud);

// ---------- projects ----------
export const projectsRouter = Router();

const PROJECT_SELECT = `SELECT t.*, COALESCE(c.name, t.client) AS client_name, c.name AS client_org, ${NAME('m')} AS manager_name,
  COALESCE((SELECT SUM(hours) FROM timesheets s WHERE s.project_id = t.id), 0) AS logged_hours,
  COALESCE((SELECT SUM(hours) FROM timesheets s WHERE s.project_id = t.id AND s.billable = 1), 0) AS billable_hours,
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = t.id) AS members
  FROM projects t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN employees m ON m.id = t.manager_id`;

const projectsCrud = crud({
  table: 'projects', label: 'project', readAll: true, write: MGR, filters: ['status', 'client_id', 'billing_type', 'manager_id', 'health'],
  search: ['t.name', 't.code', 't.client'], order: "t.status = 'active' DESC, t.name",
  fields: ['name', 'code', 'client', 'client_id', 'status', 'start_date', 'end_date', 'budget_hours', 'budget_amount', 'billing_type', 'manager_id', 'description', 'health'],
  select: PROJECT_SELECT,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.name?.trim()) throw httpError(400, 'Project name is required');
    if (m.billing_type && !['time_materials', 'fixed', 'non_billable'].includes(m.billing_type)) throw httpError(400, 'Billing type must be time & materials, fixed price or non-billable');
    if (m.health && !['on_track', 'at_risk', 'off_track'].includes(m.health)) throw httpError(400, 'Invalid health');
    if (m.start_date && m.end_date && m.end_date < m.start_date) throw httpError(400, 'End date cannot be before the start date');
    if (data.client_id) {
      const c = get('SELECT name FROM clients WHERE id = ?', data.client_id);
      if (!c) throw httpError(400, 'Unknown client');
      data.client = c.name; // keep the legacy text column in step
    }
    return data;
  },
  afterCreate(id, data, user) {
    if (data.manager_id) run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role) VALUES (?, ?, ?)', id, data.manager_id, 'Project manager');
  },
});

/** Everything the project page needs: budget burn, members with hours, milestones, allocations and P&L. */
projectsRouter.get('/:id/overview', (req, res) => {
  const p = get(`${PROJECT_SELECT} WHERE t.id = ?`, req.params.id);
  if (!p) throw httpError(404, 'Project not found');
  const members = all(
    `SELECT pm.*, ${NAME('e')} AS name, e.avatar_color, g.title AS designation,
       COALESCE((SELECT SUM(hours) FROM timesheets s WHERE s.project_id = pm.project_id AND s.employee_id = pm.employee_id), 0) AS hours,
       COALESCE((SELECT SUM(hours) FROM timesheets s WHERE s.project_id = pm.project_id AND s.employee_id = pm.employee_id AND s.billable = 1), 0) AS billable_hours
     FROM project_members pm JOIN employees e ON e.id = pm.employee_id LEFT JOIN designations g ON g.id = e.designation_id
     WHERE pm.project_id = ? ORDER BY e.first_name`, p.id,
  );
  const isMember = members.some((m) => m.employee_id === req.user.id);
  if (req.user.role === 'employee' && !isMember) throw httpError(403, 'You are not on this project');
  const showMoney = req.user.role !== 'employee';
  const hoursBy = all(`SELECT employee_id, SUM(hours) AS hours, SUM(CASE WHEN billable = 1 AND status = 'approved' AND invoice_id IS NULL THEN hours ELSE 0 END) AS unbilled
    FROM timesheets WHERE project_id = ? GROUP BY employee_id`, p.id);
  const cost = round2(hoursBy.reduce((a, h) => a + h.hours * costRate(p.id, h.employee_id), 0));
  const rateOf = (id) => members.find((m) => m.employee_id === id)?.bill_rate || 0;
  const unbilled = round2(hoursBy.reduce((a, h) => a + h.unbilled * rateOf(h.employee_id), 0));
  const billed = get(`SELECT COALESCE(SUM(l.amount), 0) AS v FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.project_id = ? AND i.status NOT IN ('void','draft')`, p.id).v;
  const collected = get("SELECT COALESCE(SUM(amount_paid), 0) AS v FROM invoices WHERE project_id = ? AND status != 'void'", p.id).v;
  res.json({
    project: p,
    members: showMoney ? members : members.map(({ bill_rate: _b, cost_rate: _c, ...m }) => m),
    milestones: all('SELECT * FROM project_milestones WHERE project_id = ? ORDER BY due_date', p.id),
    allocations: all(`SELECT a.*, ${NAME('e')} AS name, e.avatar_color FROM resource_allocations a JOIN employees e ON e.id = a.employee_id
      WHERE a.project_id = ? AND a.end_date >= ? ORDER BY a.start_date`, p.id, today()),
    weekly_hours: all(`SELECT strftime('%Y-%W', date) AS week, MIN(date) AS week_start, SUM(hours) AS hours,
      SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) AS billable FROM timesheets WHERE project_id = ? GROUP BY week ORDER BY week DESC LIMIT 12`, p.id).reverse(),
    financials: showMoney ? {
      billed: round2(billed), collected: round2(collected), unbilled, cost,
      margin: round2(billed + unbilled - cost), margin_pct: billed + unbilled ? Math.round(((billed + unbilled - cost) / (billed + unbilled)) * 100) : null,
      budget_used_pct: p.budget_amount ? Math.round(((billed + unbilled) / p.budget_amount) * 100) : null,
    } : null,
    invoices: isHR(req.user) ? all('SELECT id, number, issue_date, due_date, status, total, amount_paid FROM invoices WHERE project_id = ? ORDER BY issue_date DESC', p.id) : [],
  });
});

projectsRouter.put('/:id/members', requireRole(...MGR), (req, res) => {
  const p = get('SELECT id FROM projects WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Project not found');
  const members = Array.isArray(req.body?.members) ? req.body.members : [];
  const ids = new Set();
  for (const m of members) {
    if (!m.employee_id || ids.has(Number(m.employee_id))) throw httpError(400, 'Each member must be a different employee');
    ids.add(Number(m.employee_id));
    if (m.bill_rate != null && !(Number(m.bill_rate) >= 0)) throw httpError(400, 'Bill rate cannot be negative');
  }
  tx(() => {
    run(`DELETE FROM project_members WHERE project_id = ? AND employee_id NOT IN (${[...ids].map(() => '?').join(',') || 'NULL'})`, p.id, ...ids);
    for (const m of members) {
      run(`INSERT INTO project_members (project_id, employee_id, role, bill_rate, cost_rate) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id, employee_id) DO UPDATE SET role = excluded.role, bill_rate = excluded.bill_rate, cost_rate = excluded.cost_rate`,
      p.id, m.employee_id, m.role || null, Number(m.bill_rate) || 0, m.cost_rate === '' || m.cost_rate == null ? null : Number(m.cost_rate));
    }
  });
  audit(req.user.id, 'update_members', 'projects', p.id, { count: members.length });
  res.json(all('SELECT * FROM project_members WHERE project_id = ?', p.id));
});

projectsRouter.post('/:id/milestones', requireRole(...MGR), (req, res) => {
  if (!get('SELECT id FROM projects WHERE id = ?', req.params.id)) throw httpError(404, 'Project not found');
  const { name, due_date: due, amount } = req.body || {};
  if (!name?.trim()) throw httpError(400, 'Milestone name is required');
  if (amount != null && !(Number(amount) >= 0)) throw httpError(400, 'Amount cannot be negative');
  const id = insert('project_milestones', { project_id: Number(req.params.id), name: name.trim(), due_date: due || null, amount: Number(amount) || 0 });
  res.status(201).json(get('SELECT * FROM project_milestones WHERE id = ?', id));
});

projectsRouter.post('/milestones/:mid/complete', requireRole(...MGR), (req, res) => {
  const m = get('SELECT * FROM project_milestones WHERE id = ?', req.params.mid);
  if (!m) throw httpError(404, 'Milestone not found');
  if (m.status === 'invoiced') throw httpError(400, 'This milestone is already invoiced');
  update('project_milestones', m.id, { status: 'completed', completed_on: today() });
  for (const id of all("SELECT id FROM employees WHERE role IN ('admin','hr') AND status != 'exited'").map((r) => r.id)) {
    notify(id, 'Milestone ready to invoice', m.name, '/finance', { email: false });
  }
  res.json(get('SELECT * FROM project_milestones WHERE id = ?', m.id));
});

projectsRouter.delete('/milestones/:mid', requireRole(...MGR), (req, res) => {
  const m = get('SELECT * FROM project_milestones WHERE id = ?', req.params.mid);
  if (m?.status === 'invoiced') throw httpError(400, 'Invoiced milestones cannot be deleted');
  run('DELETE FROM project_milestones WHERE id = ?', req.params.mid);
  res.json({ ok: true });
});

projectsRouter.use('/', projectsCrud);

// ---------- opportunities ----------
export const opportunitiesRouter = Router();

export const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_PROBABILITY = { lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };

const opportunitiesCrud = crud({
  table: 'opportunities', label: 'opportunity', readAll: true, write: MGR, filters: ['stage', 'client_id', 'owner_id'], search: ['t.name', 't.prospect', 'c.name'],
  fields: ['name', 'client_id', 'prospect', 'owner_id', 'stage', 'value', 'probability', 'expected_close', 'source', 'billing_type', 'notes', 'lost_reason'],
  order: 't.expected_close IS NULL, t.expected_close',
  select: `SELECT t.*, COALESCE(c.name, t.prospect) AS account, ${NAME('o')} AS owner_name, o.avatar_color AS owner_color,
    ROUND(t.value * t.probability / 100.0) AS weighted_value, p.name AS project_name
    FROM opportunities t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN employees o ON o.id = t.owner_id LEFT JOIN projects p ON p.id = t.project_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.name?.trim()) throw httpError(400, 'Opportunity name is required');
    if (!m.client_id && !m.prospect?.trim()) throw httpError(400, 'Choose a client or enter the prospect organisation');
    if (m.stage && !STAGES.includes(m.stage)) throw httpError(400, 'Invalid stage');
    if (m.value != null && !(Number(m.value) >= 0)) throw httpError(400, 'Value cannot be negative');
    if (data.stage && data.stage !== existing?.stage) {
      if (data.probability == null) data.probability = STAGE_PROBABILITY[data.stage];
      if (['won', 'lost'].includes(data.stage)) data.closed_on = today();
      else data.closed_on = null;
      if (data.stage === 'lost' && !m.lost_reason?.trim()) throw httpError(400, 'Give a reason when marking an opportunity lost');
      if (existing?.project_id && data.stage !== 'won') throw httpError(400, 'This opportunity already became a project');
    }
    if (!existing && data.probability == null) data.probability = STAGE_PROBABILITY[m.stage || 'lead'];
    if (data.probability != null && !(Number(data.probability) >= 0 && Number(data.probability) <= 100)) throw httpError(400, 'Probability must be 0–100%');
    if (!existing && !data.owner_id) data.owner_id = user.id;
    return data;
  },
});

opportunitiesRouter.get('/summary', requireRole(...MGR), (req, res) => {
  const rows = all('SELECT stage, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value, COALESCE(SUM(value * probability / 100.0), 0) AS weighted FROM opportunities GROUP BY stage');
  const by = Object.fromEntries(STAGES.map((s) => [s, rows.find((r) => r.stage === s) || { stage: s, count: 0, value: 0, weighted: 0 }]));
  const open = STAGES.slice(0, 4).reduce((a, s) => ({ count: a.count + by[s].count, value: a.value + by[s].value, weighted: a.weighted + by[s].weighted }), { count: 0, value: 0, weighted: 0 });
  const closed = by.won.count + by.lost.count;
  res.json({
    stages: STAGES.map((s) => ({ ...by[s], value: round2(by[s].value), weighted: round2(by[s].weighted) })),
    open_count: open.count, pipeline_value: round2(open.value), weighted_pipeline: round2(open.weighted),
    won_value: round2(by.won.value), win_rate: closed ? Math.round((by.won.count / closed) * 100) : null,
    avg_deal: by.won.count ? round2(by.won.value / by.won.count) : null,
    closing_this_month: get("SELECT COUNT(*) AS n FROM opportunities WHERE stage NOT IN ('won','lost') AND substr(expected_close, 1, 7) = ?", today().slice(0, 7)).n,
  });
});

/** A won opportunity becomes a project (and the prospect a client, if it wasn't one). */
opportunitiesRouter.post('/:id/convert', requireRole(...MGR), (req, res) => {
  const o = get('SELECT * FROM opportunities WHERE id = ?', req.params.id);
  if (!o) throw httpError(404, 'Opportunity not found');
  if (o.stage !== 'won') throw httpError(400, 'Only won opportunities can be converted to a project');
  if (o.project_id) throw httpError(409, 'Already converted');
  const result = tx(() => {
    let clientId = o.client_id;
    if (!clientId) {
      clientId = get('SELECT id FROM clients WHERE lower(name) = lower(?)', o.prospect)?.id
        ?? insert('clients', { name: o.prospect.trim(), owner_id: o.owner_id, status: 'active' });
      update('opportunities', o.id, { client_id: clientId });
    }
    const client = get('SELECT name FROM clients WHERE id = ?', clientId);
    const projectId = insert('projects', {
      name: req.body?.name?.trim() || o.name, client_id: clientId, client: client.name, status: 'active', billing_type: o.billing_type || 'time_materials',
      budget_amount: o.value || null, manager_id: req.body?.manager_id || o.owner_id, start_date: req.body?.start_date || today(),
      description: o.notes || null, opportunity_id: o.id, health: 'on_track',
    });
    const manager = req.body?.manager_id || o.owner_id;
    if (manager) run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role) VALUES (?, ?, ?)', projectId, manager, 'Project manager');
    update('opportunities', o.id, { project_id: projectId });
    return { project_id: projectId, client_id: clientId };
  });
  audit(req.user.id, 'convert', 'opportunities', o.id, result);
  res.status(201).json(result);
});

opportunitiesRouter.use('/', opportunitiesCrud);

// ---------- resources ----------
export const resourcesRouter = Router();

const allocationsCrud = crud({
  table: 'resource_allocations', label: 'allocation', owner: 'employee_id', write: MGR, filters: ['employee_id', 'project_id'],
  fields: ['employee_id', 'project_id', 'start_date', 'end_date', 'allocation_pct', 'billable', 'role', 'notes'],
  order: 't.start_date DESC',
  select: `SELECT t.*, ${NAME('e')} AS employee_name, e.avatar_color, p.name AS project_name, COALESCE(c.name, p.client) AS client_name
    FROM resource_allocations t JOIN employees e ON e.id = t.employee_id JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = p.client_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.employee_id || !m.project_id || !m.start_date || !m.end_date) throw httpError(400, 'Employee, project and dates are required');
    if (m.end_date < m.start_date) throw httpError(400, 'End date cannot be before the start date');
    const pct = Number(m.allocation_pct ?? 100);
    if (!(pct >= 5 && pct <= 100)) throw httpError(400, 'Allocation must be between 5% and 100%');
    if (!get("SELECT id FROM employees WHERE id = ? AND status != 'exited'", m.employee_id)) throw httpError(400, 'Unknown employee');
    if (!get('SELECT id FROM projects WHERE id = ?', m.project_id)) throw httpError(400, 'Unknown project');
    return { ...data, created_by: existing ? existing.created_by : user.id };
  },
  afterCreate(id, data) {
    run('INSERT OR IGNORE INTO project_members (project_id, employee_id, role) VALUES (?, ?, ?)', data.project_id, data.employee_id, data.role || null);
    const p = get('SELECT name FROM projects WHERE id = ?', data.project_id);
    notify(Number(data.employee_id), 'You have been allocated to a project', `${p.name} · ${data.allocation_pct ?? 100}% from ${data.start_date} to ${data.end_date}`, '/resources', { email: false });
  },
});

/** Allocation % an employee has on each day of [from, to], averaged over working days. */
function allocationFor(rows, employeeId, from, to) {
  const days = [];
  for (let d = parseDate(from); d <= parseDate(to); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) days.push(ymd(d));
  if (!days.length) return 0;
  const mine = rows.filter((r) => r.employee_id === employeeId);
  const total = days.reduce((a, day) => a + mine.filter((r) => r.start_date <= day && r.end_date >= day).reduce((s, r) => s + r.allocation_pct, 0), 0);
  return Math.round(total / days.length);
}

resourcesRouter.get('/utilization', requireRole(...MGR), (req, res) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : addDays(to, -27);
  if (to < from) throw httpError(400, 'Invalid range');
  const where = ["e.status != 'exited'"];
  const params = [];
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(req.query.department_id); }
  const emps = all(`SELECT e.id, ${NAME('e')} AS name, e.avatar_color, d.name AS department, g.title AS designation FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id WHERE ${where.join(' AND ')} ORDER BY e.first_name`, ...params);
  const allocs = all('SELECT employee_id, project_id, start_date, end_date, allocation_pct, billable FROM resource_allocations WHERE start_date <= ? AND end_date >= ?', to, from);
  const hours = Object.fromEntries(all(`SELECT employee_id, SUM(hours) AS logged, SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) AS billable
    FROM timesheets WHERE date BETWEEN ? AND ? GROUP BY employee_id`, from, to).map((h) => [h.employee_id, h]));
  const capacity = workingDaysBetween(from, to) * 8;
  const rows = emps.map((e) => {
    const allocation = allocationFor(allocs, e.id, from, to);
    const h = hours[e.id] || { logged: 0, billable: 0 };
    const projects = [...new Set(allocs.filter((a) => a.employee_id === e.id).map((a) => a.project_id))].length;
    return {
      ...e, allocation_pct: allocation, projects, capacity_hours: capacity, logged_hours: round2(h.logged), billable_hours: round2(h.billable),
      utilization_pct: capacity ? Math.round((h.billable / capacity) * 100) : 0,
      status: allocation > 100 ? 'overallocated' : allocation >= 80 ? 'full' : allocation >= 20 ? 'partial' : 'bench',
    };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  res.json({
    from, to, capacity_hours: capacity, rows,
    summary: {
      people: rows.length, bench: count('bench'), partial: count('partial'), full: count('full'), overallocated: count('overallocated'),
      avg_allocation: rows.length ? Math.round(rows.reduce((a, r) => a + r.allocation_pct, 0) / rows.length) : 0,
      billable_utilization: rows.length && capacity ? Math.round((rows.reduce((a, r) => a + r.billable_hours, 0) / (capacity * rows.length)) * 100) : 0,
    },
  });
});

/** Week-by-week allocation grid for the resource planner (12 weeks from the given Monday). */
resourcesRouter.get('/timeline', requireRole(...MGR), (req, res) => {
  let start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : today();
  const d = parseDate(start);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  start = ymd(d);
  const weeks = Array.from({ length: Number(req.query.weeks) > 0 && Number(req.query.weeks) <= 26 ? Number(req.query.weeks) : 12 }, (_, i) => addDays(start, i * 7));
  const end = addDays(weeks[weeks.length - 1], 6);
  const allocs = all(`SELECT a.*, p.name AS project_name FROM resource_allocations a JOIN projects p ON p.id = a.project_id WHERE a.start_date <= ? AND a.end_date >= ?`, end, start);
  const where = ["e.status != 'exited'"];
  const params = [];
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(req.query.department_id); }
  if (req.query.project_id) { where.push('e.id IN (SELECT employee_id FROM resource_allocations WHERE project_id = ?)'); params.push(req.query.project_id); }
  const emps = all(`SELECT e.id, ${NAME('e')} AS name, e.avatar_color, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    WHERE ${where.join(' AND ')} ORDER BY d.name, e.first_name`, ...params);
  res.json({
    weeks,
    rows: emps.map((e) => ({
      ...e,
      weeks: weeks.map((w) => ({
        start: w,
        pct: allocationFor(allocs, e.id, w, addDays(w, 4)),
        projects: [...new Set(allocs.filter((a) => a.employee_id === e.id && a.start_date <= addDays(w, 4) && a.end_date >= w).map((a) => a.project_name))],
      })),
    })),
  });
});

resourcesRouter.use('/allocations', allocationsCrud);

// ---------- finance ----------
export const financeRouter = Router();
financeRouter.use(requireRole('admin', 'hr'));

function nextInvoiceNumber(date) {
  const prefix = `INV-${date.slice(0, 4)}-`;
  const last = get('SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1', `${prefix}%`)?.number;
  return `${prefix}${String((last ? Number(last.slice(prefix.length)) : 0) + 1).padStart(4, '0')}`;
}

function recalc(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  const subtotal = round2(get('SELECT COALESCE(SUM(amount), 0) AS v FROM invoice_lines WHERE invoice_id = ?', invoiceId).v);
  const tax = round2((subtotal * (inv.tax_rate || 0)) / 100);
  update('invoices', invoiceId, { subtotal, tax_amount: tax, total: round2(subtotal + tax) });
}

const INVOICE_SELECT = `SELECT i.*, c.name AS client_name, c.email AS client_email, c.gstin AS client_gstin, c.billing_address, p.name AS project_name,
  ROUND(i.total - i.amount_paid, 2) AS balance,
  CASE WHEN i.status IN ('sent','partially_paid') AND i.due_date < date('now','localtime') THEN CAST(julianday(date('now','localtime')) - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue
  FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id`;

function invoiceDetail(id) {
  const inv = get(`${INVOICE_SELECT} WHERE i.id = ?`, id);
  if (!inv) throw httpError(404, 'Invoice not found');
  return {
    ...inv,
    lines: all(`SELECT l.*, ${NAME('e')} AS employee_name FROM invoice_lines l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.invoice_id = ? ORDER BY l.id`, id),
    payments: all('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY date', id),
  };
}

financeRouter.get('/invoices', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status === 'overdue') where.push("i.status IN ('sent','partially_paid') AND i.due_date < date('now','localtime')");
  else if (req.query.status) { where.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.client_id) { where.push('i.client_id = ?'); params.push(req.query.client_id); }
  if (req.query.project_id) { where.push('i.project_id = ?'); params.push(req.query.project_id); }
  res.json(all(`${INVOICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.issue_date DESC, i.id DESC`, ...params));
});

financeRouter.get('/invoices/:id', (req, res) => res.json(invoiceDetail(Number(req.params.id))));

/** What can be invoiced for a project in a period: approved, billable, not-yet-invoiced time and completed milestones. */
function billableFor(project, start, end) {
  const members = Object.fromEntries(all('SELECT employee_id, bill_rate FROM project_members WHERE project_id = ?', project.id).map((m) => [m.employee_id, m.bill_rate]));
  const time = project.billing_type === 'time_materials' ? all(
    `SELECT s.employee_id, ${NAME('e')} AS name, SUM(s.hours) AS hours, GROUP_CONCAT(s.id) AS ids FROM timesheets s JOIN employees e ON e.id = s.employee_id
     WHERE s.project_id = ? AND s.billable = 1 AND s.status = 'approved' AND s.invoice_id IS NULL AND s.date BETWEEN ? AND ?
     GROUP BY s.employee_id ORDER BY e.first_name`, project.id, start, end,
  ).map((r) => ({ ...r, rate: members[r.employee_id] || 0, amount: round2(r.hours * (members[r.employee_id] || 0)) })) : [];
  const milestones = project.billing_type === 'fixed'
    ? all("SELECT * FROM project_milestones WHERE project_id = ? AND status = 'completed' AND invoice_id IS NULL ORDER BY due_date", project.id) : [];
  return { time, milestones, missing_rates: time.filter((t) => !t.rate).map((t) => t.name) };
}

financeRouter.get('/billable', (req, res) => {
  const p = get('SELECT * FROM projects WHERE id = ?', req.query.project_id);
  if (!p) throw httpError(404, 'Project not found');
  res.json(billableFor(p, req.query.start || '0000-01-01', req.query.end || today()));
});

/**
 * Create a draft invoice. From a project: time & materials bills approved billable hours in the period at each
 * member's bill rate; fixed price bills completed milestones. Extra manual lines can be added either way.
 */
financeRouter.post('/invoices', (req, res) => {
  const b = req.body || {};
  const issue = /^\d{4}-\d{2}-\d{2}$/.test(b.issue_date || '') ? b.issue_date : today();
  let clientId = Number(b.client_id) || null;
  let project = null;
  if (b.project_id) {
    project = get('SELECT * FROM projects WHERE id = ?', b.project_id);
    if (!project) throw httpError(400, 'Unknown project');
    if (project.billing_type === 'non_billable') throw httpError(400, 'This project is non-billable');
    clientId = project.client_id;
    if (!clientId) throw httpError(400, 'Link the project to a client before invoicing');
  }
  const client = clientId && get('SELECT * FROM clients WHERE id = ?', clientId);
  if (!client) throw httpError(400, 'Choose a client');
  const taxRate = b.tax_rate != null ? Number(b.tax_rate) : Number(setting('invoice_tax_rate', '18'));
  if (!(taxRate >= 0 && taxRate <= 40)) throw httpError(400, 'Tax rate must be 0–40%');
  const start = b.period_start || '0000-01-01';
  const end = b.period_end || issue;
  const lines = [];
  const timesheetIds = [];
  const milestoneIds = [];
  if (project) {
    const bill = billableFor(project, start, end);
    if (bill.missing_rates.length) throw httpError(400, `Set a bill rate for: ${bill.missing_rates.join(', ')} (Projects → Members)`);
    for (const t of bill.time) {
      lines.push({ kind: 'time', description: `${t.name} — professional services`, quantity: round2(t.hours), rate: t.rate, amount: t.amount, employee_id: t.employee_id });
      timesheetIds.push(...String(t.ids).split(',').map(Number));
    }
    for (const m of bill.milestones) {
      lines.push({ kind: 'milestone', description: `Milestone: ${m.name}`, quantity: 1, rate: m.amount, amount: m.amount, milestone_id: m.id });
      milestoneIds.push(m.id);
    }
  }
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const qty = Number(l.quantity) || 1;
    const rate = Number(l.rate) || 0;
    if (!l.description?.trim()) throw httpError(400, 'Every line needs a description');
    if (rate < 0 || qty <= 0) throw httpError(400, 'Line quantity must be positive and rate not negative');
    lines.push({ kind: l.kind || 'other', description: l.description.trim(), quantity: qty, rate, amount: round2(qty * rate) });
  }
  if (!lines.length) throw httpError(400, project ? 'Nothing to invoice for this project and period (approved billable time or completed milestones)' : 'Add at least one line');
  const id = tx(() => {
    const invId = insert('invoices', {
      number: nextInvoiceNumber(issue), client_id: client.id, project_id: project?.id ?? null, issue_date: issue,
      due_date: b.due_date || addDays(issue, client.payment_terms_days ?? 30), period_start: b.period_start || null, period_end: b.period_end || null,
      currency: client.currency || 'INR', tax_rate: taxRate, notes: b.notes || null, created_by: req.user.id, status: 'draft',
    });
    for (const l of lines) insert('invoice_lines', { invoice_id: invId, ...l });
    if (timesheetIds.length) run(`UPDATE timesheets SET invoice_id = ? WHERE id IN (${timesheetIds.map(() => '?').join(',')})`, invId, ...timesheetIds);
    if (milestoneIds.length) run(`UPDATE project_milestones SET status = 'invoiced', invoice_id = ? WHERE id IN (${milestoneIds.map(() => '?').join(',')})`, invId, ...milestoneIds);
    recalc(invId);
    return invId;
  });
  audit(req.user.id, 'create', 'invoices', id, { lines: lines.length });
  res.status(201).json(invoiceDetail(id));
});

financeRouter.put('/invoices/:id', (req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (inv.status !== 'draft') throw httpError(400, 'Only draft invoices can be edited');
  const b = req.body || {};
  tx(() => {
    const data = {};
    for (const k of ['issue_date', 'due_date', 'notes']) if (k in b) data[k] = b[k] || null;
    if ('tax_rate' in b) {
      if (!(Number(b.tax_rate) >= 0 && Number(b.tax_rate) <= 40)) throw httpError(400, 'Tax rate must be 0–40%');
      data.tax_rate = Number(b.tax_rate);
    }
    if (data.due_date && data.due_date < (data.issue_date || inv.issue_date)) throw httpError(400, 'Due date cannot be before the issue date');
    if (Object.keys(data).length) update('invoices', inv.id, data);
    if (Array.isArray(b.lines)) {
      // Only manual lines are editable; time and milestone lines stay tied to what they bill.
      run("DELETE FROM invoice_lines WHERE invoice_id = ? AND kind IN ('other','expense')", inv.id);
      for (const l of b.lines.filter((x) => !['time', 'milestone'].includes(x.kind))) {
        if (!l.description?.trim()) throw httpError(400, 'Every line needs a description');
        const qty = Number(l.quantity) || 1;
        const rate = Number(l.rate) || 0;
        insert('invoice_lines', { invoice_id: inv.id, kind: l.kind || 'other', description: l.description.trim(), quantity: qty, rate, amount: round2(qty * rate) });
      }
    }
    recalc(inv.id);
  });
  res.json(invoiceDetail(inv.id));
});

function releaseBilledWork(invoiceId) {
  run('UPDATE timesheets SET invoice_id = NULL WHERE invoice_id = ?', invoiceId);
  run("UPDATE project_milestones SET status = 'completed', invoice_id = NULL WHERE invoice_id = ?", invoiceId);
}

financeRouter.delete('/invoices/:id', (req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (inv.status !== 'draft') throw httpError(400, 'Only drafts can be deleted; void a sent invoice instead');
  tx(() => { releaseBilledWork(inv.id); run('DELETE FROM invoices WHERE id = ?', inv.id); });
  audit(req.user.id, 'delete', 'invoices', inv.id);
  res.json({ ok: true });
});

financeRouter.post('/invoices/:id/void', (req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (inv.status === 'void') throw httpError(400, 'Already void');
  if (inv.amount_paid > 0) throw httpError(400, 'An invoice with payments cannot be voided');
  tx(() => { releaseBilledWork(inv.id); update('invoices', inv.id, { status: 'void' }); });
  audit(req.user.id, 'void', 'invoices', inv.id, { reason: req.body?.reason });
  res.json(invoiceDetail(inv.id));
});

const money = (n, cur = 'INR') => `${cur === 'INR' ? 'Rs.' : cur} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function invoicePdf(inv) {
  const company = { name: setting('company_name', 'PeopleHub'), address: setting('company_address', '') };
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const lines = inv.lines.map((l) => `${pad(l.description, 44)} ${pad(round2(l.quantity), 8)} ${pad(money(l.rate, inv.currency), 16)} ${money(l.amount, inv.currency)}`);
  const body = [
    `TAX INVOICE  ${inv.number}`,
    '',
    `Bill to: ${inv.client_name}`,
    ...(inv.billing_address ? [inv.billing_address] : []),
    ...(inv.client_gstin ? [`GSTIN: ${inv.client_gstin}`] : []),
    '',
    `Issue date: ${inv.issue_date}      Due date: ${inv.due_date}`,
    ...(inv.project_name ? [`Project: ${inv.project_name}`] : []),
    ...(inv.period_start ? [`Service period: ${inv.period_start} to ${inv.period_end}`] : []),
    '',
    `${pad('Description', 44)} ${pad('Qty/Hrs', 8)} ${pad('Rate', 16)} Amount`,
    '-'.repeat(90),
    ...lines,
    '-'.repeat(90),
    `Subtotal: ${money(inv.subtotal, inv.currency)}`,
    `GST (${inv.tax_rate}%): ${money(inv.tax_amount, inv.currency)}`,
    `TOTAL: ${money(inv.total, inv.currency)}`,
    ...(inv.amount_paid ? [`Paid: ${money(inv.amount_paid, inv.currency)}   Balance due: ${money(inv.balance, inv.currency)}`] : []),
    '',
    ...(inv.notes ? [inv.notes, ''] : []),
    `Please pay within the due date quoting invoice ${inv.number}.`,
  ].join('\n');
  return buildPdf({ title: `Invoice ${inv.number}`, company: company.name, address: company.address, body, footer: `${company.name} · ${inv.number}` });
}

financeRouter.get('/invoices/:id/pdf', (req, res) => {
  const inv = invoiceDetail(Number(req.params.id));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}.pdf"` }).send(invoicePdf(inv));
});

/** Finalise and email the invoice (PDF attached) to the client's billing email or primary contact. */
financeRouter.post('/invoices/:id/send', async (req, res) => {
  const inv = invoiceDetail(Number(req.params.id));
  if (!['draft', 'sent', 'partially_paid'].includes(inv.status)) throw httpError(400, `A ${inv.status} invoice cannot be sent`);
  const contact = get('SELECT name, email FROM client_contacts WHERE client_id = ? AND email IS NOT NULL ORDER BY is_primary DESC LIMIT 1', inv.client_id);
  const to = req.body?.email || inv.client_email || contact?.email;
  if (!to) throw httpError(400, 'Add a billing email or a contact with an email to the client first');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { UPLOAD_DIR } = await import('../uploads.js');
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), invoicePdf(inv));
  queueEmail({
    to, toName: contact?.name || inv.client_name, template: 'invoice', subject: `Invoice ${inv.number} from ${setting('company_name', 'PeopleHub')}`,
    heading: `Invoice ${inv.number}`, greeting: `Dear ${contact?.name?.split(' ')[0] || inv.client_name},`,
    paragraphs: ['Please find our invoice attached. Thank you for your business.'],
    details: [['Amount due', money(inv.total - inv.amount_paid, inv.currency)], ['Due date', inv.due_date], ...(inv.project_name ? [['Project', inv.project_name]] : [])],
    attachments: [{ filename: `${inv.number}.pdf`, storedName: stored }],
  });
  if (inv.status === 'draft') update('invoices', inv.id, { status: 'sent', sent_at: new Date().toISOString() });
  audit(req.user.id, 'send', 'invoices', inv.id, { to });
  res.json(invoiceDetail(inv.id));
});

financeRouter.post('/invoices/:id/payments', (req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (!['sent', 'partially_paid'].includes(inv.status)) throw httpError(400, 'Record payments against sent invoices');
  const amount = round2(Number(req.body?.amount));
  const balance = round2(inv.total - inv.amount_paid);
  if (!(amount > 0)) throw httpError(400, 'Enter the amount received');
  if (amount > balance + 0.01) throw httpError(400, `Payment exceeds the balance due (${balance})`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || '') ? req.body.date : today();
  if (date > today()) throw httpError(400, 'Payment date cannot be in the future');
  tx(() => {
    insert('invoice_payments', { invoice_id: inv.id, amount, date, method: req.body?.method || null, reference: req.body?.reference || null, created_by: req.user.id });
    const paid = round2(inv.amount_paid + amount);
    update('invoices', inv.id, { amount_paid: paid, status: paid >= inv.total - 0.01 ? 'paid' : 'partially_paid' });
  });
  audit(req.user.id, 'payment', 'invoices', inv.id, { amount });
  res.status(201).json(invoiceDetail(inv.id));
});

/** Finance dashboard: billing and collections, receivables ageing, revenue trend, top clients, project P&L. */
financeRouter.get('/summary', (req, res) => {
  const t = today();
  const open = all(`${INVOICE_SELECT} WHERE i.status IN ('sent','partially_paid')`);
  const bucket = (lo, hi) => round2(open.filter((i) => i.days_overdue >= lo && i.days_overdue <= hi).reduce((a, i) => a + i.balance, 0));
  const months = Array.from({ length: 12 }, (_, i) => { const d = parseDate(`${t.slice(0, 7)}-01`); d.setMonth(d.getMonth() - 11 + i); return ymd(d).slice(0, 7); });
  const invoicedBy = Object.fromEntries(all("SELECT substr(issue_date, 1, 7) AS m, SUM(subtotal) AS v FROM invoices WHERE status NOT IN ('void','draft') GROUP BY m").map((r) => [r.m, r.v]));
  const collectedBy = Object.fromEntries(all('SELECT substr(date, 1, 7) AS m, SUM(amount) AS v FROM invoice_payments GROUP BY m').map((r) => [r.m, r.v]));
  const projects = all(`SELECT p.id, p.name, p.billing_type, p.status, p.budget_amount, COALESCE(c.name, p.client) AS client_name FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id WHERE p.billing_type != 'non_billable' OR p.billing_type IS NULL`);
  const pnl = projects.map((p) => {
    const billed = get(`SELECT COALESCE(SUM(l.amount), 0) AS v FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.project_id = ? AND i.status NOT IN ('void','draft')`, p.id).v;
    const hoursBy = all("SELECT employee_id, SUM(hours) AS h FROM timesheets WHERE project_id = ? GROUP BY employee_id", p.id);
    const cost = round2(hoursBy.reduce((a, h) => a + h.h * costRate(p.id, h.employee_id), 0));
    return { ...p, billed: round2(billed), cost, margin: round2(billed - cost), margin_pct: billed ? Math.round(((billed - cost) / billed) * 100) : null };
  }).filter((p) => p.billed || p.cost).sort((a, b) => b.billed - a.billed);
  res.json({
    this_month: {
      invoiced: round2(invoicedBy[t.slice(0, 7)] || 0),
      collected: round2(collectedBy[t.slice(0, 7)] || 0),
    },
    outstanding: round2(open.reduce((a, i) => a + i.balance, 0)),
    overdue: round2(open.filter((i) => i.days_overdue > 0).reduce((a, i) => a + i.balance, 0)),
    overdue_count: open.filter((i) => i.days_overdue > 0).length,
    draft_count: get("SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'").n,
    ageing: [
      { bucket: 'Not due', amount: round2(open.filter((i) => !i.days_overdue).reduce((a, i) => a + i.balance, 0)) },
      { bucket: '1–30 days', amount: bucket(1, 30) }, { bucket: '31–60 days', amount: bucket(31, 60) },
      { bucket: '61–90 days', amount: bucket(61, 90) }, { bucket: '90+ days', amount: bucket(91, 100000) },
    ],
    trend: months.map((m) => ({ month: m, invoiced: round2(invoicedBy[m] || 0), collected: round2(collectedBy[m] || 0) })),
    top_clients: all(`SELECT c.id, c.name, SUM(i.subtotal) AS billed, SUM(i.total - i.amount_paid) AS outstanding FROM invoices i JOIN clients c ON c.id = i.client_id
      WHERE i.status NOT IN ('void','draft') GROUP BY c.id ORDER BY billed DESC LIMIT 8`).map((r) => ({ ...r, billed: round2(r.billed), outstanding: round2(r.outstanding) })),
    project_pnl: pnl,
  });
});
