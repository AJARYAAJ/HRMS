import { CheckCircle2, XCircle, Circle } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { Skeleton, cx } from './ui';
import { dateTime } from '../lib/format';

/**
 * Decision history for a request (e.g. manager approved → HR approved), plus what is still pending.
 * entity is the table name (expenses, leave_requests, travel_requests, loans, resignations, …).
 */
export default function ApprovalTrail({ entity, id, status, flow }) {
  const { data = [], isLoading } = useGet(id ? 'approvals/history' : null, { entity, id });
  if (isLoading) return <Skeleton className="h-10 w-full" />;
  const waiting = status === 'manager_approved' ? 'Awaiting HR approval' : status === 'pending' ? (flow === 'hr' ? 'Awaiting HR' : 'Awaiting manager') : null;
  return (
    <div data-testid="approval-trail">
      <div className="mb-2 text-sm font-semibold">Approval trail</div>
      <ol className="space-y-2">
        {data.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            {s.decision === 'approved' ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-500" /> : <XCircle size={16} className="mt-0.5 text-rose-500" />}
            <div>
              <div><b>{s.approver_name || 'System'}</b> <span className="muted">({s.level === 'hr' ? 'HR' : 'Manager'})</span> {s.decision}</div>
              <div className="text-xs muted">{dateTime(s.created_at)}{s.comment ? ` · “${s.comment}”` : ''}</div>
            </div>
          </li>
        ))}
        {waiting && (
          <li className="flex items-center gap-2 text-sm muted"><Circle size={16} className={cx('text-amber-500')} /> {waiting}</li>
        )}
        {!data.length && !waiting && <li className="text-xs muted">No decisions recorded.</li>}
      </ol>
    </div>
  );
}
