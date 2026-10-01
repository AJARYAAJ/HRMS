import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, Plus, Pencil, Trash2, Star, CalendarDays, Users, CalendarOff, Clock3, Receipt, UserCog, Gavel, Check, MapPin,
} from 'lucide-react';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Tabs, EmptyState, CardSkeleton, Confirm, Modal, MonthPicker, Avatar, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, date, titleCase, thisMonth, shiftMonth } from '../lib/format';

const KINDS = {
  leave: { path: 'policies/leave', label: 'Leave plans', noun: 'leave plan', icon: CalendarDays },
  holiday: { path: 'policies/holiday', label: 'Holiday lists', noun: 'holiday list', icon: CalendarOff },
  weekly_off: { path: 'policies/weekly-off', label: 'Weekly offs', noun: 'weekly-off policy', icon: CalendarDays },
  attendance: { path: 'policies/attendance', label: 'Attendance', noun: 'attendance policy', icon: Clock3 },
  expense: { path: 'policies/expense', label: 'Expenses', noun: 'expense policy', icon: Receipt },
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];
const ACCRUAL = { yearly: 'Yearly (upfront)', monthly: 'Monthly', none: 'Not credited' };
const CAT_KIND = { amount: 'Amount', mileage: 'Mileage (per km)', per_diem: 'Per diem (per day)' };

export const describePattern = (p = {}) => {
  const parts = Object.entries(p).sort(([a], [b]) => a - b).map(([d, r]) => (r === 'all' ? WEEKDAYS[d] : `${String(r).split(',').map((w) => ORDINAL[w - 1]).join(' & ')} ${WEEKDAYS[d]}`));
  return parts.length ? parts.join(', ') : 'No weekly off';
};

const yesNo = (v) => (v ? <Check size={15} className="text-emerald-600" aria-label="Yes" /> : <span className="muted">—</span>);

// ---------- shared plan list ----------
function PlanList({ kind, plans, selected, onSelect, onNew }) {
  const k = KINDS[kind];
  return (
    <div className="space-y-2" data-testid={`plans-${kind}`}>
      {plans.map((p) => (
        <button key={p.id} onClick={() => onSelect(p.id)} data-testid="plan-card"
          className={cx('card w-full p-3 text-left transition hover:border-brand-300', selected === p.id && 'ring-2 ring-brand-500')}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{p.name}</span>
            {p.is_default && <Badge color="violet"><Star size={11} /> Default</Badge>}
          </div>
          {p.description && <div className="mt-0.5 line-clamp-1 text-xs muted">{p.description}</div>}
          <div className="mt-1.5 flex items-center gap-1 text-xs muted"><Users size={12} /> {p.effective} employee{p.effective === 1 ? '' : 's'}</div>
        </button>
      ))}
      <button className="btn-secondary w-full" onClick={onNew} data-testid={`new-${kind}`}><Plus size={15} /> New {k.noun}</button>
    </div>
  );
}

function PlanHeader({ kind, plan, onEdit, onDefault, onDelete, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><h3 className="text-lg font-semibold">{plan.name}</h3>{plan.is_default && <Badge color="violet">Default</Badge>}</div>
        <p className="text-sm muted">{plan.description || `No description`} · {plan.assigned} assigned directly{plan.is_default ? `, ${plan.effective - plan.assigned} by default` : ''}</p>
        {children}
      </div>
      <div className="flex flex-wrap gap-2">
        {!plan.is_default && <button className="btn-secondary" onClick={onDefault} data-testid="make-default"><Star size={15} /> Make default</button>}
        <button className="btn-secondary" onClick={onEdit} data-testid="edit-plan"><Pencil size={15} /> Edit</button>
        <button className="btn-secondary text-rose-600" onClick={onDelete} aria-label={`Delete ${KINDS[kind].noun}`}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

/** Master–detail layout shared by every plan type. */
function PlanTab({ kind, fields, renderDetail, newFields = [] }) {
  const k = KINDS[kind];
  const { data: plans = [], isLoading } = useGet(k.path);
  const [act] = useAction();
  const [sel, setSel] = useState(null);
  const form = useDisclosure();
  const del = useDisclosure();
  const plan = plans.find((p) => p.id === sel) || plans[0];
  const save = async (v) => {
    const editing = form.payload?.id;
    const res = await act(editing ? `${k.path}/${editing}` : k.path, { method: editing ? 'PUT' : 'POST', body: v, success: editing ? 'Policy updated' : `${titleCase(k.noun)} created` });
    if (res?.id) setSel(res.id);
    return !!res;
  };
  if (isLoading) return <CardSkeleton lines={8} />;
  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <div className="lg:col-span-1"><PlanList kind={kind} plans={plans} selected={plan?.id} onSelect={setSel} onNew={() => form.onOpen({})} /></div>
      <div className="lg:col-span-3">
        {!plan ? <div className="card"><EmptyState icon={k.icon} title={`No ${k.label.toLowerCase()} yet`} message={`Create a ${k.noun} and it becomes the organisation default.`} /></div> : (
          <div className="card card-pad space-y-5" data-testid="plan-detail">
            <PlanHeader kind={kind} plan={plan} onEdit={() => form.onOpen(plan)}
              onDefault={() => act(`${k.path}/${plan.id}/default`, { success: `${plan.name} is now the default`, invalidates: ['leave', 'attendance', 'holidays'] })}
              onDelete={() => del.onOpen(plan)} />
            {renderDetail(plan)}
          </div>
        )}
      </div>
      <FormModal open={form.open} onClose={form.onClose} title={form.payload?.id ? `Edit ${k.noun}` : `New ${k.noun}`} size={fields.length > 6 ? 'lg' : 'md'}
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', full: true }, ...fields,
          ...(form.payload?.id ? [] : newFields.map((f) => ({ ...f, options: typeof f.options === 'function' ? f.options(plans) : f.options })))]}
        initial={form.payload?.id ? form.payload : { ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default])) }}
        onSubmit={save} />
      <Confirm open={del.open} onClose={del.onClose} danger confirmLabel="Delete" title={`Delete ${del.payload?.name}?`}
        message="Employees assigned to it move to the organisation default."
        onConfirm={() => act(`${k.path}/${del.payload.id}`, { method: 'DELETE', success: 'Policy deleted' }).then(() => setSel(null))} />
    </div>
  );
}

// ---------- leave plans ----------
const RULE_FIELDS = (types) => [
  { name: 'leave_type_id', label: 'Leave type', type: 'select', required: true, options: types.map((t) => [t.id, t.name]) },
  { name: 'annual_quota', label: 'Days per year', type: 'number', required: true, min: 0, max: 365, step: 0.5 },
  { name: 'accrual', label: 'Credit', type: 'select', noEmpty: true, options: Object.entries(ACCRUAL), hint: 'Yearly credits all days in January (pro-rated for joiners); monthly credits 1/12 each month' },
  { name: 'carry_forward_cap', label: 'Carry forward up to (days)', type: 'number', min: 0, max: 365 },
  { name: 'min_notice_days', label: 'Apply at least (days before)', type: 'number', min: 0, max: 90 },
  { name: 'max_consecutive', label: 'Max consecutive days', type: 'number', min: 0.5, max: 365, step: 0.5, placeholder: 'No limit' },
  { name: 'gender', label: 'Only for', type: 'select', options: [['Female', 'Women'], ['Male', 'Men']], placeholder: 'Everyone' },
  { name: 'allow_half_day', label: 'Half days allowed', type: 'checkbox' },
  { name: 'encashable', label: 'Unused days above the cap are encashable', type: 'checkbox' },
  { name: 'probation_allowed', label: 'Available during probation', type: 'checkbox' },
  { name: 'sandwich', label: 'Sandwich rule: weekly offs and holidays inside a leave count', type: 'checkbox', full: true },
];

function LeaveRules({ plan }) {
  const { data: types = [] } = useGet('leave/types');
  const [act] = useAction();
  const rule = useDisclosure();
  const editing = rule.payload?.id;
  const available = types.filter((t) => editing ? t.id === rule.payload.leave_type_id : !plan.rules.some((r) => r.leave_type_id === t.id));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h4 className="font-semibold">Leave types in this plan</h4>
        <button className="btn-primary" onClick={() => rule.onOpen({ accrual: 'yearly', allow_half_day: 1, probation_allowed: 1 })} disabled={!types.some((t) => !plan.rules.some((r) => r.leave_type_id === t.id))} data-testid="add-rule"><Plus size={15} /> Add leave type</button></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm" data-testid="rules-table">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
            <tr><th className="p-3">Leave type</th><th className="p-3 text-right">Days / yr</th><th className="p-3">Credit</th><th className="p-3 text-right">Carry fwd</th><th className="p-3 text-right">Notice</th><th className="p-3 text-right">Max run</th><th className="p-3">Half day</th><th className="p-3">Probation</th><th className="p-3">Sandwich</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {plan.rules.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800" data-testid="rule-row">
                <td className="p-3"><span className="inline-flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.leave_type}</span>{r.gender && <Badge color="violet" className="ml-2">{r.gender === 'Female' ? 'Women' : 'Men'}</Badge>}</td>
                <td className="p-3 text-right tabular-nums">{r.accrual === 'none' ? '—' : r.annual_quota}</td>
                <td className="p-3">{ACCRUAL[r.accrual]}</td>
                <td className="p-3 text-right tabular-nums">{r.carry_forward_cap || '—'}</td>
                <td className="p-3 text-right tabular-nums">{r.min_notice_days ? `${r.min_notice_days}d` : '—'}</td>
                <td className="p-3 text-right tabular-nums">{r.max_consecutive || '—'}</td>
                <td className="p-3">{yesNo(r.allow_half_day)}</td>
                <td className="p-3">{yesNo(r.probation_allowed)}</td>
                <td className="p-3">{yesNo(r.sandwich)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button className="p-1 text-slate-400 hover:text-brand-600" aria-label={`Edit ${r.leave_type}`} onClick={() => rule.onOpen(r)}><Pencil size={15} /></button>
                  <button className="p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${r.leave_type}`} onClick={() => act(`policies/leave/${plan.id}/rules/${r.id}`, { method: 'DELETE', success: `${r.leave_type} removed from the plan`, invalidates: ['leave'] })}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {!plan.rules.length && <tr><td colSpan={10} className="p-6 text-center muted">No leave types yet — add the leave types employees on this plan can take.</td></tr>}
          </tbody>
        </table>
      </div>
      <FormModal open={rule.open} onClose={rule.onClose} size="lg" title={editing ? `Edit ${rule.payload.leave_type}` : 'Add leave type to plan'}
        fields={RULE_FIELDS(available)} initial={rule.payload || {}}
        onSubmit={(v) => act(editing ? `policies/leave/${plan.id}/rules/${editing}` : `policies/leave/${plan.id}/rules`, {
          method: editing ? 'PUT' : 'POST', body: v, success: editing ? 'Rule updated' : 'Leave type added', invalidates: ['leave'],
        })} />
    </div>
  );
}

// ---------- holiday lists ----------
function HolidayDetail({ plan }) {
  const [act] = useAction();
  const add = useDisclosure();
  const locs = useDisclosure();
  const { data: locations = [] } = useGet('locations');
  const [picked, setPicked] = useState([]);
  const year = new Date().getFullYear();
  const shown = plan.holidays.filter((h) => h.date >= `${year}-01-01`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MapPin size={15} className="text-slate-400" />
        {plan.locations.length ? plan.locations.map((l) => <Badge key={l.id} color="blue">{l.name}</Badge>) : <span className="muted">{plan.is_default ? 'Used by every location without its own list' : 'Not linked to a location'}</span>}
        <button className="text-sm font-semibold text-brand-600" onClick={() => { setPicked(plan.locations.map((l) => l.id)); locs.onOpen(); }} data-testid="link-locations">Change locations</button>
        <span className="ml-auto muted">Optional holidays each employee can pick: <b>{plan.optional_limit}</b></span>
      </div>
      <div className="flex items-center justify-between"><h4 className="font-semibold">Holidays from {year}</h4><button className="btn-primary" onClick={() => add.onOpen()} data-testid="add-list-holiday"><Plus size={15} /> Add holiday</button></div>
      <div className="grid gap-2 sm:grid-cols-2" data-testid="list-holidays">
        {shown.map((h) => (
          <div key={h.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="w-12 shrink-0 rounded-lg bg-brand-50 py-1 text-center dark:bg-brand-500/10"><div className="text-[10px] font-bold uppercase text-brand-600">{date(h.date, { month: 'short' })}</div><div className="text-lg font-bold leading-5">{h.date.slice(8)}</div></div>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{h.name}</div><div className="text-xs muted">{date(h.date, { weekday: 'long' })} · {h.date.slice(0, 4)}</div></div>
            <Badge color={h.type === 'Optional' ? 'amber' : 'blue'}>{h.type}</Badge>
            <button className="text-slate-400 hover:text-rose-500" aria-label={`Delete ${h.name}`} onClick={() => act(`holidays/${h.id}`, { method: 'DELETE', success: 'Holiday removed', invalidates: ['policies'] })}><Trash2 size={14} /></button>
          </div>
        ))}
        {!shown.length && <p className="text-sm muted">No holidays yet.</p>}
      </div>
      <FormModal open={add.open} onClose={add.onClose} title={`Add holiday to ${plan.name}`}
        fields={[{ name: 'name', label: 'Holiday', required: true }, { name: 'date', label: 'Date', type: 'date', required: true },
          { name: 'type', label: 'Type', type: 'select', noEmpty: true, options: [['Public', 'Public (everyone off)'], ['Optional', 'Optional (employees choose)']] }]}
        initial={{ type: 'Public' }}
        onSubmit={(v) => act('holidays', { body: { ...v, list_id: plan.id }, success: 'Holiday added', invalidates: ['policies', 'attendance', 'leave'] })} />
      <Modal open={locs.open} onClose={locs.onClose} title="Locations using this list" size="sm"
        footer={<><button className="btn-secondary" onClick={locs.onClose}>Cancel</button>
          <button className="btn-primary" onClick={async () => { if (await act(`policies/holiday/${plan.id}/locations`, { method: 'PUT', body: { location_ids: picked }, success: 'Locations updated', invalidates: ['locations'] })) locs.onClose(); }}>Save</button></>}>
        <div className="space-y-2">
          {locations.map((l) => (
            <label key={l.id} className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />
              {l.name}
            </label>
          ))}
          <p className="pt-2 text-xs muted">Employees at these offices follow this list unless a list is assigned to them directly.</p>
        </div>
      </Modal>
    </div>
  );
}

// ---------- weekly offs ----------
function WeeklyOffDetail({ plan }) {
  const [act] = useAction();
  const [draft, setDraft] = useState(null);
  const pattern = draft || plan.pattern;
  const setDay = (d, rule) => setDraft(() => { const p = { ...pattern }; if (!rule) delete p[d]; else p[d] = rule; return p; });
  const toggleWeek = (d, w) => {
    const cur = pattern[d] && pattern[d] !== 'all' ? String(pattern[d]).split(',').map(Number) : [];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort();
    setDay(d, next.length ? next.join(',') : null);
  };
  return (
    <div className="space-y-4" key={plan.id}>
      <p className="text-sm"><span className="muted">Days off:</span> <b data-testid="pattern-summary">{describePattern(pattern)}</b></p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm" data-testid="weekly-grid">
          <tbody>
            {WEEKDAYS.map((name, d) => {
              const rule = pattern[d];
              const mode = !rule ? 'working' : rule === 'all' ? 'all' : 'some';
              return (
                <tr key={d} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
                  <td className="w-32 p-3 font-medium">{name}</td>
                  <td className="p-3">
                    <select className="input !w-44" aria-label={`${name} rule`} value={mode} onChange={(e) => setDay(d, e.target.value === 'working' ? null : e.target.value === 'all' ? 'all' : '2,4')}>
                      <option value="working">Working day</option><option value="all">Off every week</option><option value="some">Off on some weeks</option>
                    </select>
                  </td>
                  <td className="p-3">
                    {mode === 'some' && <div className="flex flex-wrap gap-1.5">{ORDINAL.map((o, i) => {
                      const on = String(rule).split(',').map(Number).includes(i + 1);
                      return <button key={o} type="button" aria-pressed={on} onClick={() => toggleWeek(d, i + 1)} className={cx('rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', on ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-500 ring-slate-200 dark:ring-slate-700')}>{o}</button>;
                    })}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {draft && <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setDraft(null)}>Discard</button>
        <button className="btn-primary" data-testid="save-pattern" onClick={async () => { if (await act(`policies/weekly-off/${plan.id}`, { method: 'PUT', body: { pattern: draft }, success: 'Weekly offs saved', invalidates: ['attendance', 'leave'] })) setDraft(null); }}>Save weekly offs</button></div>}
    </div>
  );
}

// ---------- attendance ----------
const ATT_FIELDS = (types) => [
  { name: 'allow_web', label: 'Office (web) clock-in', type: 'checkbox', default: 1 },
  { name: 'allow_remote', label: 'Remote clock-in', type: 'checkbox', default: 1 },
  { name: 'allow_field', label: 'Field / on-duty clock-in', type: 'checkbox', default: 1 },
  { name: 'overtime_allowed', label: 'Record overtime', type: 'checkbox', default: 1 },
  { name: 'geofence_mode', label: 'Geofence', type: 'select', options: [['off', 'Off'], ['flag', 'Flag outside the office'], ['enforce', 'Block office clock-in outside']], placeholder: 'Organisation setting' },
  { name: 'grace_minutes', label: 'Late after (grace minutes)', type: 'number', min: 0, max: 240, placeholder: 'Shift grace' },
  { name: 'full_day_hours', label: 'Hours for a full day', type: 'number', min: 1, max: 16, step: 0.5, placeholder: '75% of shift' },
  { name: 'half_day_hours', label: 'Hours for a half day', type: 'number', min: 0.5, max: 12, step: 0.5, placeholder: '40% of shift' },
  { name: 'late_penalty_every', label: 'Penalty every N late marks', type: 'number', min: 0, max: 31, hint: '0 = no late-mark penalty', default: 0 },
  { name: 'late_penalty_days', label: 'Days deducted per penalty', type: 'number', min: 0.5, max: 5, step: 0.5, default: 0.5 },
  { name: 'penalty_leave_type_id', label: 'Deduct from', type: 'select', options: types.filter((t) => t.code !== 'LOP').map((t) => [t.id, t.name]), placeholder: 'Loss of pay' },
  { name: 'max_regularizations', label: 'Regularizations per month', type: 'number', min: 0, max: 31, placeholder: 'Unlimited' },
  { name: 'overtime_min_minutes', label: 'Minimum overtime (minutes)', type: 'number', min: 0, max: 600, default: 30 },
  { name: 'allow_biometric', label: 'Biometric device punches count', type: 'checkbox', default: 1 },
  { name: 'auto_clock_out', label: 'Automatic clock-out when people forget', type: 'checkbox', default: 0 },
  { name: 'auto_clock_out_hours', label: 'Auto clock-out after shift end (hours)', type: 'number', min: 0, max: 12, step: 0.5, default: 4, hidden: (v) => !v.auto_clock_out },
  { name: 'allowed_ips', label: 'Office clock-in only from these IPs / ranges', placeholder: 'e.g. 203.0.113.0/24, 198.51.100.7', full: true, hint: 'Empty = any network. Remote and field clock-ins are not restricted.' },
];

function AttendanceDetail({ plan }) {
  const rows = [
    ['Clock-in allowed', [plan.allow_web && 'Office', plan.allow_remote && 'Remote', plan.allow_field && 'Field'].filter(Boolean).join(', ')],
    ['Geofence', plan.geofence_mode ? titleCase(plan.geofence_mode) : 'Organisation setting'],
    ['Late after', plan.grace_minutes != null ? `${plan.grace_minutes} min grace` : "Shift's grace period"],
    ['Full / half day', `${plan.full_day_hours ?? '75% of shift'}${plan.full_day_hours ? ' h' : ''} / ${plan.half_day_hours ?? '40% of shift'}${plan.half_day_hours ? ' h' : ''}`],
    ['Late-mark penalty', plan.late_penalty_every ? `${plan.late_penalty_days} day(s) from ${plan.penalty_leave_type || 'pay (LOP)'} for every ${plan.late_penalty_every} late marks in a month` : 'None'],
    ['Regularizations', plan.max_regularizations != null ? `${plan.max_regularizations} per month` : 'Unlimited'],
    ['Overtime', plan.overtime_allowed ? `Recorded beyond the shift, at least ${plan.overtime_min_minutes} min` : 'Not recorded'],
    ['Biometric devices', plan.allow_biometric === 0 ? 'Punches ignored' : 'Punches mark attendance (first in, last out)'],
    ['Office network', plan.allowed_ips ? `Office clock-in only from ${plan.allowed_ips}` : 'Any network'],
    ['Automatic clock-out', plan.auto_clock_out ? `At shift end, ${plan.auto_clock_out_hours} h after the shift if not clocked out` : 'Off'],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid="attendance-rules">
      {rows.map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"><dt className="text-xs muted">{k}</dt><dd className="text-sm font-medium">{v}</dd></div>)}
    </dl>
  );
}

// ---------- expenses ----------
const CAT_FIELDS = [
  { name: 'name', label: 'Category', required: true },
  { name: 'kind', label: 'Claimed as', type: 'select', noEmpty: true, options: Object.entries(CAT_KIND) },
  { name: 'rate', label: 'Rate (₹ per km or per day)', type: 'number', min: 0.01, step: 0.01, hidden: (v) => !v.kind || v.kind === 'amount' },
  { name: 'per_claim_limit', label: 'Limit per claim (₹)', type: 'number', min: 1, placeholder: 'No limit' },
  { name: 'monthly_limit', label: 'Monthly limit (₹)', type: 'number', min: 1, placeholder: 'No limit' },
  { name: 'receipt_above', label: 'Receipt needed above (₹)', type: 'number', min: 0, placeholder: 'Never', hint: '0 = always' },
];

function ExpenseDetail({ plan }) {
  const [act] = useAction();
  const cat = useDisclosure();
  const editing = cat.payload?.id;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h4 className="font-semibold">Categories and limits</h4><button className="btn-primary" onClick={() => cat.onOpen({ kind: 'amount' })} data-testid="add-category"><Plus size={15} /> Add category</button></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm" data-testid="categories-table">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
            <tr><th className="p-3">Category</th><th className="p-3">Claimed as</th><th className="p-3 text-right">Per claim</th><th className="p-3 text-right">Monthly</th><th className="p-3">Receipt</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {plan.categories.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800" data-testid="category-row">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3">{c.kind === 'amount' ? 'Amount' : `${money(c.rate, true)} / ${c.kind === 'mileage' ? 'km' : 'day'}`}</td>
                <td className="p-3 text-right tabular-nums">{c.per_claim_limit ? money(c.per_claim_limit) : '—'}</td>
                <td className="p-3 text-right tabular-nums">{c.monthly_limit ? money(c.monthly_limit) : '—'}</td>
                <td className="p-3">{c.receipt_above == null ? <span className="muted">Not needed</span> : c.receipt_above === 0 ? 'Always' : `Above ${money(c.receipt_above)}`}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button className="p-1 text-slate-400 hover:text-brand-600" aria-label={`Edit ${c.name}`} onClick={() => cat.onOpen(c)}><Pencil size={15} /></button>
                  <button className="p-1 text-slate-400 hover:text-rose-600" aria-label={`Delete ${c.name}`} onClick={() => act(`policies/expense/${plan.id}/categories/${c.id}`, { method: 'DELETE', success: 'Category removed' })}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            {!plan.categories.length && <tr><td colSpan={6} className="p-6 text-center muted">No categories — employees on this policy can't claim anything yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <FormModal open={cat.open} onClose={cat.onClose} title={editing ? `Edit ${cat.payload.name}` : 'Add expense category'} fields={CAT_FIELDS} initial={cat.payload || {}}
        onSubmit={(v) => act(editing ? `policies/expense/${plan.id}/categories/${editing}` : `policies/expense/${plan.id}/categories`, { method: editing ? 'PUT' : 'POST', body: v, success: editing ? 'Category updated' : 'Category added', invalidates: ['expenses'] })} />
    </div>
  );
}

// ---------- assignments ----------
function Assignments() {
  const { data: rows = [], isLoading } = useGet('policies/assignments');
  const lists = {
    leave: useGet(KINDS.leave.path).data || [],
    holiday: useGet(KINDS.holiday.path).data || [],
    weekly_off: useGet(KINDS.weekly_off.path).data || [],
    attendance: useGet(KINDS.attendance.path).data || [],
    expense: useGet(KINDS.expense.path).data || [],
  };
  const [act] = useAction();
  const [selected, setSelected] = useState([]);
  const [kind, setKind] = useState('leave');
  const [policyId, setPolicyId] = useState('');
  const all = selected.length === rows.length && rows.length > 0;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const cell = (r, k) => {
    const e = r.effective[k];
    if (!e) return <span className="muted">—</span>;
    return <span className={cx('text-sm', !e.explicit && 'muted')} title={e.explicit ? 'Assigned' : 'Organisation default / location'}>{e.name}</span>;
  };
  const assign = async () => {
    const res = await act('policies/assign', { body: { kind, policy_id: policyId ? Number(policyId) : null, employee_ids: selected }, success: `Updated ${selected.length} employee(s)`, invalidates: ['leave', 'attendance', 'expenses', 'holidays'] });
    if (res) setSelected([]);
  };
  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-end gap-3" data-testid="assign-bar">
        <div><label className="label" htmlFor="as-kind">Policy type</label>
          <select id="as-kind" className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPolicyId(''); }}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div><label className="label" htmlFor="as-policy">Assign</label>
          <select id="as-policy" className="input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            <option value="">Organisation default{kind === 'holiday' ? ' / location list' : ''}</option>
            {lists[kind].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <button className="btn-primary" disabled={!selected.length} onClick={assign} data-testid="assign-policy"><UserCog size={16} /> Assign to {selected.length} selected</button>
        <p className="w-full text-xs muted">Grey names follow the organisation default (or, for holidays, their office's list). Assigning directly overrides it.</p>
      </div>
      <DataTable loading={isLoading} rows={rows} searchKeys={['name', 'emp_code', 'department', 'location']} testId="assignments-table" rowHeight={56}
        columns={[
          { key: 'sel', header: <input type="checkbox" aria-label="Select all" className="h-4 w-4 accent-brand-600" checked={all} onChange={() => setSelected(all ? [] : rows.map((r) => r.id))} />, width: '44px', sortable: false,
            render: (r) => <input type="checkbox" aria-label={`Select ${r.name}`} className="h-4 w-4 accent-brand-600" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /> },
          { key: 'name', header: 'Employee', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="sm" /><div><div className="font-medium">{r.name}</div><div className="text-xs muted">{r.department || '—'} · {r.location || '—'}</div></div></div> },
          { key: 'leave', header: 'Leave plan', render: (r) => cell(r, 'leave'), sortValue: (r) => r.effective.leave?.name },
          { key: 'holiday', header: 'Holiday list', render: (r) => cell(r, 'holiday'), sortValue: (r) => r.effective.holiday?.name },
          { key: 'weekly_off', header: 'Weekly off', render: (r) => cell(r, 'weekly_off'), sortValue: (r) => r.effective.weekly_off?.name },
          { key: 'attendance', header: 'Attendance', render: (r) => cell(r, 'attendance'), sortValue: (r) => r.effective.attendance?.name },
          { key: 'expense', header: 'Expense', render: (r) => cell(r, 'expense'), sortValue: (r) => r.effective.expense?.name },
        ]} />
    </div>
  );
}

// ---------- late-mark penalties ----------
function Penalties() {
  const [month, setMonth] = useState(shiftMonth(thisMonth(), -1));
  const { data = [], isLoading } = useGet('policies/penalties', { month });
  const [act] = useAction();
  const waive = useDisclosure();
  const total = data.filter((p) => p.status === 'applied').reduce((a, p) => a + p.days, 0);
  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        <p className="flex-1 text-sm muted">Counts late marks under each employee's attendance policy and deducts leave or pay. Re-running recalculates; waived penalties stay waived.</p>
        <button className="btn-primary" data-testid="run-penalties" onClick={() => act('policies/penalties/run', { body: { month }, success: 'Penalties calculated', invalidates: ['leave', 'payroll'] })}><Gavel size={16} /> Run for this month</button>
      </div>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'emp_code']} testId="penalties-table" maxHeight="480px"
        title={data.length ? `${data.length} penalt${data.length === 1 ? 'y' : 'ies'} · ${total} day(s) applied` : undefined}
        empty={<EmptyState icon={Gavel} title="No penalties for this month" message="Run the calculation after the month closes." />}
        columns={[
          { key: 'employee_name', header: 'Employee', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="sm" /><div><div className="font-medium">{r.employee_name}</div><div className="text-xs muted">{r.emp_code}</div></div></div> },
          { key: 'late_count', header: 'Late marks', align: 'right' },
          { key: 'days', header: 'Days', align: 'right' },
          { key: 'leave_type', header: 'Deducted from', render: (r) => r.leave_type || 'Loss of pay' },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'act', header: '', sortable: false, render: (r) => r.status === 'applied' && <button className="text-sm font-semibold text-brand-600" onClick={() => waive.onOpen(r)} data-testid="waive">Waive</button> },
        ]} />
      <FormModal open={waive.open} onClose={waive.onClose} title={`Waive penalty for ${waive.payload?.employee_name}`} submitLabel="Waive"
        fields={[{ name: 'comment', label: 'Reason', type: 'textarea', required: true, full: true }]}
        onSubmit={(v) => act(`policies/penalties/${waive.payload.id}/waive`, { body: v, success: 'Penalty waived', invalidates: ['leave'] })} />
    </div>
  );
}

export default function Policies() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'leave';
  const { data: types = [] } = useGet('leave/types');
  const attFields = useMemo(() => ATT_FIELDS(types), [types]);
  const copyFrom = { name: 'copy_from', label: 'Start from', type: 'select', options: (plans) => plans.map((p) => [p.id, `Copy of ${p.name}`]), placeholder: 'Blank' };
  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="Policies & settings" subtitle="Leave plans, holiday lists, weekly offs, attendance and expense policies — set a default, then assign plans to people" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'leave', label: 'Leave plans' }, { value: 'holiday', label: 'Holiday lists' }, { value: 'weekly_off', label: 'Weekly offs' },
        { value: 'attendance', label: 'Attendance' }, { value: 'expense', label: 'Expenses' }, { value: 'assign', label: 'Assign to employees' }, { value: 'penalties', label: 'Late-mark penalties' },
      ]} />
      {tab === 'leave' && <PlanTab kind="leave" fields={[]} newFields={[copyFrom]} renderDetail={(p) => <LeaveRules plan={p} />} />}
      {tab === 'holiday' && <PlanTab kind="holiday" fields={[{ name: 'optional_limit', label: 'Optional holidays per employee', type: 'number', min: 0, max: 30, default: 2 }]} renderDetail={(p) => <HolidayDetail plan={p} />} />}
      {tab === 'weekly_off' && <PlanTab kind="weekly_off" fields={[]} renderDetail={(p) => <WeeklyOffDetail key={p.id} plan={p} />} />}
      {tab === 'attendance' && <PlanTab kind="attendance" fields={attFields} renderDetail={(p) => <AttendanceDetail plan={p} />} />}
      {tab === 'expense' && <PlanTab kind="expense" fields={[]} newFields={[copyFrom]} renderDetail={(p) => <ExpenseDetail plan={p} />} />}
      {tab === 'assign' && <Assignments />}
      {tab === 'penalties' && <Penalties />}
    </div>
  );
}
