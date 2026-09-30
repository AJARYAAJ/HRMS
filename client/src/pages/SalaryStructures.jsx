import { useEffect, useState } from 'react';
import { Plus, Trash2, Star, Users, Save, Calculator, AlertTriangle } from 'lucide-react';
import { useGet, useAction, useDisclosure, useDebounced } from '../lib/hooks';
import { Badge, CardSkeleton, EmptyState, cx } from '../components/ui';
import { FormModal } from '../components/Form';
import { money } from '../lib/format';
import { authFetch } from '../lib/files';

const CALC = [['percent_ctc', '% of CTC'], ['percent_basic', '% of Basic'], ['fixed', 'Fixed / month'], ['balance', 'Balance (rest of CTC)']];
const BLANK = {
  name: '', description: '', pf_enabled: 1, pf_wage_cap: 15000, pf_employer_in_ctc: 0, esi_enabled: 1, esi_threshold: 21000, pt_enabled: 1, gratuity_in_ctc: 0,
  components: [
    { name: 'Basic', code: 'BASIC', type: 'earning', calc: 'percent_ctc', value: 50 },
    { name: 'House rent allowance', code: 'HRA', type: 'earning', calc: 'percent_basic', value: 40 },
    { name: 'Special allowance', code: 'SPECIAL', type: 'earning', calc: 'balance', value: 0 },
  ],
};

function Preview({ draft }) {
  const [ctc, setCtc] = useState(1200000);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const key = useDebounced(JSON.stringify({ draft, ctc }), 300);
  useEffect(() => {
    const { draft: d, ctc: c } = JSON.parse(key);
    if (!(c > 0)) return;
    authFetch('/api/salary/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structure: d, annual_ctc: c }) })
      .then(async (r) => { const b = await r.json(); if (r.ok) { setRes(b); setError(''); } else setError(b.error); })
      .catch(() => setError('Preview unavailable'));
  }, [key]);
  const earn = res?.lines.filter((l) => l.type === 'earning') || [];
  const ded = res?.lines.filter((l) => l.type === 'deduction') || [];
  return (
    <div className="card card-pad space-y-3" data-testid="structure-preview">
      <div className="flex items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold"><Calculator size={15} /> Preview</h4>
        <label className="flex items-center gap-2 text-xs muted">Annual CTC <input className="input !w-32 !py-1" type="number" value={ctc} onChange={(e) => setCtc(Number(e.target.value))} aria-label="Preview CTC" /></label></div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : !res ? <CardSkeleton lines={4} /> : (
        <div className="space-y-1 text-sm">
          {res.warnings.map((w) => <p key={w} className="flex items-center gap-1.5 text-xs font-medium text-amber-600"><AlertTriangle size={13} />{w}</p>)}
          <div className="grid grid-cols-3 text-xs font-semibold uppercase text-slate-400"><span>Component</span><span className="text-right">Monthly</span><span className="text-right">Annual</span></div>
          {earn.map((l) => <div key={l.code} className="grid grid-cols-3"><span>{l.name}</span><span className="text-right tabular-nums">{money(l.amount)}</span><span className="text-right tabular-nums muted">{money(l.amount * 12)}</span></div>)}
          <div className="grid grid-cols-3 border-t border-slate-100 pt-1 font-semibold dark:border-slate-800"><span>Gross</span><span className="text-right" data-testid="preview-gross">{money(res.gross)}</span><span className="text-right">{money(res.gross * 12)}</span></div>
          {ded.map((l) => <div key={l.code} className="grid grid-cols-3 text-rose-600 dark:text-rose-400"><span>− {l.name}</span><span className="text-right tabular-nums">{money(l.amount)}</span><span className="text-right tabular-nums">{money(l.amount * 12)}</span></div>)}
          <div className="grid grid-cols-3 rounded-lg bg-emerald-50 px-2 py-1 font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"><span>Take-home</span><span className="text-right" data-testid="preview-net">{money(res.net)}</span><span className="text-right">{money(res.net * 12)}</span></div>
          {(res.employer.pf || res.employer.esi || res.employer.gratuity) ? (
            <p className="pt-1 text-xs muted">Employer: PF {money(res.employer.pf)} · ESI {money(res.employer.esi)} · Gratuity {money(res.employer.gratuity)} a month</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Editor({ structure, onSaved }) {
  const [d, setD] = useState(structure);
  const [act] = useAction();
  useEffect(() => setD(structure), [structure]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setC = (i, k, v) => setD((x) => ({ ...x, components: x.components.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const save = async () => {
    const body = { ...d, components: d.components.map((c) => ({ ...c, value: Number(c.value) || 0 })) };
    const r = await act(d.id ? `salary/structures/${d.id}` : 'salary/structures', { method: d.id ? 'PUT' : 'POST', body, success: 'Salary template saved' });
    if (r?.id) onSaved(r.id);
  };
  const toggle = (k, label) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!d[k]} onChange={(e) => set(k, e.target.checked ? 1 : 0)} aria-label={label} />{label}</label>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="card card-pad space-y-4 xl:col-span-3" data-testid="structure-editor">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="s-name">Template name</label><input id="s-name" className="input" value={d.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><label className="label" htmlFor="s-desc">Description</label><input id="s-desc" className="input" value={d.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
        </div>
        <div>
          <div className="mb-1 grid grid-cols-12 gap-2 text-xs font-semibold uppercase text-slate-400"><span className="col-span-4">Component</span><span className="col-span-2">Type</span><span className="col-span-3">Calculated as</span><span className="col-span-2">Value</span></div>
          <div className="space-y-2" data-testid="component-rows">
            {d.components.map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <input className="input col-span-4" aria-label={`Component ${i + 1}`} value={c.name} onChange={(e) => setC(i, 'name', e.target.value)} />
                <select className="input col-span-2" aria-label={`Type ${i + 1}`} value={c.type} onChange={(e) => setC(i, 'type', e.target.value)}><option value="earning">Earning</option><option value="deduction">Deduction</option></select>
                <select className="input col-span-3" aria-label={`Calculation ${i + 1}`} value={c.calc} onChange={(e) => setC(i, 'calc', e.target.value)}>{CALC.filter(([v]) => c.type === 'earning' || v !== 'balance').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input className="input col-span-2" type="number" step="0.01" aria-label={`Value ${i + 1}`} disabled={c.calc === 'balance'} value={c.calc === 'balance' ? '' : c.value} onChange={(e) => setC(i, 'value', e.target.value)} />
                <button className="col-span-1 text-slate-400 hover:text-rose-600 disabled:opacity-30" disabled={c.code === 'BASIC'} aria-label={`Remove component ${i + 1}`} onClick={() => setD((x) => ({ ...x, components: x.components.filter((_, j) => j !== i) }))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button className="btn-ghost btn-sm mt-2" onClick={() => setD((x) => ({ ...x, components: [...x.components.slice(0, -1), { name: '', code: '', type: 'earning', calc: 'fixed', value: 0 }, ...x.components.slice(-1)] }))} data-testid="add-component"><Plus size={14} /> Add component</button>
        </div>
        <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-800/50">
          {toggle('pf_enabled', 'Provident fund (12%)')}
          <label className="flex items-center gap-2 text-sm">PF wage cap ₹<input className="input !w-28 !py-1" type="number" aria-label="PF wage cap" value={d.pf_wage_cap ?? ''} placeholder="Full basic" onChange={(e) => set('pf_wage_cap', e.target.value)} /></label>
          {toggle('pf_employer_in_ctc', 'Employer PF is part of CTC')}
          {toggle('gratuity_in_ctc', 'Gratuity (4.81% of basic) is part of CTC')}
          {toggle('esi_enabled', 'ESI when gross ≤ threshold')}
          <label className="flex items-center gap-2 text-sm">ESI threshold ₹<input className="input !w-28 !py-1" type="number" aria-label="ESI threshold" value={d.esi_threshold ?? ''} onChange={(e) => set('esi_threshold', e.target.value)} /></label>
          {toggle('pt_enabled', 'Professional tax')}
        </div>
        <div className="flex justify-end"><button className="btn-primary" onClick={save} data-testid="save-structure"><Save size={16} /> Save template</button></div>
      </div>
      <div className="xl:col-span-2"><Preview draft={d} /></div>
    </div>
  );
}

export default function SalaryStructures() {
  const { data = [], isLoading } = useGet('salary/structures');
  const [act] = useAction();
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const assign = useDisclosure();
  const current = draft || data.find((s) => s.id === sel) || data[0];
  if (isLoading) return <CardSkeleton lines={8} />;
  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <div className="space-y-2 lg:col-span-1" data-testid="structure-list">
        {data.map((s) => (
          <button key={s.id} onClick={() => { setDraft(null); setSel(s.id); }} className={cx('card w-full p-3 text-left', current?.id === s.id && !draft && 'ring-2 ring-brand-500')} data-testid="structure-card">
            <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{s.name}</span>{s.is_default && <Badge color="violet">Default</Badge>}</div>
            <div className="mt-0.5 text-xs muted">{s.components.length} components · {s.assigned} assigned</div>
            <div className="mt-1 text-[11px] muted">₹12L CTC → take-home {money(s.example.net)}/mo</div>
          </button>
        ))}
        <button className="btn-secondary w-full" onClick={() => setDraft({ ...BLANK, name: '' })} data-testid="new-structure"><Plus size={15} /> New salary template</button>
      </div>
      <div className="space-y-4 lg:col-span-3">
        {!current ? <div className="card"><EmptyState title="No salary templates" /></div> : (
          <>
            {current.id && !draft && (
              <div className="flex flex-wrap justify-end gap-2">
                {!current.is_default && <button className="btn-secondary btn-sm" onClick={() => act(`salary/structures/${current.id}/default`, { body: {}, success: `${current.name} is now the default` })}><Star size={14} /> Make default</button>}
                <button className="btn-secondary btn-sm" onClick={() => assign.onOpen(current)} data-testid="assign-structure"><Users size={14} /> Assign</button>
                <button className="btn-secondary btn-sm text-rose-600" onClick={() => act(`salary/structures/${current.id}`, { method: 'DELETE', success: 'Template deleted' })}><Trash2 size={14} /> Delete</button>
              </div>
            )}
            <Editor key={current.id || 'new'} structure={current} onSaved={(id) => { setDraft(null); setSel(id); }} />
          </>
        )}
      </div>
      <FormModal open={assign.open} onClose={assign.onClose} title={assign.payload ? `Assign ${assign.payload.name}` : ''} submitLabel="Assign"
        fields={[{ name: 'department_id', label: 'Everyone in department', type: 'lookup', path: 'departments' }, { name: 'employee_id', label: 'Or one employee', type: 'employee' }]}
        onSubmit={(v) => act(`salary/structures/${assign.payload.id}/assign`, { body: { department_id: v.department_id || undefined, employee_ids: v.employee_id ? [v.employee_id] : [] }, success: 'Salary template assigned', invalidates: ['payroll'] })} />
    </div>
  );
}
