import jwt from 'jsonwebtoken';
import { get, all } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'peoplehub-dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change-me/.test(process.env.JWT_SECRET))) {
  console.error('Set JWT_SECRET to a random string of at least 32 characters before running in production (generate one with: openssl rand -hex 32).');
  process.exit(1);
}

export const ROLE_RANK = { employee: 1, manager: 2, hr: 3, admin: 4 };

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = get(
      `SELECT id, first_name, last_name, email, role, manager_id, department_id, status
       FROM employees WHERE id = ?`,
      payload.id,
    );
    if (!user || user.status === 'exited') return res.status(401).json({ error: 'Account is inactive' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** Allow only users whose role is in the list. */
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

export const isHR = (user) => user.role === 'admin' || user.role === 'hr';

/** IDs of everyone reporting (directly or indirectly) to the given manager. */
export function reportIds(managerId) {
  return all(
    `WITH RECURSIVE team(id) AS (
       SELECT id FROM employees WHERE manager_id = ?
       UNION SELECT e.id FROM employees e JOIN team t ON e.manager_id = t.id
     ) SELECT id FROM team`,
    managerId,
  ).map((r) => r.id);
}

/**
 * SQL fragment restricting rows to what the user may see for an employee-owned table.
 * HR/Admin see everything, managers see themselves and their reporting tree, employees see their own.
 */
export function scopeSql(user, column) {
  if (isHR(user)) return { sql: '1=1', params: [] };
  if (user.role === 'manager') {
    const ids = [user.id, ...reportIds(user.id)];
    return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
  }
  return { sql: `${column} = ?`, params: [user.id] };
}

/** Can `user` act on (approve / view) records owned by employee `ownerId`? */
export function canManage(user, ownerId) {
  if (isHR(user)) return true;
  if (user.role === 'manager') return reportIds(user.id).includes(Number(ownerId));
  return false;
}
