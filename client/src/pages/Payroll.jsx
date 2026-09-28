import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Play, CheckCircle2, Users, Wallet, Receipt, Pencil, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, StatCard, StatSkeletons, Badge, Avatar, Modal, Confirm, Drawer } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, compactMoney, monthLabel, thisMonth } from '../lib/format';
import { useChartTheme } from '../lib/chart';

function Runs() {
  const { data = [], isLoading } = useGet('payroll/runs');
  const [act, { isLoading: running }] = useAction();
  const runModal = useDisclosure();
  const [month, setMonth] = useState(thisMonth());
  const [pay, setPay] = useState(null);
  const [view, setView] = useState(null);
  const { data: slips = [], isLoading: slipsLoading } = useGet(view ? `payroll/runs/${view.id}/payslips` : null);
  const navigate = useNavigate();
  const chart = useChartTheme();
  const latest = data[0];

  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Banknote} label="Last net payout" value={compactMoney(latest?.total_net)} hint={latest ? monthLabel(latest.month) : 'No runs yet'} />
          <StatCard icon={Wallet} tone="sky" label="Gross salary" value={compactMoney(latest?.total_gross)} hint="Before statutory deductions" />
          <StatCard icon={Receipt} tone="amber" label="Deductions" value={compactMoney(latest?.total_deductions)} hint="PF · ESI · PT · TDS" />
          <StatCard icon={Users} tone="green" label="Employees paid" value={latest?.employees ?? 0} hint={latest?.status === 'paid' ? 'Disbursed' : 'Awaiting disbursal'} />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 font-semibold">Payroll cost trend</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={[...data].reverse()} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m).slice(0, 3)} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: chart.axis }} axisLine={false} tickLine={false} width={70} />
                <Tooltip {...chart.tooltip} formatter={(v) => money(v)} labelFormatter={monthLabel} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total_net" name="Net pay" stackId="a" fill={chart.series[0]} barSize={28} stroke={chart.surface} strokeWidth={2} />
                <Bar dataKey="total_deductions" name="Deductions" stackId="a" fill={chart.series[1]} radius={[4, 4, 0, 0]} stroke={chart.surface} strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card card-pad flex flex-col">
          <h3 className="font-semibold">Run payroll</h3>
          <p className="mt-1 text-sm muted">Computes salary for every eligible employee using attendance, approved leave and loss-of-pay, with PF, ESI, professional tax and TDS (new regime).</p>
          <div className="mt-auto space-y-2 pt-4">
            <button className="btn-primary w-full" onClick={() => runModal.onOpen()} data-testid="run-payroll"><Play size={16} /> Run payroll</button>
          </div>
        </div>
      </div>
      <DataTable title="Payroll runs" loading={isLoading} rows={data} maxHeight="400px" onRowClick={setView}
        columns={[
          { key: 'month', header: 'Month', render: (r) => <span className="font-semibold">{monthLabel(r.month)}</span> },
          { key: 'employees', header: 'Employees' },
          { key: 'total_gross', header: 'Gross', align: 'right', render: (r) => money(r.total_gross) },
          { key: 'total_deductions', header: 'Deductions', align: 'right', render: (r) => money(r.total_deductions) },
          { key: 'total_net', header: 'Net pay', align: 'right', render: (r) => <b>{money(r.total_net)}</b> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'actions', header: '', sortable: false, render: (r) => (
            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              {r.status !== 'paid' && <button className="btn-success btn-sm" onClick={() => setPay(r)} data-testid="mark-paid"><CheckCircle2 size={14} /> Mark paid</button>}
              <button className="btn-ghost btn-sm" onClick={() => setView(r)}>View <ChevronRight size={14} /></button>
            </div>
          ) },
        ]} />
      <Modal open={runModal.open} onClose={runModal.onClose} title="Run payroll" size="sm"
        footer={<><button className="btn-secondary" onClick={runModal.onClose}>Cancel</button>
          <button className="btn-primary" disabled={running} data-testid="confirm-run" onClick={async () => { if (await act('payroll/run', { body: { month }, success: `Payroll processed for ${monthLabel(month)}` })) runModal.onClose(); }}>{running ? 'Processing…' : 'Process'}</button></>}>
        <label className="label" htmlFor="payroll-month">Payroll month</label>
        <input id="payroll-month" type="month" className="input" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
        <p className="mt-3 text-xs muted">Re-running an unpaid month recalculates all payslips. Paid months are locked.</p>
      </Modal>
      <Confirm open={!!pay} onClose={() => setPay(null)} title="Mark payroll as paid?" confirmLabel="Mark paid"
        message={pay && `This locks ${monthLabel(pay.month)} payroll and publishes payslips to ${pay.employees} employees.`}
        onConfirm={() => act(`payroll/runs/${pay.id}/pay`, { success: 'Payroll marked as paid · payslips published' })} />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? `Payslips · ${monthLabel(view.month)}` : ''} width="max-w-4xl">
        <DataTable loading={slipsLoading} rows={slips} searchKeys={['employee_name', 'emp_code', 'department']} exportName={view ? `payroll-${view.month}` : 'payroll'} maxHeight="calc(100vh - 230px)"
          onRowClick={(r) => navigate(`/payslips/${r.id}`)}
          columns={[
            { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 2fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate font-medium">{r.employee_name}</span></div> },
            { key: 'paid_days', header: 'Paid days', render: (r) => `${r.paid_days}/${r.working_days}` },
            { key: 'gross', header: 'Gross', align: 'right', render: (r) => money(r.gross) },
            { key: 'total_deductions', header: 'Deductions', align: 'right', render: (r) => money(r.total_deductions) },
            { key: 'net', header: 'Net', align: 'right', render: (r) => <b>{money(r.net)}</b> },
          ]} />
      </Drawer>
    </div>
  );
}

function Salaries() {
  const { data = [], isLoading } = useGet('payroll/salaries');
  const [act] = useAction();
  const edit = useDisclosure();
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'emp_code', 'department', 'designation']} exportName="salary-structures"
        columns={[
          { key: 'employee_name', header: 'Employee', width: 'minmax(220px, 2fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{r.employee_name}</div><div className="truncate text-xs muted">{r.designation}</div></div></div> },
          { key: 'department', header: 'Department' },
          { key: 'annual_ctc', header: 'Annual CTC', align: 'right', render: (r) => <b>{money(r.annual_ctc)}</b> },
          { key: 'basic', header: 'Basic / mo', align: 'right', sortValue: (r) => r.monthly.basic, render: (r) => money(r.monthly.basic), csv: (r) => r.monthly.basic },
          { key: 'gross', header: 'Gross / mo', align: 'right', sortValue: (r) => r.monthly.gross, render: (r) => money(r.monthly.gross), csv: (r) => r.monthly.gross },
          { key: 'net', header: 'Take-home / mo', align: 'right', sortValue: (r) => r.monthly.net, render: (r) => money(r.monthly.net), csv: (r) => r.monthly.net },
          { key: 'edit', header: '', sortable: false, csv: false, render: (r) => <button className="btn-ghost btn-sm" onClick={() => edit.onOpen(r)} aria-label="Revise salary"><Pencil size={14} /> Revise</button> },
        ]} />
      <FormModal open={edit.open} onClose={edit.onClose} title={`Revise salary · ${edit.payload?.employee_name}`} size="sm"
        initial={edit.payload ? { annual_ctc: edit.payload.annual_ctc } : {}}
        fields={[{ name: 'annual_ctc', label: 'New annual CTC (₹)', type: 'number', required: true, min: 0, full: true }]}
        onSubmit={(v) => act(`payroll/salaries/${edit.payload.id}`, { method: 'PUT', body: v, success: 'Salary revised' })} />
    </>
  );
}

function TaxApprovals() {
  const { data = [], isLoading } = useGet('tax-declarations');
  const [act] = useAction();
  return (
    <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'section', 'description']} exportName="tax-declarations"
      columns={[
        { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate font-medium">{r.employee_name}</span></div> },
        { key: 'fy', header: 'FY' }, { key: 'section', header: 'Section' }, { key: 'description', header: 'Description', width: 'minmax(200px, 2fr)' },
        { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
        { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        { key: 'act', header: '', sortable: false, csv: false, render: (r) => r.status === 'pending' && (
          <div className="flex justify-end gap-1">
            <button className="btn-ghost btn-sm text-rose-600" onClick={() => act(`tax-declarations/${r.id}/decision`, { method: 'PUT', body: { status: 'rejected' }, success: 'Declaration rejected' })}>Reject</button>
            <button className="btn-success btn-sm" onClick={() => act(`tax-declarations/${r.id}/decision`, { method: 'PUT', body: { status: 'approved' }, success: 'Declaration approved' })}>Approve</button>
          </div>
        ) },
      ]} />
  );
}

export default function Payroll() {
  const [tab, setTab] = useState('runs');
  return (
    <div>
      <PageHeader icon={Banknote} title="Payroll" subtitle="Process monthly payroll, manage salary structures and verify tax proofs" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'runs', label: 'Payroll runs' }, { value: 'salaries', label: 'Salary structures' }, { value: 'tax', label: 'Tax declarations' }]} />
      {tab === 'runs' && <Runs />}
      {tab === 'salaries' && <Salaries />}
      {tab === 'tax' && <TaxApprovals />}
    </div>
  );
}
