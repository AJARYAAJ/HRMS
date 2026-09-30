import { Router } from 'express';
import { all, get, insert, update, tx } from '../db.js';
import { requireRole, isHR } from '../auth.js';
import { crud } from '../crud.js';
import { audit, httpError, notify, notifyHR, today } from '../utils.js';

/**
 * Asset lifecycle: inventory with warranty and condition, assignment that the employee acknowledges, returns
 * (with condition) at any time or during exit, employee requests with approval, and a full history per asset.
 */
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
export const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'lost'];
const HR = requireRole('admin', 'hr');

export const logAsset = (assetId, action, { employeeId = null, by = null, condition = null, note = null } = {}) =>
  insert('asset_history', { asset_id: assetId, action, employee_id: employeeId, by_id: by, condition, note });

const inventory = crud({
  table: 'assets', label: 'asset',
  fields: ['asset_tag', 'name', 'category', 'serial_no', 'status', 'purchase_date', 'cost', 'warranty_until', 'condition', 'notes'],
  owner: 'assigned_to', filters: ['status', 'category', 'assigned_to'], search: ['t.name', 't.asset_tag', 't.serial_no'], order: 't.asset_tag',
  select: `SELECT t.*, ${NAME('e')} AS assigned_name, e.avatar_color,
             (SELECT COUNT(*) FROM asset_history h WHERE h.asset_id = t.id) AS history_count
           FROM assets t LEFT JOIN employees e ON e.id = t.assigned_to`,
  validate(data, user, existing) {
    // New assets start in stock: the crud factory would otherwise default the owner column to the creator.
    if (!existing) { data.assigned_to = null; if (data.status === 'assigned') delete data.status; }
    if (data.asset_tag !== undefined && !String(data.asset_tag).trim()) throw httpError(400, 'Asset tag is required');
    if (data.asset_tag && get('SELECT id FROM assets WHERE lower(asset_tag) = lower(?) AND id != ?', data.asset_tag, existing?.id ?? 0)) throw httpError(409, 'Asset tag already in use');
    if (data.condition && !CONDITIONS.includes(data.condition)) throw httpError(400, 'Unknown condition');
    // Assignment only through the assign / return actions, so history and acknowledgement stay consistent.
    if (data.status === 'assigned' && !existing?.assigned_to) throw httpError(400, 'Use "Assign" to give the asset to someone');
    if (existing?.assigned_to && data.status && data.status !== 'assigned') throw httpError(400, 'Record a return before changing the status of an assigned asset');
    return data;
  },
  afterCreate(id, data, user) { logAsset(id, 'created', { by: user.id, condition: data.condition || 'new' }); },
});

export const assetsRouter = Router();

assetsRouter.get('/summary', HR, (req, res) => {
  const t = today();
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  res.json({
    ...get(`SELECT COUNT(*) AS total, COALESCE(SUM(cost), 0) AS value,
      SUM(status = 'assigned') AS assigned, SUM(status = 'available') AS available, SUM(status = 'in_repair') AS in_repair,
      SUM(status = 'assigned' AND acknowledged_at IS NULL) AS unacknowledged,
      SUM(warranty_until IS NOT NULL AND warranty_until BETWEEN ? AND ?) AS warranty_expiring FROM assets WHERE status != 'retired'`, t, soon),
    pending_requests: get("SELECT COUNT(*) AS n FROM asset_requests WHERE status IN ('pending','manager_approved','approved')").n,
    exit_returns: all(`SELECT a.id, a.asset_tag, a.name, ${NAME('e')} AS employee_name, e.id AS employee_id, e.exit_date
      FROM assets a JOIN employees e ON e.id = a.assigned_to WHERE e.status IN ('on_notice','exited') ORDER BY e.exit_date`),
  });
});

assetsRouter.get('/:id/history', (req, res) => {
  const a = get('SELECT * FROM assets WHERE id = ?', req.params.id);
  if (!a) throw httpError(404, 'Asset not found');
  if (!isHR(req.user) && a.assigned_to !== req.user.id) throw httpError(403, 'Not allowed');
  res.json(all(`SELECT h.*, ${NAME('e')} AS employee_name, ${NAME('b')} AS by_name FROM asset_history h
    LEFT JOIN employees e ON e.id = h.employee_id LEFT JOIN employees b ON b.id = h.by_id WHERE h.asset_id = ? ORDER BY h.id DESC`, a.id));
});

assetsRouter.post('/:id/assign', HR, (req, res) => {
  const a = get('SELECT * FROM assets WHERE id = ?', req.params.id);
  if (!a) throw httpError(404, 'Asset not found');
  if (a.assigned_to) throw httpError(409, 'Asset is already assigned; record its return first');
  if (['retired', 'in_repair'].includes(a.status)) throw httpError(400, `A ${a.status.replace('_', ' ')} asset cannot be assigned`);
  const emp = get("SELECT id, first_name FROM employees WHERE id = ? AND status != 'exited'", Number(req.body.employee_id));
  if (!emp) throw httpError(400, 'Choose an active employee');
  tx(() => {
    update('assets', a.id, { assigned_to: emp.id, status: 'assigned', assigned_on: today(), acknowledged_at: null });
    logAsset(a.id, 'assigned', { employeeId: emp.id, by: req.user.id, condition: a.condition, note: req.body.note || null });
    if (req.body.request_id) {
      const r = get("SELECT * FROM asset_requests WHERE id = ? AND status = 'approved'", Number(req.body.request_id));
      if (!r || r.employee_id !== emp.id) throw httpError(400, 'That request is not an approved request from this employee');
      update('asset_requests', r.id, { status: 'fulfilled', asset_id: a.id });
    }
  });
  notify(emp.id, 'Asset assigned — please acknowledge', `${a.name} (${a.asset_tag}) has been assigned to you. Confirm you received it in My assets.`, '/assets');
  audit(req.user.id, 'assign', 'assets', a.id, { employee_id: emp.id });
  res.json(get('SELECT * FROM assets WHERE id = ?', a.id));
});

assetsRouter.post('/:id/acknowledge', (req, res) => {
  const a = get('SELECT * FROM assets WHERE id = ?', req.params.id);
  if (!a || a.assigned_to !== req.user.id) throw httpError(404, 'Asset not found');
  if (a.acknowledged_at) throw httpError(400, 'Already acknowledged');
  update('assets', a.id, { acknowledged_at: new Date().toISOString() });
  logAsset(a.id, 'acknowledged', { employeeId: req.user.id, by: req.user.id, note: req.body?.note || null });
  audit(req.user.id, 'acknowledge', 'assets', a.id);
  res.json({ ok: true });
});

assetsRouter.post('/:id/return', HR, (req, res) => {
  const a = get('SELECT * FROM assets WHERE id = ?', req.params.id);
  if (!a) throw httpError(404, 'Asset not found');
  if (!a.assigned_to) throw httpError(400, 'Asset is not assigned');
  const condition = CONDITIONS.includes(req.body.condition) ? req.body.condition : 'good';
  const status = condition === 'lost' ? 'retired' : condition === 'damaged' ? 'in_repair' : 'available';
  tx(() => {
    update('assets', a.id, { assigned_to: null, status, condition, assigned_on: null, acknowledged_at: null });
    logAsset(a.id, condition === 'lost' ? 'lost' : 'returned', { employeeId: a.assigned_to, by: req.user.id, condition, note: req.body.note || null });
  });
  notify(a.assigned_to, 'Asset return recorded', `${a.name} (${a.asset_tag}) was returned (${condition}).`, '/assets', { email: false });
  audit(req.user.id, 'return', 'assets', a.id, { condition });
  res.json(get('SELECT * FROM assets WHERE id = ?', a.id));
});

assetsRouter.use(inventory);

// ---------- requests ----------
export const assetRequestsRouter = crud({
  table: 'asset_requests', label: 'asset request', link: '/assets',
  fields: ['employee_id', 'category', 'reason', 'needed_by'],
  owner: 'employee_id', selfService: true, approval: true, filters: ['status', 'employee_id'],
  select: `SELECT t.*, ${NAME('e')} AS employee_name, e.avatar_color, a.asset_tag, a.name AS asset_name
           FROM asset_requests t JOIN employees e ON e.id = t.employee_id LEFT JOIN assets a ON a.id = t.asset_id`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!String(m.category || '').trim()) throw httpError(400, 'What do you need?');
    if (!String(m.reason || '').trim()) throw httpError(400, 'Please add a reason');
    if (m.needed_by && m.needed_by < today()) throw httpError(400, 'Needed-by date is in the past');
    return data;
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    const msg = `${emp.first_name} ${emp.last_name} requested: ${data.category}`;
    if (emp.manager_id) notify(emp.manager_id, 'Asset request awaiting approval', msg, '/approvals');
    else notifyHR('Asset request awaiting approval', msg, '/approvals');
  },
  onDecision(row, status) {
    if (status === 'approved') notifyHR('Asset request approved — ready to fulfil', `${row.category} for employee #${row.employee_id}`, '/assets?tab=requests');
  },
});

/** Exit clearance: assets an employee still holds, with their cost as the recovery if not returned. */
export function unreturnedAssets(employeeId) {
  return all("SELECT id, asset_tag, name, category, cost FROM assets WHERE assigned_to = ? AND status = 'assigned'", employeeId);
}
