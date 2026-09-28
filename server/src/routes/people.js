import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { isHR, reportIds } from '../auth.js';
import { audit, httpError, notify } from '../utils.js';
import { emailEmployee, appUrl } from '../mailer.js';

export const peopleRouter = Router();

const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const managerOf = (id) => get('SELECT manager_id FROM employees WHERE id = ?', id)?.manager_id;
const isManagerOf = (user, employeeId) => reportIds(user.id).includes(Number(employeeId));

// ---------- continuous feedback ----------
/*
 * visibility: 'recipient' – recipient and their manager see it
 *             'manager'   – private note to the recipient's manager (recipient doesn't see it)
 *             'public'    – also shown on the recipient's profile
 */
const FEEDBACK_SELECT = `SELECT f.*, ${NAME('a')} AS from_name, a.avatar_color AS from_color, ${NAME('b')} AS to_name, b.avatar_color AS to_color
  FROM feedback f JOIN employees a ON a.id = f.from_id JOIN employees b ON b.id = f.to_id`;

peopleRouter.get('/feedback', (req, res) => {
  const scope = req.query.scope || 'received';
  const u = req.user;
  let rows;
  if (scope === 'given') rows = all(`${FEEDBACK_SELECT} WHERE f.from_id = ? ORDER BY f.id DESC`, u.id);
  else if (scope === 'team') {
    const ids = isHR(u) ? null : reportIds(u.id);
    if (ids && !ids.length) return res.json([]);
    rows = all(`${FEEDBACK_SELECT} ${ids ? `WHERE f.to_id IN (${ids.join(',')})` : ''} ORDER BY f.id DESC LIMIT 500`);
  } else rows = all(`${FEEDBACK_SELECT} WHERE f.to_id = ? AND f.visibility IN ('recipient','public') ORDER BY f.id DESC`, u.id);
  res.json(rows);
});

peopleRouter.post('/feedback', (req, res) => {
  const { to_id: toId, message, visibility = 'recipient', competency, request_id: requestId } = req.body;
  if (!toId || !message?.trim()) throw httpError(400, 'Recipient and feedback are required');
  if (Number(toId) === req.user.id) throw httpError(400, 'You cannot give feedback to yourself');
  if (!['recipient', 'manager', 'public'].includes(visibility)) throw httpError(400, 'Invalid visibility');
  if (!get("SELECT id FROM employees WHERE id = ? AND status != 'exited'", toId)) throw httpError(404, 'Employee not found');
  let request;
  if (requestId) {
    request = get('SELECT * FROM feedback_requests WHERE id = ?', requestId);
    if (!request || request.reviewer_id !== req.user.id || request.status !== 'pending') throw httpError(400, 'This feedback request is not open for you');
  }
  const id = tx(() => {
    const fid = insert('feedback', { from_id: req.user.id, to_id: toId, message: message.trim(), visibility, competency: competency || null, request_id: requestId || null });
    if (request) update('feedback_requests', request.id, { status: 'completed' });
    return fid;
  });
  const from = `${req.user.first_name} ${req.user.last_name}`;
  if (visibility === 'manager') notify(managerOf(toId), 'New private feedback about your team', `${from} shared feedback`, '/performance?tab=feedback');
  else notify(Number(toId), `${req.user.first_name} shared feedback with you`, message.slice(0, 140), '/performance?tab=feedback');
  if (request && request.requester_id !== Number(toId)) notify(request.requester_id, 'Feedback request completed', `${from} responded`, '/performance?tab=feedback');
  res.status(201).json(get(`${FEEDBACK_SELECT} WHERE f.id = ?`, id));
});

// 360°: request feedback about yourself (or, for managers/HR, about a report) from colleagues.
peopleRouter.post('/feedback/requests', (req, res) => {
  const subjectId = Number(req.body.subject_id || req.user.id);
  const reviewers = [...new Set((req.body.reviewer_ids || []).map(Number))].filter((id) => id && id !== subjectId);
  if (!reviewers.length) throw httpError(400, 'Choose at least one colleague');
  if (reviewers.length > 10) throw httpError(400, 'Ask at most 10 people at once');
  if (subjectId !== req.user.id && !isHR(req.user) && !isManagerOf(req.user, subjectId)) throw httpError(403, 'You can only request feedback about yourself or your team');
  const subject = get(`SELECT ${NAME('e')} AS name FROM employees e WHERE e.id = ?`, subjectId);
  const created = tx(() => reviewers.map((rid) => insert('feedback_requests', { requester_id: req.user.id, subject_id: subjectId, reviewer_id: rid, question: req.body.question || null })));
  for (const rid of reviewers) {
    notify(rid, `Feedback requested about ${subjectId === req.user.id ? req.user.first_name : subject.name}`, req.body.question || 'Share what they do well and what could be better.', '/performance?tab=feedback');
  }
  audit(req.user.id, 'request_feedback', 'feedback_requests', null, { subject_id: subjectId, reviewers: reviewers.length });
  res.status(201).json({ created: created.length });
});

peopleRouter.get('/feedback/requests', (req, res) => {
  const base = `SELECT r.*, ${NAME('s')} AS subject_name, s.avatar_color AS subject_color, ${NAME('q')} AS requester_name, ${NAME('v')} AS reviewer_name
    FROM feedback_requests r JOIN employees s ON s.id = r.subject_id JOIN employees q ON q.id = r.requester_id JOIN employees v ON v.id = r.reviewer_id`;
  if (req.query.scope === 'sent') return res.json(all(`${base} WHERE r.requester_id = ? ORDER BY r.id DESC`, req.user.id));
  res.json(all(`${base} WHERE r.reviewer_id = ? AND r.status = 'pending' ORDER BY r.id DESC`, req.user.id));
});

peopleRouter.post('/feedback/requests/:id/decline', (req, res) => {
  const r = get('SELECT * FROM feedback_requests WHERE id = ?', req.params.id);
  if (!r || r.reviewer_id !== req.user.id || r.status !== 'pending') throw httpError(404, 'Request not found');
  update('feedback_requests', r.id, { status: 'declined' });
  res.json({ ok: true });
});

// ---------- one-on-one meetings ----------
const ONE_SELECT = `SELECT o.*, ${NAME('m')} AS manager_name, m.avatar_color AS manager_color, ${NAME('e')} AS employee_name, e.avatar_color AS employee_color
  FROM one_on_ones o JOIN employees m ON m.id = o.manager_id JOIN employees e ON e.id = o.employee_id`;

const canSee11 = (o, u) => o.manager_id === u.id || o.employee_id === u.id || isHR(u);

peopleRouter.get('/one-on-ones', (req, res) => {
  const u = req.user;
  const rows = isHR(u) && req.query.all
    ? all(`${ONE_SELECT} ORDER BY o.scheduled_at DESC LIMIT 500`)
    : all(`${ONE_SELECT} WHERE o.manager_id = ? OR o.employee_id = ? ORDER BY o.scheduled_at DESC`, u.id, u.id);
  res.json(rows);
});

peopleRouter.post('/one-on-ones', (req, res) => {
  const u = req.user;
  const other = Number(req.body.with_id);
  const { scheduled_at: at, agenda, duration_mins: duration } = req.body;
  if (!other || !at) throw httpError(400, 'Choose who to meet and when');
  if (Number.isNaN(Date.parse(at))) throw httpError(400, 'Invalid date/time');
  let managerId;
  let employeeId;
  if (isManagerOf(u, other)) { managerId = u.id; employeeId = other; }
  else if (managerOf(u.id) === other) { managerId = other; employeeId = u.id; }
  else throw httpError(403, 'One-on-ones are between a manager and their direct/indirect reports');
  const id = insert('one_on_ones', {
    manager_id: managerId, employee_id: employeeId, scheduled_at: at, agenda: agenda || null,
    duration_mins: Math.max(15, Math.min(120, Number(duration) || 30)), created_by: u.id, status: 'scheduled',
  });
  const when = at.replace('T', ' ');
  notify(other, 'One-on-one scheduled', `${u.first_name} ${u.last_name} · ${when}`, '/performance?tab=one-on-ones', { email: false });
  emailEmployee(other, {
    template: 'one_on_one', subject: `1:1 with ${u.first_name} ${u.last_name} · ${when}`, heading: 'One-on-one scheduled',
    paragraphs: [agenda ? `Agenda: ${agenda}` : 'Add talking points to the shared agenda before you meet.'],
    details: [['When', when], ['Duration', `${Math.max(15, Math.min(120, Number(duration) || 30))} minutes`], ['With', `${u.first_name} ${u.last_name}`]],
    cta: { url: `${appUrl()}/performance?tab=one-on-ones`, label: 'Open agenda' },
  });
  res.status(201).json(get(`${ONE_SELECT} WHERE o.id = ?`, id));
});

peopleRouter.put('/one-on-ones/:id', (req, res) => {
  const o = get('SELECT * FROM one_on_ones WHERE id = ?', req.params.id);
  if (!o || !canSee11(o, req.user)) throw httpError(404, 'Meeting not found');
  const data = {};
  for (const k of ['agenda', 'notes', 'action_items', 'scheduled_at']) if (k in req.body) data[k] = req.body[k];
  if ('status' in req.body) {
    if (!['scheduled', 'completed', 'cancelled'].includes(req.body.status)) throw httpError(400, 'Invalid status');
    data.status = req.body.status;
  }
  update('one_on_ones', o.id, data);
  if (data.status === 'completed' && data.action_items) {
    const other = o.manager_id === req.user.id ? o.employee_id : o.manager_id;
    notify(other, '1:1 notes and action items shared', data.action_items.slice(0, 140), '/performance?tab=one-on-ones');
  }
  res.json(get(`${ONE_SELECT} WHERE o.id = ?`, o.id));
});

// ---------- social feed ----------
function loadPosts(userId, where = '1=1', params = []) {
  const posts = all(
    `SELECT p.*, ${NAME('e')} AS author_name, e.avatar_color, g.title AS designation,
            (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
            EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.employee_id = ?) AS liked,
            (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count
     FROM posts p JOIN employees e ON e.id = p.author_id LEFT JOIN designations g ON g.id = e.designation_id
     WHERE ${where} ORDER BY p.id DESC LIMIT 100`, userId, ...params,
  );
  if (!posts.length) return posts;
  const comments = all(
    `SELECT c.*, ${NAME('e')} AS author_name, e.avatar_color FROM post_comments c JOIN employees e ON e.id = c.author_id
     WHERE c.post_id IN (${posts.map((p) => p.id).join(',')}) ORDER BY c.id`,
  );
  return posts.map((p) => ({ ...p, liked: !!p.liked, comments: comments.filter((c) => c.post_id === p.id) }));
}

peopleRouter.get('/posts', (req, res) => res.json(loadPosts(req.user.id)));

peopleRouter.post('/posts', (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) throw httpError(400, 'Write something to post');
  if (body.length > 2000) throw httpError(400, 'Posts are limited to 2,000 characters');
  const id = insert('posts', { author_id: req.user.id, body });
  // @mentions notify the people mentioned by name.
  for (const m of body.matchAll(/@([A-Z][a-z]+ [A-Z][a-z]+)/g)) {
    const who = get(`SELECT id FROM employees WHERE first_name || ' ' || last_name = ? AND status != 'exited'`, m[1]);
    if (who && who.id !== req.user.id) notify(who.id, `${req.user.first_name} mentioned you in a post`, body.slice(0, 140), '/engage?tab=feed', { email: false });
  }
  res.status(201).json(loadPosts(req.user.id, 'p.id = ?', [id])[0]);
});

peopleRouter.delete('/posts/:id', (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Post not found');
  if (p.author_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'You can only delete your own posts');
  run('DELETE FROM posts WHERE id = ?', p.id);
  if (p.author_id !== req.user.id) audit(req.user.id, 'moderate_post', 'posts', p.id);
  res.json({ ok: true });
});

peopleRouter.post('/posts/:id/like', (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Post not found');
  const liked = get('SELECT 1 FROM post_likes WHERE post_id = ? AND employee_id = ?', p.id, req.user.id);
  if (liked) run('DELETE FROM post_likes WHERE post_id = ? AND employee_id = ?', p.id, req.user.id);
  else {
    run('INSERT INTO post_likes (post_id, employee_id) VALUES (?, ?)', p.id, req.user.id);
    if (p.author_id !== req.user.id) notify(p.author_id, `${req.user.first_name} liked your post`, p.body.slice(0, 100), '/engage?tab=feed', { email: false });
  }
  res.json({ liked: !liked, likes: get('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?', p.id).n });
});

peopleRouter.post('/posts/:id/comments', (req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', req.params.id);
  if (!p) throw httpError(404, 'Post not found');
  const body = String(req.body.body || '').trim();
  if (!body) throw httpError(400, 'Comment cannot be empty');
  if (body.length > 1000) throw httpError(400, 'Comments are limited to 1,000 characters');
  const id = insert('post_comments', { post_id: p.id, author_id: req.user.id, body });
  if (p.author_id !== req.user.id) notify(p.author_id, `${req.user.first_name} commented on your post`, body.slice(0, 140), '/engage?tab=feed', { email: false });
  res.status(201).json(get(`SELECT c.*, ${NAME('e')} AS author_name, e.avatar_color FROM post_comments c JOIN employees e ON e.id = c.author_id WHERE c.id = ?`, id));
});

peopleRouter.delete('/comments/:id', (req, res) => {
  const c = get('SELECT * FROM post_comments WHERE id = ?', req.params.id);
  if (!c) throw httpError(404, 'Comment not found');
  if (c.author_id !== req.user.id && !isHR(req.user)) throw httpError(403, 'You can only delete your own comments');
  run('DELETE FROM post_comments WHERE id = ?', c.id);
  res.json({ ok: true });
});
