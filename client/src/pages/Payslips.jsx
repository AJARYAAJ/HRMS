import { useNavigate } from 'react-router-dom';
import { Wallet, FileDown, Landmark, Plus, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, monthLabel } from '../lib/format';
import { useChartTheme } from '../lib/chart';

const currentFY = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
};

export default function Payslips() {
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
      <PageHeader icon={Wallet} title="Payslips & tax" subtitle="Salary breakup, monthly payslips and investment declarations" />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-semibold"><TrendingUp size={16} className="text-brand-500" /> My salary structure</h3>
          {pLoading ? <CardSkeleton lines={5} className="!border-0 !p-0 !shadow-none" /> : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between rounded-xl bg-brand-50 p-3 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"><span>Annual CTC</span><span>{money(preview.annual_ctc)}</span></div>
                {[['Basic', m.basic], ['HRA', m.hra], ['Special allowance', m.special]].map(([l, v]) => <div key={l} className="flex justify-between px-3"><span className="muted">{l}</span><span className="font-medium">{money(v)}</span></div>)}
                <div className="flex justify-between border-t border-slate-100 px-3 pt-2 font-semibold dark:border-slate-800"><span>Gross / month</span><span>{money(m.gross)}</span></div>
                {[['Provident fund', m.pf], ['ESI', m.esi], ['Professional tax', m.pt], ['TDS', m.tds]].map(([l, v]) => <div key={l} className="flex justify-between px-3 text-rose-600 dark:text-rose-400"><span>− {l}</span><span>{money(v)}</span></div>)}
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
