import { Router } from 'express';
import { all, get, insert, update, run, tx } from './db.js';
import { scopeSql, canManage, isHR } from './auth.js';
import { audit, notify, notifyHR, httpError } from './utils.js';
import { approvalFlow, recordStep, OPEN_STATUSES } from './workflow.js';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

/**
 * Builds a REST router for a table.
 *
 * owner        column holding the owning employee; rows are then scoped to what the viewer may see
 * readAll      every signed-in user can read every row (company-wide data such as holidays)
 * write        roles allowed to create/update/delete any row
 * selfService  employees may create their own rows and edit/delete them while still pending
 * approval     exposes PUT /:id/decision for managers/HR, with optional onDecision side effects
 */
export function crud(opts) {
  const {
    table, fields, owner, readAll = false, write = ['admin', 'hr'], selfService = false,
    filters = [], search = [], order = 't.id DESC', dateField, approval = false,
    select = `SELECT t.* FROM ${table} t`, validate, afterCreate, onDecision, label = table, approvers, afterDelete,
  } = opts;
  const router = Router();

  const baseSelect = (where, params) => ({ sql: `${select} WHERE ${where.join(' AND ')}`, params });

  function visibility(user) {
    if (readAll || !owner) return { sql: '1=1', params: [] };
    return scopeSql(user, `t.${owner}`);
  }

  function fetchOne(id, user) {
    const vis = visibility(user);
    const { sql, params } = baseSelect([`t.id = ?`, vis.sql], [id, ...vis.params]);
    return get(sql, ...params) ?? null;
  }

  router.get('/', (req, res) => {
    const vis = visibility(req.user);
    const where = [vis.sql];
    const params = [...vis.params];
    if (req.query.mine === '1' && owner) {
      where.push(`t.${owner} = ?`);
      params.push(req.user.id);
    }
    for (const f of filters) {
      if (req.query[f] !== undefined && req.query[f] !== '') {
        where.push(`t.${f} = ?`);
        params.push(req.query[f]);
      }
    }
    if (dateField && req.query.from) { where.push(`t.${dateField} >= ?`); params.push(req.query.from); }
    if (dateField && req.query.to) { where.push(`t.${dateField} <= ?`); params.push(req.query.to); }
    if (req.query.q && search.length) {
      where.push(`(${search.map((s) => `${s} LIKE ?`).join(' OR ')})`);
      params.push(...search.map(() => `%${req.query.q}%`));
    }
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const { sql } = baseSelect(where, params);
    res.json(all(`${sql} ORDER BY ${order} LIMIT ${limit}`, ...params));
  });

  router.get('/:id', (req, res) => {
    const row = fetchOne(req.params.id, req.user);
    if (!row) return res.status(404).json({ error: `${label} not found` });
    res.json(row);
  });

  const canWriteAny = (user) => write.includes(user.role);

  router.post('/', (req, res) => {
    let data = pick(req.body, fields);
    if (!canWriteAny(req.user)) {
      if (!selfService || !owner) throw httpError(403, 'You do not have permission for this action');
      data[owner] = req.user.id;
      if ('status' in data) delete data.status;
    } else if (owner && !data[owner]) {
      data[owner] = req.user.id;
    }
    if (validate) data = validate(data, req.user, null) ?? data;
    const id = tx(() => {
      const newId = insert(table, data);
      afterCreate?.(newId, data, req.user);
      audit(req.user.id, 'create', table, newId);
      return newId;
    });
    res.status(201).json(get(`${select} WHERE t.id = ?`, id));
  });

  function assertEditable(existing, user) {
    if (canWriteAny(user)) return;
    if (selfService && owner && existing[owner] === user.id && (!('status' in existing) || ['pending', 'open', 'draft', 'enrolled', 'in_progress', 'on_track', 'at_risk', 'behind', 'self_review'].includes(existing.status))) return;
    throw httpError(403, 'You cannot modify this record');
  }

  router.put('/:id', (req, res) => {
    const existing = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
    if (!existing) return res.status(404).json({ error: `${label} not found` });
    assertEditable(existing, req.user);
    let data = pick(req.body, fields);
    if (!canWriteAny(req.user) && owner) {
      delete data[owner];
      if (approval) delete data.status;
    }
    if (validate) data = validate(data, req.user, existing) ?? data;
    update(table, existing.id, data);
    audit(req.user.id, 'update', table, existing.id);
    res.json(get(`${select} WHERE t.id = ?`, existing.id));
  });

  router.delete('/:id', (req, res) => {
    const existing = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
    if (!existing) return res.status(404).json({ error: `${label} not found` });
    assertEditable(existing, req.user);
    run(`DELETE FROM ${table} WHERE id = ?`, existing.id);
    afterDelete?.(existing);
    audit(req.user.id, 'delete', table, existing.id);
    res.json({ ok: true });
  });

  if (approval) {
    router.put('/:id/decision', (req, res) => {
      const { status, comment } = req.body;
      if (!['approved', 'rejected'].includes(status)) throw httpError(400, 'Status must be approved or rejected');
      const existing = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
      if (!existing) return res.status(404).json({ error: `${label} not found` });
      const ownerId = existing[owner];
      const hr = isHR(req.user);
      const flow = approvers ? 'hr' : approvalFlow(table);
      if (ownerId === req.user.id && req.user.role !== 'admin') throw httpError(403, 'You cannot approve your own request');
      if (!canManage(req.user, ownerId)) throw httpError(403, 'Only the reporting manager or HR can decide on this');
      if (!OPEN_STATUSES.includes(existing.status)) throw httpError(400, `This request is already ${existing.status.replace('_', ' ')}`);
      if (flow === 'hr' && !hr) throw httpError(403, 'Only HR can decide on this');
      if (existing.status === 'manager_approved' && !hr) throw httpError(403, 'Already approved by the manager; awaiting HR approval');

      // Two-level flow: a manager's approval moves the request on to HR instead of finalising it.
      const finalStatus = status === 'approved' && flow === 'manager_hr' && !hr ? 'manager_approved' : status;
      tx(() => {
        update(table, existing.id, { status: finalStatus, approver_id: req.user.id, comment: comment || null });
        recordStep(table, existing.id, hr ? 'hr' : 'manager', req.user.id, status, comment);
        if (finalStatus !== 'manager_approved') onDecision?.(existing, finalStatus, req.user);
        const by = `${req.user.first_name} ${req.user.last_name}`;
        if (finalStatus === 'manager_approved') {
          notify(ownerId, `Your ${label} was approved by your manager`, `Approved by ${by}; now awaiting HR approval.`, opts.link);
          notifyHR(`${label[0].toUpperCase()}${label.slice(1)} awaiting HR approval`, `Approved by ${by}`, '/approvals');
        } else {
          notify(ownerId, `Your ${label} was ${finalStatus}`, comment || `Decision by ${by}`, opts.link);
        }
        audit(req.user.id, finalStatus, table, existing.id, comment ? { comment } : undefined);
      });
      res.json(get(`${select} WHERE t.id = ?`, existing.id));
    });
  }

  return router;
}

export { isHR };
