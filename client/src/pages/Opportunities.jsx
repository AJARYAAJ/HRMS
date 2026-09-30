import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Plus, LayoutGrid, List, ArrowRightCircle, IndianRupee, Percent, CalendarClock, Trophy } from 'lucide-react';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Drawer, StatCard, StatSkeletons, EmptyState, Avatar, Modal, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, compactMoney, date, todayStr } from '../lib/format';

export const STAGES = [['lead', 'Lead', 'bg-slate-400'], ['qualified', 'Qualified', 'bg-sky-500'], ['proposal', 'Proposal', 'bg-violet-500'], ['negotiation', 'Negotiation', 'bg-amber-500'], ['won', 'Won', 'bg-emerald-500'], ['lost', 'Lost', 'bg-rose-500']];

const FIELDS = [
  { name: 'name', label: 'Opportunity', required: true, full: true },
  { name: 'client_id', label: 'Existing client', type: 'lookup', path: 'clients' },
  { name: 'prospect', label: 'Or new prospect organisation' },
  { name: 'value', label: 'Deal value (₹)', type: 'number', min: 0 },
  { name: 'expected_close', label: 'Expected close', type: 'date' },
  { name: 'stage', label: 'Stage', type: 'select', noEmpty: true, options: STAGES.slice(0, 4).map(([v, l]) => [v, l]) },
  { name: 'billing_type', label: 'Billing', type: 'select', noEmpty: true, options: [['time_materials', 'Time & materials'], ['fixed', 'Fixed price']] },
  { name: 'source', label: 'Source', type: 'select', options: ['Website', 'Referral', 'LinkedIn', 'Existing client', 'Partner', 'Conference', 'Outbound'] },
  { name: 'owner_id', label: 'Owner', type: 'employee' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];

export default function Opportunities() {
  const { data = [], isLoading } = useGet('opportunities');
  const { data: summary } = useGet('opportunities/summary');
  const [act] = useAction();
  const [view, setView] = useState('board');
  const form = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [lostFor, setLostFor] = useState(null);
  const [reason, setReason] = useState('');
  const [over, setOver] = useState(null);
  const dragged = useRef(null);
  const navigate = useNavigate();
  const open = data.find((o) => o.id === openId);
  const by = useMemo(() => Object.fromEntries(STAGES.map(([s]) => [s, data.filter((o) => o.stage === s)])), [data]);

  const move = (o, stage) => {
    if (o.stage === stage) return;
    if (o.project_id) return;
    if (stage === 'lost') { setReason(''); setLostFor(o); return; }
    act(`opportunities/${o.id}`, { method: 'PUT', body: { stage }, success: `Moved to ${STAGES.find((s) => s[0] === stage)[1]}`, invalidates: ['opportunities'] });
  };
  const convert = async (o) => {
    const r = await act(`opportunities/${o.id}/convert`, { success: 'Project created from the won deal', invalidates: ['projects', 'clients'] });
    if (r?.project_id) navigate(`/projects/${r.project_id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={Target} title="Opportunities" subtitle="Pre-sales pipeline — track deals from lead to won and turn them into projects"
        actions={<>
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[['board', LayoutGrid, 'Board'], ['list', List, 'List']].map(([v, Icon, l]) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', view === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')}><Icon size={14} />{l}</button>)}
          </div>
          <button className="btn-primary" onClick={() => form.onOpen()} data-testid="new-opportunity"><Plus size={16} /> New opportunity</button>
        </>} />
      {!summary ? <StatSkeletons /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="pipeline-summary">
          <StatCard icon={IndianRupee} label="Open pipeline" value={compactMoney(summary.pipeline_value)} hint={`${summary.open_count} open deals`} />
          <StatCard icon={Percent} tone="violet" label="Weighted pipeline" value={compactMoney(summary.weighted_pipeline)} hint="Value × probability" />
          <StatCard icon={Trophy} tone="green" label="Win rate" value={summary.win_rate == null ? '—' : `${summary.win_rate}%`} hint={summary.avg_deal ? `Avg won deal ${compactMoney(summary.avg_deal)}` : undefined} />
          <StatCard icon={CalendarClock} tone="amber" label="Closing this month" value={summary.closing_this_month} />
        </div>
      )}
      {view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-4" data-testid="pipeline-board">
          {STAGES.map(([stage, label, dot]) => (
            <div key={stage} data-stage={stage}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const o = data.find((x) => x.id === dragged.current); dragged.current = null; if (o) move(o, stage); }}
              className={cx('flex w-64 shrink-0 flex-col rounded-2xl bg-slate-100/70 p-3 dark:bg-slate-900/60', over === stage && 'ring-2 ring-brand-500')}>
              <div className="mb-1 flex items-center gap-2 px-1 text-sm font-semibold"><span className={cx('h-2 w-2 rounded-full', dot)} />{label}<span className="ml-auto rounded-full bg-white px-2 text-xs dark:bg-slate-800">{by[stage]?.length || 0}</span></div>
              <div className="mb-3 px-1 text-xs muted">{compactMoney((by[stage] || []).reduce((a, o) => a + o.value, 0))}</div>
              <div className="flex flex-col gap-2">
                {isLoading && <div className="skeleton h-20" />}
                {by[stage]?.map((o) => (
                  <div key={o.id} draggable={!o.project_id} onDragStart={() => { dragged.current = o.id; }} onClick={() => setOpenId(o.id)} data-testid="opportunity-card"
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-sm font-semibold">{o.name}</div>
                    <div className="mt-0.5 truncate text-xs muted">{o.account}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-bold">{compactMoney(o.value)}</span>
                      <div className="flex items-center gap-1.5">
                        {o.expected_close && <span className={cx('text-[11px]', o.expected_close < todayStr() && !['won', 'lost'].includes(o.stage) ? 'font-semibold text-rose-600' : 'muted')}>{date(o.expected_close, { day: '2-digit', month: 'short' })}</span>}
                        {o.owner_name && <Avatar name={o.owner_name} color={o.owner_color} size="xs" />}
                      </div>
                    </div>
                    {o.project_id && <div className="mt-2 text-[11px] font-semibold text-emerald-600">→ {o.project_name}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DataTable loading={isLoading} rows={data} searchKeys={['name', 'account', 'owner_name', 'source']} exportName="opportunities" onRowClick={(r) => setOpenId(r.id)}
          empty={<EmptyState icon={Target} title="No opportunities" />}
          columns={[
            { key: 'name', header: 'Opportunity', width: 'minmax(220px, 1.6fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{r.account}</div></div> },
            { key: 'stage', header: 'Stage', render: (r) => <Badge status={r.stage} /> },
            { key: 'value', header: 'Value', align: 'right', render: (r) => money(r.value) },
            { key: 'probability', header: 'Prob.', align: 'right', render: (r) => `${r.probability}%` },
            { key: 'weighted_value', header: 'Weighted', align: 'right', render: (r) => money(r.weighted_value) },
            { key: 'expected_close', header: 'Close', render: (r) => date(r.expected_close) },
            { key: 'owner_name', header: 'Owner', render: (r) => r.owner_name || '—' },
          ]} />
      )}
      <FormModal open={form.open} onClose={form.onClose} size="lg" title={form.payload ? `Edit ${form.payload.name}` : 'New opportunity'} fields={FIELDS}
        initial={form.payload || { stage: 'lead', billing_type: 'time_materials' }}
        onSubmit={(v) => {
          const body = Object.fromEntries(FIELDS.map((f) => [f.name, v[f.name] ?? null]));
          return form.payload ? act(`opportunities/${form.payload.id}`, { method: 'PUT', body, success: 'Opportunity updated' }) : act('opportunities', { body, success: 'Opportunity added' });
        }} />
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name || ''}>
        {open && (
          <div className="space-y-5 text-sm" data-testid="opportunity-drawer">
            <div className="flex flex-wrap gap-2"><Badge status={open.stage} /><Badge color="slate">{open.probability}% probability</Badge>{open.source && <Badge color="slate">{open.source}</Badge>}</div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs muted">Account</div><div className="font-medium">{open.account}</div></div>
              <div><div className="text-xs muted">Value</div><div className="font-medium">{money(open.value)} <span className="text-xs muted">(weighted {money(open.weighted_value)})</span></div></div>
              <div><div className="text-xs muted">Expected close</div><div className="font-medium">{date(open.expected_close)}</div></div>
              <div><div className="text-xs muted">Owner</div><div className="font-medium">{open.owner_name || '—'}</div></div>
            </div>
            {open.notes && <p className="muted">{open.notes}</p>}
            {open.lost_reason && <p className="rounded-xl bg-rose-50 p-3 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Lost: {open.lost_reason}</p>}
            {!open.project_id && (
              <div><div className="label">Move to stage</div>
                <div className="flex flex-wrap gap-1.5">{STAGES.map(([s, l]) => <button key={s} className={cx('btn btn-sm', open.stage === s ? 'bg-brand-600 text-white' : 'btn-secondary')} onClick={() => move(open, s)} data-testid={`stage-${s}`}>{l}</button>)}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => form.onOpen(open)}>Edit</button>
              {open.stage === 'won' && !open.project_id && <button className="btn-success" onClick={() => convert(open)} data-testid="convert-opportunity"><ArrowRightCircle size={16} /> Convert to project</button>}
              {open.project_id && <button className="btn-secondary" onClick={() => navigate(`/projects/${open.project_id}`)}>Open project</button>}
            </div>
          </div>
        )}
      </Drawer>
      <Modal open={!!lostFor} onClose={() => setLostFor(null)} title={`Mark “${lostFor?.name}” as lost`}
        footer={<><button className="btn-secondary" onClick={() => setLostFor(null)}>Cancel</button><button className="btn-danger" disabled={!reason.trim()} data-testid="confirm-lost"
          onClick={async () => { if (await act(`opportunities/${lostFor.id}`, { method: 'PUT', body: { stage: 'lost', lost_reason: reason }, success: 'Marked as lost' })) setLostFor(null); }}>Mark lost</button></>}>
        <label className="label" htmlFor="lost-reason">Why was it lost?</label>
        <select id="lost-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Select a reason</option>{['Price too high', 'Chose a competitor', 'No budget', 'Timing / postponed', 'No decision', 'Requirements changed'].map((r) => <option key={r}>{r}</option>)}
        </select>
      </Modal>
    </div>
  );
}
