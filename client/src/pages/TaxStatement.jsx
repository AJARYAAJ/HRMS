import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { CardSkeleton, EmptyState, Badge } from '../components/ui';
import { money, monthLabel } from '../lib/format';

const fyOf = (d = new Date()) => { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };
const fyOptions = () => { const cur = Number(fyOf().slice(0, 4)); return [0, 1, 2].map((i) => `${cur - i}-${String(cur - i + 1).slice(2)}`); };

/** Annual tax statement (Form 16 Part B style) — salary, deductions and TDS for a financial year. */
export default function TaxStatement() {
  const [fy, setFy] = useState(fyOf());
  const { data, isLoading, error } = useGet('payroll/tax-statement', { fy });
  const navigate = useNavigate();
  if (error) return <div className="card"><EmptyState title="Statement unavailable" message={error?.data?.error} /></div>;
  const t = data?.totals;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
        <div className="flex gap-2">
          <select className="input !w-auto" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
            {fyOptions().map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
          <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
        </div>
      </div>
      {isLoading ? <CardSkeleton lines={12} /> : (
        <div className="card print-area overflow-hidden" data-testid="tax-statement">
          <div className="bg-gradient-to-r from-brand-600 to-violet-600 p-6 text-white">
            <div className="text-xs uppercase tracking-wider text-white/70">Annual tax statement · FY {data.fy}</div>
            <div className="text-xl font-bold">{data.company.company_name}</div>
            <div className="text-sm text-white/80">TAN {data.company.company_tan || '—'} · PAN {data.company.company_pan || '—'}</div>
          </div>
          <div className="grid gap-4 border-b border-slate-100 p-6 text-sm dark:border-slate-800 sm:grid-cols-4">
            {[['Employee', data.employee.name], ['Employee ID', data.employee.emp_code], ['PAN', data.employee.pan], ['Tax regime', data.regime === 'old' ? 'Old regime' : 'New regime']].map(([l, v]) => (
              <div key={l}><div className="text-xs text-slate-400">{l}</div><div className="font-semibold">{v || '—'}</div></div>
            ))}
          </div>
          <div className="p-6">
            <h3 className="mb-3 font-semibold">Monthly salary & TDS</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400"><th className="py-2">Month</th><th className="text-right">Gross</th><th className="text-right">PF</th><th className="text-right">PT</th><th className="text-right">TDS</th><th className="text-right">Net</th></tr></thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.month} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2">{monthLabel(m.month)}</td><td className="text-right">{money(m.gross)}</td><td className="text-right">{money(m.pf)}</td><td className="text-right">{money(m.pt)}</td><td className="text-right">{money(m.tds)}</td><td className="text-right">{money(m.net)}</td></tr>
                  ))}
                  {!data.months.length && <tr><td colSpan={6} className="py-6 text-center muted">No paid payslips in this financial year yet.</td></tr>}
                </tbody>
                {data.months.length > 0 && (
                  <tfoot><tr className="border-t-2 border-slate-200 font-bold dark:border-slate-700"><td className="py-2">Total</td><td className="text-right">{money(t.gross)}</td><td className="text-right">{money(t.pf)}</td><td className="text-right">{money(t.pt)}</td><td className="text-right" data-testid="total-tds">{money(t.tds)}</td><td className="text-right">{money(t.net)}</td></tr></tfoot>
                )}
              </table>
            </div>
          </div>
          <div className="grid gap-6 border-t border-slate-100 p-6 dark:border-slate-800 md:grid-cols-2">
            <div>
              <h3 className="mb-3 font-semibold">Projected tax for the year</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="muted">Taxable income</span><span>{money(data.tax_breakup.taxable)}</span></div>
                <div className="flex justify-between"><span className="muted">Deductions & exemptions</span><span>{money(data.tax_breakup.deductions)}</span></div>
                <div className="flex justify-between font-semibold"><span>Annual tax (incl. cess)</span><span>{money(data.projected_annual_tax)}</span></div>
                <div className="flex justify-between"><span className="muted">TDS deducted so far</span><span>{money(t.tds)}</span></div>
                <div className="flex justify-between"><span className="muted">Remaining</span><span>{money(Math.max(0, data.projected_annual_tax - t.tds))}</span></div>
              </div>
            </div>
            <div>
              <h3 className="mb-3 font-semibold">Investment declarations</h3>
              <div className="space-y-2 text-sm">
                {data.declarations.map((d, i) => <div key={i} className="flex items-center justify-between"><span>Sec {d.section} · {d.description}</span><span className="flex items-center gap-2">{money(d.amount)}<Badge status={d.status} /></span></div>)}
                {!data.declarations.length && <p className="muted">No declarations for this year.</p>}
              </div>
            </div>
          </div>
          <p className="px-6 pb-6 text-xs muted">System-generated statement for information. The certified Form 16 (Part A from TRACES) is issued by the employer after the financial year closes.</p>
        </div>
      )}
    </div>
  );
}
