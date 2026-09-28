import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Save, RotateCcw } from 'lucide-react';
import { useGet, useAction } from '../lib/hooks';
import { PageHeader, Avatar, CardSkeleton, EmptyState, cx } from '../components/ui';
import { date, todayStr } from '../lib/format';

const mondayOf = (s) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const shift = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const TONES = ['bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300', 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'];

/** Weekly shift roster (Zoho People shift scheduling): assign a shift or week-off per person per day. */
export default function Roster() {
  const [start, setStart] = useState(mondayOf(todayStr()));
  const [dept, setDept] = useState('');
  const { data, isLoading } = useGet('workforce/roster', { start, department_id: dept });
  const { data: depts = [] } = useGet('departments');
  const [act, { isLoading: saving }] = useAction();
  const [changes, setChanges] = useState({});
  const toneOf = useMemo(() => Object.fromEntries((data?.shifts || []).map((s, i) => [s.id, TONES[i % TONES.length]])), [data]);
  const key = (e, d) => `${e}|${d}`;
  const valueOf = (row, i) => {
    const k = key(row.id, data.days[i]);
    if (k in changes) return changes[k];
    const cell = row.days[i];
    return cell ? (cell.week_off ? 'off' : String(cell.shift_id)) : '';
  };
  const dirty = Object.keys(changes).length;
  const save = async () => {
    const entries = Object.entries(changes).map(([k, v]) => { const [employee_id, d] = k.split('|'); return { employee_id: Number(employee_id), date: d, shift_id: v && v !== 'off' ? Number(v) : null, week_off: v === 'off' }; });
    if (await act('workforce/roster', { method: 'PUT', body: { entries }, success: `Roster saved · ${entries.length} change(s)` })) setChanges({});
  };

  return (
    <div>
      <PageHeader icon={CalendarRange} title="Shift roster" subtitle="Plan weekly shifts and week-offs; clock-ins are evaluated against the rostered shift"
        actions={<>
          <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
            <button className="btn-ghost btn-sm !px-2" onClick={() => { setStart(shift(start, -7)); setChanges({}); }} aria-label="Previous week"><ChevronLeft size={16} /></button>
            <span className="min-w-40 text-center text-sm font-semibold" data-testid="roster-week">{date(start, { day: 'numeric', month: 'short' })} – {date(shift(start, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button className="btn-ghost btn-sm !px-2" onClick={() => { setStart(shift(start, 7)); setChanges({}); }} aria-label="Next week"><ChevronRight size={16} /></button>
          </div>
          <button className="btn-secondary" onClick={() => act('workforce/roster/copy-week', { body: { from: shift(start, -7) }, success: 'Copied last week’s roster' })}><Copy size={16} /> Copy last week</button>
        </>} />
      {dirty > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 text-sm dark:bg-brand-500/10">
          <span><b>{dirty}</b> unsaved change(s)</span>
          <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={() => setChanges({})}><RotateCcw size={14} /> Discard</button><button className="btn-primary btn-sm" onClick={save} disabled={saving} data-testid="save-roster"><Save size={14} /> Save roster</button></div>
        </div>
      )}
      {isLoading ? <CardSkeleton lines={8} /> : data.rows.length === 0 ? <div className="card"><EmptyState title="No one to roster" /></div> : (
        <div className="card overflow-x-auto" data-testid="roster-grid">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3 text-left">Employee</th>
                {data.days.map((d) => <th key={d} className={cx('px-2 py-3 text-center', d === todayStr() && 'text-brand-600')}>{date(d, { weekday: 'short' })}<div className="font-normal normal-case">{date(d, { day: '2-digit', month: 'short' })}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 dark:border-slate-800/60" data-testid="roster-row">
                  <td className="px-4 py-2"><div className="flex items-center gap-2"><Avatar name={row.name} color={row.avatar_color} size="xs" /><div className="min-w-0"><div className="truncate font-medium">{row.name}</div><div className="truncate text-[11px] muted">{[row.department, `default ${row.default_shift || 'General'}`].filter(Boolean).join(' · ')}</div></div></div></td>
                  {data.days.map((d, i) => {
                    const v = valueOf(row, i);
                    const changed = key(row.id, d) in changes;
                    return (
                      <td key={d} className="px-1 py-1.5">
                        <select aria-label={`${row.name} ${d}`} value={v} onChange={(e) => setChanges((c) => ({ ...c, [key(row.id, d)]: e.target.value }))}
                          className={cx('w-full cursor-pointer rounded-lg border-0 px-1.5 py-1.5 text-center text-xs font-semibold outline-none ring-1 ring-inset',
                            v === 'off' ? 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700' : v ? `${toneOf[v]} ring-transparent` : 'bg-transparent text-slate-400 ring-slate-200 dark:ring-slate-700',
                            changed && 'ring-2 ring-brand-500')}>
                          <option value="">Default</option>
                          {data.shifts.map((s) => <option key={s.id} value={s.id} title={`${s.start_time}–${s.end_time}`}>{s.name}</option>)}
                          <option value="off">Week off</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
