import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import QRCode from 'qrcode';
import { all, get, run } from '../db.js';
import { JWT_SECRET, isHR, canManage, requireRole } from '../auth.js';
import { audit, httpError } from '../utils.js';
import { singleFile, removeFile, filePath } from '../uploads.js';

/**
 * Digital ID cards: a profile photo, a printable card rendered as a self-contained SVG, and a QR code that opens a
 * public verification page. The QR carries an unguessable code (employee id + HMAC), so cards can't be forged by
 * changing a number, and verification shows only what a card already shows.
 */
export const idCardsRouter = Router();
export const publicVerifyRouter = Router();

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const sign = (id) => crypto.createHmac('sha256', JWT_SECRET).update(`idcard:${id}`).digest('base64url').slice(0, 16);
export const verifyCode = (id) => `${Number(id).toString(36)}-${sign(id)}`;

function idFromCode(code) {
  const m = /^([0-9a-z]+)-([A-Za-z0-9_-]{16})$/.exec(String(code || ''));
  if (!m) return null;
  const id = parseInt(m[1], 36);
  const expected = sign(id);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2])) ? id : null;
}

const baseUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

const CARD_SELECT = `SELECT e.id, e.emp_code, e.first_name, e.last_name, e.blood_group, e.emergency_contact, e.phone, e.status, e.exit_date,
    e.date_of_joining, e.avatar_color, e.photo_file, e.photo_type, g.title AS designation, d.name AS department, l.name AS location,
    COALESCE(c.name, (SELECT value FROM settings WHERE key = 'company_name')) AS company
  FROM employees e LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN locations l ON l.id = e.location_id LEFT JOIN companies c ON c.id = e.company_id`;

const loadCard = (id) => get(`${CARD_SELECT} WHERE e.id = ?`, id);
const canSee = (user, id) => user.id === id || isHR(user) || canManage(user, id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function photoDataUrl(e) {
  if (!e.photo_file) return null;
  try {
    return `data:${e.photo_type || 'image/jpeg'};base64,${fs.readFileSync(filePath(e.photo_file)).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Renders the card (CR80 portrait proportions) as an SVG with the photo and QR embedded, ready to print or rasterise. */
export async function cardSvg(e, verifyUrl) {
  const name = `${e.first_name} ${e.last_name}`;
  const initials = `${e.first_name[0] || ''}${e.last_name[0] || ''}`.toUpperCase();
  const qr = (await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } }))
    .replace('<svg ', '<svg x="366" y="660" width="138" height="138" ');
  const photo = photoDataUrl(e);
  const color = /^#[0-9a-f]{6}$/i.test(e.avatar_color || '') ? e.avatar_color : '#6366f1';
  const rows = [
    ['EMPLOYEE ID', e.emp_code || '—'],
    ['BLOOD GROUP', e.blood_group || '—'],
    ['EMERGENCY', clip(e.emergency_contact || e.phone || '—', 22)],
    ['JOINED', e.date_of_joining || '—'],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 856" width="540" height="856" font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>
    <clipPath id="ph"><rect x="170" y="150" width="200" height="200" rx="100"/></clipPath>
  </defs>
  <rect width="540" height="856" rx="32" fill="#ffffff"/>
  <rect width="540" height="856" rx="32" fill="none" stroke="#e2e8f0" stroke-width="2"/>
  <path d="M32 0h476a32 32 0 0 1 32 32v188H0V32A32 32 0 0 1 32 0z" fill="url(#band)"/>
  <text x="270" y="70" text-anchor="middle" font-size="30" font-weight="700" fill="#ffffff">${esc(clip(e.company, 30))}</text>
  <text x="270" y="104" text-anchor="middle" font-size="16" font-weight="600" fill="#c7d2fe" letter-spacing="4">EMPLOYEE IDENTITY CARD</text>
  <circle cx="270" cy="250" r="108" fill="#ffffff"/>
  ${photo
    ? `<image href="${photo}" x="170" y="150" width="200" height="200" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>`
    : `<circle cx="270" cy="250" r="100" fill="${color}"/><text x="270" y="276" text-anchor="middle" font-size="72" font-weight="700" fill="#ffffff">${esc(initials)}</text>`}
  <text x="270" y="410" text-anchor="middle" font-size="36" font-weight="700" fill="#0f172a">${esc(clip(name, 26))}</text>
  <text x="270" y="448" text-anchor="middle" font-size="22" font-weight="600" fill="#4f46e5">${esc(clip(e.designation || 'Employee', 34))}</text>
  <text x="270" y="478" text-anchor="middle" font-size="18" fill="#64748b">${esc(clip([e.department, e.location].filter(Boolean).join(' · '), 44))}</text>
  <line x1="36" y1="512" x2="504" y2="512" stroke="#e2e8f0" stroke-width="2"/>
  ${rows.map(([k, v], i) => `<text x="36" y="${560 + i * 64}" font-size="14" font-weight="700" fill="#94a3b8" letter-spacing="2">${k}</text>
  <text x="36" y="${586 + i * 64}" font-size="22" font-weight="600" fill="#0f172a">${esc(v)}</text>`).join('\n  ')}
  <rect x="356" y="650" width="158" height="158" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
  ${qr}
  <text x="435" y="832" text-anchor="middle" font-size="13" font-weight="600" fill="#64748b">Scan to verify</text>
</svg>`;
}

// ---------- photo ----------
idCardsRouter.post('/:id/photo', singleFile(), (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id && !isHR(req.user)) { removeFile(req.file.filename); throw httpError(403, 'You can only change your own photo'); }
  if (!PHOTO_TYPES.has(req.file.mimetype)) { removeFile(req.file.filename); throw httpError(415, 'Use a PNG, JPEG or WebP photo'); }
  if (req.file.size > 5 * 1024 * 1024) { removeFile(req.file.filename); throw httpError(413, 'Photos can be up to 5 MB'); }
  const emp = get('SELECT id, photo_file FROM employees WHERE id = ?', id);
  if (!emp) { removeFile(req.file.filename); throw httpError(404, 'Employee not found'); }
  if (emp.photo_file) removeFile(emp.photo_file);
  run('UPDATE employees SET photo_file = ?, photo_type = ? WHERE id = ?', req.file.filename, req.file.mimetype, id);
  audit(req.user.id, 'update_photo', 'employees', id);
  res.json({ ok: true, photo_url: `/api/public/photo/${verifyCode(id)}?v=${Date.now()}` });
});

idCardsRouter.delete('/:id/photo', (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id && !isHR(req.user)) throw httpError(403, 'You can only change your own photo');
  const emp = get('SELECT photo_file FROM employees WHERE id = ?', id);
  if (emp?.photo_file) removeFile(emp.photo_file);
  run('UPDATE employees SET photo_file = NULL, photo_type = NULL WHERE id = ?', id);
  res.json({ ok: true });
});

// ---------- cards ----------
/** HR batch print: every active employee's card, optionally for one department or location. */
idCardsRouter.get('/batch', requireRole('admin', 'hr'), async (req, res) => {
  const where = ["e.status != 'exited'"];
  const params = [];
  if (req.query.department_id) { where.push('e.department_id = ?'); params.push(Number(req.query.department_id)); }
  if (req.query.location_id) { where.push('e.location_id = ?'); params.push(Number(req.query.location_id)); }
  const rows = all(`${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.first_name, e.last_name LIMIT 500`, ...params);
  const base = baseUrl(req);
  const cards = await Promise.all(rows.map(async (e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, emp_code: e.emp_code, svg: await cardSvg(e, `${base}/verify/${verifyCode(e.id)}`) })));
  audit(req.user.id, 'print_id_cards', 'employees', null, { count: cards.length });
  res.json(cards);
});

idCardsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!canSee(req.user, id)) throw httpError(403, 'Not allowed');
  const e = loadCard(id);
  if (!e) throw httpError(404, 'Employee not found');
  const code = verifyCode(id);
  const { photo_file: photoFile, photo_type: _t, ...rest } = e;
  res.json({ ...rest, name: `${e.first_name} ${e.last_name}`, verify_url: `${baseUrl(req)}/verify/${code}`, photo_url: photoFile ? `/api/public/photo/${code}` : null });
});

idCardsRouter.get('/:id/card.svg', async (req, res) => {
  const id = Number(req.params.id);
  if (!canSee(req.user, id)) throw httpError(403, 'Not allowed');
  const e = loadCard(id);
  if (!e) throw httpError(404, 'Employee not found');
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await cardSvg(e, `${baseUrl(req)}/verify/${verifyCode(id)}`));
});

// ---------- public verification ----------
publicVerifyRouter.get('/verify/:code', (req, res) => {
  const id = idFromCode(req.params.code);
  const e = id && loadCard(id);
  if (!e) return res.status(404).json({ valid: false, error: 'This ID card could not be verified' });
  const current = e.status !== 'exited';
  res.json({
    valid: true, current,
    name: `${e.first_name} ${e.last_name}`, emp_code: e.emp_code, designation: e.designation, department: e.department, company: e.company,
    status: current ? 'Current employee' : 'No longer with the organisation',
    photo_url: e.photo_file ? `/api/public/photo/${req.params.code}` : null,
    checked_at: new Date().toISOString(),
  });
});

publicVerifyRouter.get('/photo/:code', (req, res) => {
  const id = idFromCode(req.params.code);
  const e = id && get('SELECT photo_file, photo_type FROM employees WHERE id = ?', id);
  if (!e?.photo_file || !fs.existsSync(filePath(e.photo_file))) return res.status(404).end();
  res.set({ 'Content-Type': e.photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(filePath(e.photo_file)).pipe(res);
});
