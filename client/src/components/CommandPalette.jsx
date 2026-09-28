import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, User, Briefcase, FileText, Zap } from 'lucide-react';
import { setPaletteOpen, toggleTheme } from '../store/uiSlice';
import { navGroups } from '../routes';
import { useAuth, useDebounced, useGet } from '../lib/hooks';
import { Avatar, cx } from './ui';

export default function CommandPalette() {
  const open = useSelector((s) => s.ui.paletteOpen);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounced = useDebounced(q, 200);
  const { data: remote } = useGet(open && debounced.length >= 2 ? 'search' : null, { q: debounced });

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dispatch(setPaletteOpen(!open));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dispatch, open]);

  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  const close = () => dispatch(setPaletteOpen(false));

  const items = useMemo(() => {
    const lq = q.toLowerCase();
    const nav = navGroups.flatMap((g) => g.items).filter((i) => i.roles.includes(role))
      .filter((i) => !lq || i.label.toLowerCase().includes(lq))
      .map((i) => ({ key: `nav-${i.path}`, label: i.label, hint: 'Go to page', icon: i.icon, run: () => navigate(i.path) }));
    const actions = [
      { label: 'Apply for leave', path: '/leave?apply=1' }, { label: 'Raise a helpdesk ticket', path: '/helpdesk?new=1' },
      { label: 'Submit an expense claim', path: '/expenses?new=1' }, { label: 'Log timesheet hours', path: '/timesheets?new=1' },
      { label: 'Give kudos to a colleague', path: '/engage?kudos=1' },
    ].filter((a) => !lq || a.label.toLowerCase().includes(lq))
      .map((a) => ({ key: `act-${a.path}`, label: a.label, hint: 'Quick action', icon: Zap, run: () => navigate(a.path) }));
    if (!lq || 'toggle dark mode theme'.includes(lq)) actions.push({ key: 'theme', label: 'Toggle dark mode', hint: 'Quick action', icon: Zap, run: () => dispatch(toggleTheme()) });
    const people = (remote?.employees || []).map((e) => ({ key: `emp-${e.id}`, label: e.name, hint: e.designation || e.email, avatar: e, icon: User, run: () => navigate(`/employees/${e.id}`) }));
    const jobs = (remote?.jobs || []).map((j) => ({ key: `job-${j.id}`, label: j.title, hint: 'Open position', icon: Briefcase, run: () => navigate('/recruitment') }));
    const docs = (remote?.documents || []).map((d) => ({ key: `doc-${d.id}`, label: d.title, hint: d.category, icon: FileText, run: () => navigate('/documents') }));
    return [...people, ...nav.slice(0, lq ? 8 : 6), ...actions.slice(0, 6), ...jobs, ...docs];
  }, [q, role, remote, navigate, dispatch]);

  if (!open) return null;

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter' && items[active]) { items[active].run(); close(); }
    if (e.key === 'Escape') close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-label="Command palette">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-pop dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-slate-800">
          <Search size={18} className="text-slate-400" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder="Type to search people, pages or actions…" className="h-14 flex-1 bg-transparent text-sm outline-none" aria-label="Command search" />
          <kbd className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 dark:border-slate-700">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <div className="p-6 text-center text-sm muted">No results for “{q}”</div>}
          {items.map((it, i) => (
            <button key={it.key} onMouseEnter={() => setActive(i)} onClick={() => { it.run(); close(); }} data-testid="palette-item"
              className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === active && 'bg-brand-50 dark:bg-brand-500/10')}>
              {it.avatar ? <Avatar name={it.avatar.name} color={it.avatar.avatar_color} size="sm" /> : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800"><it.icon size={16} /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{it.label}</span>
                <span className="block truncate text-xs muted">{it.hint}</span>
              </span>
              {i === active && <ArrowRight size={16} className="text-brand-500" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
