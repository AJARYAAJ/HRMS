import webpush from 'web-push';
import { all, get, run } from './db.js';
import { appUrl } from './mailer.js';

/**
 * Browser push notifications (Web Push with VAPID). The bell shows notifications inside the app; push delivers the same
 * notification to the employee's browsers and phones even when PeopleHub is closed. Keys come from VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY, else they are generated once and kept in settings (changing them invalidates every subscription).
 */
let configured = null;
function vapid() {
  if (configured) return configured;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    publicKey = get("SELECT value FROM settings WHERE key = 'vapid_public_key'")?.value;
    privateKey = get("SELECT value FROM settings WHERE key = 'vapid_private_key'")?.value;
    if (!publicKey || !privateKey) {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      run("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public_key', ?), ('vapid_private_key', ?)", publicKey, privateKey);
    }
  }
  let subject = process.env.VAPID_SUBJECT;
  if (!subject) {
    const url = appUrl();
    subject = url.startsWith('https://') ? url : `mailto:${process.env.SMTP_FROM?.match(/[^<\s]+@[^>\s]+/)?.[0] || 'admin@peoplehub.local'}`;
  }
  configured = { publicKey, privateKey, subject };
  return configured;
}

export const pushPublicKey = () => vapid().publicKey;
/** Forget cached keys (tests and key rotation). */
export const resetPushKeys = () => { configured = null; };

// Only real browser push services receive subscriptions, so the server never posts to arbitrary (internal) URLs.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function validEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname))) return true;
  // Local test receivers, outside production only.
  return process.env.NODE_ENV !== 'production' && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
}

/** Send a payload to every browser the employee enabled. Expired subscriptions (404/410) are removed. */
export async function sendPush(employeeId, payload, { ttl = 24 * 3600 } = {}) {
  const subs = all('SELECT * FROM push_subscriptions WHERE employee_id = ?', employeeId);
  if (!subs.length) return { sent: 0, failed: 0 };
  const { publicKey, privateKey, subject } = vapid();
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      // web-push encrypts the payload and signs the VAPID header; the request itself goes out with fetch.
      const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: ttl, urgency: 'normal', vapidDetails: { subject, publicKey, privateKey },
      });
      const res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw Object.assign(new Error(`Push service answered ${res.status}`), { statusCode: res.status });
      run("UPDATE push_subscriptions SET last_used_at = datetime('now'), failures = 0 WHERE id = ?", s.id);
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410 || s.failures >= 9) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      else run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', s.id);
    }
  }));
  return { sent, failed };
}

/** Push a bell notification to the employee's browsers without blocking the request that created it. */
export function pushNotification(employeeId, n) {
  if (!get('SELECT 1 FROM push_subscriptions WHERE employee_id = ? LIMIT 1', employeeId)) return;
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND read = 0', employeeId)?.n || 0;
  sendPush(employeeId, { id: n.id, title: n.title, body: n.body || '', link: n.link || '/', unread, tag: `peoplehub-${n.id}` })
    .catch((err) => console.error('[push] delivery failed', err.message));
}
