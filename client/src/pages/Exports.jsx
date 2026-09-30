import { useMemo, useState } from 'react';
import { DownloadCloud, FileSpreadsheet, FileText, Check, History } from 'lucide-react';
import { useGet, useToast } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { authFetch, invalidateFiles } from '../lib/files';
import { timeAgo, titleCase, todayStr, thisMonth } from '../lib/format';

const firstOfYear = () => `${todayStr().slice(0, 4)}-01-01`;

export default function Exports() {
  const { data: modules = [], isLoading } = useGet('exports/modules');
  const { data: history = [], isLoading: histLoading, refetch } = useGet('exports/history');
  const { data: depts = [] } = useGet('departments');
  const { data: companies = [] } = useGet('companies');
  const toast = useToast();
  const [key, setKey] = useState(null);
  const [cols, setCols] = useState([]);
  const [f, setF] = useState({ from: firstOfYear(), to: todayStr(), month: thisMonth(), year: new Date().getFullYear(), department_id: '', company_id: '', status: '' });
  const [format, setFormat] = useState('xlsx');
  const [busy, setBusy] = useState(false);
  const mod = modules.find((m) => m.key === key);
  const groups = useMemo(() => modules.reduce((a, m) => ({ ...a, [m.group]: [...(a[m.group] || []), m] }), {}), [modules]);

  const pick = (m) => { setKey(m.key); setCols(m.defaults); setF((x) => ({ ...x, status: '' })); };
  const toggle = (c) => setCols((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : mod.columns.map((k) => k.key).filter((k) => xs.includes(k) || k === c)));

  const run = async () => {
    setBusy(true);
    const filters = {};
    if (mod.filters.date) Object.assign(filters, { from: f.from, to: f.to });
    if (mod.filters.month && f.month) filters.month = f.month;
    if (mod.filters.year) filters.year = f.year;
    if (mod.filters.department && f.department_id) filters.department_id = f.department_id;
    if (mod.filters.company && f.company_id) filters.company_id = f.company_id;
    if (mod.filters.status && f.status) filters.status = f.status;
    try {
      const res = await authFetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: mod.key, format, columns: cols, filters }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const rows = res.headers.get('X-Row-Count');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${mod.key}.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${rows} row(s) to ${name}`);
      refetch();
      invalidateFiles();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={DownloadCloud} title="Bulk export" subtitle="Export any dataset to Excel or CSV with filters and the columns you need — every export is logged" />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-2">
          {isLoading ? <CardSkeleton lines={8} /> : Object.entries(groups).map(([g, ms]) => (
            <div key={g}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{g}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ms.map((m) => (
                  <button key={m.key} onClick={() => pick(m)} data-testid={`export-${m.key}`}
                    className={cx('card p-3 text-left transition hover:border-brand-300', key === m.key && 'ring-2 ring-brand-500')}>
                    <div className="text-sm font-semibold">{m.label}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs muted">{m.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="xl:col-span-3">
          {!mod ? <div className="card"><EmptyState icon={FileSpreadsheet} title="Choose what to export" message="Pick a dataset on the left, then filters and columns." /></div> : (
            <div className="card card-pad space-y-5" data-testid="export-panel">
              <div><h3 className="text-lg font-semibold">{mod.label}</h3><p className="text-sm muted">{mod.description}</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                {mod.filters.date && <>
                  <div><label className="label" htmlFor="ex-from">From</label><input id="ex-from" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
                  <div><label className="label" htmlFor="ex-to">To</label><input id="ex-to" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
                </>}
                {mod.filters.month && <div><label className="label" htmlFor="ex-month">Month (empty = all)</label><input id="ex-month" type="month" className="input" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></div>}
                {mod.filters.year && <div><label className="label" htmlFor="ex-year">Year</label><input id="ex-year" type="number" className="input" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></div>}
                {mod.filters.department && <div><label className="label" htmlFor="ex-dept">Department</label><select id="ex-dept" className="input" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">All</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>}
                {mod.filters.company && companies.length > 1 && <div><label className="label" htmlFor="ex-co">Company</label><select id="ex-co" className="input" value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">All</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
                {mod.filters.status && <div><label className="label" htmlFor="ex-status">Status</label><select id="ex-status" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{mod.filters.status.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select></div>}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between"><span className="label !mb-0">Columns ({cols.length} of {mod.columns.length})</span>
                  <span className="flex gap-3 text-xs font-semibold"><button className="text-brand-600" onClick={() => setCols(mod.columns.map((c) => c.key))}>All</button><button className="text-brand-600" onClick={() => setCols(mod.defaults)}>Default</button></span></div>
                <div className="flex flex-wrap gap-1.5" data-testid="export-columns">
                  {mod.columns.map((c) => {
                    const on = cols.includes(c.key);
                    return <button key={c.key} onClick={() => toggle(c.key)} aria-pressed={on} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition', on ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/30' : 'text-slate-500 ring-slate-200 dark:ring-slate-700')}>{on && <Check size={11} />}{c.label}</button>;
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label="Format">
                  {[['xlsx', FileSpreadsheet, 'Excel'], ['csv', FileText, 'CSV']].map(([v, Icon, l]) => <button key={v} role="radio" aria-checked={format === v} onClick={() => setFormat(v)} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', format === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}><Icon size={14} />{l}</button>)}
                </div>
                <span className="flex-1" />
                <button className="btn-primary" disabled={busy || !cols.length} onClick={run} data-testid="run-export"><DownloadCloud size={16} /> {busy ? 'Preparing…' : 'Export'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <DataTable title={<span className="flex items-center gap-2"><History size={16} /> Export history</span>} loading={histLoading} rows={history} maxHeight="360px" searchKeys={['module_label', 'by_name']}
        columns={[
          { key: 'module_label', header: 'Dataset' },
          { key: 'format', header: 'Format', render: (r) => <Badge color={r.format === 'xlsx' ? 'green' : 'slate'}>{r.format.toUpperCase()}</Badge> },
          { key: 'row_count', header: 'Rows', align: 'right' },
          { key: 'by_name', header: 'By' },
          { key: 'created_at', header: 'When', render: (r) => timeAgo(r.created_at) },
        ]} />
    </div>
  );
}
