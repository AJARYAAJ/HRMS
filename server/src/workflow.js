import { all, get, insert, run } from './db.js';

/**
 * Approval flows per request type:
 *   manager     – the reporting manager (or HR) decides in one step
 *   manager_hr  – manager approves first, then HR gives final approval
 *   hr          – only HR decides
 * HR can always act directly (e.g. when the manager is away).
 */
export const DEFAULT_FLOWS = {
  leave_requests: 'manager',
  regularizations: 'manager',
  attendance_requests: 'manager',
  timesheets: 'manager',
  expenses: 'manager_hr',
  travel_requests: 'manager_hr',
  loans: 'manager_hr',
  resignations: 'manager_hr',
  tax_declarations: 'hr',
  asset_requests: 'manager_hr',
};

export const FLOW_LABELS = {
  leave_requests: 'Leave requests', regularizations: 'Attendance regularization', attendance_requests: 'WFH / on-duty / comp-off / overtime',
  timesheets: 'Timesheets', expenses: 'Expense claims', travel_requests: 'Travel requests', loans: 'Loans & salary advances',
  resignations: 'Resignations', tax_declarations: 'Tax declarations', asset_requests: 'Asset requests',
};

export function approvalFlows() {
  let saved = {};
  try { saved = JSON.parse(get("SELECT value FROM settings WHERE key = 'approval_flows'")?.value || '{}'); } catch { /* corrupt setting */ }
  return { ...DEFAULT_FLOWS, ...saved };
}

export const approvalFlow = (table) => approvalFlows()[table] || 'manager';

export function saveApprovalFlows(flows) {
  const clean = Object.fromEntries(Object.entries(flows)
    .filter(([k, v]) => k in DEFAULT_FLOWS && ['manager', 'manager_hr', 'hr'].includes(v)));
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('approval_flows', ?)", JSON.stringify({ ...approvalFlows(), ...clean }));
  return approvalFlows();
}

export function recordStep(entity, entityId, level, approverId, decision, comment) {
  insert('approval_steps', { entity, entity_id: entityId, level, approver_id: approverId, decision, comment: comment || null });
}

export const approvalHistory = (entity, entityId) => all(
  `SELECT s.*, e.first_name || ' ' || e.last_name AS approver_name FROM approval_steps s
   LEFT JOIN employees e ON e.id = s.approver_id WHERE s.entity = ? AND s.entity_id = ? ORDER BY s.id`,
  entity, entityId,
);

/** Statuses that still reserve balances / block overlapping requests. */
export const OPEN_STATUSES = ['pending', 'manager_approved'];
