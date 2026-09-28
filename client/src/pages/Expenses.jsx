import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt, Plus, Trash2, Wallet, Clock, CheckCircle2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, StatCard, StatSkeletons } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, date, todayStr } from '../lib/format';

const CATEGORIES = ['Travel', 'Food & Meals', 'Internet', 'Client Entertainment', 'Office Supplies', 'Training', 'Relocation', 'Other'];

export default function Expenses() {
  const { isManager } = useAuth();
  const [tab, setTab] = useState('mine');
  const [params, setParams] = useSearchParams();
  const { data = [], isLoading } = useGet('expenses', tab === 'mine' ? { mine: 1 } : {});
  const [act] = useAction();
  const add = useDisclosure();
  useEffect(() => { if (params.get('new') === '1') { add.onOpen(); setParams({}); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (s) => data.filter((e) => e.status === s).reduce((a, e) => a + e.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader icon={Receipt} title="Expenses & reimbursements" subtitle="Submit claims and track reimbursement status"
        actions={<button className="btn-primary" onClick={() => add.onOpen()} data-testid="new-expense"><Plus size={16} /> New claim</button>} />
      {isManager && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'My claims' }, { value: 'team', label: 'Team claims' }]} />}
      {isLoading ? <StatSkeletons count={3} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={Clock} tone="amber" label="Pending" value={money(sum('pending'))} />
          <StatCard icon={CheckCircle2} tone="green" label="Approved" value={money(sum('approved'))} />
          <StatCard icon={Wallet} label="Total claimed" value={money(data.reduce((a, e) => a + e.amount, 0))} hint={`${data.length} claims`} />
        </div>
      )}
      <DataTable loading={isLoading} rows={data} searchKeys={['category', 'description', 'employee_name']} exportName="expenses"
        columns={[
          ...(tab === 'team' ? [{ key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> }] : []),
          { key: 'date', header: 'Date', render: (r) => date(r.date) },
          { key: 'category', header: 'Category' },
          { key: 'description', header: 'Description', width: 'minmax(200px, 2fr)' },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'approver_name', header: 'Approver', render: (r) => r.approver_name || '—' },
          { key: 'x', header: '', sortable: false, csv: false, render: (r) => tab === 'mine' && r.status === 'pending' && <button className="text-slate-400 hover:text-rose-500" aria-label="Delete claim" onClick={() => act(`expenses/${r.id}`, { method: 'DELETE', success: 'Claim withdrawn' })}><Trash2 size={15} /></button> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="New expense claim" submitLabel="Submit claim" initial={{ date: todayStr() }}
        fields={[
          { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
          { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
          { name: 'date', label: 'Expense date', type: 'date', required: true, max: todayStr() },
          { name: 'description', label: 'Description', required: true },
        ]}
        onSubmit={(v) => act('expenses', { body: v, success: 'Expense claim submitted' })} />
    </div>
  );
}
