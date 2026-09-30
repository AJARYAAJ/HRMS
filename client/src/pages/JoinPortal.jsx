import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, Circle, Upload, FileText, AlertTriangle, PartyPopper, Send, PenLine, Download, Building2 } from 'lucide-react';
import { Badge, cx } from '../components/ui';
import { date } from '../lib/format';

const api = async (token, path = '', opts = {}) => {
  const res = await fetch(`/api/join/${encodeURIComponent(token)}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Section({ title, done, children, testId }) {
  return (
    <section className="card card-pad space-y-4" data-testid={testId}>
      <h2 className="flex items-center gap-2 text-lg font-semibold">{done ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Circle size={20} className="text-slate-300" />}{title}</h2>
      {children}
    </section>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder, id, options, full }) {
  return (
    <div className={cx(full && 'sm:col-span-2')}>
      <label className="label" htmlFor={id}>{label}</label>
      {options ? (
        <select id={id} className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea id={id} className="input min-h-20" value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input" type={type} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** The new hire's private pre-boarding portal (no account needed; the link token authorises it). */
export default function JoinPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ personal: {}, address: {}, emergency: {}, bank: {} });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [signature, setSignature] = useState('');
  const fileRefs = useRef({});

  const load = (d) => { setData(d); setForm({ personal: {}, address: {}, emergency: {}, bank: {}, ...d.details }); };
  useEffect(() => { api(token).then(load).catch((e) => setError(e.message)); }, [token]);
  const flash = (text, tone = 'ok') => { setMsg({ text, tone }); setTimeout(() => setMsg(null), 4000); };
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { load(await fn()); if (ok) flash(ok); } catch (e) { flash(e.message, 'error'); } finally { setBusy(''); }
  };
  const set = (section, key) => (v) => setForm((f) => ({ ...f, [section]: { ...f[section], [key]: v } }));
  const saveDetails = () => run('details', () => api(token, '/details', json('PUT', form)), 'Details saved');
  const upload = (docType, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('doc_type', docType);
    fd.append('file', file);
    run(`doc-${docType}`, () => api(token, '/documents', { method: 'POST', body: fd }), `${file.name} uploaded`);
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="card max-w-md p-6 text-center" data-testid="join-error"><AlertTriangle className="mx-auto text-amber-500" size={32} /><h1 className="mt-3 text-lg font-semibold">{error}</h1></div>
      </div>
    );
  }
  if (!data) return <div className="flex min-h-screen items-center justify-center muted">Loading…</div>;
  const locked = ['submitted', 'converted'].includes(data.status);
  const docs = Object.fromEntries(data.documents.map((d) => [d.doc_type, d]));
  const s = data.progress.sections;

  return (
    <div className="min-h-screen bg-slate-50 pb-16 dark:bg-slate-950">
      <div className="bg-gradient-to-r from-brand-600 to-violet-600 px-4 pb-24 pt-10 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-100"><Building2 size={16} /> {data.company}</div>
          <h1 className="mt-2 text-3xl font-bold" data-testid="join-welcome">Welcome aboard, {data.name.split(' ')[0]}!</h1>
          <p className="mt-1 text-indigo-100">You join as <b>{data.designation || 'a new team member'}</b>{data.department ? ` in ${data.department}` : ''} on <b>{date(data.date_of_joining)}</b>.</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-indigo-100">
            {data.manager_name && <span>Manager: <b className="text-white">{data.manager_name}</b></span>}
            {data.buddy_name && <span>Your buddy: <b className="text-white">{data.buddy_name}</b></span>}
            {data.location && <span>Office: <b className="text-white">{data.location}</b></span>}
          </div>
        </div>
      </div>
      <div className="mx-auto -mt-16 max-w-3xl space-y-5 px-4">
        <div className="card card-pad" data-testid="join-progress">
          <div className="flex items-center justify-between"><span className="font-semibold">Your joining checklist</span><span className="text-sm font-bold text-brand-600">{data.progress.pct}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${data.progress.pct}%` }} /></div>
          {data.status === 'converted' ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><PartyPopper size={16} /> You're all set — check your email for your PeopleHub sign-in. <Link to="/login" className="font-semibold underline">Sign in</Link></p>
          ) : data.status === 'submitted' ? (
            <p className="mt-3 text-sm text-emerald-700" data-testid="join-submitted">Submitted — thank you! HR is reviewing your documents and will contact you if anything else is needed.</p>
          ) : data.progress.blockers.length ? <p className="mt-3 text-xs muted">Still needed: {data.progress.blockers.join(' · ')}</p> : <p className="mt-3 text-sm text-emerald-700">Everything is ready — submit below.</p>}
        </div>
        {msg && <div role="status" className={cx('rounded-xl px-4 py-3 text-sm font-medium', msg.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{msg.text}</div>}

        <Section title="Personal details" done={s.personal && s.address && s.emergency} testId="join-personal">
          <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
            <Input id="j-dob" label="Date of birth" type="date" value={form.personal.date_of_birth} onChange={set('personal', 'date_of_birth')} />
            <Input id="j-gender" label="Gender" options={['Female', 'Male', 'Other']} value={form.personal.gender} onChange={set('personal', 'gender')} />
            <Input id="j-phone" label="Mobile number" value={form.personal.phone} onChange={set('personal', 'phone')} placeholder="+91 …" />
            <Input id="j-blood" label="Blood group" options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']} value={form.personal.blood_group} onChange={set('personal', 'blood_group')} />
            <Input id="j-marital" label="Marital status" options={['Single', 'Married', 'Other']} value={form.personal.marital_status} onChange={set('personal', 'marital_status')} />
            <Input id="j-pemail" label="Personal email" type="email" value={form.personal.personal_email} onChange={set('personal', 'personal_email')} />
            <Input id="j-addr" label="Current address" type="textarea" full value={form.address.current} onChange={set('address', 'current')} />
            <Input id="j-paddr" label="Permanent address (if different)" type="textarea" full value={form.address.permanent} onChange={set('address', 'permanent')} />
            <Input id="j-ename" label="Emergency contact name" value={form.emergency.name} onChange={set('emergency', 'name')} />
            <Input id="j-erel" label="Relationship" value={form.emergency.relation} onChange={set('emergency', 'relation')} />
            <Input id="j-ephone" label="Emergency contact phone" value={form.emergency.phone} onChange={set('emergency', 'phone')} />
          </fieldset>
        </Section>

        <Section title="Bank & statutory details" done={s.bank} testId="join-bank">
          <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
            <Input id="j-bank" label="Bank name" value={form.bank.bank_name} onChange={set('bank', 'bank_name')} />
            <Input id="j-acct" label="Account number" value={form.bank.account} onChange={set('bank', 'account')} />
            <Input id="j-ifsc" label="IFSC" value={form.bank.ifsc} onChange={set('bank', 'ifsc')} placeholder="HDFC0001234" />
            <Input id="j-pan" label="PAN" value={form.bank.pan} onChange={set('bank', 'pan')} placeholder="ABCDE1234F" />
            <Input id="j-uan" label="UAN (if you have one)" value={form.bank.uan} onChange={set('bank', 'uan')} />
          </fieldset>
          {!locked && <div className="flex justify-end"><button className="btn-primary" disabled={busy === 'details'} onClick={saveDetails} data-testid="save-details">{busy === 'details' ? 'Saving…' : 'Save details'}</button></div>}
        </Section>

        <Section title="Documents" done={data.doc_types.filter((t) => t.required).every((t) => docs[t.key] && docs[t.key].status !== 'rejected')} testId="join-documents">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.doc_types.map((t) => {
              const d = docs[t.key];
              return (
                <div key={t.key} className="flex flex-wrap items-center gap-3 py-3" data-testid={`doc-${t.key}`}>
                  <FileText size={18} className="text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.label}{t.required ? '' : <span className="ml-1 text-xs muted">(optional)</span>}</div>
                    {d && <div className="truncate text-xs muted">{d.original_name}</div>}
                    {d?.status === 'rejected' && <div className="text-xs font-medium text-rose-600">Please re-upload: {d.note}</div>}
                  </div>
                  {d && <Badge status={d.status === 'verified' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending'}>{d.status === 'verified' ? 'Verified' : d.status === 'rejected' ? 'Needs a new copy' : 'Uploaded'}</Badge>}
                  {!locked && (
                    <>
                      <input type="file" className="hidden" accept={t.accept === 'image' ? 'image/png,image/jpeg,image/webp' : 'application/pdf,image/png,image/jpeg'} ref={(el) => { fileRefs.current[t.key] = el; }}
                        onChange={(e) => { upload(t.key, e.target.files?.[0]); e.target.value = ''; }} data-testid={`upload-${t.key}`} />
                      <button className="btn-secondary btn-sm" disabled={busy === `doc-${t.key}`} onClick={() => fileRefs.current[t.key]?.click()}><Upload size={14} /> {d ? 'Replace' : 'Upload'}</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Accept your offer" done={!!data.offer_accepted_at} testId="join-offer">
          {data.offer_letter && <a className="btn-secondary btn-sm" href={`/api/join/${encodeURIComponent(token)}/offer`} target="_blank" rel="noreferrer"><Download size={14} /> Read your offer letter</a>}
          {data.offer_accepted_at ? (
            <p className="text-sm text-emerald-700" data-testid="offer-signed">Signed electronically on {new Date(data.offer_accepted_at).toLocaleString()}.</p>
          ) : !locked && (
            <div className="space-y-2">
              <p className="text-sm muted">I accept the offer and its terms. Type your full name (<b>{data.name}</b>) as your electronic signature.</p>
              <div className="flex flex-wrap gap-2">
                <input className="input max-w-xs font-[cursive]" aria-label="Signature" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={data.name} />
                <button className="btn-primary" disabled={!signature || busy === 'sign'} onClick={() => run('sign', () => api(token, '/accept-offer', json('POST', { signature })), 'Offer accepted — welcome!')} data-testid="sign-offer"><PenLine size={16} /> Sign & accept</button>
              </div>
            </div>
          )}
        </Section>

        {!locked && (
          <div className="flex justify-end">
            <button className="btn-primary" disabled={busy === 'submit'} onClick={async () => { await saveDetails(); run('submit', () => api(token, '/submit', { method: 'POST' }), 'Submitted to HR'); }} data-testid="submit-preboarding"><Send size={16} /> Submit to HR</button>
          </div>
        )}
      </div>
    </div>
  );
}
