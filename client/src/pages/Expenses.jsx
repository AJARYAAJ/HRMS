import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt, Plus, Trash2, Wallet, Clock, CheckCircle2, Paperclip } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Avatar, StatCard, StatSkeletons, Drawer } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { FileDrop, Attachments } from '../components/Files';
import { uploadAttachment, invalidateFiles } from '../lib/files';
import { money, date, todayStr, timeAgo } from '../lib/format';

const CATEGORIES = ['Travel', 'Food & Meals', 'Internet', 'Client Entertainment', 'Office Supplies', 'Training', 'Relocation', 'Other'];

export default function Expenses() {
  const { isManager, user } = useAuth();
  const [tab, setTab] = useState('mine');
  const [params, setParams] = useSearchParams();
  const { data = [], isLoading } = useGet('expenses', tab === 'mine' ? { mine: 1 } : {});
  const [act] = useAction();
  const toast = useToast();
  const add = useDisclosure();
  const [receipt, setReceipt] = useState(null);
  const [openId, setOpenId] = useState(null);
  const open = data.find((e) => e.id === openId);
  useEffect(() => { if (params.get('new') === '1') { add.onOpen(); setParams({}); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = (s) => data.filter((e) => e.status === s).reduce((a, e) => a + e.amount, 0);

  const submit = async (v) => {
    const created = await act('expenses', { body: v });
    if (!created) return null;
    if (receipt) {
      try {
        await uploadAttachment('expenses', created.id, receipt);
        invalidateFiles('expenses');
      } catch (e) {
        toast(`Claim saved, but the receipt failed to upload: ${e.message}`, 'error');
        return created;
      }
    }
    toast(receipt ? 'Expense claim submitted with receipt' : 'Expense claim submitted');
    return created;
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={Receipt} title="Expenses & reimbursements" subtitle="Submit claims with receipts and track reimbursement status"
        actions={<button className="btn-primary" onClick={() => { setReceipt(null); add.onOpen(); }} data-testid="new-expense"><Plus size={16} /> New claim</button>} />
      {isManager && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'My claims' }, { value: 'team', label: 'Team claims' }]} />}
      {isLoading ? <StatSkeletons count={3} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={Clock} tone="amber" label="Pending" value={money(sum('pending'))} />
          <StatCard icon={CheckCircle2} tone="green" label="Approved" value={money(sum('approved'))} />
          <StatCard icon={Wallet} label="Total claimed" value={money(data.reduce((a, e) => a + e.amount, 0))} hint={`${data.length} claims`} />
        </div>
      )}
      <DataTable loading={isLoading} rows={data} searchKeys={['category', 'description', 'employee_name']} exportName="expenses" onRowClick={(r) => setOpenId(r.id)}
        columns={[
          ...(tab === 'team' ? [{ key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> }] : []),
          { key: 'date', header: 'Date', render: (r) => date(r.date) },
          { key: 'category', header: 'Category' },
          { key: 'description', header: 'Description', width: 'minmax(200px, 2fr)' },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
          { key: 'attachment_count', header: 'Receipt', render: (r) => (r.attachment_count ? <span className="flex items-center gap-1 text-brand-600 dark:text-brand-400" data-testid="receipt-indicator"><Paperclip size={13} />{r.attachment_count}</span> : <span className="text-xs muted">None</span>) },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'x', header: '', sortable: false, csv: false, render: (r) => tab === 'mine' && r.status === 'pending' && <button className="text-slate-400 hover:text-rose-500" aria-label="Delete claim" onClick={(e) => { e.stopPropagation(); act(`expenses/${r.id}`, { method: 'DELETE', success: 'Claim withdrawn' }); }}><Trash2 size={15} /></button> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="New expense claim" submitLabel="Submit claim" initial={{ date: todayStr() }}
        fields={[
          { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
          { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
          { name: 'date', label: 'Expense date', type: 'date', required: true, max: todayStr() },
          { name: 'description', label: 'Description', required: true },
        ]}
        onSubmit={submit}>
        <FileDrop file={receipt} onChange={setReceipt} label="Receipt" hint="Photo or PDF of the bill · up to 10 MB" testId="receipt-drop" />
      </FormModal>
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.category} · ${money(open.amount)}` : ''}>
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><Badge status={open.status} /><span className="text-xs muted">Submitted {timeAgo(open.created_at)}</span></div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-slate-400">Employee</div><div className="font-medium">{open.employee_name}</div></div>
              <div><div className="text-xs text-slate-400">Expense date</div><div className="font-medium">{date(open.date)}</div></div>
              <div className="col-span-2"><div className="text-xs text-slate-400">Description</div><div className="font-medium">{open.description}</div></div>
              {open.approver_name && <div><div className="text-xs text-slate-400">Decided by</div><div className="font-medium">{open.approver_name}</div></div>}
              {open.comment && <div className="col-span-2"><div className="text-xs text-slate-400">Comment</div><div className="font-medium">{open.comment}</div></div>}
            </div>
            <Attachments entity="expenses" entityId={open.id} title="Receipts" related={['expenses']}
              canUpload={open.employee_id === user.id && open.status === 'pending'} canDelete={open.employee_id === user.id && open.status === 'pending'} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
