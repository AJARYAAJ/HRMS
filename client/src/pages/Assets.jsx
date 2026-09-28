import { useState } from 'react';
import { Laptop, Plus, Pencil, Package, Wrench, UserCheck } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, StatCard, StatSkeletons } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, date } from '../lib/format';

const FIELDS = [
  { name: 'asset_tag', label: 'Asset tag', required: true }, { name: 'name', label: 'Name / model', required: true },
  { name: 'category', label: 'Category', type: 'select', options: ['Laptop', 'Monitor', 'Mobile', 'Accessory', 'Furniture', 'Other'] },
  { name: 'serial_no', label: 'Serial number' }, { name: 'assigned_to', label: 'Assigned to', type: 'employee' },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['available', 'Available'], ['assigned', 'Assigned'], ['in_repair', 'In repair'], ['retired', 'Retired']] },
  { name: 'purchase_date', label: 'Purchase date', type: 'date' }, { name: 'cost', label: 'Cost (₹)', type: 'number', min: 0 },
];

export default function Assets() {
  const { isHR } = useAuth();
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = useGet('assets', { status });
  const [act] = useAction();
  const form = useDisclosure();
  const count = (s) => data.filter((a) => a.status === s).length;

  return (
    <div className="space-y-6">
      <PageHeader icon={Laptop} title={isHR ? 'Asset management' : 'My assets'} subtitle={isHR ? 'Track company hardware, allocation and repairs' : 'Company equipment assigned to you'}
        actions={isHR && <button className="btn-primary" onClick={() => form.onOpen()}><Plus size={16} /> Add asset</button>} />
      {isHR && (isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Package} label="Total assets" value={data.length} hint={money(data.reduce((a, x) => a + (x.cost || 0), 0))} />
          <StatCard icon={UserCheck} tone="sky" label="Assigned" value={count('assigned')} />
          <StatCard icon={Laptop} tone="green" label="Available" value={count('available')} />
          <StatCard icon={Wrench} tone="amber" label="In repair" value={count('in_repair')} />
        </div>
      ))}
      <DataTable loading={isLoading} rows={data} searchKeys={['asset_tag', 'name', 'serial_no', 'assigned_name']} exportName="assets"
        toolbar={isHR && <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option><option value="assigned">Assigned</option><option value="available">Available</option><option value="in_repair">In repair</option><option value="retired">Retired</option>
        </select>}
        columns={[
          { key: 'asset_tag', header: 'Tag', render: (r) => <span className="font-mono text-xs font-semibold">{r.asset_tag}</span> },
          { key: 'name', header: 'Asset', width: 'minmax(180px, 2fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.category} · {r.serial_no}</div></div> },
          { key: 'assigned_name', header: 'Assigned to', render: (r) => r.assigned_name || '—' },
          { key: 'purchase_date', header: 'Purchased', render: (r) => date(r.purchase_date) },
          { key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost) },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          ...(isHR ? [{ key: 'e', header: '', sortable: false, csv: false, render: (r) => <button className="btn-ghost btn-sm" onClick={() => form.onOpen(r)} aria-label="Edit asset"><Pencil size={14} /></button> }] : []),
        ]} />
      <FormModal open={form.open} onClose={form.onClose} title={form.payload ? 'Edit asset' : 'Add asset'} fields={FIELDS} initial={form.payload || { status: 'available' }}
        onSubmit={(v) => (form.payload ? act(`assets/${form.payload.id}`, { method: 'PUT', body: v, success: 'Asset updated' }) : act('assets', { body: v, success: 'Asset added' }))} />
    </div>
  );
}
