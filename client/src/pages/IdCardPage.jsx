import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IdCard, Download, Printer, Camera, Trash2, ExternalLink, Copy } from 'lucide-react';
import { useGet, useAction, useAuth, useToast } from '../lib/hooks';
import { PageHeader, Tabs, CardSkeleton, EmptyState } from '../components/ui';
import { authFetch, uploadForm } from '../lib/files';
import { api } from '../store/api';
import { useDispatch } from 'react-redux';

const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Rasterises the card SVG to a PNG at print resolution (≈ 300 dpi for a CR80 card) and downloads it. */
async function downloadPng(svg, filename) {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1712;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}

/** Opens a print-ready sheet (card size 54 × 85.6 mm) so cards can be printed or saved as PDF from the browser. */
function printCards(cards) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ID cards</title><style>
    @page { size: A4; margin: 10mm; } body { margin: 0; font-family: sans-serif; }
    .grid { display: flex; flex-wrap: wrap; gap: 6mm; } img { width: 54mm; height: 85.6mm; break-inside: avoid; }
  </style></head><body><div class="grid">${cards.map((c) => `<img src="${svgUrl(c.svg)}" alt="${c.name.replace(/"/g, '')}">`).join('')}</div>
  <script>Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => { window.focus(); window.print(); });<\/script></body></html>`);
  w.document.close();
  return true;
}

function MyCard({ employeeId }) {
  const { user, isHR } = useAuth();
  const id = employeeId || user.id;
  const { data: info, isLoading, refetch } = useGet(`id-cards/${id}`);
  const [svg, setSvg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [act] = useAction();
  const toast = useToast();
  const fileRef = useRef(null);
  const dispatch = useDispatch();
  const canEditPhoto = id === user.id || isHR;

  const load = async () => {
    const res = await authFetch(`/api/id-cards/${id}/card.svg`);
    setSvg(res.ok ? await res.text() : null);
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { refetch(); load(); dispatch(api.util.invalidateTags([{ type: 'R', id: 'employees' }, { type: 'R', id: 'auth' }])); };
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadForm(`id-cards/${id}/photo`, {}, file);
      toast('Photo updated');
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (isLoading) return <CardSkeleton lines={10} />;
  if (!info) return <div className="card"><EmptyState icon={IdCard} title="ID card not available" /></div>;
  const file = `id-card-${info.emp_code || info.id}.png`;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="mx-auto max-w-xs" data-testid="id-card">
          {svg ? <img src={svgUrl(svg)} alt={`ID card of ${info.name}`} className="w-full rounded-[1.6rem] shadow-xl shadow-brand-500/10" /> : <CardSkeleton lines={12} />}
        </div>
      </div>
      <div className="space-y-4 lg:col-span-3">
        <div className="card card-pad space-y-3">
          <h3 className="font-semibold">{info.name}</h3>
          <p className="text-sm muted">{info.designation || 'Employee'} · {info.company}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!svg} onClick={() => downloadPng(svg, file)} data-testid="download-png"><Download size={16} /> Download PNG</button>
            <button className="btn-secondary" disabled={!svg} onClick={() => printCards([{ name: info.name, svg }]) || toast('Allow pop-ups to print', 'error')}><Printer size={16} /> Print / save as PDF</button>
          </div>
        </div>
        {canEditPhoto && (
          <div className="card card-pad space-y-3">
            <h3 className="font-semibold">Photo</h3>
            <p className="text-sm muted">A clear, front-facing photo (PNG, JPEG or WebP, up to 5 MB). It appears on the ID card and your profile.</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="photo-input" />
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}><Camera size={16} /> {busy ? 'Uploading…' : info.photo_url ? 'Change photo' : 'Upload photo'}</button>
              {info.photo_url && <button className="btn-secondary text-rose-600" onClick={async () => { if (await act(`id-cards/${id}/photo`, { method: 'DELETE', success: 'Photo removed' })) refresh(); }}><Trash2 size={16} /> Remove</button>}
            </div>
          </div>
        )}
        <div className="card card-pad space-y-2">
          <h3 className="font-semibold">Verification</h3>
          <p className="text-sm muted">Anyone scanning the QR code sees whether this card belongs to a current employee — nothing more.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800" data-testid="verify-url">{info.verify_url}</code>
            <button className="btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(info.verify_url).then(() => toast('Link copied'))}><Copy size={14} /> Copy</button>
            <a className="btn-ghost btn-sm" href={info.verify_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function BatchPrint() {
  const { data: depts = [] } = useGet('departments');
  const { data: locations = [] } = useGet('locations');
  const [f, setF] = useState({ department_id: '', location_id: '' });
  const [cards, setCards] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = async () => {
    setBusy(true);
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const res = await authFetch(`/api/id-cards/batch${qs ? `?${qs}` : ''}`);
    setCards(res.ok ? await res.json() : []);
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="b-dept">Department</label><select id="b-dept" className="input" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">All</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div><label className="label" htmlFor="b-loc">Location</label><select id="b-loc" className="input" value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}><option value="">All</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <button className="btn-secondary" onClick={load} disabled={busy} data-testid="load-cards">{busy ? 'Loading…' : 'Show cards'}</button>
        {cards?.length > 0 && <button className="btn-primary" onClick={() => printCards(cards) || toast('Allow pop-ups to print', 'error')} data-testid="print-all"><Printer size={16} /> Print {cards.length} card(s)</button>}
      </div>
      {cards && (cards.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="batch-cards">
          {cards.map((c) => <img key={c.id} src={svgUrl(c.svg)} alt={`ID card of ${c.name}`} className="w-full rounded-2xl shadow" />)}
        </div>
      ) : <div className="card"><EmptyState icon={IdCard} title="No employees match" /></div>)}
    </div>
  );
}

export default function IdCardPage() {
  const { isHR } = useAuth();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get('employee') ? Number(params.get('employee')) : null;
  const tab = params.get('tab') || 'card';
  return (
    <div className="space-y-6">
      <PageHeader icon={IdCard} title="Digital ID card" subtitle="Your company ID with a QR code anyone can scan to verify you work here" />
      {isHR && <Tabs value={tab} onChange={(t) => setParams(t === 'card' ? {} : { tab: t })} tabs={[{ value: 'card', label: employeeId ? 'Employee card' : 'My card' }, { value: 'batch', label: 'Batch print' }]} />}
      {tab === 'batch' && isHR ? <BatchPrint /> : <MyCard employeeId={employeeId} />}
    </div>
  );
}
