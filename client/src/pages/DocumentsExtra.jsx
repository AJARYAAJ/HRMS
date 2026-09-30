import { useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Upload, XCircle, FileCheck2, History, PenLine, Files, BellRing } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { Badge, CardSkeleton, EmptyState, Modal, Avatar, StatCard } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { FileDrop } from '../components/Files';
import { uploadForm, downloadAttachment, invalidateFiles, formatBytes } from '../lib/files';
import { date, dateTime } from '../lib/format';

const STATE = {
  missing: ['Missing', 'red'], pending: ['Awaiting verification', 'amber'], verified: ['Verified', 'green'],
  rejected: ['Sent back', 'red'], expired: ['Expired', 'red'], expiring: ['Expires soon', 'amber'],
};

/** Upload a new file for an existing document (new version / replacement). */
export function VersionUpload({ doc, onClose }) {
  const [file, setFile] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { isHR } = useAuth();
  if (!doc) return null;
  const submit = async () => {
    if (!file) return toast('Choose a file', 'error');
    setBusy(true);
    try {
      await uploadForm(`documents/${doc.id}/versions`, values, file);
      toast('New version uploaded');
      invalidateFiles('documents');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!doc} onClose={onClose} title={`New version · ${doc.title}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={submit} data-testid="upload-version"><Upload size={16} /> {busy ? 'Uploading…' : 'Upload'}</button></>}>
      <div className="space-y-4">
        <FileDrop file={file} onChange={setFile} label="File" testId="version-drop" />
        {doc.expires_on !== undefined && doc.employee_id && <div><label className="label" htmlFor="v-exp">New expiry date (if any)</label><input id="v-exp" type="date" className="input" value={values.expires_on || ''} onChange={(e) => setValues({ ...values, expires_on: e.target.value })} /></div>}
        {isHR && doc.requires_ack && !doc.employee_id && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!values.reack} onChange={(e) => setValues({ ...values, reack: e.target.checked ? 1 : '' })} /> Ask everyone to acknowledge again</label>
        )}
      </div>
    </Modal>
  );
}

export function VersionsModal({ doc, onClose }) {
  const { data = [], isLoading } = useGet(doc ? `documents/${doc.id}/versions` : null);
  const toast = useToast();
  return (
    <Modal open={!!doc} onClose={onClose} title={doc ? `Version history · ${doc.title}` : ''}>
      {isLoading ? <CardSkeleton lines={3} /> : data.length === 0 ? <p className="text-sm muted">No files yet.</p> : (
        <ol className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="versions">
          {data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
              <Badge color={v.current ? 'green' : 'slate'}>v{v.version}</Badge>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{v.original_name}</div><div className="text-xs muted">{dateTime(v.created_at)}{v.uploaded_by_name ? ` · ${v.uploaded_by_name}` : ''} · {formatBytes(v.size)}</div></div>
              <button className="btn-ghost btn-sm" onClick={() => downloadAttachment(v.id, v.original_name).catch((e) => toast(e.message, 'error'))}>Download</button>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

export function SignModal({ doc, onClose }) {
  const { user } = useAuth();
  const [act] = useAction();
  const [sig, setSig] = useState('');
  if (!doc) return null;
  const name = `${user.first_name} ${user.last_name}`;
  return (
    <Modal open={!!doc} onClose={() => { setSig(''); onClose(); }} title={`Sign · ${doc.title}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!sig} data-testid="confirm-sign" onClick={async () => { if (await act(`documents/${doc.id}/sign`, { body: { signature: sig }, success: 'Signed — HR has been notified', invalidates: ['documents'] })) { setSig(''); onClose(); } }}><PenLine size={16} /> Sign</button></>}>
      <p className="text-sm muted">I have read and accept this document. Type your full name (<b>{name}</b>) as your electronic signature; the time and your IP address are recorded.</p>
      <input className="input mt-3 font-[cursive]" aria-label="Signature" value={sig} onChange={(e) => setSig(e.target.value)} placeholder={name} />
    </Modal>
  );
}

/** "My documents checklist" — required and optional document types with their verification state. */
export function Checklist({ employeeId }) {
  const { data, isLoading } = useGet('documents/checklist', employeeId ? { employee_id: employeeId } : {});
  const [target, setTarget] = useState(null);
  const [file, setFile] = useState(null);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (isLoading || !data) return <CardSkeleton lines={6} />;
  const upload = async () => {
    if (!file) return toast('Choose a file', 'error');
    setBusy(true);
    try {
      if (target.document && ['rejected', 'expired', 'expiring'].includes(target.state)) await uploadForm(`documents/${target.document.id}/versions`, { expires_on: expires }, file);
      else await uploadForm('documents', { doc_type_id: target.type.id, expires_on: expires }, file);
      toast(`${target.type.name} uploaded — HR will verify it`);
      invalidateFiles('documents');
      setTarget(null); setFile(null); setExpires('');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className={`card card-pad flex items-center gap-3 ${data.complete ? 'border-emerald-200' : 'border-amber-200'}`} data-testid="checklist-status">
        {data.complete ? <CheckCircle2 className="text-emerald-500" /> : <AlertTriangle className="text-amber-500" />}
        <p className="text-sm">{data.complete ? 'All required documents are verified.' : 'Some required documents are missing or awaiting verification.'}</p>
      </div>
      <div className="card divide-y divide-slate-100 dark:divide-slate-800" data-testid="doc-checklist">
        {data.items.map((i) => {
          const [label, tone] = STATE[i.state];
          const canUpload = !employeeId && i.state !== 'verified' && i.state !== 'pending';
          return (
            <div key={i.type.id} className="flex flex-wrap items-center gap-3 p-4" data-testid="checklist-item">
              <FileCheck2 size={18} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.type.name}{!i.type.required && <span className="ml-1 text-xs muted">(optional)</span>}</div>
                <div className="text-xs muted">{i.type.description}{i.document?.expires_on ? ` · expires ${date(i.document.expires_on)}` : ''}</div>
                {i.state === 'rejected' && <div className="text-xs font-medium text-rose-600">HR: {i.document.verify_note}</div>}
              </div>
              <Badge color={tone}>{label}</Badge>
              {canUpload && <button className="btn-secondary btn-sm" onClick={() => { setTarget(i); setFile(null); setExpires(''); }} data-testid={`checklist-upload-${i.type.id}`}><Upload size={14} /> {i.document ? 'Upload new copy' : 'Upload'}</button>}
            </div>
          );
        })}
      </div>
      <Modal open={!!target} onClose={() => setTarget(null)} title={target ? `Upload ${target.type.name}` : ''}
        footer={<><button className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={upload} data-testid="checklist-submit">{busy ? 'Uploading…' : 'Upload'}</button></>}>
        <div className="space-y-4">
          <FileDrop file={file} onChange={setFile} label="File" testId="checklist-drop" />
          {target?.type.has_expiry ? <div><label className="label" htmlFor="c-exp">Expiry date</label><input id="c-exp" type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} /></div> : null}
        </div>
      </Modal>
    </div>
  );
}

/** HR: who is missing documents, what awaits verification, what expires or needs review. */
export function Compliance() {
  const { data, isLoading } = useGet('documents/compliance');
  const { data: all = [] } = useGet('documents', { all: 1 });
  const [act] = useAction();
  const reject = useDisclosure();
  const toast = useToast();
  if (isLoading || !data) return <CardSkeleton lines={8} />;
  const pending = all.filter((d) => d.employee_id && d.verification === 'pending');
  const incomplete = data.employees.filter((e) => !e.complete);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FileCheck2} tone="green" label="Fully compliant" value={`${data.complete}/${data.employees.length}`} />
        <StatCard icon={Clock} tone="amber" label="Awaiting verification" value={pending.length} />
        <StatCard icon={AlertTriangle} tone="rose" label="Expiring ≤ 30 days" value={data.expiring.length} />
        <StatCard icon={History} tone="sky" label="Policies due for review" value={data.reviews_due.length} />
      </div>
      <div className="card card-pad">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Awaiting verification</h3>
          <button className="btn-ghost btn-sm" onClick={() => act('documents/expiry-reminders', { body: {}, success: 'Expiry reminders sent' })}><BellRing size={14} /> Send expiry reminders</button></div>
        {pending.length === 0 ? <p className="text-sm muted">Nothing to verify.</p> : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="verify-queue">
            {pending.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="verify-item">
                <div className="min-w-0 flex-1"><div className="font-medium">{d.title} · {d.employee_name}</div><div className="text-xs muted">Uploaded {date(d.updated_at || d.created_at)}{d.file_name ? ` · ${d.file_name}` : ''}</div></div>
                {d.file_id && <button className="btn-ghost btn-sm" onClick={() => downloadAttachment(d.file_id, d.file_name).catch((e) => toast(e.message, 'error'))}>View</button>}
                <button className="btn-ghost btn-sm text-emerald-600" onClick={() => act(`documents/${d.id}/verify`, { method: 'PUT', body: { status: 'verified' }, success: `${d.title} verified`, invalidates: ['documents'] })} data-testid="verify-document"><CheckCircle2 size={14} /> Verify</button>
                <button className="btn-ghost btn-sm text-rose-600" onClick={() => reject.onOpen(d)}><XCircle size={14} /> Send back</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <DataTable rows={incomplete} searchKeys={['name', 'emp_code', 'department']} maxHeight="420px" testId="compliance-table"
        title={`Missing required documents · ${incomplete.length} employee(s)`}
        empty={<EmptyState icon={FileCheck2} title="Everyone has their required documents" />}
        columns={[
          { key: 'name', header: 'Employee', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="xs" /><div><div className="font-medium">{r.name}</div><div className="text-xs muted">{r.department || '—'}</div></div></div> },
          { key: 'missing', header: 'Missing or unverified', width: 'minmax(260px, 3fr)', render: (r) => <div className="flex flex-wrap gap-1">{r.missing.map((m) => <Badge key={m} color="amber">{m}</Badge>)}</div>, sortValue: (r) => r.missing.length },
        ]} />
      {data.expiring.length > 0 && (
        <div className="card card-pad"><h3 className="mb-2 font-semibold">Expiring within 30 days</h3>
          <ul className="space-y-1 text-sm">{data.expiring.map((d) => <li key={d.id}>{d.title}{d.employee_name ? ` · ${d.employee_name}` : ''} — <span className={d.expires_on < new Date().toISOString().slice(0, 10) ? 'text-rose-600' : 'text-amber-600'}>{date(d.expires_on)}</span></li>)}</ul></div>
      )}
      <FormModal open={reject.open} onClose={reject.onClose} title={reject.payload ? `Send back ${reject.payload.title}` : ''} submitLabel="Send back"
        fields={[{ name: 'note', label: 'What needs fixing?', type: 'textarea', required: true, full: true }]}
        onSubmit={(v) => act(`documents/${reject.payload.id}/verify`, { method: 'PUT', body: { status: 'rejected', note: v.note }, success: 'Sent back to the employee', invalidates: ['documents'] })} />
    </div>
  );
}

export function BulkLetters({ open, onClose }) {
  const { data: templates = [] } = useGet(open ? 'letter-templates' : null);
  const [act] = useAction();
  const toast = useToast();
  return (
    <FormModal open={open} onClose={onClose} title="Generate letters in bulk" submitLabel="Generate" initial={{ send_email: 1 }}
      fields={[
        { name: 'template_id', label: 'Template', type: 'select', required: true, options: templates.filter((t) => t.type !== 'offer').map((t) => [t.id, t.name]), full: true },
        { name: 'department_id', label: 'Everyone in department', type: 'lookup', path: 'departments' },
        { name: 'employee_id', label: 'Or one employee', type: 'employee' },
        { name: 'purpose', label: 'Purpose (optional)', full: true },
        { name: 'require_signature', label: 'Employees must sign electronically', type: 'checkbox' },
        { name: 'send_email', label: 'Email each letter as a PDF', type: 'checkbox' },
      ]}
      onSubmit={async (v) => {
        const r = await act('hr/letters/bulk', {
          body: { template_id: Number(v.template_id), department_id: v.department_id || undefined, employee_ids: v.employee_id ? [v.employee_id] : [], purpose: v.purpose, require_signature: !!v.require_signature, send_email: !!v.send_email },
          invalidates: ['documents'],
        });
        if (r) toast(`${r.issued} letter(s) generated`);
        return !!r;
      }}>
      <p className="flex items-center gap-2 text-sm muted"><Files size={15} /> Each letter is filed under the employee's documents.</p>
    </FormModal>
  );
}
