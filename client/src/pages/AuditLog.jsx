import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { PageHeader, Avatar, Badge } from '../components/ui';
import DataTable from '../components/DataTable';
import { dateTime, titleCase } from '../lib/format';

const ACTION_COLOR = { create: 'green', update: 'blue', delete: 'red', approved: 'green', rejected: 'red', login: 'slate', run_payroll: 'violet', pay_payroll: 'violet' };

export default function AuditLog() {
  const [entity, setEntity] = useState('');
  const { data = [], isLoading } = useGet('audit-logs', { entity }, { fresh: true });
  const entities = ['employees', 'leave_requests', 'attendance', 'payroll_runs', 'expenses', 'regularizations', 'candidates', 'settings', 'assets', 'tickets'];
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Audit log" subtitle="Tamper-evident trail of every sensitive action in the system" />
      <DataTable loading={isLoading} rows={data} searchKeys={['actor_name', 'action', 'entity']} exportName="audit-log"
        toolbar={<select className="input !w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entity filter"><option value="">All modules</option>{entities.map((e) => <option key={e} value={e}>{titleCase(e)}</option>)}</select>}
        columns={[
          { key: 'created_at', header: 'Time (UTC)', render: (r) => dateTime(r.created_at) },
          { key: 'actor_name', header: 'User', width: 'minmax(180px, 1.4fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.actor_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.actor_name || 'System'}</span></div> },
          { key: 'action', header: 'Action', render: (r) => <Badge color={ACTION_COLOR[r.action] || 'slate'}>{titleCase(r.action)}</Badge> },
          { key: 'entity', header: 'Module', render: (r) => titleCase(r.entity) },
          { key: 'entity_id', header: 'Record', render: (r) => (r.entity_id ? `#${r.entity_id}` : '—') },
          { key: 'details', header: 'Details', width: 'minmax(200px, 2fr)', render: (r) => <span className="font-mono text-xs muted">{r.details || '—'}</span> },
        ]} />
    </div>
  );
}
