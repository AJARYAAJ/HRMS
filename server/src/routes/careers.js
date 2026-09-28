import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, insert, update, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit, httpError, notify, notifyHR, today } from '../utils.js';
import { singleFile, removeFile, UPLOAD_DIR } from '../uploads.js';
import { queueEmail } from '../mailer.js';
import { buildPdf } from '../pdf.js';
import { renderTemplate } from './hrdocs.js';

/** Public (unauthenticated) careers site API. */
export const careersRouter = Router();
/** Authenticated: offer letters for candidates. */
export const offersRouter = Router();

const setting = (k, d) => get('SELECT value FROM settings WHERE key = ?', k)?.value || d;

const JOB_SELECT = `SELECT j.id, j.title, j.employment_type, j.experience, j.openings, j.description, j.created_at,
  d.name AS department, l.name AS location, l.city
  FROM job_openings j LEFT JOIN departments d ON d.id = j.department_id LEFT JOIN locations l ON l.id = j.location_id`;

careersRouter.get('/', (req, res) => {
  res.json({
    company: { name: setting('company_name', 'Our company'), short: setting('company_short', ''), email: setting('company_email', ''), address: setting('company_address', '') },
    jobs: all(`${JOB_SELECT} WHERE j.status = 'open' ORDER BY j.id DESC`),
  });
});

careersRouter.get('/jobs/:id', (req, res) => {
  const job = get(`${JOB_SELECT} WHERE j.id = ? AND j.status = 'open'`, req.params.id);
  if (!job) throw httpError(404, 'This position is no longer open');
  res.json(job);
});

// Simple in-memory rate limit per IP (applications are low volume; this blunts scripted spam).
const hits = new Map();
function rateLimit(req) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= Number(process.env.CAREERS_RATE_LIMIT || 10)) throw httpError(429, 'Too many applications from this network. Please try again later.');
  recent.push(now);
  hits.set(key, recent);
}

careersRouter.post('/jobs/:id/apply', singleFile(), (req, res) => {
  const cleanup = () => removeFile(req.file.filename);
  try {
    rateLimit(req);
    const job = get(`${JOB_SELECT} WHERE j.id = ? AND j.status = 'open'`, req.params.id);
    if (!job) throw httpError(404, 'This position is no longer open');
    const b = req.body;
    // Honeypot: real users never see or fill this field.
    if (b.website) throw httpError(400, 'Invalid submission');
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (name.length < 2) throw httpError(400, 'Please enter your full name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Please enter a valid email address');
    if (!['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(req.file.mimetype)) {
      throw httpError(415, 'Please upload your resume as PDF or Word');
    }
    if (get('SELECT id FROM candidates WHERE job_id = ? AND lower(email) = ?', job.id, email)) throw httpError(409, 'You have already applied for this position');
    const hiringManager = get('SELECT hiring_manager_id FROM job_openings WHERE id = ?', job.id)?.hiring_manager_id;
    const id = tx(() => {
      const cid = insert('candidates', {
        job_id: job.id, name, email, phone: b.phone || null, source: 'Careers Page', stage: 'applied', rating: 0,
        experience_years: b.experience_years ? Number(b.experience_years) : null, current_company: b.current_company || null,
        expected_ctc: b.expected_ctc ? Number(String(b.expected_ctc).replace(/[,₹\s]/g, '')) || null : null,
        notes: b.cover_letter ? `Cover letter: ${String(b.cover_letter).slice(0, 3000)}` : null,
      });
      insert('attachments', {
        entity: 'candidates', entity_id: cid, stored_name: req.file.filename, original_name: req.file.originalname.slice(0, 200),
        mime_type: req.file.mimetype, size: req.file.size, uploaded_by: null,
      });
      return cid;
    });
    const msg = `${name} applied for ${job.title}`;
    if (hiringManager) notify(hiringManager, 'New application', msg, '/recruitment', { email: false });
    notifyHR('New application from the careers page', msg, '/recruitment');
    const company = setting('company_name', 'our company');
    queueEmail({
      to: email, toName: name, template: 'application_received', subject: `We received your application for ${job.title}`,
      heading: 'Thanks for applying!', greeting: `Hi ${name.split(' ')[0]},`,
      paragraphs: [`Thank you for your interest in the ${job.title} role at ${company}. Our team reviews every application and will get back to you if your profile matches what we're looking for.`],
      details: [['Position', job.title], ['Location', job.location || '—'], ['Application ID', `APP-${String(id).padStart(5, '0')}`]],
    });
    res.status(201).json({ ok: true, application_id: `APP-${String(id).padStart(5, '0')}` });
  } catch (err) {
    cleanup();
    throw err;
  }
});

// ---------- offer letters ----------
const inr = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

offersRouter.post('/:candidateId', requireRole('admin', 'hr'), (req, res) => {
  const c = get(`SELECT c.*, j.title AS job_title FROM candidates c LEFT JOIN job_openings j ON j.id = c.job_id WHERE c.id = ?`, req.params.candidateId);
  if (!c) throw httpError(404, 'Candidate not found');
  const ctc = Number(req.body.offered_ctc);
  const joining = req.body.joining_date;
  if (!(ctc > 0)) throw httpError(400, 'Enter the offered annual CTC');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joining || '') || joining < today()) throw httpError(400, 'Joining date must be today or later');
  const template = req.body.template_id
    ? get('SELECT * FROM letter_templates WHERE id = ?', req.body.template_id)
    : get("SELECT * FROM letter_templates WHERE type = 'offer' ORDER BY id LIMIT 1");
  if (!template) throw httpError(400, 'Create an offer letter template first (Documents → Letters)');
  const company = { name: setting('company_name', ''), address: setting('company_address', '') };
  const body = renderTemplate(template.body, {
    candidate_name: c.name, job_title: c.job_title || '', offered_ctc: inr(ctc), joining_date: longDate(joining),
    company_name: company.name, company_address: company.address, today: longDate(today()),
  });
  const pdf = buildPdf({ title: template.name, company: company.name, address: company.address, body, footer: `${company.name} · Offer ref OFR-${c.id}` });
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), pdf);
  const filename = `Offer-Letter-${c.name.replace(/[^a-z0-9]+/gi, '-')}.pdf`;
  tx(() => {
    insert('attachments', { entity: 'candidates', entity_id: c.id, stored_name: stored, original_name: filename, mime_type: 'application/pdf', size: pdf.length, uploaded_by: req.user.id });
    update('candidates', c.id, { stage: 'offer', expected_ctc: ctc });
  });
  if (req.body.send_email !== false && c.email) {
    queueEmail({
      to: c.email, toName: c.name, template: 'offer_letter', subject: `Offer letter: ${c.job_title || 'your new role'} at ${company.name}`,
      heading: 'Congratulations! 🎉', greeting: `Dear ${c.name.split(' ')[0]},`,
      paragraphs: [`We are delighted to offer you the position of ${c.job_title || 'our team member'}. Your offer letter is attached — please review it and reply to confirm your acceptance.`],
      details: [['Annual CTC', `₹${ctc.toLocaleString('en-IN')}`], ['Joining date', longDate(joining)]],
      attachments: [{ filename, storedName: stored }],
    });
  }
  audit(req.user.id, 'send_offer', 'candidates', c.id, { ctc, joining });
  res.status(201).json({ ok: true, filename });
});

