import { Router } from 'express';
import { all, get, update, run, tx } from '../db.js';
import { requireRole, isHR } from '../auth.js';
import { crud } from '../crud.js';
import { audit, httpError, notify, notifyHR, today } from '../utils.js';
import { singleFile, removeFile } from '../uploads.js';
import { saveAttachment } from './attachments.js';

/**
 * Document depth: who a company document is for (audience), version history, expiry and review dates, the
 * employee document checklist with HR verification, and electronic signatures on letters.
 */
export const docsExtraRouter = Router();
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
export const AUDIENCES = ['all', 'department', 'location', 'company', 'employees'];

export const parseIds = (v) => {
  if (Array.isArray(v)) return v.map(Number).filter(Boolean);
  if (v === undefined || v === null || v === '') return [];
  try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(Number).filter(Boolean); } catch { /* comma list */ }
  return String(v).split(',').map((x) => Number(x.trim())).filter(Boolean);
};

/** SQL condition matching the employees a company document is meant for. */
export function audienceSql(doc, alias = 'e') {
  const ids = parseIds(doc.audience_ids);
  const col = { department: 'department_id', location: 'location_id', company: 'company_id', employees: 'id' }[doc.audience_type];
  if (!col || !ids.length) return { sql: '1=1', params: [] };
  return { sql: `${alias}.${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Is a company-wide document visible to this employee? */
export function inAudience(doc, emp) {
  if (doc.employee_id) return doc.employee_id === emp.id;
  const ids = parseIds(doc.audience_ids);
  if (!doc.audience_type || doc.audience_type === 'all' || !ids.length) return true;
  const v = { department: emp.department_id, location: emp.location_id, company: emp.company_id, employees: emp.id }[doc.audience_type];
  return ids.includes(v);
}

export const audienceEmployees = (doc) => {
  const a = audienceSql(doc);
  return all(`SELECT e.id FROM employees e WHERE e.status != 'exited' AND ${a.sql}`, ...a.params).map((r) => r.id);
};

// ---------- document types (checklist) ----------
export const documentTypesRouter = crud({
  table: 'document_types', label: 'document type', fields: ['name', 'category', 'required', 'has_expiry', 'description'], readAll: true, order: 't.required DESC, t.name',
  validate(data, user, existing) {
    const name = String(data.name ?? existing?.name ?? '').trim();
    if (!name) throw httpError(400, 'Name is required');
    if (get('SELECT id FROM document_types WHERE lower(name) = lower(?) AND id != ?', name, existing?.id ?? 0)) throw httpError(409, 'This document type exists');
    return { ...data, ...(data.name !== undefined ? { name } : {}) };
  },
});

function checklistFor(employeeId) {
  const t = today();
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return all('SELECT * FROM document_types ORDER BY required DESC, name').map((type) => {
    const d = get(`SELECT d.id, d.title, d.verification, d.verify_note, d.expires_on, d.created_at, f.id AS file_id, f.original_name AS file_name, f.mime_type AS file_type
      FROM documents d LEFT JOIN attachments f ON f.id = (SELECT MAX(id) FROM attachments WHERE entity = 'documents' AND entity_id = d.id)
      WHERE d.employee_id = ? AND d.doc_type_id = ? ORDER BY d.id DESC LIMIT 1`, employeeId, type.id);
    let state = 'missing';
    if (d) state = d.verification === 'rejected' ? 'rejected' : d.expires_on && d.expires_on < t ? 'expired' : d.verification === 'verified' ? (d.expires_on && d.expires_on <= soon ? 'expiring' : 'verified') : 'pending';
    return { type, document: d || null, state };
  });
}

docsExtraRouter.get('/checklist', (req, res) => {
  const id = isHR(req.user) && req.query.employee_id ? Number(req.query.employee_id) : req.user.id;
  const items = checklistFor(id);
  res.json({ employee_id: id, items, complete: items.filter((i) => i.type.required).every((i) => ['verified', 'expiring'].includes(i.state)) });
});

docsExtraRouter.get('/compliance', requireRole('admin', 'hr'), (req, res) => {
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const required = all('SELECT id, name FROM document_types WHERE required = 1');
  const emps = all(`SELECT e.id, ${NAME('e')} AS name, e.emp_code, e.avatar_color, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited' ORDER BY e.first_name`);
  const have = all("SELECT employee_id, doc_type_id, verification FROM documents WHERE employee_id IS NOT NULL AND doc_type_id IS NOT NULL AND (expires_on IS NULL OR expires_on >= date('now'))");
  const key = (e, t) => `${e}:${t}`;
  const verified = new Set(have.filter((h) => h.verification === 'verified').map((h) => key(h.employee_id, h.doc_type_id)));
  const pending = have.filter((h) => h.verification === 'pending').length;
  const rows = emps.map((e) => {
    const missing = required.filter((t) => !verified.has(key(e.id, t.id))).map((t) => t.name);
    return { ...e, missing, complete: !missing.length };
  });
  res.json({
    required: required.map((t) => t.name), employees: rows, complete: rows.filter((r) => r.complete).length, pending_verification: pending,
    expiring: all(`SELECT d.id, d.title, d.expires_on, d.employee_id, ${NAME('e')} AS employee_name FROM documents d LEFT JOIN employees e ON e.id = d.employee_id
      WHERE d.expires_on IS NOT NULL AND d.expires_on <= ? ORDER BY d.expires_on`, soon),
    reviews_due: all('SELECT id, title, review_on, folder FROM documents WHERE employee_id IS NULL AND review_on IS NOT NULL AND review_on <= ? ORDER BY review_on', soon),
  });
});

docsExtraRouter.put('/:id/verify', requireRole('admin', 'hr'), (req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!d?.employee_id) throw httpError(404, 'Personal document not found');
  const { status, note } = req.body || {};
  if (!['verified', 'rejected'].includes(status)) throw httpError(400, 'Status must be verified or rejected');
  if (status === 'rejected' && !String(note || '').trim()) throw httpError(400, 'Add a note so the employee knows what to fix');
  update('documents', d.id, { verification: status, verified_by: req.user.id, verify_note: note || null });
  notify(d.employee_id, status === 'verified' ? `${d.title} verified` : `${d.title} needs attention`, status === 'verified' ? 'HR verified your document.' : note, '/documents?tab=checklist');
  audit(req.user.id, `document_${status}`, 'documents', d.id);
  res.json({ ok: true });
});

// ---------- versions ----------
docsExtraRouter.get('/:id/versions', (req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!d) throw httpError(404, 'Document not found');
  if (!isHR(req.user) && d.employee_id && d.employee_id !== req.user.id) throw httpError(403, 'Not allowed');
  const files = all(`SELECT a.id, a.original_name, a.mime_type, a.size, a.created_at, ${NAME('u')} AS uploaded_by_name FROM attachments a LEFT JOIN employees u ON u.id = a.uploaded_by
    WHERE a.entity = 'documents' AND a.entity_id = ? ORDER BY a.id`, d.id);
  res.json(files.map((f, i) => ({ ...f, version: i + 1, current: i === files.length - 1 })).reverse());
});

docsExtraRouter.post('/:id/versions', singleFile(), (req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  const allowed = d && (isHR(req.user) || (d.employee_id && d.employee_id === req.user.id));
  if (!allowed) { removeFile(req.file.filename); throw httpError(d ? 403 : 404, d ? 'Not allowed' : 'Document not found'); }
  const reack = d.requires_ack && ['1', 'true', 'on'].includes(String(req.body.reack));
  tx(() => {
    saveAttachment(req.file, 'documents', d.id, req.user.id);
    update('documents', d.id, {
      version: (d.version || 1) + 1, updated_at: new Date().toISOString(),
      ...(d.employee_id && d.doc_type_id ? { verification: 'pending', verify_note: null } : {}),
      ...(req.body.expires_on ? { expires_on: req.body.expires_on, expiry_reminded_at: null } : {}),
    });
    if (reack) run('DELETE FROM document_acks WHERE document_id = ?', d.id);
  });
  if (reack) for (const id of audienceEmployees(d)) notify(id, `Updated policy — please acknowledge again: ${d.title}`, req.body.note || 'A new version was published.', '/documents');
  audit(req.user.id, 'new_version', 'documents', d.id, { version: (d.version || 1) + 1, reack });
  res.status(201).json({ version: (d.version || 1) + 1 });
});

// ---------- e-signature ----------
docsExtraRouter.post('/:id/sign', (req, res) => {
  const d = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!d || d.employee_id !== req.user.id) throw httpError(404, 'Document not found');
  if (!d.requires_signature) throw httpError(400, 'This document does not need a signature');
  if (d.signed_at) throw httpError(400, 'Already signed');
  const name = `${req.user.first_name} ${req.user.last_name}`;
  const sig = String(req.body?.signature || '').trim();
  if (sig.toLowerCase().replace(/\s+/g, ' ') !== name.toLowerCase()) throw httpError(400, `Type your full name exactly as "${name}" to sign`);
  update('documents', d.id, { signed_at: new Date().toISOString(), signature: `${sig} · ${req.ip}` });
  notifyHR('Document signed', `${name} signed ${d.title}`, `/employees/${d.employee_id}`);
  audit(req.user.id, 'sign', 'documents', d.id);
  res.json({ ok: true });
});

// ---------- expiry reminders ----------
/** Reminds owners (and HR) about personal documents expiring within 30 days; each document is reminded once. */
export function remindExpiringDocuments() {
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const due = all("SELECT id, title, employee_id, expires_on FROM documents WHERE employee_id IS NOT NULL AND expires_on IS NOT NULL AND expires_on <= ? AND expiry_reminded_at IS NULL", soon);
  for (const d of due) {
    notify(d.employee_id, `${d.title} expires on ${d.expires_on}`, 'Please upload a renewed copy under Documents → Checklist.', '/documents?tab=checklist');
    run('UPDATE documents SET expiry_reminded_at = ? WHERE id = ?', new Date().toISOString(), d.id);
  }
  if (due.length) notifyHR('Documents expiring soon', `${due.length} employee document(s) expire within 30 days`, '/documents?tab=compliance');
  return due.length;
}

docsExtraRouter.post('/expiry-reminders', requireRole('admin', 'hr'), (req, res) => res.json({ reminded: remindExpiringDocuments() }));

