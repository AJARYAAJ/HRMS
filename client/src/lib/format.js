const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n, exact = false) => (n === null || n === undefined || n === '' ? '—' : (exact ? inr2 : inr).format(Number(n)));
export const compactMoney = (n) => {
  const v = Number(n || 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${v}`;
};
export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN'));

const toDate = (s) => {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00`) : new Date(str.replace(' ', 'T'));
};

export const date = (s, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => {
  const d = toDate(s);
  return d && !isNaN(d) ? d.toLocaleDateString('en-IN', opts) : '—';
};
export const shortDate = (s) => date(s, { day: '2-digit', month: 'short' });
export const dateTime = (s) => {
  const d = toDate(s);
  return d && !isNaN(d) ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};
export const monthLabel = (m) => (m ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '—');

export const timeAgo = (s) => {
  const d = toDate(s);
  if (!d) return '';
  // Server timestamps from SQLite datetime('now') are UTC without a zone marker.
  const ts = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(s)) ? new Date(String(s).replace(' ', 'T') + 'Z') : d;
  const diff = (Date.now() - ts.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date(s);
};

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const thisMonth = () => todayStr().slice(0, 7);
export const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const minsToHours = (m) => {
  const v = Math.round(Number(m || 0));
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
};
export const hoursBetween = (a, b) => {
  if (!a || !b) return null;
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  return (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
};

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const fullName = (e) => (e ? `${e.first_name} ${e.last_name}` : '');

export function downloadCsv(filename, rows, columns) {
  const cols = columns || Object.keys(rows[0] || {}).map((k) => ({ key: k, header: k }));
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.map((c) => esc(c.header)).join(','), ...rows.map((r) => cols.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
