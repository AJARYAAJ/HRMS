import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { X, CheckCircle2, AlertCircle, Info, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { dismissToast } from '../store/uiSlice';
import { initials, titleCase, monthLabel, shiftMonth } from '../lib/format';

export const cx = (...c) => c.filter(Boolean).join(' ');

// ---------- skeletons ----------
export const Skeleton = ({ className = 'h-4 w-full' }) => <div className={cx('skeleton', className)} />;

export function CardSkeleton({ lines = 3, className = '' }) {
  return (
    <div className={cx('card card-pad space-y-3', className)} data-testid="skeleton">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={cx('h-3', i % 2 ? 'w-2/3' : 'w-full')} />)}
    </div>
  );
}

export function StatSkeletons({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-pad space-y-3" data-testid="skeleton">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="skeleton">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          {Array.from({ length: cols - 1 }).map((_, c) => <Skeleton key={c} className={cx('h-3', c === 0 ? 'w-1/4' : 'w-1/6')} />)}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in" data-testid="page-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <StatSkeletons />
      <div className="grid gap-6 lg:grid-cols-3">
        <CardSkeleton lines={6} className="lg:col-span-2" />
        <CardSkeleton lines={6} />
      </div>
    </div>
  );
}

// ---------- primitives ----------
export function Avatar({ name, color = '#6366f1', size = 'md', className = '' }) {
  const sizes = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg', xl: 'h-20 w-20 text-2xl' };
  return (
    <div
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-900', sizes[size], className)}
      style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

const STATUS_STYLES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-400',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-400',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300',
};
const STATUS_COLOR = {
  approved: 'green', present: 'green', active: 'green', paid: 'green', completed: 'green', resolved: 'green', hired: 'green', open: 'blue',
  on_track: 'green', assigned: 'blue', available: 'green', closed: 'slate', offer: 'violet',
  pending: 'amber', processed: 'blue', in_progress: 'blue', manager_review: 'violet', self_review: 'amber', scheduled: 'blue',
  half_day: 'amber', late: 'amber', on_notice: 'amber', at_risk: 'amber', on_hold: 'amber', screening: 'blue', interview: 'violet', enrolled: 'slate',
  rejected: 'red', absent: 'red', exited: 'red', cancelled: 'slate', behind: 'red', in_repair: 'amber', retired: 'slate', high: 'red', urgent: 'red',
  manager_approved: 'violet', withdrawn: 'slate', reimbursed: 'green', draft: 'slate', probation: 'amber', extended: 'amber', confirmed: 'green',
  todo: 'slate', review: 'violet', done: 'green', inside: 'green', outside: 'amber', idle: 'amber', offline: 'slate', paused: 'violet', productive: 'green', unproductive: 'red', neutral: 'blue',
  sent: 'green', logged: 'blue', queued: 'slate', retrying: 'amber', failed: 'red',
  medium: 'amber', low: 'slate', leave: 'violet', holiday: 'blue', remote: 'blue', applied: 'slate', admin: 'violet', hr: 'blue', manager: 'amber', employee: 'slate',
};
export function Badge({ children, color, status, className = '', ...rest }) {
  const key = color || STATUS_COLOR[status] || 'slate';
  return (
    <span {...rest} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', STATUS_STYLES[key], className)}>
      {children ?? titleCase(status)}
    </span>
  );
}

export function Progress({ value = 0, color = 'bg-brand-500', className = '' }) {
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', className)}>
      <div className={cx('h-full rounded-full transition-all duration-500', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="hidden h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25 sm:flex">
            <Icon size={20} />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'brand', onClick }) {
  const tones = {
    brand: 'from-brand-500 to-violet-500 shadow-brand-500/30', green: 'from-emerald-500 to-teal-500 shadow-emerald-500/30',
    amber: 'from-amber-500 to-orange-500 shadow-amber-500/30', rose: 'from-rose-500 to-pink-500 shadow-rose-500/30',
    sky: 'from-sky-500 to-cyan-500 shadow-sky-500/30', slate: 'from-slate-500 to-slate-700 shadow-slate-500/30',
  };
  return (
    <div onClick={onClick} className={cx('card card-pad group transition hover:-translate-y-0.5 hover:shadow-md', onClick && 'cursor-pointer')}>
      <div className="flex items-start justify-between">
        <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg', tones[tone])}>
          {Icon && <Icon size={18} />}
        </div>
      </div>
      <div className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</div>
      <div className="mt-0.5 text-sm font-medium muted">{label}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
        <Icon size={24} />
      </div>
      <div className="font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {message && <p className="mt-1 max-w-sm text-sm muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={cx('mb-5 flex gap-6 overflow-x-auto border-b border-slate-200 dark:border-slate-800', className)} role="tablist">
      {tabs.map((t) => {
        const key = t.value ?? t;
        return (
          <button key={key} role="tab" aria-selected={value === key} className={cx('tab', value === key && 'active')} onClick={() => onChange(key)}>
            {t.label ?? t}
            {t.count !== undefined && t.count !== null && (
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MonthPicker({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
      <button className="btn-ghost btn-sm !px-2" aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}><ChevronLeft size={16} /></button>
      <span className="min-w-32 text-center text-sm font-semibold" data-testid="month-label">{monthLabel(value)}</span>
      <button className="btn-ghost btn-sm !px-2" aria-label="Next month" onClick={() => onChange(shiftMonth(value, 1))}><ChevronRight size={16} /></button>
    </div>
  );
}

// ---------- overlays ----------
function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEscape(open, onClose);
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl animate-pop dark:bg-slate-900 sm:rounded-2xl', sizes[size])}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button className="btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={cx('absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl animate-slide-in dark:bg-slate-900', width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button className="btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', danger }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy}
          onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>{confirmLabel}</button>
      </>}>
      <p className="text-sm muted">{message}</p>
    </Modal>
  );
}

// ---------- toasts ----------
export function Toaster() {
  const toasts = useSelector((s) => s.ui.toasts);
  const dispatch = useDispatch();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
      {toasts.map((t) => <Toast key={t.id} toast={t} onClose={() => dispatch(dismissToast(t.id))} />)}
    </div>
  );
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    const id = setTimeout(onClose, 3800);
    return () => clearTimeout(id);
  }, [onClose]);
  const Icon = toast.type === 'error' ? AlertCircle : toast.type === 'info' ? Info : CheckCircle2;
  const color = toast.type === 'error' ? 'text-rose-500' : toast.type === 'info' ? 'text-sky-500' : 'text-emerald-500';
  return (
    <div role="status" className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl animate-pop dark:border-slate-700 dark:bg-slate-800">
      <Icon className={cx('mt-0.5 shrink-0', color)} size={18} />
      <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">{toast.message}</div>
      <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss"><X size={16} /></button>
    </div>
  );
}
