import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { CardSkeleton, EmptyState } from '../components/ui';
import { money, monthLabel, date } from '../lib/format';

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  n = Math.floor(n);
  if (n < 20) return ones[n];
  if (n < 100) return `${tens[Math.floor(n / 10)]} ${ones[n % 10]}`.trim();
  if (n < 1000) return `${ones[Math.floor(n / 100)]} Hundred ${words(n % 100)}`.trim();
  if (n < 100000) return `${words(Math.floor(n / 1000))} Thousand ${words(n % 1000)}`.trim();
  if (n < 10000000) return `${words(Math.floor(n / 100000))} Lakh ${words(n % 100000)}`.trim();
  return `${words(Math.floor(n / 10000000))} Crore ${words(n % 10000000)}`.trim();
}

export default function PayslipView() {
  const { id } = useParams();
  const { data: s, isLoading, error } = useGet(`payroll/payslips/${id}`);
  const navigate = useNavigate();
  if (isLoading) return <CardSkeleton lines={12} />;
  if (error) return <div className="card"><EmptyState title="Payslip not available" message={error?.data?.error} /></div>;
  const c = s.company || {};
  const earnings = [['Basic salary', s.basic], ['House rent allowance', s.hra], ['Special allowance', s.special]];
  const deductions = [['Provident fund', s.pf], ['ESI', s.esi], ['Professional tax', s.pt], ['Income tax (TDS)', s.tds]];
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <button className="btn-ghost btn-sm" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
        <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
      </div>
      <div className="card print-area overflow-hidden" data-testid="payslip">
        <div className="flex flex-col justify-between gap-4 bg-gradient-to-r from-brand-600 to-violet-600 p-6 text-white sm:flex-row">
          <div>
            <div className="text-xl font-bold">{c.company_name}</div>
            <div className="text-sm text-white/80">{c.company_address}</div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-xs uppercase tracking-wider text-white/70">Payslip for</div>
            <div className="text-lg font-bold">{monthLabel(s.month)}</div>
          </div>
        </div>
        <div className="grid gap-x-8 gap-y-3 border-b border-slate-100 p-6 text-sm dark:border-slate-800 sm:grid-cols-3">
          {[['Employee', s.employee_name], ['Employee ID', s.emp_code], ['Designation', s.designation], ['Department', s.department], ['Date of joining', date(s.date_of_joining)],
            ['PAN', s.pan], ['UAN', s.uan], ['Bank', `${s.bank_name || '—'} ${s.bank_account ? '•••• ' + String(s.bank_account).slice(-4) : ''}`],
            ['Paid days', `${s.paid_days} / ${s.working_days}${s.lop_days ? ` (LOP ${s.lop_days})` : ''}`]].map(([l, v]) => (
            <div key={l}><div className="text-xs text-slate-400">{l}</div><div className="font-medium">{v || '—'}</div></div>
          ))}
        </div>
        <div className="grid sm:grid-cols-2">
          {[['Earnings', earnings, s.gross, 'Gross earnings'], ['Deductions', deductions, s.total_deductions, 'Total deductions']].map(([title, rows, total, label]) => (
            <div key={title} className="p-6 sm:first:border-r sm:first:border-slate-100 dark:sm:first:border-slate-800">
              <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</div>
              {rows.map(([l, v]) => <div key={l} className="flex justify-between py-1.5 text-sm"><span>{l}</span><span className="font-medium">{money(v, true)}</span></div>)}
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm font-bold dark:border-slate-800"><span>{label}</span><span>{money(total, true)}</span></div>
            </div>
          ))}
        </div>
        <div className="m-6 mt-0 rounded-2xl bg-emerald-50 p-5 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-900 dark:text-emerald-200">Net pay</span>
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300" data-testid="net-pay">{money(s.net, true)}</span>
          </div>
          <div className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-300/80">Rupees {words(s.net)} only</div>
        </div>
        <div className="px-6 pb-6 text-center text-xs text-slate-400">This is a system-generated payslip and does not require a signature.</div>
      </div>
    </div>
  );
}
