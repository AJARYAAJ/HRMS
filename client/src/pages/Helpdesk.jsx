import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Plus, MessageSquare } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Avatar, Drawer, Tabs } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal, EmployeeSelect } from '../components/Form';
import { timeAgo, dateTime } from '../lib/format';

export default function Helpdesk() {
  const { isHR } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState(isHR ? 'all' : 'mine');
  const { data = [], isLoading } = useGet('tickets', { status, ...(tab === 'mine' ? { mine: 1 } : {}) });
  const [act] = useAction();
  const add = useDisclosure();
  const [open, setOpen] = useState(null);
  const [resolution, setResolution] = useState('');
  useEffect(() => { if (params.get('new') === '1') { add.onOpen(); setParams({}); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticket = open && data.find((t) => t.id === open.id);

  return (
    <div>
      <PageHeader icon={LifeBuoy} title="Helpdesk" subtitle="Raise and track HR, IT, payroll and facilities requests"
        actions={<button className="btn-primary" onClick={() => add.onOpen()} data-testid="new-ticket"><Plus size={16} /> New ticket</button>} />
      {isHR && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All tickets' }, { value: 'mine', label: 'My tickets' }]} />}
      <DataTable loading={isLoading} rows={data} searchKeys={['subject', 'category', 'employee_name']} exportName="tickets" onRowClick={(r) => { setOpen(r); setResolution(r.resolution || ''); }}
        toolbar={<select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>}
        columns={[
          { key: 'id', header: '#', width: '70px', render: (r) => <span className="font-mono text-xs muted">#{r.id}</span> },
          { key: 'subject', header: 'Subject', width: 'minmax(240px, 2.5fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.subject}</div><div className="truncate text-xs muted">{r.employee_name} · {timeAgo(r.created_at)}</div></div> },
          { key: 'category', header: 'Category' },
          { key: 'priority', header: 'Priority', render: (r) => <Badge status={r.priority} /> },
          { key: 'assignee_name', header: 'Assignee', render: (r) => r.assignee_name || <span className="muted">Unassigned</span> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="Raise a ticket" submitLabel="Submit ticket" initial={{ priority: 'medium', category: 'HR' }}
        fields={[
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['HR', 'IT', 'Payroll', 'Facilities', 'Finance', 'Other'] },
          { name: 'priority', label: 'Priority', type: 'select', noEmpty: true, options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
          { name: 'subject', label: 'Subject', required: true, full: true },
          { name: 'description', label: 'Describe the issue', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => act('tickets', { body: v, success: 'Ticket raised — HR has been notified' })} />
      <Drawer open={!!ticket} onClose={() => setOpen(null)} title={ticket ? `Ticket #${ticket.id}` : ''}>
        {ticket && (
          <div className="space-y-5">
            <div>
              <div className="flex gap-2"><Badge status={ticket.status} /><Badge status={ticket.priority} /><Badge color="slate">{ticket.category}</Badge></div>
              <h3 className="mt-3 text-lg font-bold">{ticket.subject}</h3>
              <div className="mt-2 flex items-center gap-2 text-sm muted"><Avatar name={ticket.employee_name} color={ticket.avatar_color} size="xs" />{ticket.employee_name} · {dateTime(ticket.created_at)}</div>
            </div>
            <p className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">{ticket.description}</p>
            {ticket.resolution && !isHR && <div className="rounded-xl bg-emerald-50 p-4 text-sm dark:bg-emerald-500/10"><div className="mb-1 flex items-center gap-1.5 font-semibold"><MessageSquare size={14} /> Resolution</div>{ticket.resolution}</div>}
            {isHR && (
              <div className="space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div><label className="label">Assignee</label><EmployeeSelect value={ticket.assignee_id} onChange={(v) => act(`tickets/${ticket.id}`, { method: 'PUT', body: { assignee_id: v }, success: 'Assignee updated' })} placeholder="Unassigned" filter={(e) => e.role !== 'employee'} /></div>
                <div><label className="label">Status</label>
                  <select className="input" value={ticket.status} onChange={(e) => act(`tickets/${ticket.id}`, { method: 'PUT', body: { status: e.target.value }, success: 'Status updated' })} data-testid="ticket-status">
                    {['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select></div>
                <div><label className="label" htmlFor="resolution">Resolution note</label><textarea id="resolution" className="input min-h-24" value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
                <button className="btn-primary" onClick={() => act(`tickets/${ticket.id}`, { method: 'PUT', body: { resolution, status: 'resolved' }, success: 'Ticket resolved' })}>Resolve ticket</button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
