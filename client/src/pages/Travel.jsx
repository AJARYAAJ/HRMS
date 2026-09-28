import { useState } from 'react';
import { Plane, Plus, Trash2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, Drawer, StatCard, EmptyState } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import ApprovalTrail from '../components/ApprovalTrail';
import { money, date, todayStr } from '../lib/format';

/** Travel requests with advances (Zoho People / Keka style), approved manager → HR. */
export default function Travel() {
  const { isManager, user } = useAuth();
  const [tab, setTab] = useState('mine');
  const { data = [], isLoading } = useGet('travel', tab === 'mine' ? { mine: 1 } : {});
  const [act] = useAction();
  const add = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const open = data.find((t) => t.id === openId);
  const upcoming = data.filter((t) => t.status === 'approved' && t.depart_date >= todayStr());
  return (
    <div className="space-y-6">
      <PageHeader icon={Plane} title="Travel" subtitle="Plan business trips, request advances and track approvals"
        actions={<button className="btn-primary" onClick={() => add.onOpen()} data-testid="new-travel"><Plus size={16} /> New trip</button>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Plane} label="Upcoming trips" value={upcoming.length} hint={upcoming[0] ? `Next: ${upcoming[0].to_city} on ${date(upcoming[0].depart_date)}` : undefined} />
        <StatCard icon={Plane} tone="amber" label="Awaiting approval" value={data.filter((t) => ['pending', 'manager_approved'].includes(t.status)).length} />
        <StatCard icon={Plane} tone="green" label="Advances approved" value={money(data.filter((t) => t.status === 'approved').reduce((a, t) => a + (t.advance_amount || 0), 0))} />
      </div>
      {isManager && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'My trips' }, { value: 'team', label: 'Team trips' }]} />}
      <DataTable loading={isLoading} rows={data} searchKeys={['purpose', 'from_city', 'to_city', 'employee_name']} exportName="travel" onRowClick={(r) => setOpenId(r.id)}
        empty={<EmptyState icon={Plane} title="No trips yet" message="Raise a travel request before booking so it can be approved and any advance paid." />}
        columns={[
          ...(tab === 'team' ? [{ key: 'employee_name', header: 'Employee', width: 'minmax(180px, 1.4fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> }] : []),
          { key: 'route', header: 'Route', sortValue: (r) => r.to_city, render: (r) => <span className="font-semibold">{r.from_city} → {r.to_city}</span>, csv: (r) => `${r.from_city} to ${r.to_city}` },
          { key: 'depart_date', header: 'Dates', render: (r) => `${date(r.depart_date, { day: '2-digit', month: 'short' })}${r.return_date ? ` – ${date(r.return_date, { day: '2-digit', month: 'short' })}` : ''}` },
          { key: 'purpose', header: 'Purpose', width: 'minmax(180px, 1.8fr)' },
          { key: 'estimated_cost', header: 'Estimate', align: 'right', render: (r) => money(r.estimated_cost) },
          { key: 'advance_amount', header: 'Advance', align: 'right', render: (r) => (r.advance_amount ? money(r.advance_amount) : '—') },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="New travel request" submitLabel="Submit for approval" initial={{ mode: 'Flight', from_city: 'Bengaluru', depart_date: todayStr(), billable: 0 }}
        fields={[
          { name: 'purpose', label: 'Purpose', required: true, full: true },
          { name: 'from_city', label: 'From', required: true }, { name: 'to_city', label: 'To', required: true },
          { name: 'depart_date', label: 'Departure', type: 'date', required: true, min: todayStr() }, { name: 'return_date', label: 'Return', type: 'date' },
          { name: 'mode', label: 'Mode', type: 'select', noEmpty: true, options: ['Flight', 'Train', 'Bus', 'Cab', 'Own vehicle'] },
          { name: 'estimated_cost', label: 'Estimated cost (₹)', type: 'number', min: 0 },
          { name: 'advance_amount', label: 'Advance needed (₹)', type: 'number', min: 0 },
          { name: 'billable', label: 'Billable to client', type: 'checkbox' },
        ]}
        onSubmit={(v) => act('travel', { body: v, success: 'Travel request submitted' })} />
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.from_city} → ${open.to_city}` : ''}>
        {open && (
          <div className="space-y-5">
            <Badge status={open.status} />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs muted">Traveller</div><div className="font-medium">{open.employee_name}</div></div>
              <div><div className="text-xs muted">Mode</div><div className="font-medium">{open.mode || '—'}</div></div>
              <div><div className="text-xs muted">Departure</div><div className="font-medium">{date(open.depart_date)}</div></div>
              <div><div className="text-xs muted">Return</div><div className="font-medium">{date(open.return_date)}</div></div>
              <div><div className="text-xs muted">Estimate</div><div className="font-medium">{money(open.estimated_cost)}</div></div>
              <div><div className="text-xs muted">Advance</div><div className="font-medium">{money(open.advance_amount)}</div></div>
              <div className="col-span-2"><div className="text-xs muted">Purpose</div><div className="font-medium">{open.purpose}</div></div>
            </div>
            <ApprovalTrail entity="travel_requests" id={open.id} status={open.status} flow="manager_hr" />
            {open.employee_id === user.id && open.status === 'pending' && (
              <button className="btn-ghost btn-sm text-rose-600" onClick={async () => { if (await act(`travel/${open.id}`, { method: 'DELETE', success: 'Request withdrawn' })) setOpenId(null); }}><Trash2 size={14} /> Withdraw request</button>
            )}
            <p className="text-xs muted">After the trip, submit bills under Expenses — approved claims are reimbursed with your salary.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
