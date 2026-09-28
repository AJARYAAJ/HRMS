import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireRole } from '../auth.js';
import { audit, httpError } from '../utils.js';
import { queueEmail, flushOutbox, smtpConfig, verifySmtp } from '../mailer.js';

export const emailsRouter = Router();
emailsRouter.use(requireRole('admin', 'hr'));

emailsRouter.get('/status', async (req, res) => {
  const cfg = smtpConfig();
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM email_outbox GROUP BY status').map((r) => [r.status, r.n]));
  res.json({
    mode: cfg ? 'smtp' : 'log',
    host: cfg ? `${cfg.host}:${cfg.port}` : null,
    from: process.env.SMTP_FROM || null,
    verify: req.query.verify === '1' ? await verifySmtp() : undefined,
    counts,
  });
});

emailsRouter.get('/', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(to_email LIKE ? OR subject LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(all(
    `SELECT id, to_email, to_name, employee_id, subject, template, status, attempts, last_error, created_at, sent_at
     FROM email_outbox WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
    ...params, Math.min(Number(req.query.limit) || 500, 2000),
  ));
});

emailsRouter.get('/:id', (req, res) => {
  const mail = get('SELECT * FROM email_outbox WHERE id = ?', req.params.id);
  if (!mail) throw httpError(404, 'Email not found');
  res.json(mail);
});

emailsRouter.post('/test', async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw httpError(400, 'Enter a valid email address');
  const id = queueEmail({
    to, template: 'test', subject: 'PeopleHub test email', heading: 'Email delivery is working',
    paragraphs: [`This test was sent by ${req.user.first_name} ${req.user.last_name} from Settings → Email.`],
  });
  await flushOutbox();
  audit(req.user.id, 'send_test_email', 'email_outbox', id, { to });
  res.status(201).json(get('SELECT id, to_email, subject, status, last_error FROM email_outbox WHERE id = ?', id));
});

emailsRouter.post('/:id/retry', async (req, res) => {
  const mail = get('SELECT * FROM email_outbox WHERE id = ?', req.params.id);
  if (!mail) throw httpError(404, 'Email not found');
  if (mail.status === 'sent') throw httpError(400, 'This email was already delivered');
  run("UPDATE email_outbox SET status = 'queued', attempts = 0, last_error = NULL, next_attempt_at = datetime('now') WHERE id = ?", mail.id);
  await flushOutbox();
  res.json(get('SELECT id, status, last_error FROM email_outbox WHERE id = ?', mail.id));
});
