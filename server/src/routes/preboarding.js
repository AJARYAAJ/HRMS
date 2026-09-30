import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR, canManage } from '../auth.js';
import { audit, httpError, notify, notifyHR, today } from '../utils.js';
import { singleFile, removeFile, filePath, UPLOAD_DIR } from '../uploads.js';
import { queueEmail, appUrl } from '../mailer.js';
import { createEmployee } from './employees.js';

/**
 * Pre-boarding (before day one) and onboarding templates (after joining).
 *
 * HR invites a new hire; they get a private link (no account needed) where they fill in personal, address, family,
 * emergency and bank details, upload the document checklist and sign their offer. HR verifies each document or
 * sends it back with a note, then converts the pre-hire into an employee: the profile is pre-filled, verified
 * documents are filed under their documents, the onboarding checklist comes from the chosen template, and their
 * buddy and manager are notified. Only a SHA-256 hash of the link token is stored.
 */
export const preboardingRouter = Router();
export const joinRouter = Router();
export const onboardingTemplatesRouter = Router();

const HR = requireRole('admin', 'hr');
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const LINK_DAYS = 30;

export const DOC_TYPES = [
  { key: 'photo', label: 'Passport-size photo', required: true, accept: 'image' },
  { key: 'pan', label: 'PAN card', required: true },
  { key: 'aadhaar', label: 'Aadhaar card', required: true },
  { key: 'education', label: 'Highest education certificate', required: true },
  { key: 'experience', label: 'Relieving / experience letter (previous employer)', required: false },
  { key: 'bank_proof', label: 'Cancelled cheque or bank statement', required: true },
];
const DOC = Object.fromEntries(DOC_TYPES.map((d) => [d.key, d]));

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const expiry = () => new Date(Date.now() + LINK_DAYS * 86400000).toISOString();
const portalUrl = (token) => `${appUrl()}/join/${token}`;
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

const SELECT = `SELECT p.*, g.title AS designation, d.name AS department, l.name AS location, ${NAME('m')} AS manager_name, ${NAME('b')} AS buddy_name,
    t.name AS template_name, COALESCE(c.name, (SELECT value FROM settings WHERE key = 'company_name')) AS company
  FROM preboarding p LEFT JOIN designations g ON g.id = p.designation_id LEFT JOIN departments d ON d.id = p.department_id
  LEFT JOIN locations l ON l.id = p.location_id LEFT JOIN employees m ON m.id = p.manager_id LEFT JOIN employees b ON b.id = p.buddy_id
  LEFT JOIN onboarding_templates t ON t.id = p.template_id LEFT JOIN companies c ON c.id = (SELECT id FROM companies ORDER BY id LIMIT 1)`;

/** Which parts of the form are complete, and what still blocks submission. */
function progress(p, docs) {
  const d = parse(p.details);
  const sections = {
    personal: !!(d.personal?.date_of_birth && d.personal?.gender && d.personal?.phone),
    address: !!d.address?.current,
    emergency: !!(d.emergency?.name && d.emergency?.phone),
    bank: !!(d.bank?.account && d.bank?.ifsc && d.bank?.pan),
  };
  const byType = Object.fromEntries(docs.map((x) => [x.doc_type, x]));
  const missing = DOC_TYPES.filter((t) => t.required && (!byType[t.key] || byType[t.key].status === 'rejected')).map((t) => t.label);
  const blockers = [
    ...Object.entries(sections).filter(([, ok]) => !ok).map(([k]) => `${k[0].toUpperCase()}${k.slice(1)} details`),
    ...missing,
    ...(p.offer_accepted_at ? [] : ['Offer acceptance']),
  ];
  const total = Object.keys(sections).length + DOC_TYPES.filter((t) => t.required).length + 1;
  return {
    sections, blockers, pct: Math.round(((total - blockers.length) / total) * 100),
    verified: DOC_TYPES.filter((t) => t.required).every((t) => byType[t.key]?.status === 'verified'),
  };
}

function detailFor(p) {
  const docs = all('SELECT id, doc_type, original_name, mime_type, size, status, note, created_at FROM preboarding_documents WHERE preboarding_id = ? ORDER BY id', p.id);
  const { token_hash: _h, ...rest } = p;
  return { ...rest, details: parse(p.details), documents: docs, progress: progress(p, docs), doc_types: DOC_TYPES };
}

function sendInvite(p, token) {
  queueEmail({
    to: p.email, toName: p.name, template: 'preboarding', subject: `Welcome aboard — complete your joining formalities`,
    heading: `We're excited to have you, ${p.name.split(' ')[0]}!`,
    paragraphs: [
      `Before your first day on ${p.date_of_joining}, please fill in your details, upload the listed documents and accept your offer using your private link.`,
      `The link works for ${LINK_DAYS} days and needs no password. Please don't share it.`,
    ],
    details: [['Role', p.designation || '—'], ['Joining date', p.date_of_joining]],
    cta: { url: portalUrl(token), label: 'Start pre-boarding' },
  });
}

// ---------- HR ----------
preboardingRouter.use(HR);

preboardingRouter.get('/', (req, res) => {
  const rows = all(`${SELECT} ORDER BY CASE p.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'invited' THEN 2 ELSE 3 END, p.date_of_joining`);
  res.json(rows.map((p) => {
    const docs = all('SELECT doc_type, status FROM preboarding_documents WHERE preboarding_id = ?', p.id);
    const pr = progress(p, docs);
    const { token_hash: _h, details: _d, ...rest } = p;
    return { ...rest, pct: pr.pct, verified: pr.verified, pending_docs: docs.filter((d) => d.status === 'pending').length, expired: p.expires_at < new Date().toISOString() };
  }));
});

preboardingRouter.get('/:id', (req, res) => {
  const p = get(`${SELECT} WHERE p.id = ?`, req.params.id);
  if (!p) throw httpError(404, 'Pre-boarding record not found');
  res.json(detailFor(p));
});

preboardingRouter.post('/', (req, res) => {
  const b = req.body || {};
  let { name, email, phone } = b;
  const cand = b.candidate_id ? get('SELECT c.*, j.department_id, j.location_id, j.hiring_manager_id, j.title FROM candidates c LEFT JOIN job_openings j ON j.id = c.job_id WHERE c.id = ?', b.candidate_id) : null;
  if (b.candidate_id && !cand) throw httpError(404, 'Candidate not found');
  name = String(name || cand?.name || '').trim();
  email = String(email || cand?.email || '').trim().toLowerCase();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Name and a valid email are required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date_of_joining || '')) throw httpError(400, 'Choose the joining date');
  if (get('SELECT id FROM employees WHERE lower(email) = ?', email)) throw httpError(409, 'An employee with this email already exists');
  if (get("SELECT id FROM preboarding WHERE lower(email) = ? AND status NOT IN ('converted','cancelled')", email)) throw httpError(409, 'This person already has an active pre-boarding invite');
  const token = newToken();
  const designationId = b.designation_id || (cand?.title && get('SELECT id FROM designations WHERE title = ?', cand.title)?.id) || null;
  const id = insert('preboarding', {
    candidate_id: cand?.id ?? null, name, email, phone: phone || cand?.phone || null,
    designation_id: designationId, department_id: b.department_id || cand?.department_id || null, location_id: b.location_id || cand?.location_id || null,
    manager_id: b.manager_id || cand?.hiring_manager_id || null, buddy_id: b.buddy_id || null, template_id: b.template_id || null,
    date_of_joining: b.date_of_joining, annual_ctc: b.annual_ctc ?? cand?.expected_ctc ?? null,
    token_hash: hashToken(token), expires_at: expiry(), status: 'invited', created_by: req.user.id,
  });
  const p = get(`${SELECT} WHERE p.id = ?`, id);
  sendInvite(p, token);
  audit(req.user.id, 'create', 'preboarding', id);
  res.status(201).json({ ...detailFor(p), portal_url: portalUrl(token) });
});

preboardingRouter.put('/:id', (req, res) => {
  const p = get('SELECT * FROM preboarding WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Pre-boarding record not found');
  if (['converted', 'cancelled'].includes(p.status)) throw httpError(400, `This record is ${p.status}`);
  const allowed = ['designation_id', 'department_id', 'location_id', 'manager_id', 'buddy_id', 'template_id', 'date_of_joining', 'annual_ctc', 'phone'];
  const data = Object.fromEntries(allowed.filter((k) => k in req.body).map((k) => [k, req.body[k] === '' ? null : req.body[k]]));
  update('preboarding', p.id, data);
  res.json(detailFor(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

preboardingRouter.post('/:id/resend', (req, res) => {
  const p = get(`${SELECT} WHERE p.id = ?`, req.params.id);
  if (!p) throw httpError(404, 'Pre-boarding record not found');
  if (['converted', 'cancelled'].includes(p.status)) throw httpError(400, `This record is ${p.status}`);
  const token = newToken();
  update('preboarding', p.id, { token_hash: hashToken(token), expires_at: expiry() });
  sendInvite(p, token);
  audit(req.user.id, 'resend_link', 'preboarding', p.id);
  res.json({ ok: true, portal_url: portalUrl(token) });
});

preboardingRouter.post('/:id/cancel', (req, res) => {
  const p = get('SELECT * FROM preboarding WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Pre-boarding record not found');
  if (p.status === 'converted') throw httpError(400, 'Already converted to an employee');
  update('preboarding', p.id, { status: 'cancelled' });
  audit(req.user.id, 'cancel', 'preboarding', p.id);
  res.json({ ok: true });
});

preboardingRouter.get('/:id/documents/:docId/download', (req, res) => {
  const d = get('SELECT * FROM preboarding_documents WHERE id = ? AND preboarding_id = ?', req.params.docId, req.params.id);
  if (!d || !fs.existsSync(filePath(d.stored_name))) throw httpError(404, 'File not found');
  res.set({ 'Content-Type': d.mime_type, 'Content-Disposition': `inline; filename="${d.original_name.replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(filePath(d.stored_name)).pipe(res);
});

preboardingRouter.put('/:id/documents/:docId', (req, res) => {
  const p = get('SELECT * FROM preboarding WHERE id = ?', req.params.id);
  const d = p && get('SELECT * FROM preboarding_documents WHERE id = ? AND preboarding_id = ?', req.params.docId, p.id);
  if (!d) throw httpError(404, 'Document not found');
  const { status, note } = req.body;
  if (!['verified', 'rejected'].includes(status)) throw httpError(400, 'Status must be verified or rejected');
  if (status === 'rejected' && !String(note || '').trim()) throw httpError(400, 'Tell the new hire what to fix');
  update('preboarding_documents', d.id, { status, note: note || null });
  if (status === 'rejected') {
    if (p.status === 'submitted') update('preboarding', p.id, { status: 'in_progress' });
    queueEmail({
      to: p.email, toName: p.name, template: 'preboarding_fix', subject: 'Please re-upload a document',
      heading: 'One document needs another look',
      paragraphs: [`Your ${DOC[d.doc_type]?.label || d.doc_type} could not be accepted: ${note}`, 'Please upload a new copy using the same pre-boarding link we sent you.'],
    });
  }
  audit(req.user.id, `document_${status}`, 'preboarding', p.id, { doc_type: d.doc_type });
  res.json(detailFor(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

/** Day one: turn the pre-hire into an employee with everything they filled in. */
preboardingRouter.post('/:id/convert', (req, res) => {
  const p = get(`${SELECT} WHERE p.id = ?`, req.params.id);
  if (!p) throw httpError(404, 'Pre-boarding record not found');
  if (p.status === 'converted') throw httpError(400, 'Already converted');
  const docs = all('SELECT * FROM preboarding_documents WHERE preboarding_id = ?', p.id);
  const pr = progress(p, docs);
  if (p.status !== 'submitted') throw httpError(400, 'The new hire has not submitted their details yet');
  if (!pr.verified) throw httpError(400, 'Verify every required document first');
  const d = parse(p.details);
  const [first, ...rest] = p.name.split(/\s+/);
  const e = d.emergency || {};
  const employeeId = createEmployee({
    first_name: first, last_name: rest.join(' ') || '-', email: p.email, phone: d.personal?.phone || p.phone,
    department_id: p.department_id, designation_id: p.designation_id, location_id: p.location_id, manager_id: p.manager_id,
    buddy_id: p.buddy_id, template_id: p.template_id, date_of_joining: p.date_of_joining, annual_ctc: p.annual_ctc,
    date_of_birth: d.personal?.date_of_birth, gender: d.personal?.gender, marital_status: d.personal?.marital_status, blood_group: d.personal?.blood_group,
    address: [d.address?.current, d.address?.permanent && d.address.permanent !== d.address.current ? `Permanent: ${d.address.permanent}` : null].filter(Boolean).join('\n'),
    emergency_contact: [e.name, e.relation && `(${e.relation})`, e.phone].filter(Boolean).join(' '),
    pan: d.bank?.pan?.toUpperCase(), uan: d.bank?.uan, bank_name: d.bank?.bank_name, bank_account: d.bank?.account, ifsc: d.bank?.ifsc?.toUpperCase(),
  }, req.user.id);
  tx(() => {
    for (const doc of docs.filter((x) => x.status === 'verified')) {
      const docId = insert('documents', { title: DOC[doc.doc_type]?.label || doc.doc_type, category: 'Personal', employee_id: employeeId, content: 'Verified during pre-boarding' });
      insert('attachments', { entity: 'documents', entity_id: docId, stored_name: doc.stored_name, original_name: doc.original_name, mime_type: doc.mime_type, size: doc.size, uploaded_by: req.user.id });
      if (doc.doc_type === 'photo' && doc.mime_type.startsWith('image/')) {
        // The ID card photo gets its own copy so deleting the document never breaks the card.
        const copy = `${crypto.randomUUID()}${doc.stored_name.slice(doc.stored_name.lastIndexOf('.'))}`;
        fs.copyFileSync(filePath(doc.stored_name), `${UPLOAD_DIR}/${copy}`);
        run('UPDATE employees SET photo_file = ?, photo_type = ? WHERE id = ?', copy, doc.mime_type, employeeId);
      }
    }
    update('preboarding', p.id, { status: 'converted', employee_id: employeeId });
    if (p.candidate_id) run("UPDATE candidates SET stage = 'hired' WHERE id = ?", p.candidate_id);
  });
  if (p.buddy_id) notify(p.buddy_id, 'You are an onboarding buddy', `${p.name} joins on ${p.date_of_joining}. Help them settle in during their first weeks.`, `/employees/${employeeId}`);
  audit(req.user.id, 'convert', 'preboarding', p.id, { employee_id: employeeId });
  res.status(201).json({ employee_id: employeeId });
});

// ---------- the new hire's portal (public, token-protected) ----------
function byToken(token, { writable = true } = {}) {
  const p = get(`${SELECT} WHERE p.token_hash = ?`, hashToken(token));
  if (!p || p.status === 'cancelled') throw httpError(404, 'This link is not valid. Ask HR for a new one.');
  if (p.expires_at < new Date().toISOString()) throw httpError(410, 'This link has expired. Ask HR to resend it.');
  if (writable && ['submitted', 'converted'].includes(p.status)) throw httpError(400, p.status === 'converted' ? 'You have already joined — sign in to PeopleHub instead' : 'You have already submitted. HR will contact you if anything else is needed.');
  return p;
}

const publicView = (p) => {
  const d = detailFor(p);
  const offer = p.candidate_id && get("SELECT id, original_name FROM attachments WHERE entity = 'candidates' AND entity_id = ? AND mime_type = 'application/pdf' ORDER BY id DESC LIMIT 1", p.candidate_id);
  return {
    name: p.name, email: p.email, company: p.company, designation: p.designation, department: p.department, location: p.location,
    manager_name: p.manager_name, buddy_name: p.buddy_name, date_of_joining: p.date_of_joining, status: p.status,
    details: d.details, documents: d.documents, progress: d.progress, doc_types: DOC_TYPES,
    offer_letter: offer ? { name: offer.original_name } : null, offer_accepted_at: p.offer_accepted_at, offer_signature: p.offer_signature,
  };
};

joinRouter.get('/:token', (req, res) => res.json(publicView(byToken(req.params.token, { writable: false }))));

const clean = (o, keys, max = 200) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, String(o[k] ?? '').trim().slice(0, max)]));
joinRouter.put('/:token/details', (req, res) => {
  const p = byToken(req.params.token);
  const b = req.body || {};
  const cur = parse(p.details);
  const next = {
    personal: { ...cur.personal, ...clean(b.personal, ['date_of_birth', 'gender', 'marital_status', 'blood_group', 'phone', 'personal_email']) },
    address: { ...cur.address, ...clean(b.address, ['current', 'permanent'], 500) },
    emergency: { ...cur.emergency, ...clean(b.emergency, ['name', 'relation', 'phone']) },
    bank: { ...cur.bank, ...clean(b.bank, ['bank_name', 'account', 'ifsc', 'pan', 'uan']) },
    family: Array.isArray(b.family) ? b.family.slice(0, 10).map((f) => clean(f, ['name', 'relation', 'date_of_birth'])) : cur.family || [],
  };
  if (next.personal.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(next.personal.date_of_birth)) throw httpError(400, 'Date of birth is invalid');
  if (next.bank.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(next.bank.pan)) throw httpError(400, 'PAN should look like ABCDE1234F');
  if (next.bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(next.bank.ifsc)) throw httpError(400, 'IFSC should look like HDFC0001234');
  if (next.bank.account && !/^\d{6,18}$/.test(next.bank.account)) throw httpError(400, 'Bank account number should be 6–18 digits');
  update('preboarding', p.id, { details: JSON.stringify(next), status: 'in_progress' });
  res.json(publicView(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

joinRouter.post('/:token/documents', singleFile(), (req, res) => {
  let p;
  try {
    p = byToken(req.params.token);
    const type = DOC[req.body.doc_type];
    if (!type) throw httpError(400, 'Unknown document type');
    if (type.accept === 'image' && !req.file.mimetype.startsWith('image/')) throw httpError(415, 'Upload the photo as a PNG or JPEG image');
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(req.file.mimetype)) throw httpError(415, 'Upload a PDF or an image');
  } catch (err) {
    removeFile(req.file.filename);
    throw err;
  }
  const old = get('SELECT * FROM preboarding_documents WHERE preboarding_id = ? AND doc_type = ?', p.id, req.body.doc_type);
  if (old) { removeFile(old.stored_name); run('DELETE FROM preboarding_documents WHERE id = ?', old.id); }
  insert('preboarding_documents', {
    preboarding_id: p.id, doc_type: req.body.doc_type, stored_name: req.file.filename, original_name: req.file.originalname.slice(0, 200),
    mime_type: req.file.mimetype, size: req.file.size, status: 'pending',
  });
  if (p.status === 'invited') update('preboarding', p.id, { status: 'in_progress' });
  res.status(201).json(publicView(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

joinRouter.get('/:token/offer', (req, res) => {
  const p = byToken(req.params.token, { writable: false });
  const offer = p.candidate_id && get("SELECT * FROM attachments WHERE entity = 'candidates' AND entity_id = ? AND mime_type = 'application/pdf' ORDER BY id DESC LIMIT 1", p.candidate_id);
  if (!offer || !fs.existsSync(filePath(offer.stored_name))) throw httpError(404, 'No offer letter on file');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${offer.original_name.replace(/"/g, '')}"` });
  fs.createReadStream(filePath(offer.stored_name)).pipe(res);
});

/** Electronic acceptance: the new hire types their full name as a signature; time and IP are recorded. */
joinRouter.post('/:token/accept-offer', (req, res) => {
  const p = byToken(req.params.token);
  const sig = String(req.body?.signature || '').trim();
  if (sig.toLowerCase().replace(/\s+/g, ' ') !== p.name.toLowerCase().replace(/\s+/g, ' ')) throw httpError(400, `Type your full name exactly as "${p.name}" to sign`);
  update('preboarding', p.id, { offer_accepted_at: new Date().toISOString(), offer_signature: `${sig} · ${req.ip}`, status: 'in_progress' });
  notifyHR('Offer accepted', `${p.name} accepted the offer and signed electronically`, '/onboarding?tab=preboarding');
  res.json(publicView(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

joinRouter.post('/:token/submit', (req, res) => {
  const p = byToken(req.params.token);
  const docs = all('SELECT * FROM preboarding_documents WHERE preboarding_id = ?', p.id);
  const pr = progress(p, docs);
  if (pr.blockers.length) throw httpError(400, `Still needed: ${pr.blockers.join(', ')}`);
  update('preboarding', p.id, { status: 'submitted', submitted_at: new Date().toISOString() });
  notifyHR('Pre-boarding submitted', `${p.name} submitted their joining details — review and verify the documents`, '/onboarding?tab=preboarding');
  res.json(publicView(get(`${SELECT} WHERE p.id = ?`, p.id)));
});

// ---------- onboarding templates ----------
onboardingTemplatesRouter.get('/', (req, res) => {
  res.json(all(`SELECT t.*, d.name AS department FROM onboarding_templates t LEFT JOIN departments d ON d.id = t.department_id ORDER BY t.type, t.is_default DESC, t.name`)
    .map((t) => ({ ...t, is_default: !!t.is_default, tasks: all('SELECT * FROM onboarding_template_tasks WHERE template_id = ? ORDER BY sort, offset_days, id', t.id) })));
});

onboardingTemplatesRouter.use(HR);

function cleanTemplate(b, existing) {
  const name = String(b.name ?? existing?.name ?? '').trim();
  if (!name) throw httpError(400, 'Name is required');
  const type = ['onboarding', 'offboarding'].includes(b.type) ? b.type : existing?.type || 'onboarding';
  const tasks = Array.isArray(b.tasks) ? b.tasks.map((t, i) => {
    const title = String(t.title || '').trim();
    if (!title) throw httpError(400, 'Every task needs a title');
    const offset = Number(t.offset_days ?? 0);
    if (!Number.isInteger(offset) || offset < -60 || offset > 365) throw httpError(400, 'Due offsets must be whole days between -60 and 365');
    return { title: title.slice(0, 200), category: ['HR', 'IT', 'Manager', 'Buddy', 'Employee', 'Finance', 'Learning', 'Admin'].includes(t.category) ? t.category : 'HR', offset_days: offset, sort: i };
  }) : null;
  return { data: { name, type, department_id: b.department_id === undefined ? existing?.department_id ?? null : b.department_id || null }, tasks };
}

onboardingTemplatesRouter.post('/', (req, res) => {
  const { data, tasks } = cleanTemplate(req.body || {});
  if (get('SELECT id FROM onboarding_templates WHERE lower(name) = lower(?)', data.name)) throw httpError(409, 'A template with this name exists');
  const id = tx(() => {
    const tid = insert('onboarding_templates', { ...data, is_default: get('SELECT id FROM onboarding_templates WHERE type = ?', data.type) ? 0 : 1 });
    for (const t of tasks || []) insert('onboarding_template_tasks', { template_id: tid, ...t });
    return tid;
  });
  audit(req.user.id, 'create', 'onboarding_templates', id);
  res.status(201).json({ id });
});

onboardingTemplatesRouter.put('/:id', (req, res) => {
  const t = get('SELECT * FROM onboarding_templates WHERE id = ?', req.params.id);
  if (!t) throw httpError(404, 'Template not found');
  const { data, tasks } = cleanTemplate(req.body || {}, t);
  if (get('SELECT id FROM onboarding_templates WHERE lower(name) = lower(?) AND id != ?', data.name, t.id)) throw httpError(409, 'A template with this name exists');
  tx(() => {
    update('onboarding_templates', t.id, data);
    if (tasks) {
      run('DELETE FROM onboarding_template_tasks WHERE template_id = ?', t.id);
      for (const x of tasks) insert('onboarding_template_tasks', { template_id: t.id, ...x });
    }
  });
  audit(req.user.id, 'update', 'onboarding_templates', t.id);
  res.json({ ok: true });
});

onboardingTemplatesRouter.post('/:id/default', (req, res) => {
  const t = get('SELECT * FROM onboarding_templates WHERE id = ?', req.params.id);
  if (!t) throw httpError(404, 'Template not found');
  tx(() => { run('UPDATE onboarding_templates SET is_default = 0 WHERE type = ?', t.type); run('UPDATE onboarding_templates SET is_default = 1 WHERE id = ?', t.id); });
  res.json({ ok: true });
});

onboardingTemplatesRouter.delete('/:id', (req, res) => {
  const t = get('SELECT * FROM onboarding_templates WHERE id = ?', req.params.id);
  if (!t) throw httpError(404, 'Template not found');
  if (t.is_default && get('SELECT COUNT(*) AS n FROM onboarding_templates WHERE type = ?', t.type).n > 1) throw httpError(409, 'Make another template the default first');
  run('DELETE FROM onboarding_templates WHERE id = ?', t.id);
  audit(req.user.id, 'delete', 'onboarding_templates', t.id);
  res.json({ ok: true });
});

// ---------- the new joiner's view ----------
export function myOnboarding(req, res) {
  const id = Number(req.query.employee_id || req.user.id);
  if (id !== req.user.id && !isHR(req.user) && !canManage(req.user, id)) throw httpError(403, 'Not allowed');
  const e = get(`SELECT e.id, e.first_name, e.last_name, e.date_of_joining, e.probation_end_date, e.confirmation_status, g.title AS designation,
      m.id AS manager_id, ${NAME('m')} AS manager_name, m.email AS manager_email, m.avatar_color AS manager_color,
      b.id AS buddy_id, ${NAME('b')} AS buddy_name, b.email AS buddy_email, b.avatar_color AS buddy_color
    FROM employees e LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN employees m ON m.id = e.manager_id LEFT JOIN employees b ON b.id = e.buddy_id WHERE e.id = ?`, id);
  if (!e) throw httpError(404, 'Employee not found');
  const tasks = all("SELECT * FROM onboarding_tasks WHERE employee_id = ? AND type = 'onboarding' ORDER BY due_date, id", id);
  const day = Math.floor((new Date(`${today()}T00:00:00`) - new Date(`${e.date_of_joining}T00:00:00`)) / 86400000) + 1;
  const docs = get("SELECT COUNT(*) AS n FROM documents WHERE employee_id = ?", id).n;
  const acks = get("SELECT COUNT(*) AS pending FROM documents d WHERE d.requires_ack = 1 AND d.employee_id IS NULL AND NOT EXISTS (SELECT 1 FROM document_acks a WHERE a.document_id = d.id AND a.employee_id = ?)", id).pending;
  const training = get("SELECT COUNT(*) AS n FROM enrollments WHERE employee_id = ? AND status != 'completed'", id)?.n ?? 0;
  res.json({ employee: e, day, tasks, done: tasks.filter((t) => t.done).length, documents: docs, pending_policy_acks: acks, pending_training: training });
}

export function setBuddy(req, res) {
  const emp = get('SELECT id, first_name, last_name, manager_id FROM employees WHERE id = ?', Number(req.body.employee_id));
  if (!emp) throw httpError(404, 'Employee not found');
  if (!isHR(req.user) && emp.manager_id !== req.user.id) throw httpError(403, 'Only HR or the manager can assign a buddy');
  const buddy = req.body.buddy_id ? get("SELECT id FROM employees WHERE id = ? AND status != 'exited'", Number(req.body.buddy_id)) : null;
  if (req.body.buddy_id && !buddy) throw httpError(400, 'Choose an active employee as buddy');
  if (buddy?.id === emp.id) throw httpError(400, 'Someone cannot be their own buddy');
  update('employees', emp.id, { buddy_id: buddy?.id ?? null });
  if (buddy) notify(buddy.id, 'You are an onboarding buddy', `Help ${emp.first_name} ${emp.last_name} settle in during their first weeks.`, `/employees/${emp.id}`);
  audit(req.user.id, 'set_buddy', 'employees', emp.id, { buddy_id: buddy?.id ?? null });
  res.json({ ok: true });
}
