import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Landmark, Plus, Send, Download, Ban, Trash2, IndianRupee, AlarmClock, Wallet, FileText, CreditCard } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet, useAction, useToast, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Badge, Drawer, StatCard, StatSkeletons, CardSkeleton, EmptyState, Modal, Confirm, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal, LookupSelect } from '../components/Form';
import { money, compactMoney, date, todayStr, monthLabel } from '../lib/format';
import { authFetch } from '../lib/files';
import { useChartTheme } from '../lib/chart';

const STATUS = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['partially_paid', 'Part-paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];

async function downloadPdf(inv, toast) {
  const res = await authFetch(`/api/finance/invoices/${inv.id}/pdf`);
  if (!res.ok) return toast('Could not download the invoice', 'error');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `${inv.number}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Overview() {
  const { data, isLoading } = useGet('finance/summary');
  const chart = useChartTheme();
  if (isLoading) return <StatSkeletons />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="finance-summary">
        <StatCard icon={FileText} label="Invoiced this month" value={compactMoney(data.this_month.invoiced)} hint="Before tax" />
        <StatCard icon={Wallet} tone="green" label="Collected this month" value={compactMoney(data.this_month.collected)} />
        <StatCard icon={IndianRupee} tone="sky" label="Receivables" value={compactMoney(data.outstanding)} hint={`${data.draft_count} draft(s) not yet sent`} />
        <StatCard icon={AlarmClock} tone="rose" label="Overdue" value={compactMoney(data.overdue)} hint={`${data.overdue_count} invoice(s)`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 font-semibold">Invoiced vs collected — last 12 months</h3>
          <div className="h-72" data-testid="revenue-chart">
            <ResponsiveContainer>
              <BarChart data={data.trend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).slice(0, 3)} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} width={64} />
                <Tooltip {...chart.tooltip} labelFormatter={monthLabel} formatter={(v) => money(v)} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="invoiced" name="Invoiced" fill={chart.series[0]} radius={[4, 4, 0, 0]} barSize={14} />
                <Bar dataKey="collected" name="Collected" fill={chart.series[2]} radius={[4, 4, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="mb-4 font-semibold">Receivables ageing</h3>
          <div className="space-y-3" data-testid="ageing">
            {data.ageing.map((b, i) => {
              const max = Math.max(...data.ageing.map((x) => x.amount), 1);
              return (
                <div key={b.bucket}>
                  <div className="mb-1 flex justify-between text-sm"><span>{b.bucket}</span><span className="font-semibold">{money(b.amount)}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{ width: `${(b.amount / max) * 100}%`, background: i === 0 ? chart.series[0] : chart.series[i >= 3 ? 7 : 3] }} /></div>
                </div>
              );
            })}
          </div>
          <h3 className="mb-3 mt-6 font-semibold">Top clients</h3>
          <div className="space-y-2 text-sm">
            {data.top_clients.map((c) => <div key={c.id} className="flex justify-between"><span className="truncate">{c.name}</span><span className="font-semibold">{compactMoney(c.billed)}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PnL() {
  const { data, isLoading } = useGet('finance/summary');
  return (
    <DataTable loading={isLoading} rows={data?.project_pnl || []} searchKeys={['name', 'client_name']} exportName="project-pnl" initialSort={{ key: 'billed', dir: 'desc' }}
      empty={<EmptyState icon={Landmark} title="No billed projects yet" />}
      columns={[
        { key: 'name', header: 'Project', width: 'minmax(220px, 1.6fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.client_name}</div></div> },
        { key: 'billing_type', header: 'Billing', render: (r) => <Badge status={r.billing_type} /> },
        { key: 'billed', header: 'Billed', align: 'right', render: (r) => money(r.billed) },
        { key: 'cost', header: 'People cost', align: 'right', render: (r) => money(r.cost) },
        { key: 'margin', header: 'Margin', align: 'right', render: (r) => <b className={r.margin < 0 ? 'text-rose-600' : ''}>{money(r.margin)}</b> },
        { key: 'margin_pct', header: 'Margin %', align: 'right', render: (r) => (r.margin_pct == null ? '—' : <Badge color={r.margin_pct >= 30 ? 'green' : r.margin_pct >= 0 ? 'amber' : 'red'}>{r.margin_pct}%</Badge>) },
      ]} />
  );
}

function NewInvoice({ open, onClose, onCreated }) {
  const [mode, setMode] = useState('project');
  const [projectId, setProjectId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(todayStr());
  const [lines, setLines] = useState([{ description: '', quantity: 1, rate: '' }]);
  const { data: bill, isFetching } = useGet(open && mode === 'project' && projectId ? 'finance/billable' : null, { project_id: projectId, start, end });
  const [act, { isLoading }] = useAction();
  useEffect(() => { if (open) { setProjectId(null); setClientId(null); setLines([{ description: '', quantity: 1, rate: '' }]); } }, [open]);
  const billTotal = bill ? bill.time.reduce((a, t) => a + t.amount, 0) + bill.milestones.reduce((a, m) => a + m.amount, 0) : 0;
  const manual = lines.filter((l) => l.description.trim() && Number(l.rate) > 0);
  const create = async () => {
    const body = mode === 'project'
      ? { project_id: projectId, period_start: start || undefined, period_end: end, lines: manual }
      : { client_id: clientId, lines: manual };
    const r = await act('finance/invoices', { body, success: 'Draft invoice created' });
    if (r?.id) { onClose(); onCreated(r.id); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New invoice" size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={isLoading || (mode === 'project' ? !projectId : !clientId || !manual.length)} onClick={create} data-testid="create-invoice">Create draft</button></>}>
      <div className="space-y-4">
        <Tabs value={mode} onChange={setMode} tabs={[{ value: 'project', label: 'From a project' }, { value: 'manual', label: 'Manual' }]} />
        {mode === 'project' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3"><label className="label" htmlFor="inv-project">Project</label><LookupSelect id="inv-project" path="projects" value={projectId} onChange={setProjectId} placeholder="Choose a billable project" /></div>
              <div><label className="label" htmlFor="inv-start">Time from</label><input id="inv-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><label className="label" htmlFor="inv-end">Time to</label><input id="inv-end" type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
            {projectId && (
              <div className={cx('rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700', isFetching && 'opacity-60')} data-testid="billable-preview">
                {!bill ? 'Loading…' : (
                  <>
                    {bill.time.map((t) => <div key={t.employee_id} className="flex justify-between py-0.5"><span>{t.name} · {Math.round(t.hours * 10) / 10} h × {money(t.rate)}</span><span className="font-semibold">{money(t.amount)}</span></div>)}
                    {bill.milestones.map((m) => <div key={m.id} className="flex justify-between py-0.5"><span>Milestone: {m.name}</span><span className="font-semibold">{money(m.amount)}</span></div>)}
                    {!bill.time.length && !bill.milestones.length && <p className="muted">No approved billable time or completed milestones to invoice in this period.</p>}
                    {bill.missing_rates.length > 0 && <p className="mt-2 text-rose-600">Set bill rates first for: {bill.missing_rates.join(', ')}</p>}
                    {billTotal > 0 && <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 font-semibold dark:border-slate-800"><span>Subtotal (before tax)</span><span>{money(billTotal)}</span></div>}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div><label className="label" htmlFor="inv-client">Client</label><LookupSelect id="inv-client" path="clients" value={clientId} onChange={setClientId} placeholder="Choose a client" /></div>
        )}
        <div>
          <div className="label">{mode === 'project' ? 'Extra lines (optional)' : 'Lines'}</div>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_80px_120px_auto] gap-2">
              <input className="input" placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} aria-label="Line description" />
              <input className="input" type="number" min="0" placeholder="Qty" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Quantity" />
              <input className="input" type="number" min="0" placeholder="Rate ₹" value={l.rate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} aria-label="Rate" />
              <button className="btn-ghost btn-sm !px-1.5" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn-secondary btn-sm" onClick={() => setLines([...lines, { description: '', quantity: 1, rate: '' }])}><Plus size={14} /> Add line</button>
        </div>
        <p className="text-xs muted">GST is added at the default rate (Settings). Due date follows the client's payment terms.</p>
      </div>
    </Modal>
  );
}

function InvoiceDrawer({ id, onClose }) {
  const { data: inv, isLoading } = useGet(id ? `finance/invoices/${id}` : null);
  const [act] = useAction();
  const toast = useToast();
  const pay = useDisclosure();
  const [confirm, setConfirm] = useState(null);
  return (
    <Drawer open={!!id} onClose={onClose} title={inv ? `Invoice ${inv.number}` : 'Invoice'} width="max-w-2xl">
      {isLoading || !inv ? <CardSkeleton lines={8} /> : (
        <div className="space-y-5 text-sm" data-testid="invoice-drawer">
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={inv.days_overdue ? 'overdue' : inv.status}>{inv.days_overdue ? `Overdue ${inv.days_overdue}d` : undefined}</Badge>
            <span className="muted">{inv.client_name}{inv.project_name ? ` · ${inv.project_name}` : ''}</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><div className="text-xs muted">Issued</div><div className="font-medium">{date(inv.issue_date)}</div></div>
            <div><div className="text-xs muted">Due</div><div className="font-medium">{date(inv.due_date)}</div></div>
            <div><div className="text-xs muted">Period</div><div className="font-medium">{inv.period_start ? `${date(inv.period_start, { day: '2-digit', month: 'short' })} – ${date(inv.period_end, { day: '2-digit', month: 'short' })}` : '—'}</div></div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full" data-testid="invoice-lines">
              <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-400 dark:bg-slate-800/60"><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
              <tbody>{inv.lines.map((l) => <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-2">{l.description}</td><td className="px-3 py-2 text-right">{Math.round(l.quantity * 100) / 100}</td><td className="px-3 py-2 text-right">{money(l.rate)}</td><td className="px-3 py-2 text-right font-medium">{money(l.amount)}</td></tr>)}</tbody>
              <tfoot className="border-t border-slate-200 dark:border-slate-700">
                <tr><td colSpan={3} className="px-3 py-1.5 text-right muted">Subtotal</td><td className="px-3 py-1.5 text-right">{money(inv.subtotal)}</td></tr>
                <tr><td colSpan={3} className="px-3 py-1.5 text-right muted">GST {inv.tax_rate}%</td><td className="px-3 py-1.5 text-right">{money(inv.tax_amount)}</td></tr>
                <tr><td colSpan={3} className="px-3 py-1.5 text-right font-semibold">Total</td><td className="px-3 py-1.5 text-right text-base font-bold" data-testid="invoice-total">{money(inv.total)}</td></tr>
                {inv.amount_paid > 0 && <tr><td colSpan={3} className="px-3 py-1.5 text-right muted">Balance due</td><td className="px-3 py-1.5 text-right font-semibold">{money(inv.balance)}</td></tr>}
              </tfoot>
            </table>
          </div>
          {inv.payments.length > 0 && (
            <div><div className="mb-2 font-semibold">Payments</div>
              {inv.payments.map((p) => <div key={p.id} className="flex justify-between border-b border-slate-50 py-1.5 dark:border-slate-800"><span>{date(p.date)} · {p.method || 'Payment'}{p.reference ? ` · ${p.reference}` : ''}</span><span className="font-semibold">{money(p.amount)}</span></div>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => downloadPdf(inv, toast)} data-testid="invoice-pdf"><Download size={16} /> PDF</button>
            {['draft', 'sent', 'partially_paid'].includes(inv.status) && <button className="btn-primary" onClick={() => act(`finance/invoices/${inv.id}/send`, { success: inv.status === 'draft' ? 'Invoice sent to the client' : 'Reminder sent', invalidates: ['finance'] })} data-testid="send-invoice"><Send size={16} /> {inv.status === 'draft' ? 'Send to client' : 'Send reminder'}</button>}
            {['sent', 'partially_paid'].includes(inv.status) && <button className="btn-success" onClick={() => pay.onOpen()} data-testid="record-payment"><CreditCard size={16} /> Record payment</button>}
            {inv.status === 'draft' && <button className="btn-ghost text-rose-600" onClick={() => setConfirm('delete')}><Trash2 size={16} /> Delete draft</button>}
            {['sent'].includes(inv.status) && !inv.amount_paid && <button className="btn-ghost text-rose-600" onClick={() => setConfirm('void')}><Ban size={16} /> Void</button>}
          </div>
          <FormModal open={pay.open} onClose={pay.onClose} title={`Record payment · ${inv.number}`} submitLabel="Record" initial={{ amount: inv.balance, date: todayStr(), method: 'Bank transfer' }}
            fields={[{ name: 'amount', label: 'Amount received (₹)', type: 'number', min: 1, required: true }, { name: 'date', label: 'Date', type: 'date', required: true, max: todayStr() },
              { name: 'method', label: 'Method', type: 'select', noEmpty: true, options: ['Bank transfer', 'UPI', 'Cheque', 'Card', 'Cash'] }, { name: 'reference', label: 'Reference / UTR' }]}
            onSubmit={(v) => act(`finance/invoices/${inv.id}/payments`, { body: v, success: 'Payment recorded', invalidates: ['finance'] })} />
          <Confirm open={!!confirm} onClose={() => setConfirm(null)} danger title={confirm === 'void' ? 'Void this invoice?' : 'Delete this draft?'} confirmLabel={confirm === 'void' ? 'Void' : 'Delete'}
            message="The billed time and milestones become available to invoice again."
            onConfirm={async () => { const ok = confirm === 'void' ? await act(`finance/invoices/${inv.id}/void`, { success: 'Invoice voided', invalidates: ['finance'] }) : await act(`finance/invoices/${inv.id}`, { method: 'DELETE', success: 'Draft deleted', invalidates: ['finance'] }); if (ok && confirm === 'delete') onClose(); }} />
        </div>
      )}
    </Drawer>
  );
}

function Invoices() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = useGet('finance/invoices', { status });
  const create = useDisclosure();
  const openId = Number(params.get('invoice')) || null;
  const setOpen = (id) => setParams(id ? { tab: 'invoices', invoice: id } : { tab: 'invoices' }, { replace: true });
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['number', 'client_name', 'project_name']} exportName="invoices" onRowClick={(r) => setOpen(r.id)}
        toolbar={<>
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="btn-primary btn-sm" onClick={() => create.onOpen()} data-testid="new-invoice"><Plus size={14} /> New invoice</button>
        </>}
        empty={<EmptyState icon={FileText} title="No invoices" />}
        columns={[
          { key: 'number', header: 'Invoice', render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
          { key: 'client_name', header: 'Client', width: 'minmax(180px, 1.4fr)', render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.client_name}</div><div className="truncate text-xs muted">{r.project_name}</div></div> },
          { key: 'issue_date', header: 'Issued', render: (r) => date(r.issue_date) },
          { key: 'due_date', header: 'Due', render: (r) => <span className={r.days_overdue ? 'font-semibold text-rose-600' : ''}>{date(r.due_date)}</span> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total) },
          { key: 'balance', header: 'Balance', align: 'right', render: (r) => (r.status === 'void' ? '—' : money(r.balance)) },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.days_overdue ? 'overdue' : r.status}>{r.days_overdue ? `Overdue ${r.days_overdue}d` : undefined}</Badge> },
        ]} />
      <NewInvoice open={create.open} onClose={create.onClose} onCreated={setOpen} />
      <InvoiceDrawer id={openId} onClose={() => setOpen(null)} />
    </>
  );
}

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const tab = ['invoices', 'pnl'].includes(params.get('tab')) || params.get('invoice') ? (params.get('tab') === 'pnl' ? 'pnl' : 'invoices') : 'overview';
  return (
    <div>
      <PageHeader icon={Landmark} title="Finance" subtitle="Invoicing from approved time and milestones, collections, receivables and project profitability" />
      <Tabs value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'invoices', label: 'Invoices' }, { value: 'pnl', label: 'Project P&L' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'pnl' && <PnL />}
    </div>
  );
}
