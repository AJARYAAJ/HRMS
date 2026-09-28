import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus, XCircle, PartyPopper, Trash2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, MonthPicker, CardSkeleton, Skeleton, Confirm, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { thisMonth, todayStr, date, shortDate } from '../lib/format';

function Balances() {
  const { data = [], isLoading } = useGet('leave/balances');
  if (isLoading) return <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="card card-pad space-y-3"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-8 w-1/3" /><Skeleton className="h-2 w-full" /></div>)}</div>;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6" data-testid="leave-balances">
      {data.map((b) => {
        const lop = b.code === 'LOP';
        const pct = lop || !b.allocated ? 0 : (b.available / b.allocated) * 100;
        return (
          <div key={b.leave_type_id} className="card card-pad relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: b.color }} />
            <div className="text-sm font-semibold muted">{b.name}</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-900 dark:text-white" data-testid={`balance-${b.code}`}>{lop ? b.used : b.available}</span>
              <span className="text-sm muted">{lop ? 'days taken' : `/ ${b.allocated}`}</span>
            </div>
            {!lop && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: b.color }} />
              </div>
            )}
            <div className="mt-2 text-xs muted">{b.used} used{b.pending ? ` · ${b.pending} pending` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

function TeamCalendar() {
  const [month, setMonth] = useState(thisMonth());
  const { data, isLoading } = useGet('leave/calendar', { month });
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const people = useMemo(() => {
    const map = new Map();
    for (const l of data?.leaves || []) {
      if (!map.has(l.employee_id)) map.set(l.employee_id, { id: l.employee_id, name: l.employee_name, color: l.avatar_color, leaves: [] });
      map.get(l.employee_id).leaves.push(l);
    }
    return [...map.values()];
  }, [data]);
  const hol = new Set((data?.holidays || []).map((h) => h.date));
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
        <h3 className="font-semibold">Who's on leave</h3>
        <MonthPicker value={month} onChange={setMonth} />
      </div>
      {isLoading ? <div className="p-4"><CardSkeleton lines={6} className="!border-0 !p-0 !shadow-none" /></div> : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 220 + days * 32 }}>
            <div className="flex border-b border-slate-100 text-[10px] font-semibold text-slate-400 dark:border-slate-800">
              <div className="w-[220px] shrink-0 px-4 py-2">EMPLOYEE</div>
              {Array.from({ length: days }, (_, i) => {
                const dow = new Date(y, m - 1, i + 1).getDay();
                return <div key={i} className={cx('w-8 shrink-0 py-2 text-center', (dow === 0 || dow === 6) && 'bg-slate-50 dark:bg-slate-800/40')}>{i + 1}</div>;
              })}
            </div>
            {people.length === 0 && <div className="p-8 text-center text-sm muted">No leaves this month.</div>}
            {people.map((p) => (
              <div key={p.id} className="flex items-center border-b border-slate-50 dark:border-slate-800/60">
                <div className="flex w-[220px] shrink-0 items-center gap-2 px-4 py-2"><Avatar name={p.name} color={p.color} size="xs" /><span className="truncate text-sm font-medium">{p.name}</span></div>
                {Array.from({ length: days }, (_, i) => {
                  const ds = `${month}-${String(i + 1).padStart(2, '0')}`;
                  const dow = new Date(y, m - 1, i + 1).getDay();
                  const l = p.leaves.find((x) => ds >= x.start_date && ds <= x.end_date);
                  const off = dow === 0 || dow === 6 || hol.has(ds);
                  return (
                    <div key={i} className={cx('h-10 w-8 shrink-0 p-0.5', off && 'bg-slate-50 dark:bg-slate-800/40')}>
                      {l && !off && <div title={`${l.leave_type} (${l.status})`} className={cx('h-full w-full rounded-md', l.status === 'pending' && 'opacity-50')} style={{ background: l.color }} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3 border-t border-slate-100 p-3 text-xs muted dark:border-slate-800"><span>Faded = pending approval</span><span>Grey columns = weekends & holidays</span></div>
    </div>
  );
}

function Holidays() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('holidays');
  const [act] = useAction();
  const add = useDisclosure();
  const upcoming = data.filter((h) => h.date >= todayStr());
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> Add holiday</button></div>}
      {isLoading ? <CardSkeleton lines={6} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((h) => (
            <div key={h.id} className={cx('card flex items-center gap-4 p-4', h.date < todayStr() && 'opacity-50')}>
              <div className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
                <span className="text-[10px] font-bold uppercase">{date(h.date, { month: 'short' })}</span>
                <span className="text-xl font-bold leading-none">{date(h.date, { day: '2-digit' })}</span>
              </div>
              <div className="flex-1">
                <div className="font-semibold">{h.name}</div>
                <div className="text-xs muted">{date(h.date, { weekday: 'long', year: 'numeric' })}</div>
              </div>
              <Badge color={h.type === 'Public' ? 'blue' : 'slate'}>{h.type}</Badge>
              {isHR && <button className="text-slate-400 hover:text-rose-500" aria-label="Delete holiday" onClick={() => act(`holidays/${h.id}`, { method: 'DELETE', success: 'Holiday removed' })}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      )}
      <p className="text-sm muted">{upcoming.length} upcoming holidays</p>
      <FormModal open={add.open} onClose={add.onClose} title="Add holiday"
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'type', label: 'Type', type: 'select', options: ['Public', 'Optional'], noEmpty: true }]}
        initial={{ type: 'Public' }}
        onSubmit={(v) => act('holidays', { body: v, success: 'Holiday added' })} />
    </div>
  );
}

function RequestsTable({ all }) {
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = useGet('leave/requests', all ? { status } : { mine: 1, status });
  const [act] = useAction();
  const [cancel, setCancel] = useState(null);
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'leave_type', 'reason']} exportName="leave-requests" maxHeight="520px"
        toolbar={<select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
        </select>}
        columns={[
          ...(all ? [{ key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate font-medium">{r.employee_name}</span></div> }] : []),
          { key: 'leave_type', header: 'Type', render: (r) => <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.leave_type}</span> },
          { key: 'start_date', header: 'Dates', width: 'minmax(170px, 1.2fr)', render: (r) => `${shortDate(r.start_date)}${r.end_date !== r.start_date ? ` → ${shortDate(r.end_date)}` : ''}`, csv: (r) => `${r.start_date} to ${r.end_date}` },
          { key: 'days', header: 'Days', render: (r) => (r.half_day ? '½' : r.days) },
          { key: 'reason', header: 'Reason', width: 'minmax(160px, 1.5fr)' },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'actions', header: '', sortable: false, csv: false, render: (r) => (['pending', 'approved'].includes(r.status) && r.end_date >= todayStr() && !all ? (
            <button className="btn-ghost btn-sm text-rose-600" onClick={() => setCancel(r)}><XCircle size={14} /> Cancel</button>
          ) : null) },
        ]} />
      <Confirm open={!!cancel} onClose={() => setCancel(null)} danger confirmLabel="Cancel leave" title="Cancel leave request?"
        message="Your balance will be restored if the leave was already approved."
        onConfirm={() => act(`leave/requests/${cancel.id}/cancel`, { success: 'Leave cancelled' })} />
    </>
  );
}

export default function Leave() {
  const { isHR } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'mine';
  const apply = useDisclosure(params.get('apply') === '1');
  const { data: types = [] } = useGet('leave/types');
  const [act] = useAction();
  useEffect(() => { if (params.get('apply') === '1') apply.onOpen(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <PageHeader icon={CalendarDays} title="Leave" subtitle="Balances, requests, team calendar and holiday list"
        actions={<button className="btn-primary" onClick={() => apply.onOpen()} data-testid="apply-leave"><Plus size={16} /> Apply leave</button>} />
      <Balances />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'mine', label: 'My requests' }, { value: 'calendar', label: 'Team calendar' }, { value: 'holidays', label: 'Holidays' },
        ...(isHR ? [{ value: 'all', label: 'All requests' }] : []),
      ]} />
      {tab === 'mine' && <RequestsTable />}
      {tab === 'all' && isHR && <RequestsTable all />}
      {tab === 'calendar' && <TeamCalendar />}
      {tab === 'holidays' && <Holidays />}
      <FormModal open={apply.open} onClose={() => { apply.onClose(); if (params.get('apply')) setParams({}); }} title="Apply for leave" submitLabel="Submit request"
        initial={{ start_date: todayStr(), end_date: todayStr(), half_day: 0 }}
        fields={[
          { name: 'leave_type_id', label: 'Leave type', type: 'select', required: true, full: true, options: types.map((t) => [t.id, t.name]) },
          { name: 'start_date', label: 'From', type: 'date', required: true },
          { name: 'end_date', label: 'To', type: 'date', required: true },
          { name: 'half_day', label: 'Half day (single date only)', type: 'checkbox', full: true },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true, placeholder: 'Briefly describe the reason' },
        ]}
        onSubmit={(v) => act('leave/requests', { body: { ...v, leave_type_id: Number(v.leave_type_id), end_date: v.half_day ? v.start_date : v.end_date }, success: 'Leave request submitted' })}>
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-3 text-xs text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"><PartyPopper size={14} /> Weekends and company holidays are excluded automatically.</div>
      </FormModal>
    </div>
  );
}
