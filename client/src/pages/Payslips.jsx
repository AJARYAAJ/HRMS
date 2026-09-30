import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wallet, FileDown, Landmark, Plus, TrendingUp, HandCoins, FileText } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState, Tabs, Modal, Progress, cx } from '../components/ui';
import ApprovalTrail from '../components/ApprovalTrail';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, monthLabel } from '../lib/format';
import { useChartTheme } from '../lib/chart';

const currentFY = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
};

function Overview() {
  const { data: slips = [], isLoading } = useGet('payroll/payslips');
  const { data: preview, isLoading: pLoading } = useGet('payroll/preview');
  const { data: decl = [], isLoading: dLoading } = useGet('tax-declarations', { mine: 1 });
  const [act] = useAction();
  const add = useDisclosure();
  const navigate = useNavigate();
  const chart = useChartTheme();
  const m = preview?.monthly;
  const breakdown = m ? [
    { name: 'Take-home', value: m.net }, { name: 'Provident fund', value: m.pf }, { name: 'Income tax (TDS)', value: m.tds }, { name: 'Prof. tax & ESI', value: m.pt + m.esi },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-semibold"><TrendingUp size={16} className="text-brand-500" /> My salary structure</h3>
          {pLoading ? <CardSkeleton lines={5} className="!border-0 !p-0 !shadow-none" /> : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between rounded-xl bg-brand-50 p-3 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"><span>Annual CTC</span><span>{money(preview.annual_ctc)}</span></div>
                {preview.structure && <div className="px-3 text-xs muted" data-testid="my-structure">Salary structure: <b>{preview.structure}</b></div>}
                {(m.lines ? m.lines.filter((l) => l.type === 'earning').map((l) => [l.name, l.amount]) : [['Basic', m.basic], ['HRA', m.hra], ['Special allowance', m.special]])
                  .map(([l, v]) => <div key={l} className="flex justify-between px-3"><span className="muted">{l}</span><span className="font-medium">{money(v)}</span></div>)}
                <div className="flex justify-between border-t border-slate-100 px-3 pt-2 font-semibold dark:border-slate-800"><span>Gross / month</span><span>{money(m.gross)}</span></div>
                {(m.lines ? m.lines.filter((l) => l.type === 'deduction').map((l) => [l.name, l.amount]) : [['Provident fund', m.pf], ['ESI', m.esi], ['Professional tax', m.pt], ['TDS', m.tds]]).map(([l, v]) => <div key={l} className="flex justify-between px-3 text-rose-600 dark:text-rose-400"><span>− {l}</span><span>{money(v)}</span></div>)}
                <div className="flex justify-between rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"><span>Take-home / month</span><span data-testid="take-home">{money(m.net)}</span></div>
                <p className="px-3 text-xs muted">Estimated annual tax (new regime): {money(preview.annual_tax)}</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke={chart.surface} strokeWidth={2}>
                      {breakdown.map((_, i) => <Cell key={i} fill={chart.series[i]} />)}
                    </Pie>
                    <Tooltip {...chart.tooltip} formatter={(v) => money(v)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
        <div className="card card-pad">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold"><Landmark size={16} className="text-brand-500" /> Tax declarations</h3>
            <button className="btn-secondary btn-sm" onClick={() => add.onOpen()} data-testid="add-declaration"><Plus size={14} /> Declare</button>
          </div>
          {dLoading ? <CardSkeleton lines={3} className="!border-0 !p-0 !shadow-none" /> : decl.length === 0 ? <p className="text-sm muted">No declarations for this year.</p> : (
            <div className="space-y-2.5">
              {decl.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                  <div><div className="text-sm font-semibold">Sec {d.section} · {money(d.amount)}</div><div className="text-xs muted">{d.description} · FY {d.fy}</div></div>
                  <Badge status={d.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <DataTable title="Payslips" loading={isLoading} rows={slips} onRowClick={(r) => navigate(`/payslips/${r.id}`)} maxHeight="420px"
        empty={<EmptyState icon={Wallet} title="No payslips yet" message="Payslips appear here once payroll is processed and paid." />}
        columns={[
          { key: 'month', header: 'Month', render: (r) => <span className="font-semibold">{monthLabel(r.month)}</span> },
          { key: 'paid_days', header: 'Paid days', render: (r) => `${r.paid_days} / ${r.working_days}` },
          { key: 'gross', header: 'Gross', align: 'right', render: (r) => money(r.gross) },
          { key: 'total_deductions', header: 'Deductions', align: 'right', render: (r) => money(r.total_deductions) },
          { key: 'net', header: 'Net pay', align: 'right', render: (r) => <b className="text-emerald-600 dark:text-emerald-400">{money(r.net)}</b> },
          { key: 'dl', header: '', sortable: false, render: () => <span className="flex justify-end"><span className="btn-ghost btn-sm"><FileDown size={14} /> View</span></span> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="Investment declaration" submitLabel="Submit"
        initial={{ fy: currentFY(), section: '80C' }}
        fields={[
          { name: 'fy', label: 'Financial year', required: true },
          { name: 'section', label: 'Section', type: 'select', noEmpty: true, options: [['80C', '80C – PPF, ELSS, LIC'], ['80D', '80D – Health insurance'], ['HRA', 'HRA – Rent paid'], ['24b', '24(b) – Home loan interest'], ['80CCD', '80CCD(1B) – NPS'], ['80E', '80E – Education loan']] },
          { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 },
          { name: 'description', label: 'Description', required: true },
        ]}
        onSubmit={(v) => act('tax-declarations', { body: v, success: 'Declaration submitted for verification' })} />
    </div>
  );
}

function Loans() {
  const { data = [], isLoading } = useGet('loans', { mine: 1 });
  const [act] = useAction();
  const add = useDisclosure();
  const [schedule, setSchedule] = useState(null);
  const { data: sched } = useGet(schedule ? `loans/${schedule.id}/schedule` : null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm muted">Interest-free salary advances (up to one month's gross, repaid in 1–3 months) and loans (up to six months' gross, 1–36 EMIs). EMIs are deducted from your salary automatically.</p>
        <button className="btn-primary" onClick={() => add.onOpen()} data-testid="request-loan"><Plus size={16} /> Request</button>
      </div>
      <DataTable loading={isLoading} rows={data} maxHeight="420px" onRowClick={(r) => setSchedule(r)}
        empty={<EmptyState icon={HandCoins} title="No loans or advances" />}
        columns={[
          { key: 'type', header: 'Type', render: (r) => <span className="font-semibold">{r.type === 'advance' ? 'Salary advance' : 'Loan'}</span> },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
          { key: 'emi', header: 'EMI', align: 'right', render: (r) => `${money(r.emi)} × ${r.tenure_months}` },
          { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => <b>{money(r.outstanding)}</b> },
          { key: 'progress', header: 'Repaid', sortable: false, width: 'minmax(140px, 1.2fr)', render: (r) => <Progress value={r.amount ? ((r.amount - r.outstanding) / r.amount) * 100 : 0} color="bg-emerald-500" /> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="Request a loan or salary advance" submitLabel="Submit request" initial={{ type: 'advance', tenure_months: 1 }}
        fields={[
          { name: 'type', label: 'Type', type: 'select', noEmpty: true, options: [['advance', 'Salary advance'], ['loan', 'Loan']] },
          { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, required: true },
          { name: 'tenure_months', label: 'Repay over (months)', type: 'number', min: 1, max: 36, required: true },
          { name: 'reason', label: 'Reason', required: true },
        ]}
        onSubmit={(v) => act('loans', { body: v, success: 'Request submitted for approval' })} />
      <Modal open={!!schedule} onClose={() => setSchedule(null)} title="Repayment schedule">
        {schedule && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div className="font-bold">{money(schedule.amount)}</div><div className="text-xs muted">Principal</div></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div className="font-bold">{money(schedule.emi)}</div><div className="text-xs muted">Monthly EMI</div></div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div className="font-bold">{money(schedule.outstanding)}</div><div className="text-xs muted">Outstanding</div></div>
            </div>
            <div className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {(sched?.repayments || []).map((r) => <div key={r.month} className="flex justify-between py-2"><span>{monthLabel(r.month)}</span><span className="font-semibold">{money(r.amount)}</span></div>)}
              {!sched?.repayments?.length && <p className="py-2 muted">No EMIs deducted yet.</p>}
            </div>
            <ApprovalTrail entity="loans" id={schedule.id} status={schedule.status} flow="manager_hr" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function TaxPlanner() {
  const { data, isLoading } = useGet('payroll/regime');
  const [act] = useAction();
  const navigate = useNavigate();
  if (isLoading) return <CardSkeleton lines={6} />;
  const p = data.projected;
  const card = (key, title) => {
    const r = p.regimes[key];
    const selected = p.selected === key;
    return (
      <div className={cx('card card-pad relative', selected && 'ring-2 ring-brand-500')} data-testid={`regime-${key}`}>
        {p.recommended === key && <span className="absolute right-4 top-4"><Badge color="green">Saves more</Badge></span>}
        <h3 className="font-semibold">{title}</h3>
        <div className="mt-3 text-3xl font-bold">{money(r.tax)}</div>
        <div className="text-xs muted">Estimated annual tax · {money(r.tax / 12)} per month</div>
        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="muted">Gross income</span><span>{money(p.annual_gross)}</span></div>
          <div className="flex justify-between"><span className="muted">Deductions & exemptions</span><span>− {money(r.deductions)}</span></div>
          <div className="flex justify-between font-semibold"><span>Taxable income</span><span>{money(r.taxable)}</span></div>
          {key === 'old' && r.deduction_items && (
            <div className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              {Object.entries(r.deduction_items).filter(([, v]) => v > 0).map(([k, v]) => <div key={k} className="flex justify-between"><span className="muted">{k === 'standard' ? 'Standard deduction' : `Sec ${k}`}</span><span>{money(v)}</span></div>)}
            </div>
          )}
        </div>
        <button className={cx('mt-5 w-full', selected ? 'btn-secondary' : 'btn-primary')} disabled={selected}
          onClick={() => act('payroll/regime', { method: 'PUT', body: { regime: key }, success: `Switched to the ${title.toLowerCase()}`, invalidates: ['payroll'] })} data-testid={`choose-${key}`}>
          {selected ? 'Current choice' : `Choose ${title.toLowerCase()}`}
        </button>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm muted">Estimates for FY {p.fy} using your current CTC and investment declarations (pending ones included). TDS in your next payroll follows the regime you choose. You could save <b>{money(p.savings)}</b> with the {p.recommended} regime.</p>
        <button className="btn-secondary" onClick={() => navigate('/tax-statement')} data-testid="open-tax-statement"><FileText size={16} /> Annual tax statement</button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">{card('new', 'New regime')}{card('old', 'Old regime')}</div>
    </div>
  );
}

export default function Payslips() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  return (
    <div className="space-y-6">
      <PageHeader icon={Wallet} title="Payslips & tax" subtitle="Salary, payslips, tax planning, declarations and loans" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: 'overview', label: 'Payslips' }, { value: 'tax', label: 'Tax planner' }, { value: 'loans', label: 'Loans & advances' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'tax' && <TaxPlanner />}
      {tab === 'loans' && <Loans />}
    </div>
  );
}
