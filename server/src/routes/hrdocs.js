import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { crud } from '../crud.js';
import { audit, httpError, notify, notifyHR, today } from '../utils.js';
import { buildPdf } from '../pdf.js';
import { UPLOAD_DIR, singleFile, removeFile } from '../uploads.js';
import { emailEmployee } from '../mailer.js';
import { createEmployee } from './employees.js';
import { companyDetails } from './payroll.js';

export const hrdocsRouter = Router();

const inr = (n) => (n ? `Rs. ${Number(n).toLocaleString('en-IN')}` : '');
const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// ---------- letter templates ----------
export const PLACEHOLDERS = [
  'employee_name', 'first_name', 'emp_code', 'designation', 'department', 'date_of_joining', 'annual_ctc', 'monthly_gross',
  'manager_name', 'company_name', 'company_address', 'today', 'last_working_day', 'probation_end_date', 'purpose',
  'candidate_name', 'job_title', 'offered_ctc', 'joining_date',
];

export const lettersRouter = crud({
  table: 'letter_templates', label: 'letter template', fields: ['name', 'type', 'body'], readAll: true, order: 't.type, t.name',
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.name || !m.body) throw httpError(400, 'Name and body are required');
    const unknown = [...m.body.matchAll(/{{\s*(\w+)\s*}}/g)].map((x) => x[1]).filter((k) => !PLACEHOLDERS.includes(k));
    if (unknown.length) throw httpError(400, `Unknown placeholder(s): ${[...new Set(unknown)].join(', ')}`);
    return data;
  },
});

export function renderTemplate(body, vars) {
  return body.replace(/{{\s*(\w+)\s*}}/g, (_, k) => (vars[k] ?? '').toString());
}

function employeeVars(employeeId, extra = {}) {
  const e = get(
    `SELECT e.*, g.title AS designation, d.name AS department, m.first_name || ' ' || m.last_name AS manager_name
     FROM employees e LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN employees m ON m.id = e.manager_id WHERE e.id = ?`, employeeId,
  );
  if (!e) throw httpError(404, 'Employee not found');
  const c = companyDetails(e.company_id);
  const resignation = get("SELECT approved_lwd FROM resignations WHERE employee_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1", e.id);
  return {
    employee: e, company: c,
    vars: {
      employee_name: `${e.first_name} ${e.last_name}`, first_name: e.first_name, emp_code: e.emp_code, designation: e.designation || '',
      department: e.department || '', date_of_joining: longDate(e.date_of_joining), annual_ctc: inr(e.annual_ctc),
      monthly_gross: inr(Math.round((e.annual_ctc || 0) / 12)), manager_name: e.manager_name || '', company_name: c.company_name,
      company_address: c.company_address, today: longDate(today()), last_working_day: longDate(resignation?.approved_lwd || e.exit_date),
      probation_end_date: longDate(e.probation_end_date), ...extra,
    },
  };
}

/** Render a template to PDF and file it as a document (plus attachment) for the employee. */
export function generateLetter({ templateId, employeeId, purpose, userId }) {
  const t = get('SELECT * FROM letter_templates WHERE id = ?', templateId);
  if (!t) throw httpError(404, 'Template not found');
  const { vars, company, employee } = employeeVars(employeeId, { purpose: purpose || '' });
  const body = renderTemplate(t.body, vars);
  const pdf = buildPdf({ title: t.name, company: company.company_name, address: company.company_address, body, footer: `${company.company_name} · Ref ${employee.emp_code}-${Date.now().toString(36).toUpperCase()}` });
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), pdf);
  const filename = `${t.name.replace(/[^a-z0-9]+/gi, '-')}-${employee.emp_code}.pdf`;
  try {
    return tx(() => {
      const docId = insert('documents', { title: t.name, category: 'Letter', employee_id: employeeId, content: body });
      insert('attachments', { entity: 'documents', entity_id: docId, stored_name: stored, original_name: filename, mime_type: 'application/pdf', size: pdf.length, uploaded_by: userId });
      audit(userId, 'generate_letter', 'documents', docId, { template: t.name, employee_id: employeeId });
      return { documentId: docId, storedName: stored, filename, template: t };
    });
  } catch (err) {
    removeFile(stored);
    throw err;
  }
}

hrdocsRouter.get('/letters/placeholders', (req, res) => res.json(PLACEHOLDERS));

hrdocsRouter.post('/letters/preview', requireRole('admin', 'hr'), (req, res) => {
  const t = req.body.template_id ? get('SELECT * FROM letter_templates WHERE id = ?', req.body.template_id) : { body: req.body.body || '' };
  if (!t) throw httpError(404, 'Template not found');
  const { vars } = employeeVars(Number(req.body.employee_id), { purpose: req.body.purpose || '' });
  res.json({ text: renderTemplate(t.body, vars) });
});

hrdocsRouter.post('/letters/generate', requireRole('admin', 'hr'), (req, res) => {
  const { template_id: templateId, employee_id: employeeId, purpose, request_id: requestId, send_email: sendEmail = true } = req.body;
  if (!templateId || !employeeId) throw httpError(400, 'Template and employee are required');
  const result = generateLetter({ templateId: Number(templateId), employeeId: Number(employeeId), purpose, userId: req.user.id });
  if (requestId) update('letter_requests', Number(requestId), { status: 'fulfilled', document_id: result.documentId, handled_by: req.user.id });
  notify(Number(employeeId), `Your ${result.template.name} is ready`, 'Download it from Documents.', '/documents', { email: false });
  if (sendEmail) {
    emailEmployee(Number(employeeId), {
      force: true, template: 'letter', subject: `Your ${result.template.name}`, heading: result.template.name,
      paragraphs: [`Please find your ${result.template.name.toLowerCase()} attached. A copy is also available under Documents in PeopleHub.`],
      attachments: [{ filename: result.filename, storedName: result.storedName }],
    });
  }
  res.status(201).json({ document_id: result.documentId, filename: result.filename });
});

// ---------- letter requests (salary certificate, experience letter, address proof…) ----------
export const letterRequestsRouter = crud({
  table: 'letter_requests', label: 'letter request', link: '/documents', fields: ['employee_id', 'type', 'purpose'],
  owner: 'employee_id', selfService: true, filters: ['status', 'employee_id'],
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS employee_name, e.avatar_color, h.first_name || ' ' || h.last_name AS handled_by_name
           FROM letter_requests t JOIN employees e ON e.id = t.employee_id LEFT JOIN employees h ON h.id = t.handled_by`,
  validate(data, user, existing) {
    if (!existing && !data.type) throw httpError(400, 'Letter type is required');
    return data;
  },
  afterCreate(id, data) {
    const emp = get('SELECT first_name, last_name FROM employees WHERE id = ?', data.employee_id);
    notifyHR('Letter requested', `${emp.first_name} ${emp.last_name} requested a ${data.type}${data.purpose ? ` (${data.purpose})` : ''}`, '/documents?tab=requests');
  },
});

letterRequestsRouter.post('/:id/reject', requireRole('admin', 'hr'), (req, res) => {
  const r = get('SELECT * FROM letter_requests WHERE id = ?', req.params.id);
  if (!r) throw httpError(404, 'Request not found');
  update('letter_requests', r.id, { status: 'rejected', handled_by: req.user.id, comment: req.body.comment || null });
  notify(r.employee_id, `Your ${r.type} request was declined`, req.body.comment || '', '/documents');
  res.json({ ok: true });
});

// ---------- policy acknowledgement ----------
hrdocsRouter.post('/documents/:id/acknowledge', (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!doc || (doc.employee_id && doc.employee_id !== req.user.id)) throw httpError(404, 'Document not found');
  if (!doc.requires_ack) throw httpError(400, 'This document does not need acknowledgement');
  run('INSERT OR IGNORE INTO document_acks (document_id, employee_id) VALUES (?, ?)', doc.id, req.user.id);
  audit(req.user.id, 'acknowledge', 'documents', doc.id);
  res.json({ ok: true });
});

hrdocsRouter.get('/documents/:id/acknowledgements', requireRole('admin', 'hr'), (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!doc) throw httpError(404, 'Document not found');
  const rows = all(
    `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.avatar_color, d.name AS department, a.acknowledged_at
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN document_acks a ON a.employee_id = e.id AND a.document_id = ?
     WHERE e.status != 'exited' ${doc.employee_id ? 'AND e.id = ?' : ''} ORDER BY a.acknowledged_at IS NULL DESC, e.first_name`,
    doc.id, ...(doc.employee_id ? [doc.employee_id] : []),
  );
  res.json({ document: doc, acknowledged: rows.filter((r) => r.acknowledged_at).length, total: rows.length, rows });
});

hrdocsRouter.post('/documents/:id/remind', requireRole('admin', 'hr'), (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ? AND requires_ack = 1', req.params.id);
  if (!doc) throw httpError(404, 'Document not found');
  const pending = all(
    `SELECT e.id FROM employees e WHERE e.status != 'exited' AND NOT EXISTS (SELECT 1 FROM document_acks a WHERE a.document_id = ? AND a.employee_id = e.id)`, doc.id,
  );
  for (const p of pending) notify(p.id, `Please acknowledge: ${doc.title}`, 'Read the document and click Acknowledge.', '/documents');
  res.json({ reminded: pending.length });
});

// ---------- custom fields ----------
export const customFieldsRouter = crud({
  table: 'custom_fields', label: 'custom field', readAll: true, order: 't.section, t.sort_order, t.id',
  fields: ['label', 'type', 'options', 'section', 'required', 'employee_editable', 'sort_order'],
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.label) throw httpError(400, 'Label is required');
    if (!['text', 'number', 'date', 'select', 'textarea'].includes(m.type)) throw httpError(400, 'Invalid field type');
    if (data.options !== undefined) {
      const opts = Array.isArray(data.options) ? data.options : String(data.options || '').split('\n');
      const clean = opts.map((o) => String(o).trim()).filter(Boolean);
      if (m.type === 'select' && clean.length < 2) throw httpError(400, 'Dropdown fields need at least two options');
      data.options = m.type === 'select' ? JSON.stringify(clean) : null;
    }
    if (!existing) {
      let key = m.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
      while (get('SELECT id FROM custom_fields WHERE field_key = ?', key)) key += '_1';
      data.field_key = key;
    }
    return data;
  },
});

// ---------- bulk employee import (CSV) ----------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const IMPORT_COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'department', 'designation', 'location', 'company', 'manager_email',
  'date_of_joining', 'date_of_birth', 'gender', 'employment_type', 'role', 'annual_ctc'];

hrdocsRouter.get('/employees-import/template', requireRole('admin', 'hr'), (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.csv"');
  res.send(`${IMPORT_COLUMNS.join(',')}\nRavi,Kumar,ravi.kumar@example.com,+91 9000000001,Engineering,Software Engineer,Bengaluru HQ,Nimbus Technologies,manager@peoplehub.demo,${today()},1995-04-12,Male,Full-time,employee,1200000\n`);
});

hrdocsRouter.post('/employees-import', requireRole('admin', 'hr'), singleFile(), (req, res) => {
  let text;
  try { text = fs.readFileSync(req.file.path, 'utf8'); } finally { removeFile(req.file.filename); }
  const rows = parseCsv(text);
  if (rows.length < 2) throw httpError(400, 'The file has no data rows');
  if (rows.length > 1001) throw httpError(400, 'Import at most 1,000 employees at a time');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  for (const req2 of ['first_name', 'last_name', 'email']) if (!header.includes(req2)) throw httpError(400, `Missing required column: ${req2}`);

  const lookup = (table, col) => Object.fromEntries(all(`SELECT id, lower(${col}) AS k FROM ${table}`).map((r) => [r.k, r.id]));
  const depts = lookup('departments', 'name');
  const desigs = lookup('designations', 'title');
  const locs = lookup('locations', 'name');
  const comps = lookup('companies', 'name');
  const existing = new Set(all('SELECT lower(email) AS e FROM employees').map((r) => r.e));
  const seen = new Set();
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const dateOk = (d) => !d || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)));

  const results = rows.slice(1).map((cells, i) => {
    const r = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]));
    const errors = [];
    const email = r.email.toLowerCase();
    if (!r.first_name) errors.push('first_name is required');
    if (!r.last_name) errors.push('last_name is required');
    if (!emailOk(email)) errors.push('invalid email');
    else if (existing.has(email)) errors.push('email already exists');
    else if (seen.has(email)) errors.push('duplicate email in file');
    seen.add(email);
    const data = { first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone || null, gender: r.gender || null };
    if (r.department) { data.department_id = depts[r.department.toLowerCase()]; if (!data.department_id) errors.push(`unknown department "${r.department}"`); }
    if (r.designation) { data.designation_id = desigs[r.designation.toLowerCase()]; if (!data.designation_id) errors.push(`unknown designation "${r.designation}"`); }
    if (r.location) { data.location_id = locs[r.location.toLowerCase()]; if (!data.location_id) errors.push(`unknown location "${r.location}"`); }
    if (r.company) { data.company_id = comps[r.company.toLowerCase()]; if (!data.company_id) errors.push(`unknown company "${r.company}"`); }
    if (r.manager_email) {
      const mgr = get('SELECT id FROM employees WHERE lower(email) = lower(?)', r.manager_email);
      if (mgr) data.manager_id = mgr.id; else errors.push(`manager ${r.manager_email} not found`);
    }
    for (const k of ['date_of_joining', 'date_of_birth']) { if (!dateOk(r[k])) errors.push(`${k} must be YYYY-MM-DD`); else if (r[k]) data[k] = r[k]; }
    if (r.employment_type) {
      if (!['Full-time', 'Part-time', 'Contract', 'Intern'].includes(r.employment_type)) errors.push('employment_type must be Full-time, Part-time, Contract or Intern');
      else data.employment_type = r.employment_type;
    }
    if (r.role) {
      if (!['employee', 'manager', 'hr'].includes(r.role)) errors.push('role must be employee, manager or hr');
      else data.role = r.role;
    }
    if (r.annual_ctc) {
      const ctc = Number(r.annual_ctc.replace(/[,₹\s]/g, ''));
      if (!(ctc >= 0)) errors.push('annual_ctc must be a number'); else data.annual_ctc = ctc;
    }
    return { row: i + 2, name: `${r.first_name} ${r.last_name}`.trim(), email: r.email, errors, data };
  });

  const valid = results.filter((r) => !r.errors.length);
  const dryRun = req.query.dry_run === '1' || req.body.dry_run === '1';
  let created = 0;
  if (!dryRun) {
    for (const r of valid) { createEmployee(r.data, req.user.id); created++; }
    audit(req.user.id, 'import_employees', 'employees', null, { created, rejected: results.length - valid.length });
  }
  res.status(dryRun ? 200 : 201).json({
    dry_run: dryRun, total: results.length, valid: valid.length, invalid: results.length - valid.length, created,
    rows: results.map(({ data, ...r }) => r),
  });
});

// ---------- knowledge base ----------
export const kbRouter = crud({
  table: 'kb_articles', label: 'article', fields: ['title', 'category', 'body'], readAll: true, filters: ['category'],
  search: ['t.title', 't.body', 't.category'], order: 't.views DESC, t.id DESC',
  select: `SELECT t.*, e.first_name || ' ' || e.last_name AS author_name FROM kb_articles t LEFT JOIN employees e ON e.id = t.created_by`,
  validate(data, user, existing) {
    const m = { ...existing, ...data };
    if (!m.title || !m.body) throw httpError(400, 'Title and body are required');
    return existing ? { ...data, updated_at: new Date().toISOString() } : { ...data, created_by: user.id };
  },
});
kbRouter.post('/:id/view', (req, res) => { run('UPDATE kb_articles SET views = views + 1 WHERE id = ?', req.params.id); res.json({ ok: true }); });
kbRouter.post('/:id/helpful', (req, res) => { run('UPDATE kb_articles SET helpful = helpful + 1 WHERE id = ?', req.params.id); res.json({ ok: true }); });

