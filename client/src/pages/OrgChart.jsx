import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, ChevronDown, ChevronRight, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { useGet } from '../lib/hooks';
import { PageHeader, Avatar, CardSkeleton, cx } from '../components/ui';

function Node({ node, depth, expanded, toggle, highlight }) {
  const open = expanded.has(node.id);
  const hasKids = node.children.length > 0;
  return (
    <div className="flex flex-col items-center">
      <div className={cx('relative w-56 rounded-2xl border bg-white p-3 shadow-sm transition hover:shadow-md dark:bg-slate-900',
        highlight === node.id ? 'border-brand-500 ring-4 ring-brand-500/20' : 'border-slate-200 dark:border-slate-700')} data-testid="org-node">
        <Link to={`/employees/${node.id}`} className="flex items-center gap-3">
          <Avatar name={node.name} color={node.avatar_color} size="md" />
          <div className="min-w-0 text-left">
            <div className="truncate text-sm font-semibold">{node.name}</div>
            <div className="truncate text-xs muted">{node.designation}</div>
            <div className="truncate text-[11px] text-brand-600 dark:text-brand-400">{node.department || 'Leadership'}</div>
          </div>
        </Link>
        {hasKids && (
          <button onClick={() => toggle(node.id)} className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{node.total}
          </button>
        )}
      </div>
      {hasKids && open && (
        <>
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-700" />
          <div className="flex">
            {node.children.map((c, i) => {
              const only = node.children.length === 1;
              const first = i === 0;
              const last = i === node.children.length - 1;
              return (
                <div key={c.id} className="relative flex flex-col items-center px-2 pt-6">
                  {!only && <div className={cx('absolute top-0 h-px bg-slate-300 dark:bg-slate-700', first ? 'left-1/2 right-0' : last ? 'left-0 right-1/2' : 'inset-x-0')} />}
                  <div className="absolute left-1/2 top-0 h-6 w-px bg-slate-300 dark:bg-slate-700" />
                  <Node node={c} depth={depth + 1} expanded={expanded} toggle={toggle} highlight={highlight} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function OrgChart() {
  const { data = [], isLoading } = useGet('employees/org-chart');
  const [zoom, setZoom] = useState(0.9);
  const scroller = useRef(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [data.length, zoom]);
  const [q, setQ] = useState('');
  const { roots, parents } = useMemo(() => {
    const map = new Map(data.map((d) => [d.id, { ...d, children: [] }]));
    const rootsArr = [];
    const parentMap = new Map();
    for (const n of map.values()) {
      if (n.manager_id && map.has(n.manager_id)) { map.get(n.manager_id).children.push(n); parentMap.set(n.id, n.manager_id); } else rootsArr.push(n);
    }
    const count = (n) => (n.total = n.children.reduce((a, c) => a + 1 + count(c), 0));
    rootsArr.forEach(count);
    return { roots: rootsArr, parents: parentMap };
  }, [data]);
  const [expanded, setExpanded] = useState(null);
  const exp = expanded ?? new Set(roots.map((r) => r.id));
  const toggle = (id) => setExpanded(() => { const n = new Set(exp); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const match = q.length > 1 ? data.find((d) => d.name.toLowerCase().includes(q.toLowerCase())) : null;
  const locate = () => {
    if (!match) return;
    const n = new Set(exp);
    let p = parents.get(match.id);
    while (p) { n.add(p); p = parents.get(p); }
    setExpanded(n);
  };

  return (
    <div>
      <PageHeader icon={Network} title="Organization chart" subtitle={`${data.length} people · click a node count to expand teams`}
        actions={<>
          <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input w-56 pl-9" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && locate()} aria-label="Find person" /></div>
          <button className="btn-secondary btn-sm" onClick={locate} disabled={!match}>Locate</button>
          <button className="btn-secondary btn-sm !px-2" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} aria-label="Zoom out"><ZoomOut size={16} /></button>
          <button className="btn-secondary btn-sm !px-2" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))} aria-label="Zoom in"><ZoomIn size={16} /></button>
          <button className="btn-secondary btn-sm" onClick={() => setExpanded(new Set(data.map((d) => d.id)))}>Expand all</button>
        </>} />
      {isLoading ? <CardSkeleton lines={8} /> : (
        <div className="card overflow-auto p-8" ref={scroller} style={{ maxHeight: 'calc(100vh - 220px)' }}>
          <div className="mx-auto flex w-max gap-10" style={{ zoom }}>
            {roots.map((r) => <Node key={r.id} node={r} depth={0} expanded={exp} toggle={toggle} highlight={match?.id} />)}
          </div>
        </div>
      )}
    </div>
  );
}
