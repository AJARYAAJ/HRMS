import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Play, CheckCircle2, Users, Wallet, Receipt, Pencil, ChevronRight, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useGet, useAction, useDisclosure, useToast } from '../lib/hooks';
import SalaryStructures from './SalaryStructures';
import { PageHeader, Tabs, StatCard, StatSkeletons, Badge, Avatar, Modal, Confirm, Drawer, CardSkeleton } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, compactMoney, monthLabel, thisMonth } from '../lib/format';
import { useChartTheme } from '../lib/chart';
import { authFetch } from '../lib/files';

function Runs() {
  const { data = [], isLoading } = useGet('payroll/runs');
  const [act, { isLoading: running }] = useAction();
  const runModal = useDisclosure();
  const [month, setMonth] = useState(thisMonth());
  const [companyId, setCompanyId] = useState('');
  const { data: companies = [] } = useGet('companies');
  const toast = useToast();
  const [pay, setPay] = useState(null);
  const [view, setView] = useState(null);
  const { data: slips = [], isLoading: slipsLoading } = useGet(view ? `payroll/runs/${view.id}/payslips` : null);
  const navigate = useNavigate();
  const chart = useChartTheme();
  // Runs are per legal entity; KPIs and the trend aggregate all entities for a month.
  const byMonth = Object.values(data.reduce((acc, r) => {
    acc[r.month] ||= { month: r.month, total_net: 0, total_gross: 0, total_deductions: 0, employees: 0, paid: true };
    for (const k of ['total_net', 'total_gross', 'total_deductions', 'employees']) acc[r.month][k] += r[k] || 0;
    acc[r.month].paid &&= r.status === 'paid';
    return acc;
  }, {})).sort((a, b) => b.month.localeCompare(a.month));
  const latest = byMonth[0];
  const downloadBankFile = async (r) => {
    const res = await authFetch(`/api/payroll/runs/${r.id}/bank-file`);
    if (!res.ok) return toast('Could not generate the bank file', 'error');
    const missing = Number(res.headers.get('X-Missing-Bank-Details') || 0);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `bank-transfer-${r.month}-${(r.company_name || 'company').replace(/\W+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(missing ? `Bank file downloaded · ${missing} employee(s) missing bank details` : 'Bank transfer file downloaded', missing ? 'info' : 'success');
  };

  return (
    <div className="space-y-6">
      {isLoading ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Banknote} label="Last net payout" value={compactMoney(latest?.total_net)} hint={latest ? monthLabel(latest.month) : 'No runs yet'} />
          <StatCard icon={Wallet} tone="sky" label="Gross salary" value={compactMoney(latest?.total_gross)} hint="Before statutory deductions" />
          <StatCard icon={Receipt} tone="amber" label="Deductions" value={compactMoney(latest?.total_deductions)} hint="PF · ESI · PT · TDS" />
          <StatCard icon={Users} tone="green" label="Employees paid" value={latest?.employees ?? 0} hint={latest?.paid ? 'Disbursed' : 'Awaiting disbursal'} />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 font-semibold">Payroll cost trend</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={[...byMonth].reverse()} margin={{ left: 0, right: 8 }}>
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
          { key: 'company_name', header: 'Company', width: 'minmax(170px, 1.3fr)' },
          { key: 'employees', header: 'Staff', width: '80px' },
          { key: 'total_gross', header: 'Gross', align: 'right', render: (r) => money(r.total_gross) },
          { key: 'total_deductions', header: 'Deductions', align: 'right', render: (r) => money(r.total_deductions) },
          { key: 'total_net', header: 'Net pay', align: 'right', render: (r) => <b>{money(r.total_net)}</b> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'actions', header: '', sortable: false, csv: false, width: 'minmax(290px, auto)', render: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status !== 'paid' && <button className="btn-success btn-sm" onClick={() => setPay(r)} data-testid="mark-paid"><CheckCircle2 size={14} /> Mark paid</button>}
              <button className="btn-ghost btn-sm" onClick={() => downloadBankFile(r)} data-testid="bank-file" title="Bank transfer file (CSV)"><Download size={14} /> Bank file</button>
              <button className="btn-ghost btn-sm" onClick={() => setView(r)}>View <ChevronRight size={14} /></button>
            </div>
          ) },
        ]} />
      <Modal open={runModal.open} onClose={runModal.onClose} title="Run payroll" size="sm"
        footer={<><button className="btn-secondary" onClick={runModal.onClose}>Cancel</button>
          <button className="btn-primary" disabled={running} data-testid="confirm-run" onClick={async () => {
            const res = await act('payroll/run', { body: { month, company_id: companyId || undefined } });
            if (res) {
              toast(`Payroll processed for ${monthLabel(month)} · ${res.runs.length} ${res.runs.length === 1 ? 'company' : 'companies'}${res.skipped?.length ? ` (${res.skipped.length} already paid)` : ''}`);
              runModal.onClose();
            }
          }}>{running ? 'Processing…' : 'Process'}</button></>}>
        <label className="label" htmlFor="payroll-month">Payroll month</label>
        <input id="payroll-month" type="month" className="input" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
        <label className="label mt-4" htmlFor="payroll-company">Legal entity</label>
        <select id="payroll-company" className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="mt-3 text-xs muted">Re-running an unpaid month recalculates all payslips. Paid months are locked.</p>
      </Modal>
      <Confirm open={!!pay} onClose={() => setPay(null)} title="Mark payroll as paid?" confirmLabel="Mark paid"
        message={pay && `This locks ${monthLabel(pay.month)} payroll and publishes payslips to ${pay.employees} employees.`}
        onConfirm={() => act(`payroll/runs/${pay.id}/pay`, { success: 'Payroll marked as paid · payslips published' })} />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? `Payslips · ${monthLabel(view.month)} · ${view.company_name || ''}` : ''} width="max-w-4xl">
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
          { key: 'structure', header: 'Structure', render: (r) => <span className="text-xs">{r.structure}</span> },
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

function AllLoans() {
  const { data = [], isLoading } = useGet('loans');
  return (
    <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'reason', 'type']} exportName="loans"
      columns={[
        { key: 'employee_name', header: 'Employee', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate font-medium">{r.employee_name}</span></div> },
        { key: 'type', header: 'Type', render: (r) => (r.type === 'advance' ? 'Salary advance' : 'Loan') },
        { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
        { key: 'emi', header: 'EMI', align: 'right', render: (r) => `${money(r.emi)} × ${r.tenure_months}` },
        { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => <b>{money(r.outstanding)}</b> },
        { key: 'emis_paid', header: 'EMIs paid' },
        { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
      ]} />
  );
}

function PayrollSettings() {
  const { data, isLoading } = useGet('payroll/settings');
  const [values, setValues] = useState(null);
  const [act, { isLoading: saving }] = useAction();
  const v = values || data;
  if (isLoading || !v) return <CardSkeleton lines={4} />;
  const example = 1200000;
  const basic = (example / 12) * (v.basicPct / 100);
  return (
    <form className="card card-pad max-w-2xl space-y-5" onSubmit={(e) => { e.preventDefault(); act('payroll/settings', { method: 'PUT', body: v, success: 'Salary structure saved' }); }}>
      <div>
        <h3 className="font-semibold">Salary structure</h3>
        <p className="text-sm muted">Applies to all future payroll runs. PF is 12% of basic (capped at ₹15,000 basic); professional tax and ESI follow statutory slabs.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="basic-pct">Basic (% of CTC)</label><input id="basic-pct" type="number" min="30" max="70" className="input" value={v.basicPct} onChange={(e) => setValues({ ...v, basicPct: Number(e.target.value) })} /></div>
        <div><label className="label" htmlFor="hra-pct">HRA (% of basic)</label><input id="hra-pct" type="number" min="0" max="50" className="input" value={v.hraPct} onChange={(e) => setValues({ ...v, hraPct: Number(e.target.value) })} /></div>
      </div>
      <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
        <div className="mb-1 font-semibold">Example: ₹12,00,000 CTC</div>
        <div className="grid grid-cols-3 gap-2 muted"><span>Basic {money(basic)}</span><span>HRA {money(basic * (v.hraPct / 100))}</span><span>Special {money(example / 12 - basic - basic * (v.hraPct / 100))}</span></div>
      </div>
      <div className="flex justify-end"><button className="btn-primary" disabled={saving} data-testid="save-payroll-settings">Save</button></div>
    </form>
  );
}

export default function Payroll() {
  const [tab, setTab] = useState('runs');
  return (
    <div>
      <PageHeader icon={Banknote} title="Payroll" subtitle="Process monthly payroll, manage salary structures and verify tax proofs" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'runs', label: 'Payroll runs' }, { value: 'salaries', label: 'Employee salaries' }, { value: 'structures', label: 'Salary templates' }, { value: 'loans', label: 'Loans & advances' }, { value: 'tax', label: 'Tax declarations' }, { value: 'settings', label: 'Settings' }]} />
      {tab === 'runs' && <Runs />}
      {tab === 'salaries' && <Salaries />}
      {tab === 'structures' && <SalaryStructures />}
      {tab === 'tax' && <TaxApprovals />}
      {tab === 'loans' && <AllLoans />}
      {tab === 'settings' && <PayrollSettings />}
    </div>
  );
}
