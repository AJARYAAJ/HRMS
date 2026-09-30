import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { requireRole, isHR, canManage } from '../auth.js';
import { audit, httpError, notify, today } from '../utils.js';
import { computeSalary, structureFor, loadStructure, cleanComponents } from '../salary.js';
import { taxProfile, fyOf } from '../tax.js';

/** Salary structures (templates of components), assignment to employees and salary breakups. */
export const salaryRouter = Router();
const HR = requireRole('admin', 'hr');
const NAME = (a) => `${a}.first_name || ' ' || ${a}.last_name`;
const flag = (v, d = 0) => (v === undefined ? d : v === true || v === 1 || v === '1' ? 1 : 0);

function cleanStructure(b, existing = {}) {
  const name = String(b.name ?? existing.name ?? '').trim();
  if (!name) throw httpError(400, 'Name is required');
  const cap = b.pf_wage_cap === undefined ? existing.pf_wage_cap ?? 15000 : b.pf_wage_cap === '' || b.pf_wage_cap === null ? null : Number(b.pf_wage_cap);
  if (cap !== null && !(cap > 0)) throw httpError(400, 'PF wage cap must be a positive amount, or empty for full basic');
  const esiThreshold = Number(b.esi_threshold ?? existing.esi_threshold ?? 21000);
  if (!(esiThreshold > 0)) throw httpError(400, 'ESI threshold must be positive');
  return {
    name, description: b.description ?? existing.description ?? null,
    pf_enabled: flag(b.pf_enabled, existing.pf_enabled ?? 1), pf_wage_cap: cap, pf_employer_in_ctc: flag(b.pf_employer_in_ctc, existing.pf_employer_in_ctc ?? 0),
    esi_enabled: flag(b.esi_enabled, existing.esi_enabled ?? 1), esi_threshold: esiThreshold,
    pt_enabled: flag(b.pt_enabled, existing.pt_enabled ?? 1), gratuity_in_ctc: flag(b.gratuity_in_ctc, existing.gratuity_in_ctc ?? 0),
  };
}

const list = () => all(`SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.salary_structure_id = s.id AND e.status != 'exited') AS assigned
  FROM salary_structures s ORDER BY s.is_default DESC, s.name`).map((s) => ({
  ...s, is_default: !!s.is_default, components: all('SELECT * FROM salary_components WHERE structure_id = ? ORDER BY sort, id', s.id),
  example: computeSalary(loadStructure(s.id), 1200000),
}));

salaryRouter.get('/structures', HR, (req, res) => res.json(list()));

/** Breakup for a CTC under a saved structure or an unsaved draft (used by the editor's live preview). */
salaryRouter.post('/preview', HR, (req, res) => {
  const ctc = Number(req.body.annual_ctc);
  if (!(ctc > 0)) throw httpError(400, 'Enter an annual CTC');
  const structure = req.body.structure
    ? { ...cleanStructure(req.body.structure), components: cleanComponents(req.body.structure.components, httpError) }
    : loadStructure(Number(req.body.structure_id));
  if (!structure) throw httpError(404, 'Structure not found');
  res.json(computeSalary(structure, ctc));
});

function saveComponents(structureId, comps) {
  run('DELETE FROM salary_components WHERE structure_id = ?', structureId);
  for (const c of comps) insert('salary_components', { structure_id: structureId, ...c });
}

salaryRouter.post('/structures', HR, (req, res) => {
  const data = cleanStructure(req.body || {});
  const comps = cleanComponents(req.body.components, httpError);
  if (get('SELECT id FROM salary_structures WHERE lower(name) = lower(?)', data.name)) throw httpError(409, 'A structure with this name exists');
  const id = tx(() => {
    const sid = insert('salary_structures', { ...data, is_default: get('SELECT id FROM salary_structures') ? 0 : 1 });
    saveComponents(sid, comps);
    return sid;
  });
  audit(req.user.id, 'create', 'salary_structures', id);
  res.status(201).json(list().find((s) => s.id === id));
});

salaryRouter.put('/structures/:id', HR, (req, res) => {
  const s = get('SELECT * FROM salary_structures WHERE id = ?', req.params.id);
  if (!s) throw httpError(404, 'Structure not found');
  const data = cleanStructure(req.body || {}, s);
  if (get('SELECT id FROM salary_structures WHERE lower(name) = lower(?) AND id != ?', data.name, s.id)) throw httpError(409, 'A structure with this name exists');
  const comps = req.body.components ? cleanComponents(req.body.components, httpError) : null;
  tx(() => { update('salary_structures', s.id, data); if (comps) saveComponents(s.id, comps); });
  audit(req.user.id, 'update', 'salary_structures', s.id);
  res.json(list().find((x) => x.id === s.id));
});

salaryRouter.post('/structures/:id/default', HR, (req, res) => {
  if (!get('SELECT id FROM salary_structures WHERE id = ?', req.params.id)) throw httpError(404, 'Structure not found');
  tx(() => { run('UPDATE salary_structures SET is_default = 0'); run('UPDATE salary_structures SET is_default = 1 WHERE id = ?', req.params.id); });
  res.json({ ok: true });
});

salaryRouter.delete('/structures/:id', HR, (req, res) => {
  const s = get('SELECT * FROM salary_structures WHERE id = ?', req.params.id);
  if (!s) throw httpError(404, 'Structure not found');
  if (s.is_default && get('SELECT COUNT(*) AS n FROM salary_structures').n > 1) throw httpError(409, 'Make another structure the default first');
  tx(() => { run('UPDATE employees SET salary_structure_id = NULL WHERE salary_structure_id = ?', s.id); run('DELETE FROM salary_structures WHERE id = ?', s.id); });
  audit(req.user.id, 'delete', 'salary_structures', s.id);
  res.json({ ok: true });
});

salaryRouter.post('/structures/:id/assign', HR, (req, res) => {
  const s = req.params.id === 'default' ? null : get('SELECT * FROM salary_structures WHERE id = ?', req.params.id);
  if (req.params.id !== 'default' && !s) throw httpError(404, 'Structure not found');
  let ids = Array.isArray(req.body.employee_ids) ? req.body.employee_ids.map(Number).filter(Boolean) : [];
  if (req.body.department_id) ids = [...new Set([...ids, ...all("SELECT id FROM employees WHERE department_id = ? AND status != 'exited'", Number(req.body.department_id)).map((r) => r.id)])];
  if (!ids.length) throw httpError(400, 'Choose employees or a department');
  tx(() => { for (const id of ids) run('UPDATE employees SET salary_structure_id = ? WHERE id = ?', s?.id ?? null, id); });
  for (const id of ids) notify(id, 'Your salary structure was updated', `Your pay now follows the ${s?.name || 'default'} structure. See the breakup under Payslips & Tax.`, '/payslips', { email: false });
  audit(req.user.id, 'assign_structure', 'salary_structures', s?.id ?? null, { employees: ids.length });
  res.json({ updated: ids.length });
});

/** An employee's current salary breakup, monthly and annual, component by component. */
salaryRouter.get('/breakup/:employeeId', (req, res) => {
  const id = Number(req.params.employeeId);
  if (id !== req.user.id && !isHR(req.user) && !canManage(req.user, id)) throw httpError(403, 'Not allowed');
  const emp = get('SELECT * FROM employees WHERE id = ?', id);
  if (!emp) throw httpError(404, 'Employee not found');
  // Managers see the structure but not the amounts of their reports.
  if (id !== req.user.id && !isHR(req.user)) return res.json({ structure: structureFor(id).name });
  const tax = taxProfile(emp, fyOf(today()));
  const s = structureFor(id);
  const m = computeSalary(s, emp.annual_ctc, { annualTax: tax.annual_tax });
  res.json({ annual_ctc: emp.annual_ctc, structure: s.name, structure_id: s.id, monthly: m, annual: m.lines.map((l) => ({ ...l, amount: Math.round(l.amount * 12 * 100) / 100 })), regime: tax.selected });
});

salaryRouter.get('/assignments', HR, (req, res) => {
  res.json(all(`SELECT e.id, e.emp_code, ${NAME('e')} AS name, e.annual_ctc, e.avatar_color, d.name AS department, e.salary_structure_id, s.name AS structure
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN salary_structures s ON s.id = e.salary_structure_id
    WHERE e.status != 'exited' ORDER BY e.first_name`));
});
