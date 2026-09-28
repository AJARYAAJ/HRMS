import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { TableSkeleton, EmptyState, cx } from './ui';
import { downloadCsv } from '../lib/format';
import { useDebounced } from '../lib/hooks';

/**
 * Virtualised data grid: only visible rows are rendered, so tens of thousands of records scroll smoothly.
 * columns: [{ key, header, render?(row), width?, sortable?, sortValue?(row), csv?(row), align? }]
 */
export default function DataTable({
  rows = [], columns, loading, searchKeys, searchPlaceholder = 'Search…', toolbar, onRowClick, exportName,
  empty, rowHeight = 60, maxHeight = 'calc(100vh - 290px)', title, initialSort, testId = 'data-table',
}) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 150).trim().toLowerCase();
  const [sort, setSort] = useState(initialSort || null);
  const parentRef = useRef(null);

  const filtered = useMemo(() => {
    let out = rows;
    if (q && searchKeys?.length) {
      out = out.filter((r) => searchKeys.some((k) => String(typeof k === 'function' ? k(r) : r[k] ?? '').toLowerCase().includes(q)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = col?.sortValue || ((r) => r[sort.key]);
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, q, sort, searchKeys, columns]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const template = columns.map((c) => c.width || 'minmax(96px, 1fr)').join(' ');
  const toggleSort = (c) => {
    if (c.sortable === false) return;
    setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 'asc' } : s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null));
  };

  return (
    <div className="card overflow-hidden" data-testid={testId}>
      {(searchKeys || toolbar || exportName || title) && (
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 md:flex-row md:items-center">
          {title && <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>}
          {searchKeys && (
            <div className="relative w-full md:max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search table" />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
            {toolbar}
            {exportName && (
              <button className="btn-secondary btn-sm" onClick={() => downloadCsv(`${exportName}.csv`, filtered, columns.filter((c) => c.header && c.csv !== false).map((c) => ({ ...c, header: typeof c.header === 'string' ? c.header : c.key })))}>
                <Download size={14} /> Export
              </button>
            )}
          </div>
        </div>
      )}
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight }}>
        <div style={{ minWidth: columns.length * 110 }}>
          <div className="sticky top-0 z-10 grid gap-3 border-b border-slate-100 bg-slate-50/95 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95" style={{ gridTemplateColumns: template }}>
            {columns.map((c) => (
              <button key={c.key} className={cx('flex items-center gap-1 text-left uppercase', c.align === 'right' && 'justify-end', c.sortable === false ? 'cursor-default' : 'hover:text-slate-800 dark:hover:text-slate-200')} onClick={() => toggleSort(c)}>
                {c.header}
                {c.sortable !== false && c.header && (sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />)}
              </button>
            ))}
          </div>
          {loading ? (
            <TableSkeleton cols={Math.min(columns.length, 6)} />
          ) : filtered.length === 0 ? (
            empty || <EmptyState title={q ? 'No matching results' : 'No records yet'} message={q ? 'Try a different search term.' : undefined} />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vr) => {
                const row = filtered[vr.index];
                return (
                  <div
                    key={row.id ?? vr.index}
                    data-testid="table-row"
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cx('absolute inset-x-0 grid items-center gap-3 border-b border-slate-100 px-4 text-sm dark:border-slate-800/70', onRowClick && 'cursor-pointer hover:bg-brand-50/50 dark:hover:bg-slate-800/50')}
                    style={{ gridTemplateColumns: template, height: vr.size, transform: `translateY(${vr.start}px)` }}
                  >
                    {columns.map((c) => (
                      <div key={c.key} className={cx('min-w-0 truncate', c.align === 'right' && 'text-right')}>
                        {c.render ? c.render(row) : row[c.key] ?? '—'}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {!loading && rows.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs muted dark:border-slate-800">
          Showing {filtered.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} records
        </div>
      )}
    </div>
  );
}
