import { useMemo, useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { PageHeader, MonthPicker, CardSkeleton, cx } from '../components/ui';
import { thisMonth, todayStr, date } from '../lib/format';

// Each event type has a fixed colour and label (identity never relies on colour alone: the legend and text carry it).
const TYPES = {
  holiday: ['Holiday', 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300'],
  leave: ['Leave', 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300'],
  interview: ['Interview', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'],
  one_on_one: ['1:1', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'],
  birthday: ['Birthday', 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300'],
  anniversary: ['Anniversary', 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'],
  task: ['Task due', 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'],
  travel: ['Travel', 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300'],
  probation: ['Probation review', 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'],
};

/** Company calendar: holidays, leave, interviews, 1:1s, birthdays, anniversaries, tasks, travel and probation reviews. */
export default function CalendarPage() {
  const [month, setMonth] = useState(thisMonth());
  const [hidden, setHidden] = useState(new Set());
  const [selected, setSelected] = useState(todayStr());
  const { data, isLoading } = useGet('work/calendar', { month });
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();

  // Expand multi-day events (leave, travel) onto every day they cover.
  const byDay = useMemo(() => {
    const map = {};
    for (const e of data?.events || []) {
      if (hidden.has(e.type)) continue;
      const start = Number(e.date.slice(8, 10));
      const end = e.end && e.end.slice(0, 7) === month ? Number(e.end.slice(8, 10)) : start;
      for (let d = start; d <= end; d++) (map[d] ||= []).push(e);
    }
    return map;
  }, [data, hidden, month]);
  const selectedDay = selected.slice(0, 7) === month ? Number(selected.slice(8, 10)) : null;
  const toggle = (t) => setHidden((h) => { const n = new Set(h); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <div>
      <PageHeader icon={CalendarIcon} title="Calendar" subtitle="Everything happening across the company in one place" actions={<MonthPicker value={month} onChange={setMonth} />} />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Event types">
        {Object.entries(TYPES).map(([k, [label, cls]]) => (
          <button key={k} onClick={() => toggle(k)} aria-pressed={!hidden.has(k)} className={cx('rounded-full px-3 py-1 text-xs font-semibold transition', cls, hidden.has(k) && 'opacity-40 line-through')}>{label}</button>
        ))}
      </div>
      {isLoading ? <CardSkeleton lines={10} /> : (
        <div className="grid gap-6 xl:grid-cols-4">
          <div className="card overflow-hidden xl:col-span-3" data-testid="company-calendar">
            <div className="grid grid-cols-7 border-b border-slate-100 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: first }).map((_, i) => <div key={`e${i}`} className="min-h-28 border-b border-r border-slate-50 bg-slate-50/40 dark:border-slate-800/60 dark:bg-slate-900/40" />)}
              {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                const ds = `${month}-${String(d).padStart(2, '0')}`;
                const evs = byDay[d] || [];
                const dow = new Date(y, m - 1, d).getDay();
                return (
                  <button key={d} onClick={() => setSelected(ds)} data-testid="calendar-day"
                    className={cx('flex min-h-28 flex-col justify-start border-b border-r border-slate-50 p-1.5 text-left transition hover:bg-brand-50/40 dark:border-slate-800/60 dark:hover:bg-slate-800/40',
                      (dow === 0 || dow === 6) && 'bg-slate-50/60 dark:bg-slate-900/40', selectedDay === d && 'ring-2 ring-inset ring-brand-500')}>
                    <div className={cx('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', ds === todayStr() && 'bg-brand-600 text-white')}>{d}</div>
                    <div className="space-y-0.5">
                      {evs.slice(0, 3).map((e, i) => <div key={i} className={cx('truncate rounded px-1.5 py-0.5 text-[10px] font-medium', TYPES[e.type]?.[1])}>{e.time ? `${e.time} ` : ''}{e.title}</div>)}
                      {evs.length > 3 && <div className="px-1 text-[10px] font-semibold muted">+{evs.length - 3} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card card-pad">
            <h3 className="font-semibold">{date(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <div className="mt-4 space-y-2" data-testid="day-events">
              {(selectedDay ? byDay[selectedDay] || [] : []).map((e, i) => (
                <div key={i} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                  <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-semibold', TYPES[e.type]?.[1])}>{TYPES[e.type]?.[0]}</span>
                  <div className="mt-1 text-sm font-medium">{e.title}</div>
                  {(e.time || e.subtitle) && <div className="text-xs muted">{[e.time, e.subtitle].filter(Boolean).join(' · ')}</div>}
                </div>
              ))}
              {selectedDay && !(byDay[selectedDay] || []).length && <p className="text-sm muted">Nothing scheduled.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
