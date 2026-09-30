import { useNavigate } from 'react-router-dom';
import { FolderKanban, Plus } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Progress, StatCard, EmptyState } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { useState } from 'react';
import { date, todayStr } from '../lib/format';

export const BILLING = [['time_materials', 'Time & materials'], ['fixed', 'Fixed price'], ['non_billable', 'Non-billable']];
export const HEALTH = [['on_track', 'On track'], ['at_risk', 'At risk'], ['off_track', 'Off track']];

export const PROJECT_FIELDS = [
  { name: 'name', label: 'Project name', required: true, full: true },
  { name: 'client_id', label: 'Client', type: 'lookup', path: 'clients' },
  { name: 'code', label: 'Code', placeholder: 'PRJ-106' },
  { name: 'billing_type', label: 'Billing', type: 'select', noEmpty: true, options: BILLING },
  { name: 'manager_id', label: 'Project manager', type: 'employee' },
  { name: 'start_date', label: 'Start', type: 'date' },
  { name: 'end_date', label: 'End', type: 'date' },
  { name: 'budget_hours', label: 'Budget (hours)', type: 'number', min: 0 },
  { name: 'budget_amount', label: 'Budget (₹)', type: 'number', min: 0 },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed']] },
  { name: 'health', label: 'Health', type: 'select', noEmpty: true, options: HEALTH },
  { name: 'description', label: 'Description', type: 'textarea', full: true },
];

export default function Projects() {
  const { isManager } = useAuth();
  const [status, setStatus] = useState('active');
  const { data = [], isLoading } = useGet('projects', { status });
  const [act] = useAction();
  const form = useDisclosure();
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <PageHeader icon={FolderKanban} title="Projects" subtitle="Client and internal projects — team, budget, milestones and profitability"
        actions={isManager && <button className="btn-primary" onClick={() => form.onOpen()} data-testid="new-project"><Plus size={16} /> New project</button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="Projects" value={data.length} hint={status ? `${status.replace('_', ' ')}` : 'all'} />
        <StatCard icon={FolderKanban} tone="amber" label="At risk / off track" value={data.filter((p) => p.health !== 'on_track').length} />
        <StatCard icon={FolderKanban} tone="sky" label="Hours logged" value={Math.round(data.reduce((a, p) => a + p.logged_hours, 0)).toLocaleString('en-IN')} />
        <StatCard icon={FolderKanban} tone="green" label="Billable share" value={`${(() => { const l = data.reduce((a, p) => a + p.logged_hours, 0); return l ? Math.round((data.reduce((a, p) => a + p.billable_hours, 0) / l) * 100) : 0; })()}%`} />
      </div>
      <DataTable loading={isLoading} rows={data} searchKeys={['name', 'code', 'client_name', 'manager_name']} exportName="projects" onRowClick={(r) => navigate(`/projects/${r.id}`)}
        toolbar={<select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="">All</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select>}
        empty={<EmptyState icon={FolderKanban} title="No projects" />}
        columns={[
          { key: 'name', header: 'Project', width: 'minmax(220px, 1.8fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{[r.code, r.client_name].filter(Boolean).join(' · ')}</div></div> },
          { key: 'billing_type', header: 'Billing', render: (r) => <Badge status={r.billing_type}>{BILLING.find((b) => b[0] === r.billing_type)?.[1]}</Badge> },
          { key: 'manager_name', header: 'Manager', render: (r) => r.manager_name || '—' },
          { key: 'members', header: 'Team', align: 'right' },
          { key: 'burn', header: 'Hours vs budget', width: 'minmax(160px, 1.2fr)', sortValue: (r) => (r.budget_hours ? r.logged_hours / r.budget_hours : 0), csv: (r) => `${r.logged_hours}/${r.budget_hours || ''}`, render: (r) => (r.budget_hours ? (
            <div className="w-full"><div className="mb-1 flex justify-between text-xs"><span>{Math.round(r.logged_hours)} h</span><span className="muted">{r.budget_hours} h</span></div>
              <Progress value={Math.min(100, (r.logged_hours / r.budget_hours) * 100)} color={r.logged_hours > r.budget_hours ? 'bg-rose-500' : r.logged_hours > r.budget_hours * 0.85 ? 'bg-amber-500' : 'bg-brand-500'} /></div>
          ) : <span className="text-xs muted">{Math.round(r.logged_hours)} h · no budget</span>) },
          { key: 'end_date', header: 'Ends', render: (r) => <span className={r.end_date && r.end_date < todayStr() && r.status === 'active' ? 'font-semibold text-rose-600' : ''}>{date(r.end_date)}</span> },
          { key: 'health', header: 'Health', render: (r) => <Badge status={r.health}>{HEALTH.find((h) => h[0] === r.health)?.[1]}</Badge> },
        ]} />
      <FormModal open={form.open} onClose={form.onClose} size="lg" title="New project" fields={PROJECT_FIELDS} initial={{ billing_type: 'time_materials', status: 'active', health: 'on_track', start_date: todayStr() }}
        onSubmit={async (v) => { const r = await act('projects', { body: v, success: 'Project created' }); if (r?.id) navigate(`/projects/${r.id}`); return r; }} />
    </div>
  );
}

