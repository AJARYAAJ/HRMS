import { Router } from 'express';
import fs from 'node:fs';
import { all, get, insert, run } from '../db.js';
import { isHR, canManage } from '../auth.js';
import { audit, httpError, notify, notifyHR } from '../utils.js';
import { singleFile, removeFile, filePath, INLINE_TYPES } from '../uploads.js';

export const attachmentsRouter = Router();

const PENDING = ['pending', 'open', 'in_progress'];

/**
 * Who may read / add files for each kind of record. Each rule receives the parent row and the user.
 * Anything not listed here cannot carry attachments.
 */
const RULES = {
  expenses: {
    load: (id) => get('SELECT id, employee_id AS owner, status FROM expenses WHERE id = ?', id),
    read: (r, u) => r.owner === u.id || canManage(u, r.owner),
    write: (r, u) => (r.owner === u.id && r.status === 'pending') || isHR(u),
  },
  tickets: {
    load: (id) => get('SELECT id, employee_id AS owner, assignee_id, status, subject FROM tickets WHERE id = ?', id),
    read: (r, u) => r.owner === u.id || r.assignee_id === u.id || isHR(u),
    write: (r, u) => ((r.owner === u.id || r.assignee_id === u.id) && PENDING.includes(r.status)) || isHR(u),
  },
  candidates: {
    load: (id) => get('SELECT id FROM candidates WHERE id = ?', id),
    read: (r, u) => u.role !== 'employee',
    write: (r, u) => u.role !== 'employee',
  },
  screenshots: {
    load: (id) => get('SELECT id, id AS owner FROM employees WHERE id = ?', id),
    read: (r, u) => r.owner === u.id || canManage(u, r.owner),
    write: () => false,
  },
  documents: {
    load: (id) => get('SELECT id, employee_id AS owner FROM documents WHERE id = ?', id),
    read: (r, u) => r.owner === null || r.owner === u.id || isHR(u),
    write: (r, u) => isHR(u) || (r.owner !== null && r.owner === u.id),
  },
};

function resolve(entity, entityId, user, mode) {
  const rule = RULES[entity];
  if (!rule) throw httpError(400, 'Files cannot be attached to this kind of record');
  const row = rule.load(Number(entityId));
  if (!row) throw httpError(404, 'Record not found');
  if (!rule[mode](row, user)) throw httpError(403, mode === 'read' ? 'You cannot view these files' : 'You cannot add or remove files here');
  return row;
}

const SELECT = `SELECT a.id, a.entity, a.entity_id, a.original_name, a.mime_type, a.size, a.created_at, a.uploaded_by,
  e.first_name || ' ' || e.last_name AS uploaded_by_name FROM attachments a LEFT JOIN employees e ON e.id = a.uploaded_by`;

attachmentsRouter.get('/', (req, res) => {
  const { entity, entity_id } = req.query;
  resolve(entity, entity_id, req.user, 'read');
  res.json(all(`${SELECT} WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC`, entity, entity_id));
});

export function saveAttachment(file, entity, entityId, userId) {
  return insert('attachments', {
    entity, entity_id: Number(entityId), stored_name: file.filename, original_name: file.originalname.slice(0, 200),
    mime_type: file.mimetype, size: file.size, uploaded_by: userId,
  });
}

attachmentsRouter.post('/', singleFile(), (req, res) => {
  const { entity, entity_id } = req.body;
  let row;
  try {
    row = resolve(entity, entity_id, req.user, 'write');
  } catch (err) {
    removeFile(req.file.filename);
    throw err;
  }
  const id = saveAttachment(req.file, entity, entity_id, req.user.id);
  audit(req.user.id, 'upload', entity, Number(entity_id), { file: req.file.originalname, size: req.file.size });
  // Let the other side of a ticket know a file was added.
  if (entity === 'tickets') {
    if (row.owner !== req.user.id) notify(row.owner, `New file on ticket #${row.id}`, req.file.originalname, '/helpdesk');
    else if (row.assignee_id) notify(row.assignee_id, `New file on ticket #${row.id}`, req.file.originalname, '/helpdesk');
    else notifyHR(`New file on ticket #${row.id}`, req.file.originalname, '/helpdesk');
  }
  res.status(201).json(get(`${SELECT} WHERE a.id = ?`, id));
});

attachmentsRouter.get('/:id/download', (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', req.params.id);
  if (!a) throw httpError(404, 'File not found');
  resolve(a.entity, a.entity_id, req.user, 'read');
  const file = filePath(a.stored_name);
  if (!fs.existsSync(file)) throw httpError(410, 'This file is no longer available');
  const inline = req.query.inline === '1' && INLINE_TYPES.has(a.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.type(a.mime_type);
  const encoded = encodeURIComponent(a.original_name);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.original_name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encoded}`);
  fs.createReadStream(file).pipe(res);
});

attachmentsRouter.delete('/:id', (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', req.params.id);
  if (!a) throw httpError(404, 'File not found');
  resolve(a.entity, a.entity_id, req.user, 'write');
  if (a.uploaded_by !== req.user.id && !isHR(req.user)) throw httpError(403, 'Only the uploader or HR can remove this file');
  run('DELETE FROM attachments WHERE id = ?', a.id);
  removeFile(a.stored_name);
  audit(req.user.id, 'delete_file', a.entity, a.entity_id, { file: a.original_name });
  res.json({ ok: true });
});
