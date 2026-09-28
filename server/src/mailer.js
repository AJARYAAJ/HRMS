import nodemailer from 'nodemailer';
import { all, get, insert, run } from './db.js';

/**
 * Outbound email.
 *
 * Every email is written to `email_outbox` first and delivered by a background worker, so requests never
 * wait on SMTP and failed deliveries are retried with backoff. Without SMTP settings the worker marks
 * mail as "logged" (visible in Settings → Email) instead of sending it, which keeps local setups working.
 */

const MAX_ATTEMPTS = 4;
let transport;
let transportKey;

export function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    ignoreTLS: process.env.SMTP_IGNORE_TLS === 'true',
  };
}

function getTransport() {
  const cfg = smtpConfig();
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({ ...cfg, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    transportKey = key;
  }
  return transport;
}

const setting = (key, fallback) => get('SELECT value FROM settings WHERE key = ?', key)?.value || fallback;
export const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
const fromAddress = () => process.env.SMTP_FROM || `"${setting('company_short', 'PeopleHub')} HR" <${setting('company_email', 'no-reply@peoplehub.local')}>`;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Branded, table-based HTML layout that renders consistently in Gmail, Outlook and mobile clients. */
export function renderEmail({ heading, greeting, paragraphs = [], details = [], cta, footnote }) {
  const company = escapeHtml(setting('company_name', 'PeopleHub'));
  const rows = details.map(([k, v]) => `
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:40%">${escapeHtml(k)}</td>
      <td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600">${escapeHtml(v)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#4f46e5;background-image:linear-gradient(135deg,#4f46e5,#8b5cf6);padding:22px 28px;color:#ffffff">
        <div style="font-size:18px;font-weight:800;letter-spacing:-0.2px">PeopleHub</div>
        <div style="font-size:12px;opacity:.85">${company}</div>
      </td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(heading)}</h1>
        ${greeting ? `<p style="margin:0 0 12px;font-size:14px;color:#334155">${escapeHtml(greeting)}</p>` : ''}
        ${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(p)}</p>`).join('')}
        ${rows ? `<table role="presentation" width="100%" style="margin:8px 0 16px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${rows}</table>` : ''}
        ${cta ? `<p style="margin:20px 0 8px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">${escapeHtml(cta.label)}</a></p>` : ''}
        ${footnote ? `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${escapeHtml(footnote)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;color:#94a3b8;font-size:11px">
        You're receiving this because you have a PeopleHub account. Manage email preferences in Account settings.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = [heading, greeting, ...paragraphs, ...details.map(([k, v]) => `${k}: ${v}`), cta ? `${cta.label}: ${cta.url}` : '', footnote]
    .filter(Boolean).join('\n\n');
  return { html, text };
}

/** Queue an email for delivery. Returns the outbox id. */
export function queueEmail({ to, toName, employeeId, subject, template = 'generic', ...content }) {
  if (!to) return null;
  const { html, text } = content.html ? { html: content.html, text: content.text } : renderEmail(content);
  return insert('email_outbox', { to_email: to, to_name: toName, employee_id: employeeId, subject, html, text, template });
}

/** Queue a notification email to an employee, honouring their email preference. */
export function emailEmployee(employeeId, { force = false, ...content }) {
  const emp = get('SELECT id, first_name, last_name, email, status, email_notifications FROM employees WHERE id = ?', employeeId);
  if (!emp || emp.status === 'exited' || (!force && !emp.email_notifications)) return null;
  return queueEmail({ to: emp.email, toName: `${emp.first_name} ${emp.last_name}`, employeeId: emp.id, greeting: `Hi ${emp.first_name},`, ...content });
}

let processing = false;

/** Deliver due emails. Safe to call concurrently; resolves once this batch is done. */
export async function processOutbox(limit = 25) {
  if (processing) return 0;
  processing = true;
  let handled = 0;
  try {
    const due = all(
      `SELECT * FROM email_outbox WHERE status IN ('queued','retrying') AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?`,
      limit,
    );
    const tx = getTransport();
    for (const mail of due) {
      handled++;
      if (!tx) {
        run("UPDATE email_outbox SET status = 'logged', attempts = attempts + 1, sent_at = datetime('now') WHERE id = ?", mail.id);
        if (process.env.MAIL_LOG === '1') console.log(`[mail:logged] to=${mail.to_email} subject="${mail.subject}"`);
        continue;
      }
      try {
        const info = await tx.sendMail({
          from: fromAddress(),
          to: mail.to_name ? { name: mail.to_name, address: mail.to_email } : mail.to_email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text || undefined,
        });
        run("UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, message_id = ?, last_error = NULL, sent_at = datetime('now') WHERE id = ?",
          info.messageId || null, mail.id);
      } catch (err) {
        const attempts = mail.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        // Exponential backoff: 1, 4, 9 minutes.
        run(`UPDATE email_outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = datetime('now', ?) WHERE id = ?`,
          giveUp ? 'failed' : 'retrying', attempts, String(err.message || err).slice(0, 500), `+${attempts * attempts} minutes`, mail.id);
      }
    }
  } finally {
    processing = false;
  }
  return handled;
}

/** Process until the queue has nothing due (used by tests and the "send now" admin action). */
export async function flushOutbox() {
  for (let i = 0; i < 20; i++) {
    if (processing) await new Promise((r) => setTimeout(r, 50));
    const n = await processOutbox();
    if (!n && !processing) return;
  }
}

let timer;
export function startMailer(intervalMs = Number(process.env.MAIL_INTERVAL_MS) || 3000) {
  if (timer) return;
  timer = setInterval(() => { processOutbox().catch((e) => console.error('[mail] worker error', e)); }, intervalMs);
  timer.unref();
}

export async function verifySmtp() {
  const tx = getTransport();
  if (!tx) return { configured: false };
  try {
    await tx.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}
