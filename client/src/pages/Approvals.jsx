import { useMemo, useState } from 'react';
import { CheckSquare, Check, X, Plane, Clock, Receipt, Timer, Landmark, CheckCheck, Paperclip, Home, Luggage, HandCoins, LogOut, History } from 'lucide-react';
import { useGet, useAction, useToast } from '../lib/hooks';
import ApprovalTrail from '../components/ApprovalTrail';
import { PageHeader, Tabs, Avatar, Badge, EmptyState, TableSkeleton, Modal } from '../components/ui';
import { Attachments } from '../components/Files';
import { timeAgo } from '../lib/format';

const TYPES = {
  leave: { label: 'Leave', icon: Plane, path: (id) => `leave/requests/${id}/decision`, entity: 'leave_requests' },
  regularization: { label: 'Attendance', icon: Clock, path: (id) => `regularizations/${id}/decision`, entity: 'regularizations' },
  attendance_request: { label: 'WFH / On-duty', icon: Home, path: (id) => `attendance-requests/${id}/decision`, entity: 'attendance_requests' },
  expense: { label: 'Expenses', icon: Receipt, path: (id) => `expenses/${id}/decision`, entity: 'expenses' },
  travel: { label: 'Travel', icon: Luggage, path: (id) => `travel/${id}/decision`, entity: 'travel_requests' },
  loan: { label: 'Loans', icon: HandCoins, path: (id) => `loans/${id}/decision`, entity: 'loans' },
  timesheet: { label: 'Timesheets', icon: Timer, path: (id) => `timesheets/${id}/decision`, entity: 'timesheets' },
  resignation: { label: 'Resignations', icon: LogOut, path: (id) => `resignations/${id}/decision`, entity: 'resignations' },
  tax: { label: 'Tax proofs', icon: Landmark, path: (id) => `tax-declarations/${id}/decision`, entity: 'tax_declarations' },
};

export default function Approvals() {
  const { data = [], isLoading } = useGet('approvals');
  const [tab, setTab] = useState('all');
  const [act] = useAction();
  const [reject, setReject] = useState(null);
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [files, setFiles] = useState(null);
  const [trail, setTrail] = useState(null);
  const toast = useToast();

  const counts = useMemo(() => Object.fromEntries(Object.keys(TYPES).map((t) => [t, data.filter((d) => d.type === t).length])), [data]);
  const visibleTypes = Object.entries(TYPES).filter(([k]) => counts[k] > 0 || ['leave', 'regularization', 'expense', 'timesheet'].includes(k));
  const items = tab === 'all' ? data : data.filter((d) => d.type === tab);
  const key = (i) => `${i.type}-${i.id}`;

  const decide = async (item, status, note) => {
    const invalidates = item.type === 'leave' ? ['leave'] : item.type === 'regularization' ? ['regularizations'] : [];
    const res = await act(TYPES[item.type].path(item.id), { method: 'PUT', body: { status, comment: note }, invalidates });
    if (res) toast(res.status === 'manager_approved' ? `${TYPES[item.type].label} approved — sent to HR for final approval` : `${TYPES[item.type].label} request ${status}`);
    return res;
  };

  const bulkApprove = async () => {
    for (const i of items.filter((x) => selected.has(key(x)))) await decide(i, 'approved');
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader icon={CheckSquare} title="Approvals" subtitle="Review and act on requests from your team"
        actions={selected.size > 0 && <button className="btn-success" onClick={bulkApprove} data-testid="bulk-approve"><CheckCheck size={16} /> Approve {selected.size} selected</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: data.length }, ...visibleTypes.map(([k, v]) => ({ value: k, label: v.label, count: counts[k] }))]} />
      <div className="card overflow-hidden">
        {isLoading ? <TableSkeleton rows={5} /> : items.length === 0 ? (
          <EmptyState icon={CheckCheck} title="All caught up!" message="There are no pending requests that need your attention." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((i) => {
              const T = TYPES[i.type];
              return (
                <div key={key(i)} className="flex flex-col gap-3 p-4 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/40 md:flex-row md:items-center" data-testid="approval-item">
                  <input type="checkbox" className="hidden h-4 w-4 accent-brand-600 md:block" aria-label="Select request" checked={selected.has(key(i))}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(key(i)) : n.delete(key(i)); return n; })} />
                  <div className="flex flex-1 items-center gap-3">
                    <Avatar name={i.employee_name} color={i.avatar_color} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{i.employee_name}</span>
                        <Badge color="violet"><T.icon size={11} /> {T.label}</Badge>
                        {i.stage === 'manager_approved' && <Badge status="manager_approved">Manager approved</Badge>}
                        {i.flow === 'manager_hr' && i.stage === 'pending' && <Badge color="slate">2-step</Badge>}
                        <span className="text-xs muted">{timeAgo(i.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{i.summary}</div>
                      {i.detail && <div className="truncate text-xs muted">“{i.detail}”</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost btn-sm !px-2" onClick={() => setTrail(i)} aria-label="Approval history" title="Approval history"><History size={14} /></button>
                    {i.type === 'expense' && <button className="btn-ghost btn-sm" onClick={() => setFiles(i)} data-testid="view-receipt"><Paperclip size={14} /> Receipt</button>}
                    <button className="btn-secondary btn-sm text-rose-600" onClick={() => { setReject(i); setComment(''); }} data-testid="reject-btn"><X size={14} /> Reject</button>
                    <button className="btn-success btn-sm" onClick={() => decide(i, 'approved')} data-testid="approve-btn"><Check size={14} /> Approve</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Modal open={!!files} onClose={() => setFiles(null)} title={files ? `Receipts · ${files.employee_name}` : ''}>
        {files && <><p className="mb-4 text-sm muted">{files.summary}</p><Attachments entity="expenses" entityId={files.id} title="Receipts" canUpload={false} canDelete={false} /></>}
      </Modal>
      <Modal open={!!trail} onClose={() => setTrail(null)} title={trail ? `${TYPES[trail.type].label} · ${trail.employee_name}` : ''} size="sm">
        {trail && <><p className="mb-4 text-sm muted">{trail.summary}</p><ApprovalTrail entity={TYPES[trail.type].entity} id={trail.id} status={trail.stage} flow={trail.flow} /></>}
      </Modal>
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject request" size="sm"
        footer={<><button className="btn-secondary" onClick={() => setReject(null)}>Cancel</button>
          <button className="btn-danger" onClick={async () => { if (await decide(reject, 'rejected', comment)) setReject(null); }} data-testid="confirm-reject">Reject</button></>}>
        <label className="label" htmlFor="reject-comment">Reason (shared with employee)</label>
        <textarea id="reject-comment" className="input min-h-24" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Critical release that week, please reschedule" />
      </Modal>
    </div>
  );
}
