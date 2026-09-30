import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Laptop, Plus, Pencil, Package, Wrench, UserCheck, ShieldAlert, CheckCircle2, Undo2, UserPlus, History, Inbox } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, StatCard, StatSkeletons, Tabs, Drawer, Avatar, EmptyState, CardSkeleton } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, date, dateTime, titleCase, todayStr } from '../lib/format';

const CATEGORIES = ['Laptop', 'Monitor', 'Mobile', 'Accessory', 'Furniture', 'Other'];
const CONDITIONS = [['new', 'New'], ['good', 'Good'], ['fair', 'Fair'], ['damaged', 'Damaged (send to repair)'], ['lost', 'Lost (retire)']];
const FIELDS = [
  { name: 'asset_tag', label: 'Asset tag', required: true }, { name: 'name', label: 'Name / model', required: true },
  { name: 'category', label: 'Category', type: 'select', options: CATEGORIES },
  { name: 'serial_no', label: 'Serial number' },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['available', 'Available'], ['in_repair', 'In repair'], ['retired', 'Retired']], hidden: (v) => v.status === 'assigned' },
  { name: 'condition', label: 'Condition', type: 'select', noEmpty: true, options: CONDITIONS.slice(0, 4) },
  { name: 'purchase_date', label: 'Purchase date', type: 'date' }, { name: 'warranty_until', label: 'Warranty until', type: 'date' },
  { name: 'cost', label: 'Cost (₹)', type: 'number', min: 0 },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];
const ACTION_LABEL = { created: 'Added to inventory', assigned: 'Assigned', acknowledged: 'Receipt acknowledged', returned: 'Returned', lost: 'Reported lost', repair: 'Sent to repair', updated: 'Updated' };

function warrantyBadge(w) {
  if (!w) return null;
  const days = Math.round((new Date(`${w}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 86400000);
  if (days < 0) return <Badge color="slate">Warranty ended</Badge>;
  if (days <= 60) return <Badge color="amber">Warranty ends in {days}d</Badge>;
  return null;
}

function AssetDrawer({ asset, onClose, onEdit }) {
  const { isHR, user } = useAuth();
  const { data: history = [], isLoading } = useGet(asset ? `assets/${asset.id}/history` : null);
  const [act] = useAction();
  const assign = useDisclosure();
  const ret = useDisclosure();
  const { data: requests = [] } = useGet(isHR && asset ? 'asset-requests' : null, { status: 'approved' });
  if (!asset) return null;
  const mine = asset.assigned_to === user.id;
  return (
    <Drawer open={!!asset} onClose={onClose} title={`${asset.asset_tag} · ${asset.name}`}>
      <div className="space-y-5" data-testid="asset-drawer">
        <div className="flex flex-wrap items-center gap-2"><Badge status={asset.status} />{asset.condition && <Badge color="slate">{titleCase(asset.condition)}</Badge>}{warrantyBadge(asset.warranty_until)}
          {asset.assigned_to && (asset.acknowledged_at ? <Badge color="green">Acknowledged</Badge> : <Badge color="amber">Awaiting acknowledgement</Badge>)}</div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[['Category', asset.category], ['Serial number', asset.serial_no], ['Assigned to', asset.assigned_name], ['Assigned on', asset.assigned_on && date(asset.assigned_on)],
            ['Purchased', asset.purchase_date && date(asset.purchase_date)], ['Warranty until', asset.warranty_until && date(asset.warranty_until)], ['Cost', money(asset.cost)]].map(([k, v]) => (
            <div key={k}><dt className="text-xs muted">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>
          ))}
        </dl>
        {asset.notes && <p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/50">{asset.notes}</p>}
        <div className="flex flex-wrap gap-2">
          {mine && !asset.acknowledged_at && <button className="btn-primary" data-testid="acknowledge-asset" onClick={() => act(`assets/${asset.id}/acknowledge`, { body: {}, success: 'Thanks — receipt acknowledged' })}><CheckCircle2 size={16} /> I have received this</button>}
          {isHR && !asset.assigned_to && asset.status === 'available' && <button className="btn-primary" onClick={() => assign.onOpen()} data-testid="assign-asset"><UserPlus size={16} /> Assign</button>}
          {isHR && asset.assigned_to && <button className="btn-secondary" onClick={() => ret.onOpen()} data-testid="return-asset"><Undo2 size={16} /> Record return</button>}
          {isHR && <button className="btn-secondary" onClick={onEdit}><Pencil size={16} /> Edit</button>}
        </div>
        <div>
          <h4 className="mb-2 flex items-center gap-2 font-semibold"><History size={15} /> History</h4>
          {isLoading ? <CardSkeleton lines={3} /> : (
            <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700" data-testid="asset-history">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500 dark:border-slate-900" />
                  <div className="font-medium">{ACTION_LABEL[h.action] || titleCase(h.action)}{h.employee_name && ['assigned', 'returned', 'lost'].includes(h.action) ? ` · ${h.employee_name}` : ''}</div>
                  <div className="text-xs muted">{dateTime(h.created_at)}{h.by_name ? ` · by ${h.by_name}` : ''}{h.condition ? ` · ${h.condition}` : ''}</div>
                  {h.note && <div className="text-xs">{h.note}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <FormModal open={assign.open} onClose={assign.onClose} title={`Assign ${asset.asset_tag}`} submitLabel="Assign"
        fields={[{ name: 'employee_id', label: 'Employee', type: 'employee', required: true },
          { name: 'request_id', label: 'Fulfils request', type: 'select', options: requests.map((r) => [r.id, `${r.employee_name} · ${r.category}`]), placeholder: 'None' },
          { name: 'note', label: 'Note', full: true }]}
        onSubmit={(v) => act(`assets/${asset.id}/assign`, { body: { ...v, request_id: v.request_id ? Number(v.request_id) : undefined }, success: 'Asset assigned', invalidates: ['asset-requests'] })} />
      <FormModal open={ret.open} onClose={ret.onClose} title={`Return ${asset.asset_tag} from ${asset.assigned_name}`} submitLabel="Record return" initial={{ condition: 'good' }}
        fields={[{ name: 'condition', label: 'Condition on return', type: 'select', noEmpty: true, options: CONDITIONS.slice(1) }, { name: 'note', label: 'Note', full: true }]}
        onSubmit={(v) => act(`assets/${asset.id}/return`, { body: v, success: 'Return recorded', invalidates: ['exit'] })} />
    </Drawer>
  );
}

function Requests() {
  const { isHR, isManager } = useAuth();
  const { data = [], isLoading } = useGet('asset-requests', isManager ? {} : { mine: 1 });
  const [act] = useAction();
  const form = useDisclosure();
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['category', 'reason', 'employee_name']} testId="asset-requests"
        toolbar={<button className="btn-primary" onClick={() => form.onOpen()} data-testid="request-asset"><Plus size={16} /> Request an asset</button>}
        empty={<EmptyState icon={Inbox} title="No asset requests" message="Need a monitor, headset or phone? Raise a request." />}
        columns={[
          ...(isManager ? [{ key: 'employee_name', header: 'Employee', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" />{r.employee_name}</div> }] : []),
          { key: 'category', header: 'Item' },
          { key: 'reason', header: 'Reason', width: 'minmax(180px, 2fr)' },
          { key: 'needed_by', header: 'Needed by', render: (r) => (r.needed_by ? date(r.needed_by) : '—') },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{r.status === 'fulfilled' ? `Fulfilled · ${r.asset_tag}` : undefined}</Badge> },
          ...(isHR ? [] : [{ key: 'x', header: '', sortable: false, render: (r) => r.status === 'pending' && !isManager && <button className="text-xs font-semibold text-rose-600" onClick={() => act(`asset-requests/${r.id}`, { method: 'DELETE', success: 'Request withdrawn' })}>Withdraw</button> }]),
        ]} />
      <FormModal open={form.open} onClose={form.onClose} title="Request an asset" submitLabel="Submit request"
        fields={[{ name: 'category', label: 'What do you need?', type: 'select', required: true, options: CATEGORIES },
          { name: 'needed_by', label: 'Needed by', type: 'date', min: todayStr() },
          { name: 'reason', label: 'Reason', type: 'textarea', required: true, full: true }]}
        onSubmit={(v) => act('asset-requests', { body: v, success: 'Request submitted for approval' })} />
    </>
  );
}

export default function Assets() {
  const { isHR } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'assets';
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = useGet('assets', isHR ? { status } : { mine: 1 });
  const { data: sum } = useGet(isHR ? 'assets/summary' : null);
  const form = useDisclosure();
  const [act] = useAction();
  const [openId, setOpenId] = useState(null);
  const open = data.find((a) => a.id === openId);

  return (
    <div className="space-y-6">
      <PageHeader icon={Laptop} title={isHR ? 'Asset management' : 'My assets'} subtitle={isHR ? 'Inventory, assignment and acknowledgement, returns, requests and warranty' : 'Company equipment assigned to you, and requests for new equipment'}
        actions={isHR && tab === 'assets' && <button className="btn-primary" onClick={() => form.onOpen()}><Plus size={16} /> Add asset</button>} />
      {isHR && (!sum ? <StatSkeletons count={4} /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="asset-stats">
          <StatCard icon={Package} label="Assets" value={sum.total} hint={money(sum.value)} />
          <StatCard icon={UserCheck} tone="sky" label="Assigned" value={sum.assigned} hint={`${sum.unacknowledged} awaiting acknowledgement`} />
          <StatCard icon={Laptop} tone="green" label="Available" value={sum.available} hint={`${sum.in_repair} in repair`} />
          <StatCard icon={ShieldAlert} tone="amber" label="Warranty ending ≤ 60 days" value={sum.warranty_expiring} hint={`${sum.pending_requests} open request(s)`} />
        </div>
      ))}
      {isHR && sum?.exit_returns?.length > 0 && (
        <div className="card card-pad border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5" data-testid="exit-returns">
          <h3 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><Wrench size={16} /> Returns due from leavers</h3>
          <ul className="mt-2 space-y-1 text-sm">{sum.exit_returns.map((r) => <li key={r.id}><button className="font-medium text-brand-600" onClick={() => { setStatus(''); setOpenId(r.id); }}>{r.asset_tag} · {r.name}</button> — {r.employee_name}{r.exit_date ? `, last day ${date(r.exit_date)}` : ''}</li>)}</ul>
        </div>
      )}
      <Tabs value={tab} onChange={(t) => setParams(t === 'assets' ? {} : { tab: t })} tabs={[{ value: 'assets', label: isHR ? 'Inventory' : 'My assets' }, { value: 'requests', label: 'Requests', count: isHR ? sum?.pending_requests : undefined }]} />
      {tab === 'requests' ? <Requests /> : (
        <DataTable loading={isLoading} rows={data} searchKeys={['asset_tag', 'name', 'serial_no', 'assigned_name']} exportName="assets" onRowClick={(r) => setOpenId(r.id)}
          toolbar={isHR && <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option><option value="assigned">Assigned</option><option value="available">Available</option><option value="in_repair">In repair</option><option value="retired">Retired</option>
          </select>}
          empty={<EmptyState icon={Laptop} title={isHR ? 'No assets yet' : 'No assets assigned to you'} />}
          columns={[
            { key: 'asset_tag', header: 'Tag', render: (r) => <span className="font-mono text-xs font-semibold">{r.asset_tag}</span> },
            { key: 'name', header: 'Asset', width: 'minmax(180px, 2fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.category} · {r.serial_no}</div></div> },
            ...(isHR ? [{ key: 'assigned_name', header: 'Assigned to', render: (r) => r.assigned_name || '—' }] : []),
            { key: 'acknowledged_at', header: 'Receipt', render: (r) => (!r.assigned_to ? '—' : r.acknowledged_at ? <Badge color="green">Acknowledged</Badge> : <Badge color="amber">Pending</Badge>) },
            { key: 'warranty_until', header: 'Warranty', render: (r) => warrantyBadge(r.warranty_until) || (r.warranty_until ? date(r.warranty_until) : '—') },
            ...(isHR ? [{ key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost) }] : []),
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ]} />
      )}
      <AssetDrawer asset={open} onClose={() => setOpenId(null)} onEdit={() => form.onOpen(open)} />
      <FormModal open={form.open} onClose={form.onClose} title={form.payload ? 'Edit asset' : 'Add asset'} fields={FIELDS} initial={form.payload || { status: 'available', condition: 'new' }}
        onSubmit={(v) => (form.payload ? act(`assets/${form.payload.id}`, { method: 'PUT', body: v, success: 'Asset updated' }) : act('assets', { body: v, success: 'Asset added' }))} />
    </div>
  );
}
