import { useMemo, useState } from 'react';
import { CheckSquare, Check, X, Plane, Clock, Receipt, Timer, Landmark, CheckCheck } from 'lucide-react';
import { useGet, useAction } from '../lib/hooks';
import { PageHeader, Tabs, Avatar, Badge, EmptyState, TableSkeleton, Modal } from '../components/ui';
import { timeAgo } from '../lib/format';

const TYPES = {
  leave: { label: 'Leave', icon: Plane, path: (id) => `leave/requests/${id}/decision` },
  regularization: { label: 'Attendance', icon: Clock, path: (id) => `regularizations/${id}/decision` },
  expense: { label: 'Expenses', icon: Receipt, path: (id) => `expenses/${id}/decision` },
  timesheet: { label: 'Timesheets', icon: Timer, path: (id) => `timesheets/${id}/decision` },
  tax: { label: 'Tax proofs', icon: Landmark, path: (id) => `tax-declarations/${id}/decision` },
};

export default function Approvals() {
  const { data = [], isLoading } = useGet('approvals');
  const [tab, setTab] = useState('all');
  const [act] = useAction();
  const [reject, setReject] = useState(null);
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState(new Set());

  const counts = useMemo(() => Object.fromEntries(Object.keys(TYPES).map((t) => [t, data.filter((d) => d.type === t).length])), [data]);
  const items = tab === 'all' ? data : data.filter((d) => d.type === tab);
  const key = (i) => `${i.type}-${i.id}`;

  const decide = async (item, status, note) => {
    const invalidates = item.type === 'leave' ? ['leave'] : item.type === 'regularization' ? ['regularizations'] : [];
    return act(TYPES[item.type].path(item.id), { method: 'PUT', body: { status, comment: note }, success: `${TYPES[item.type].label} request ${status}`, invalidates });
  };

  const bulkApprove = async () => {
    for (const i of items.filter((x) => selected.has(key(x)))) await decide(i, 'approved');
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader icon={CheckSquare} title="Approvals" subtitle="Review and act on requests from your team"
        actions={selected.size > 0 && <button className="btn-success" onClick={bulkApprove} data-testid="bulk-approve"><CheckCheck size={16} /> Approve {selected.size} selected</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: data.length }, ...Object.entries(TYPES).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] }))]} />
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
                        <span className="text-xs muted">{timeAgo(i.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{i.summary}</div>
                      {i.detail && <div className="truncate text-xs muted">“{i.detail}”</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary btn-sm text-rose-600" onClick={() => { setReject(i); setComment(''); }} data-testid="reject-btn"><X size={14} /> Reject</button>
                    <button className="btn-success btn-sm" onClick={() => decide(i, 'approved')} data-testid="approve-btn"><Check size={14} /> Approve</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject request" size="sm"
        footer={<><button className="btn-secondary" onClick={() => setReject(null)}>Cancel</button>
          <button className="btn-danger" onClick={async () => { if (await decide(reject, 'rejected', comment)) setReject(null); }} data-testid="confirm-reject">Reject</button></>}>
        <label className="label" htmlFor="reject-comment">Reason (shared with employee)</label>
        <textarea id="reject-comment" className="input min-h-24" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Critical release that week, please reschedule" />
      </Modal>
    </div>
  );
}
