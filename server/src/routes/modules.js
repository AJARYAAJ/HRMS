import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR, canManage } from '../auth.js';
import { crud } from '../crud.js';
import { httpError, audit, notify, notifyHR, today } from '../utils.js';
import { expenseCategoriesFor } from '../policies.js';
import { AUDIENCES, parseIds, inAudience, audienceEmployees } from './docs.js';
import { createEmployee } from './employees.js';
import { singleFile, removeFile, deleteAttachmentsFor } from '../uploads.js';
import { saveAttachment } from './attachments.js';
import { queueEmail } from '../mailer.js';
import { pushPublicKey, validEndpoint, sendPush } from '../push.js';

const EMP_NAME = (alias) => `${alias}.first_name || ' ' || ${alias}.last_name`;

// ---------- organisation ----------
export const departmentsRouter = crud({
  table: 'departments', label: 'department', fields: ['name', 'code', 'head_id', 'description'], readAll: true, order: 't.name',
  select: `SELECT t.*, ${EMP_NAME('h')} AS head_name,
           (SELECT COUNT(*) FROM employees e WHERE e.department_id = t.id AND e.status != 'exited') AS headcount
           FROM departments t LEFT JOIN employees h ON h.id = t.head_id`,
});
export const companiesRouter = crud({
  table: 'companies', label: 'company', readAll: true, order: 't.name',
  fields: ['name', 'legal_name', 'pan', 'tan', 'gstin', 'pf_code', 'esi_code', 'address', 'city', 'state'],
  select: `SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.company_id = t.id AND e.status != 'exited') AS headcount FROM companies t`,
  validate(data, user, existing) {
    if (!existing && !data.name) throw httpError(400, 'Company name is required');
    return data;
  },
});

export const designationsRouter = crud({
  table: 'designations', label: 'designation', fields: ['title', 'level'], readAll: true, order: 't.title',
  select: `SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.designation_id = t.id AND e.status != 'exited') AS headcount FROM designations t`,
});
export const locationsRouter = crud({
  table: 'locations', label: 'location', fields: ['name', 'city', 'state', 'address', 'latitude', 'longitude', 'radius_m'], readAll: true, order: 't.name',
  select: `SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.location_id = t.id AND e.status != 'exited') AS headcount FROM locations t`,
});

// ---------- recruitment ----------
export const jobsRouter = crud({
  table: 'job_openings', label: 'job opening',
  fields: ['title', 'department_id', 'location_id', 'employment_type', 'experience', 'openings', 'status', 'description', 'hiring_manager_id'],
  readAll: true, filters: ['status', 'department_id'], search: ['t.title'],
  select: `SELECT t.*, d.name AS department, l.name AS location, ${EMP_NAME('m')} AS hiring_manager,
           (SELECT COUNT(*) FROM candidates c WHERE c.job_id = t.id) AS applicants,
           (SELECT COUNT(*) FROM candidates c WHERE c.job_id = t.id AND c.stage = 'hired') AS hired
           FROM job_openings t LEFT JOIN departments d ON d.id = t.department_id
           LEFT JOIN locations l ON l.id = t.location_id LEFT JOIN employees m ON m.id = t.hiring_manager_id`,
});

const candidatesCrud = crud({
  table: 'candidates', label: 'candidate',
  afterDelete: (row) => deleteAttachmentsFor('candidates', row.id),
  fields: ['job_id', 'name', 'email', 'phone', 'source', 'stage', 'rating', 'experience_years', 'current_company', 'expected_ctc', 'notes'],
  write: ['admin', 'hr', 'manager'], readAll: true, filters: ['job_id', 'stage'], search: ['t.name', 't.email', 't.current_company'],
  select: `SELECT t.*, j.title AS job_title, (SELECT COUNT(*) FROM attachments x WHERE x.entity = 'candidates' AND x.entity_id = t.id) AS attachment_count FROM candidates t LEFT JOIN job_openings j ON j.id = t.job_id`,
});
export const candidatesRouter = Router();
candidatesRouter.use((req, res, next) => (req.user.role === 'employee' ? res.status(403).json({ error: 'Recruitment is restricted to managers and HR' }) : next()));

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
candidatesRouter.put('/:id/stage', (req, res) => {
  const { stage } = req.body;
  if (!STAGES.includes(stage)) throw httpError(400, 'Invalid stage');
  const cand = get('SELECT * FROM candidates WHERE id = ?', req.params.id);
  if (!cand) throw httpError(404, 'Candidate not found');
  update('candidates', cand.id, { stage });
  audit(req.user.id, 'move_stage', 'candidates', cand.id, { from: cand.stage, to: stage });
  res.json(get('SELECT * FROM candidates WHERE id = ?', cand.id));
});

// Convert an accepted offer into an employee record with an onboarding checklist.
candidatesRouter.post('/:id/hire', requireRole('admin', 'hr'), (req, res) => {
  const cand = get('SELECT c.*, j.department_id, j.location_id, j.hiring_manager_id, j.title FROM candidates c LEFT JOIN job_openings j ON j.id = c.job_id WHERE c.id = ?', req.params.id);
  if (!cand) throw httpError(404, 'Candidate not found');
  const [first, ...rest] = cand.name.trim().split(/\s+/);
  const desig = get('SELECT id FROM designations WHERE title = ?', cand.title);
  const id = createEmployee({
    first_name: first, last_name: rest.join(' ') || '-', email: req.body.email || cand.email, phone: cand.phone,
    department_id: cand.department_id, location_id: cand.location_id, manager_id: cand.hiring_manager_id,
    designation_id: desig?.id, date_of_joining: req.body.date_of_joining || today(), annual_ctc: req.body.annual_ctc ?? cand.expected_ctc,
  }, req.user.id);
  update('candidates', cand.id, { stage: 'hired' });
  const job = get('SELECT * FROM job_openings WHERE id = ?', cand.job_id);
  if (job) {
    const hired = get("SELECT COUNT(*) AS n FROM candidates WHERE job_id = ? AND stage = 'hired'", job.id).n;
    if (hired >= job.openings) update('job_openings', job.id, { status: 'closed' });
  }
  res.status(201).json({ employee_id: id });
});
candidatesRouter.use('/', candidatesCrud);

export const interviewsRouter = crud({
  table: 'interviews', label: 'interview',
  fields: ['candidate_id', 'interviewer_id', 'round', 'scheduled_at', 'mode', 'status', 'rating', 'feedback'],
  write: ['admin', 'hr', 'manager'], readAll: true, filters: ['candidate_id', 'interviewer_id', 'status'], order: 't.scheduled_at DESC',
  select: `SELECT t.*, c.name AS candidate_name, j.title AS job_title, ${EMP_NAME('i')} AS interviewer_name
           FROM interviews t JOIN candidates c ON c.id = t.candidate_id LEFT JOIN job_openings j ON j.id = c.job_id
           LEFT JOIN employees i ON i.id = t.interviewer_id`,
  afterCreate(id, data) {
    const c = get('SELECT c.name, c.email, j.title FROM candidates c LEFT JOIN job_openings j ON j.id = c.job_id WHERE c.id = ?', data.candidate_id);
    const when = data.scheduled_at?.replace('T', ' ');
    notify(data.interviewer_id, 'Interview scheduled', `${data.round || 'Interview'} with ${c?.name} at ${when}`, '/recruitment');
    // Invite the candidate too (they have no account, so this is email only).
    if (c?.email) {
      const company = get("SELECT value FROM settings WHERE key = 'company_name'")?.value || 'our company';
      queueEmail({
        to: c.email, toName: c.name, template: 'interview_invite',
        subject: `Interview invitation: ${c.title || 'your application'} at ${company}`,
        heading: 'You are invited to interview',
        greeting: `Hi ${c.name.split(' ')[0]},`,
        paragraphs: [`Thank you for applying for the ${c.title || 'open'} role. We'd love to speak with you.`],
        details: [['Round', data.round || 'Interview'], ['When', when], ['Mode', data.mode || 'Video']],
        footnote: 'Reply to this email if you need to reschedule.',
      });
    }
    run("UPDATE candidates SET stage = 'interview' WHERE id = ? AND stage IN ('applied','screening')", data.candidate_id);
  },
});

// ---------- onboarding ----------
export const onboardingRouter = Router();
onboardingRouter.get('/', (req, res) => {
  const type = req.query.type || 'onboarding';
  const mineOnly = !isHR(req.user) || req.query.mine === '1';
  const rows = all(
    `SELECT t.*, ${EMP_NAME('e')} AS employee_name, e.avatar_color, e.date_of_joining, e.exit_date, g.title AS designation
     FROM onboarding_tasks t JOIN employees e ON e.id = t.employee_id LEFT JOIN designations g ON g.id = e.designation_id
     WHERE t.type = ? ${mineOnly ? 'AND t.employee_id = ?' : ''} ORDER BY e.id DESC, t.due_date`,
    ...(mineOnly ? [type, req.user.id] : [type]),
  );
  res.json(rows);
});
onboardingRouter.put('/:id', (req, res) => {
  const task = get('SELECT * FROM onboarding_tasks WHERE id = ?', req.params.id);
  if (!task) throw httpError(404, 'Task not found');
  if (!isHR(req.user) && task.employee_id !== req.user.id && !canManage(req.user, task.employee_id)) throw httpError(403, 'Not allowed');
  update('onboarding_tasks', task.id, { done: req.body.done ? 1 : 0, done_at: req.body.done ? new Date().toISOString() : null, done_by: req.body.done ? req.user.id : null });
  const pending = get("SELECT COUNT(*) AS n FROM onboarding_tasks WHERE employee_id = ? AND type = ? AND done = 0", task.employee_id, task.type).n;
  if (task.type === 'offboarding' && pending === 0) update('employees', task.employee_id, { status: 'exited' });
  res.json(get('SELECT * FROM onboarding_tasks WHERE id = ?', task.id));
});
onboardingRouter.post('/', requireRole('admin', 'hr'), (req, res) => {
  const { employee_id, title, category, due_date, type = 'onboarding' } = req.body;
  if (!employee_id || !title) throw httpError(400, 'Employee and title are required');
  const id = insert('onboarding_tasks', { employee_id, title, category, due_date, type, done: 0 });
  res.status(201).json(get('SELECT * FROM onboarding_tasks WHERE id = ?', id));
});

// ---------- performance ----------
export const goalsRouter = crud({
  table: 'goals', label: 'goal',
  fields: ['employee_id', 'title', 'description', 'category', 'cycle', 'progress', 'weight', 'due_date', 'status'],
  owner: 'employee_id', selfService: true, write: ['admin', 'hr', 'manager'], filters: ['employee_id', 'cycle', 'status'],
  order: 't.due_date',
  select: `SELECT t.*, ${EMP_NAME('e')} AS employee_name, e.avatar_color FROM goals t JOIN employees e ON e.id = t.employee_id`,
  validate(data, user) {
    if (data.progress !== undefined) data.progress = Math.max(0, Math.min(100, Number(data.progress)));
    if (data.progress === 100) data.status = 'completed';
    if (user.role === 'manager' && data.employee_id && !canManage(user, data.employee_id) && Number(data.employee_id) !== user.id) {
      throw httpError(403, 'You can only set goals for your team');
    }
    return data;
  },
});

export const reviewsRouter = Router();
const REVIEW_SELECT = `SELECT t.*, ${EMP_NAME('e')} AS employee_name, e.avatar_color, ${EMP_NAME('r')} AS reviewer_name, g.title AS designation
  FROM reviews t JOIN employees e ON e.id = t.employee_id LEFT JOIN employees r ON r.id = t.reviewer_id LEFT JOIN designations g ON g.id = e.designation_id`;
reviewsRouter.get('/', (req, res) => {
  const where = isHR(req.user) ? '1=1' : 't.employee_id = ? OR t.reviewer_id = ?';
  const params = isHR(req.user) ? [] : [req.user.id, req.user.id];
  const cycle = req.query.cycle ? ' AND t.cycle = ?' : '';
  res.json(all(`${REVIEW_SELECT} WHERE (${where})${cycle} ORDER BY t.id DESC`, ...params, ...(req.query.cycle ? [req.query.cycle] : [])));
});
reviewsRouter.post('/launch', requireRole('admin', 'hr'), (req, res) => {
  const { cycle } = req.body;
  if (!cycle) throw httpError(400, 'Review cycle name is required');
  const emps = all("SELECT id, manager_id FROM employees WHERE status = 'active'");
  let created = 0;
  tx(() => {
    for (const e of emps) {
      if (get('SELECT id FROM reviews WHERE employee_id = ? AND cycle = ?', e.id, cycle)) continue;
      insert('reviews', { employee_id: e.id, reviewer_id: e.manager_id, cycle, status: 'self_review' });
      notify(e.id, `Performance review: ${cycle}`, 'Your self-assessment is open.', '/performance');
      created++;
    }
    audit(req.user.id, 'launch_review', 'reviews', null, { cycle, created });
  });
  res.status(201).json({ created });
});
reviewsRouter.put('/:id', (req, res) => {
  const r = get('SELECT * FROM reviews WHERE id = ?', req.params.id);
  if (!r) throw httpError(404, 'Review not found');
  const data = {};
  if (r.employee_id === req.user.id && r.status === 'self_review') {
    Object.assign(data, { self_rating: req.body.self_rating, self_comments: req.body.self_comments });
    if (req.body.submit) data.status = 'manager_review';
  } else if ((r.reviewer_id === req.user.id || isHR(req.user)) && ['manager_review', 'self_review'].includes(r.status)) {
    Object.assign(data, { manager_rating: req.body.manager_rating, strengths: req.body.strengths, improvements: req.body.improvements });
    if (req.body.submit) {
      data.status = 'completed';
      notify(r.employee_id, 'Performance review completed', `Your ${r.cycle} review has been finalized.`, '/performance');
    }
  } else throw httpError(403, 'This review is not editable by you at its current stage');
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  update('reviews', r.id, data);
  res.json(get(`${REVIEW_SELECT} WHERE t.id = ?`, r.id));
});

export const kudosRouter = Router();
kudosRouter.get('/', (req, res) => {
  res.json(all(
    `SELECT k.*, ${EMP_NAME('f')} AS from_name, f.avatar_color AS from_color, ${EMP_NAME('t')} AS to_name, t.avatar_color AS to_color
     FROM kudos k JOIN employees f ON f.id = k.from_id JOIN employees t ON t.id = k.to_id ORDER BY k.id DESC LIMIT ?`,
    Number(req.query.limit) || 50,
  ));
});
kudosRouter.post('/', (req, res) => {
  const { to_id, badge, message } = req.body;
  if (!to_id || !message) throw httpError(400, 'Recipient and message are required');
  if (Number(to_id) === req.user.id) throw httpError(400, 'You cannot send kudos to yourself');
  const id = insert('kudos', { from_id: req.user.id, to_id, badge, message });
  notify(Number(to_id), `${req.user.first_name} sent you kudos 🎉`, message, '/engage');
  res.status(201).json(get('SELECT * FROM kudos WHERE id = ?', id));
});

// ---------- expenses, projects, timesheets ----------
export const expensesRouter = crud({
  table: 'expenses', label: 'expense claim', link: '/expenses',
  afterDelete: (row) => deleteAttachmentsFor('expenses', row.id),
  fields: ['employee_id', 'category', 'amount', 'date', 'description', 'distance_km', 'days'],
  owner: 'employee_id', selfService: true, approval: true, filters: ['status', 'employee_id', 'category'], dateField: 'date',
  select: `SELECT t.*, ${EMP_NAME('e')} AS employee_name, e.avatar_color, ${EMP_NAME('a')} AS approver_name,
           (SELECT COUNT(*) FROM attachments x WHERE x.entity = 'expenses' AND x.entity_id = t.id) AS attachment_count
           FROM expenses t JOIN employees e ON e.id = t.employee_id LEFT JOIN employees a ON a.id = t.approver_id`,
  validate(data, user, existing) {
    if (data.date && data.date > today()) throw httpError(400, 'Expense date cannot be in the future');
    const m = { ...existing, ...data };
    const ownerId = m.employee_id ?? user.id;
    const { policy, categories } = expenseCategoriesFor(ownerId);
    const cat = policy && categories.find((c) => c.name === m.category);
    if (policy && !cat) throw httpError(400, `"${m.category}" is not a category in your expense policy (${policy.name})`);
    const out = { ...data };
    if (cat?.kind === 'mileage') {
      const km = Number(m.distance_km);
      if (!(km > 0)) throw httpError(400, 'Enter the distance travelled in km');
      out.distance_km = km; out.days = null; out.amount = Math.round(km * cat.rate * 100) / 100;
    } else if (cat?.kind === 'per_diem') {
      const days = Number(m.days);
      if (!(days > 0 && days <= 60)) throw httpError(400, 'Enter the number of days (up to 60)');
      out.days = days; out.distance_km = null; out.amount = Math.round(days * cat.rate * 100) / 100;
    } else {
      if (m.amount === undefined || !(Number(m.amount) > 0)) throw httpError(400, 'Amount must be greater than zero');
      out.distance_km = null; out.days = null;
    }
    const amount = Number(out.amount ?? m.amount);
    if (cat) {
      if (cat.per_claim_limit && amount > cat.per_claim_limit) throw httpError(400, `${cat.name} claims are limited to ₹${cat.per_claim_limit} each`);
      if (cat.monthly_limit && m.date) {
        const used = get(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE employee_id = ? AND category = ? AND substr(date, 1, 7) = ?
          AND status NOT IN ('rejected') AND id != ?`, ownerId, cat.name, m.date.slice(0, 7), existing?.id ?? 0).v;
        if (used + amount > cat.monthly_limit) throw httpError(400, `This exceeds your monthly ${cat.name} limit of ₹${cat.monthly_limit} (₹${Math.round(used)} already claimed)`);
      }
      out.receipt_required = cat.receipt_above != null && amount > cat.receipt_above ? 1 : 0;
    }
    return out;
  },
  onDecision(row, status) {
    if (status === 'approved' && row.receipt_required && !get("SELECT id FROM attachments WHERE entity = 'expenses' AND entity_id = ?", row.id)) {
      throw httpError(400, 'A receipt is required for this claim under the expense policy; ask the employee to attach it first');
    }
  },
  afterCreate(id, data) {
    const emp = get('SELECT manager_id, first_name FROM employees WHERE id = ?', data.employee_id);
    notify(emp?.manager_id, 'Expense claim submitted', `${emp.first_name} claimed ₹${data.amount} for ${data.category}`, '/approvals');
  },
});

export const timesheetsRouter = crud({
  table: 'timesheets', label: 'timesheet entry', link: '/timesheets',
  fields: ['employee_id', 'project_id', 'date', 'hours', 'task', 'billable'],
  owner: 'employee_id', selfService: true, approval: true, filters: ['status', 'employee_id', 'project_id'], dateField: 'date',
  order: 't.date DESC, t.id DESC',
  select: `SELECT t.*, p.name AS project_name, ${EMP_NAME('e')} AS employee_name, e.avatar_color
           FROM timesheets t JOIN employees e ON e.id = t.employee_id LEFT JOIN projects p ON p.id = t.project_id`,
  validate(data) {
    if (data.hours !== undefined && !(Number(data.hours) > 0 && Number(data.hours) <= 24)) throw httpError(400, 'Hours must be between 0 and 24');
    return data;
  },
});

// ---------- assets & helpdesk ----------
export const ticketsRouter = crud({
  table: 'tickets', label: 'ticket',
  afterDelete: (row) => deleteAttachmentsFor('tickets', row.id),
  fields: ['employee_id', 'category', 'subject', 'description', 'priority', 'status', 'assignee_id', 'resolution'],
  owner: 'employee_id', selfService: true, filters: ['status', 'priority', 'category', 'employee_id'], search: ['t.subject'],
  select: `SELECT t.*, ${EMP_NAME('e')} AS employee_name, e.avatar_color, ${EMP_NAME('a')} AS assignee_name,
           (SELECT COUNT(*) FROM attachments x WHERE x.entity = 'tickets' AND x.entity_id = t.id) AS attachment_count
           FROM tickets t JOIN employees e ON e.id = t.employee_id LEFT JOIN employees a ON a.id = t.assignee_id`,
  validate(data, user, existing) {
    if (!existing && !data.subject) throw httpError(400, 'Subject is required');
    if (existing && data.status && data.status !== existing.status && !['admin', 'hr'].includes(user.role)) delete data.status;
    if (existing && data.status && data.status !== existing.status) {
      notify(existing.employee_id, `Ticket #${existing.id} is now ${data.status.replace('_', ' ')}`, existing.subject, '/helpdesk');
    }
    return data;
  },
  afterCreate(id, data) {
    notifyHR('New helpdesk ticket', `#${id} ${data.subject}`, '/helpdesk');
  },
});

// ---------- engagement, learning, documents ----------
export const announcementsRouter = crud({
  table: 'announcements', label: 'announcement', fields: ['title', 'body', 'category', 'pinned'], readAll: true,
  order: 't.pinned DESC, t.id DESC',
  select: `SELECT t.*, ${EMP_NAME('e')} AS author_name, e.avatar_color FROM announcements t LEFT JOIN employees e ON e.id = t.author_id`,
  validate(data, user, existing) {
    if (!existing) data.author_id = user.id;
    return data;
  },
  afterCreate(id, data) {
    for (const { id: eid } of all("SELECT id FROM employees WHERE status != 'exited'")) notify(eid, `📣 ${data.title}`, data.body?.slice(0, 120), '/engage');
  },
});

export const coursesRouter = crud({
  table: 'courses', label: 'course', fields: ['title', 'category', 'duration_hours', 'mandatory', 'description'], readAll: true, order: 't.mandatory DESC, t.title',
  select: `SELECT t.*, (SELECT COUNT(*) FROM enrollments n WHERE n.course_id = t.id) AS enrolled,
           (SELECT COUNT(*) FROM enrollments n WHERE n.course_id = t.id AND n.status = 'completed') AS completed FROM courses t`,
});

export const enrollmentsRouter = crud({
  table: 'enrollments', label: 'enrollment', fields: ['course_id', 'employee_id', 'progress', 'status'],
  owner: 'employee_id', selfService: true, filters: ['employee_id', 'course_id', 'status'],
  select: `SELECT t.*, c.title AS course_title, c.category, c.duration_hours, c.mandatory, ${EMP_NAME('e')} AS employee_name
           FROM enrollments t JOIN courses c ON c.id = t.course_id JOIN employees e ON e.id = t.employee_id`,
  validate(data, user, existing) {
    if (!existing && get('SELECT id FROM enrollments WHERE course_id = ? AND employee_id = ?', data.course_id, data.employee_id ?? user.id)) {
      throw httpError(409, 'Already enrolled in this course');
    }
    if (data.progress !== undefined) {
      data.progress = Math.max(0, Math.min(100, Number(data.progress)));
      data.status = data.progress >= 100 ? 'completed' : data.progress > 0 ? 'in_progress' : 'enrolled';
    }
    return data;
  },
});

export const documentsRouter = Router();
const DOC_SELECT = `SELECT d.*, ${EMP_NAME('e')} AS employee_name,
    f.id AS file_id, f.original_name AS file_name, f.mime_type AS file_type, f.size AS file_size
  FROM documents d LEFT JOIN employees e ON e.id = d.employee_id
  LEFT JOIN attachments f ON f.id = (SELECT MAX(id) FROM attachments WHERE entity = 'documents' AND entity_id = d.id)`;
documentsRouter.get('/', (req, res) => {
  const personal = isHR(req.user) && req.query.employee_id ? Number(req.query.employee_id) : req.user.id;
  const rows = all(
    `${DOC_SELECT} WHERE d.employee_id IS NULL OR d.employee_id = ? ${isHR(req.user) && req.query.all ? 'OR 1=1' : ''} ORDER BY d.employee_id IS NOT NULL, d.id DESC`,
    personal,
  );
  const mine = new Set(all('SELECT document_id FROM document_acks WHERE employee_id = ?', req.user.id).map((r) => r.document_id));
  const hr = isHR(req.user);
  const me = get('SELECT * FROM employees WHERE id = ?', req.user.id);
  const visible = hr ? rows : rows.filter((d) => inAudience(d, me));
  res.json(visible.map((d) => {
    const out = { ...d, audience_ids: parseIds(d.audience_ids), acknowledged: mine.has(d.id), requires_signature: !!d.requires_signature };
    if (hr && d.requires_ack) {
      const aud = d.employee_id ? [d.employee_id] : audienceEmployees(d);
      out.ack_total = aud.length;
      out.ack_count = aud.length ? get(`SELECT COUNT(*) AS n FROM document_acks WHERE document_id = ? AND employee_id IN (${aud.join(',')})`, d.id).n : 0;
    }
    return out;
  }));
});
// HR publishes company-wide or personal documents; employees may upload their own personal documents (KYC, certificates).
documentsRouter.post('/', singleFile(false), (req, res) => {
  const { title, category, content } = req.body;
  const audienceType = AUDIENCES.includes(req.body.audience_type) ? req.body.audience_type : 'all';
  const audienceIds = parseIds(req.body.audience_ids);
  const docType = req.body.doc_type_id ? get('SELECT * FROM document_types WHERE id = ?', Number(req.body.doc_type_id)) : null;
  const dateOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!dateOk(req.body.expires_on) || !dateOk(req.body.review_on)) {
    if (req.file) removeFile(req.file.filename);
    throw httpError(400, 'Dates must be YYYY-MM-DD');
  }
  const requiresAck = isHR(req.user) && ['1', 'true', 'on'].includes(String(req.body.requires_ack)) ? 1 : 0;
  const hr = isHR(req.user);
  const employeeId = hr ? (req.body.employee_id ? Number(req.body.employee_id) : null) : req.user.id;
  const docTitle = title || docType?.name;
  if (!docTitle) {
    if (req.file) removeFile(req.file.filename);
    throw httpError(400, 'Title is required');
  }
  if (!req.file && !content) throw httpError(400, 'Attach a file or enter the document content');
  let id;
  try {
    id = tx(() => {
      const docId = insert('documents', {
        title: docTitle, category: category || docType?.category || (hr ? 'Policy' : 'Personal'), employee_id: employeeId, content: content || null, requires_ack: requiresAck,
        folder: String(req.body.folder || '').trim() || null, expires_on: req.body.expires_on || null, review_on: req.body.review_on || null,
        audience_type: employeeId ? 'employees' : audienceType, audience_ids: employeeId ? null : (audienceType === 'all' ? null : JSON.stringify(audienceIds)),
        doc_type_id: employeeId ? docType?.id ?? null : null, verification: employeeId && docType ? (hr ? 'verified' : 'pending') : null,
        requires_signature: hr && employeeId && ['1', 'true', 'on'].includes(String(req.body.requires_signature)) ? 1 : 0,
      });
      if (req.file) saveAttachment(req.file, 'documents', docId, req.user.id);
      audit(req.user.id, 'create', 'documents', docId, req.file ? { file: req.file.originalname } : undefined);
      return docId;
    });
  } catch (err) {
    // The transaction rolled back, so don't leave the stored file behind.
    if (req.file) removeFile(req.file.filename);
    throw err;
  }
  if (hr && employeeId) notify(employeeId, 'New document shared with you', docTitle, '/documents');
  if (hr && !employeeId && requiresAck) {
    for (const eid of audienceEmployees({ audience_type: audienceType, audience_ids: audienceIds })) {
      if (eid !== req.user.id) notify(eid, `Please read and acknowledge: ${docTitle}`, 'A new company policy needs your acknowledgement.', '/documents');
    }
  }
  if (!hr) notifyHR(docType ? 'Document awaiting verification' : 'Employee uploaded a document', `${req.user.first_name} ${req.user.last_name}: ${docTitle}`, '/documents?tab=compliance');
  res.status(201).json(get(`${DOC_SELECT} WHERE d.id = ?`, id));
});
documentsRouter.delete('/:id', (req, res) => {
  const doc = get('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!doc) throw httpError(404, 'Document not found');
  if (!isHR(req.user) && doc.employee_id !== req.user.id) throw httpError(403, 'You cannot delete this document');
  tx(() => {
    deleteAttachmentsFor('documents', doc.id);
    run('DELETE FROM documents WHERE id = ?', doc.id);
  });
  audit(req.user.id, 'delete', 'documents', doc.id);
  res.json({ ok: true });
});

export const surveysRouter = Router();
surveysRouter.get('/', (req, res) => {
  const surveys = all('SELECT * FROM surveys ORDER BY active DESC, id DESC');
  res.json(surveys.map((s) => {
    const options = JSON.parse(s.options);
    const votes = all('SELECT option_index, COUNT(*) AS n FROM survey_votes WHERE survey_id = ? GROUP BY option_index', s.id);
    const mine = get('SELECT option_index FROM survey_votes WHERE survey_id = ? AND employee_id = ?', s.id, req.user.id);
    const counts = options.map((_, i) => votes.find((v) => v.option_index === i)?.n || 0);
    const out = { ...s, options, counts, my_vote: mine ? mine.option_index : null };
    // eNPS: option index = score 0–10; promoters 9–10, detractors 0–6. Individual answers are never exposed.
    if (s.type === 'enps') {
      const total = counts.reduce((a, b) => a + b, 0);
      const promoters = counts.slice(9).reduce((a, b) => a + b, 0);
      const detractors = counts.slice(0, 7).reduce((a, b) => a + b, 0);
      out.enps = total ? Math.round(((promoters - detractors) / total) * 100) : null;
      out.breakdown = { promoters, passives: total - promoters - detractors, detractors, total };
    }
    return out;
  }));
});
surveysRouter.post('/', requireRole('admin', 'hr'), (req, res) => {
  const { question, options, type = 'poll' } = req.body;
  if (!['poll', 'enps'].includes(type)) throw httpError(400, 'Survey type must be poll or enps');
  const opts = type === 'enps' ? Array.from({ length: 11 }, (_, i) => String(i)) : (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!question || opts.length < 2) throw httpError(400, 'A question and at least two options are required');
  const id = insert('surveys', { question, options: JSON.stringify(opts), active: 1, type });
  if (type === 'enps') {
    for (const { id: eid } of all("SELECT id FROM employees WHERE status != 'exited'")) notify(eid, 'Quick pulse survey (anonymous)', question, '/engage?tab=polls', { email: false });
  }
  res.status(201).json({ id });
});
surveysRouter.post('/:id/vote', (req, res) => {
  const s = get('SELECT * FROM surveys WHERE id = ?', req.params.id);
  if (!s || !s.active) throw httpError(404, 'Poll not found or closed');
  const idx = Number(req.body.option_index);
  if (!(idx >= 0 && idx < JSON.parse(s.options).length)) throw httpError(400, 'Invalid option');
  run('INSERT OR REPLACE INTO survey_votes (survey_id, employee_id, option_index) VALUES (?, ?, ?)', s.id, req.user.id, idx);
  res.json({ ok: true });
});
surveysRouter.put('/:id', requireRole('admin', 'hr'), (req, res) => {
  update('surveys', Number(req.params.id), { active: req.body.active ? 1 : 0 });
  res.json({ ok: true });
});

// ---------- notifications, audit, settings ----------
export const notificationsRouter = Router();
notificationsRouter.get('/', (req, res) => {
  const items = all('SELECT * FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND read = 0', req.user.id).n;
  res.json({ items, unread });
});
// Browser push: the public key for subscribing, and the browsers/phones this employee enabled.
const deviceName = (ua = '') => {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};
notificationsRouter.get('/push', (req, res) => {
  const devices = all('SELECT id, endpoint, device, created_at, last_used_at FROM push_subscriptions WHERE employee_id = ? ORDER BY id DESC', req.user.id);
  res.json({ public_key: pushPublicKey(), devices });
});
notificationsRouter.post('/push/subscribe', (req, res) => {
  const sub = req.body?.subscription || req.body || {};
  const { endpoint } = sub;
  const { p256dh, auth } = sub.keys || {};
  if (!endpoint || !p256dh || !auth) throw httpError(400, 'A push subscription with endpoint and keys is required');
  if (!validEndpoint(endpoint)) throw httpError(400, 'This push service is not supported');
  if (!/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth)) throw httpError(400, 'Invalid push subscription keys');
  const device = String(req.body?.device || deviceName(req.get('user-agent'))).slice(0, 80);
  // The same browser re-subscribing (or another user signing in on it) takes over the endpoint.
  run(`INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET employee_id = excluded.employee_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0`,
  req.user.id, endpoint, p256dh, auth, device);
  res.status(201).json({ ok: true, device });
});
notificationsRouter.post('/push/unsubscribe', (req, res) => {
  const { endpoint, id } = req.body || {};
  if (id) run('DELETE FROM push_subscriptions WHERE id = ? AND employee_id = ?', id, req.user.id);
  else if (endpoint) run('DELETE FROM push_subscriptions WHERE endpoint = ? AND employee_id = ?', endpoint, req.user.id);
  else throw httpError(400, 'endpoint or id is required');
  res.json({ ok: true });
});
notificationsRouter.post('/push/test', async (req, res) => {
  const result = await sendPush(req.user.id, { title: 'Notifications are on', body: 'PeopleHub will alert you here about approvals, payslips, reminders and more.', link: '/', tag: 'peoplehub-test' });
  if (!result.sent && !result.failed) throw httpError(400, 'Turn on browser notifications on this device first');
  res.json(result);
});
notificationsRouter.post('/read-all', (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE employee_id = ?', req.user.id);
  res.json({ ok: true });
});
notificationsRouter.post('/:id/read', (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE id = ? AND employee_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

export const auditRouter = Router();
auditRouter.get('/', requireRole('admin', 'hr'), (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.entity) { where.push('a.entity = ?'); params.push(req.query.entity); }
  if (req.query.action) { where.push('a.action = ?'); params.push(req.query.action); }
  res.json(all(
    `SELECT a.*, ${EMP_NAME('e')} AS actor_name, e.avatar_color FROM audit_logs a LEFT JOIN employees e ON e.id = a.actor_id
     WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 300`,
    ...params,
  ));
});

export const settingsRouter = Router();
settingsRouter.get('/', (req, res) => {
  res.json(Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])));
});
settingsRouter.put('/', requireRole('admin'), (req, res) => {
  tx(() => {
    for (const [k, v] of Object.entries(req.body)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v ?? ''));
  });
  audit(req.user.id, 'update', 'settings', null, { keys: Object.keys(req.body) });
  res.json(Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])));
});
