import { useEffect, useState } from 'react';
import { FileText, Upload, Trash2, BookOpen, User, Search, Download, Eye, Plus, FileSignature, History, PenLine, Folder, Files } from 'lucide-react';
import { Checklist, Compliance, VersionUpload, VersionsModal, SignModal, BulkLetters } from './DocumentsExtra';
import { useSearchParams } from 'react-router-dom';
import DataTable from '../components/DataTable';
import CrudTable from '../components/CrudTable';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState, Modal, Confirm, Tabs, Avatar, Progress } from '../components/ui';
import { FormFields, FormModal } from '../components/Form';
import { FileDrop, FilePreview, FileTypeIcon } from '../components/Files';
import { uploadForm, downloadAttachment, isPreviewable, formatBytes, invalidateFiles } from '../lib/files';
import { date, titleCase } from '../lib/format';

function UploadModal({ open, onClose }) {
  const { isHR } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState({});
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!open) return;
    setValues(isHR ? { category: 'Policy', audience_type: 'all' } : { category: 'KYC' });
    setFile(null);
    setProgress(null);
  }, [open, isHR]);
  const { data: docTypes = [] } = useGet(open ? 'document-types' : null);
  const aud = (type) => (v) => v.employee_id || v.audience_type !== type;
  const fields = isHR
    ? [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['Policy', 'Compliance', 'Calendar', 'Letter', 'Form', 'Personal'] },
      { name: 'folder', label: 'Folder', placeholder: 'e.g. HR policies, Finance', hidden: (v) => !!v.employee_id },
      { name: 'employee_id', label: 'Personal document for (empty = company document)', type: 'employee', full: true },
      { name: 'audience_type', label: 'Who can see it', type: 'select', noEmpty: true, options: [['all', 'Everyone'], ['department', 'A department'], ['location', 'A location'], ['company', 'A legal entity']], hidden: (v) => !!v.employee_id },
      { name: 'audience_department', label: 'Department', type: 'lookup', path: 'departments', hidden: aud('department') },
      { name: 'audience_location', label: 'Location', type: 'lookup', path: 'locations', hidden: aud('location') },
      { name: 'audience_company', label: 'Company', type: 'lookup', path: 'companies', hidden: aud('company') },
      { name: 'review_on', label: 'Review by', type: 'date', hidden: (v) => !!v.employee_id },
      { name: 'expires_on', label: 'Expires on', type: 'date' },
      { name: 'requires_ack', label: 'Employees must read and acknowledge this', type: 'checkbox', hidden: (v) => !!v.employee_id, full: true },
      { name: 'requires_signature', label: 'The employee must sign it electronically', type: 'checkbox', hidden: (v) => !v.employee_id, full: true },
      { name: 'content', label: 'Description / content', type: 'textarea', full: true, hint: 'Optional when a file is attached.' },
    ]
    : [
      { name: 'doc_type_id', label: 'Document type', type: 'select', options: docTypes.map((t) => [t.id, t.name]), placeholder: 'Other document', full: true },
      { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. Degree certificate', hidden: (v) => !!v.doc_type_id },
      { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['KYC', 'Certificate', 'Personal', 'Medical', 'Other'], full: true, hidden: (v) => !!v.doc_type_id },
      { name: 'expires_on', label: 'Expires on (if any)', type: 'date' },
    ];
  const submit = async (e) => {
    e.preventDefault();
    if (!file && (!isHR || !values.content)) return toast(isHR ? 'Attach a file or enter content' : 'Please attach a file', 'error');
    setProgress(0);
    try {
      const { audience_department: ad, audience_location: al, audience_company: ac, ...rest } = values;
      const audienceId = { department: ad, location: al, company: ac }[values.audience_type];
      await uploadForm('documents', { ...rest, audience_ids: audienceId ? JSON.stringify([audienceId]) : '' }, file, setProgress);
      toast(isHR ? 'Document published' : 'Document uploaded — HR has been notified');
      invalidateFiles('documents');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setProgress(null);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={isHR ? 'Publish document' : 'Upload a document'}>
      <form onSubmit={submit} className="space-y-5">
        <FormFields fields={fields} values={values} setValues={setValues} />
        <FileDrop file={file} onChange={setFile} label={isHR ? 'File (optional)' : 'File'} />
        {progress !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" data-testid="upload-progress"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={progress !== null}><Upload size={16} /> {progress !== null ? `Uploading ${progress}%` : 'Upload'}</button>
        </div>
      </form>
    </Modal>
  );
}

const LETTER_TYPES = ['Salary Certificate', 'Experience Letter', 'Address Proof Letter', 'Employment Verification', 'Relieving Letter', 'Other'];

function LetterRequests() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('letter-requests', isHR ? {} : { mine: 1 });
  const { data: templates = [] } = useGet(isHR ? 'letter-templates' : null);
  const [act] = useAction();
  const add = useDisclosure();
  const [fulfil, setFulfil] = useState(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()} data-testid="request-letter"><Plus size={16} /> Request a letter</button></div>
      <DataTable loading={isLoading} rows={data} searchKeys={['employee_name', 'type', 'purpose']} maxHeight="480px"
        empty={<EmptyState icon={FileSignature} title="No letter requests" message="Request salary certificates, experience letters and more — HR will send you a signed PDF." />}
        columns={[
          ...(isHR ? [{ key: 'employee_name', header: 'Employee', width: 'minmax(180px, 1.4fr)', render: (r) => <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" /><span className="truncate">{r.employee_name}</span></div> }] : []),
          { key: 'type', header: 'Letter', render: (r) => <span className="font-semibold">{r.type}</span> },
          { key: 'purpose', header: 'Purpose', width: 'minmax(160px, 1.5fr)' },
          { key: 'created_at', header: 'Requested', render: (r) => date(r.created_at) },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status === 'fulfilled' ? 'approved' : r.status}>{r.status === 'fulfilled' ? 'Issued' : undefined}</Badge> },
          ...(isHR ? [{ key: 'act', header: '', sortable: false, render: (r) => r.status === 'pending' && (
            <div className="flex justify-end gap-1">
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => act(`letter-requests/${r.id}/reject`, { body: { comment: 'Please contact HR' }, success: 'Request declined' })}>Decline</button>
              <button className="btn-primary btn-sm" onClick={() => setFulfil(r)} data-testid="fulfil-request">Issue</button>
            </div>
          ) }] : []),
        ]} />
      <FormModal open={add.open} onClose={add.onClose} title="Request a letter" submitLabel="Send request" initial={{ type: LETTER_TYPES[0] }}
        fields={[{ name: 'type', label: 'Letter type', type: 'select', noEmpty: true, options: LETTER_TYPES, full: true }, { name: 'purpose', label: 'Purpose', required: true, full: true, placeholder: 'e.g. home loan application, visa' }]}
        onSubmit={(v) => act('letter-requests', { body: v, success: 'Letter requested — HR has been notified' })} />
      <FormModal open={!!fulfil} onClose={() => setFulfil(null)} title={fulfil ? `Issue ${fulfil.type} · ${fulfil.employee_name}` : ''} submitLabel="Generate PDF & email"
        initial={fulfil ? { template_id: templates.find((t) => t.name.toLowerCase().includes(fulfil.type.split(' ')[0].toLowerCase()))?.id || '', purpose: fulfil.purpose } : {}}
        fields={[{ name: 'template_id', label: 'Template', type: 'select', required: true, options: templates.filter((t) => t.type !== 'offer').map((t) => [t.id, t.name]), full: true }, { name: 'purpose', label: 'Purpose', full: true }]}
        onSubmit={(v) => act('hr/letters/generate', { body: { ...v, employee_id: fulfil.employee_id, request_id: fulfil.id }, success: 'Letter issued and emailed', invalidates: ['letter-requests'] })} />
    </div>
  );
}

function LetterTemplates() {
  const { data: placeholders = [] } = useGet('hr/letters/placeholders');
  return (
    <div className="space-y-4">
      <div className="card card-pad text-sm">
        <div className="mb-2 font-semibold">Placeholders</div>
        <div className="flex flex-wrap gap-1.5">{placeholders.map((p) => <code key={p} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{`{{${p}}}`}</code>)}</div>
      </div>
      <CrudTable path="letter-templates" label="letter template" searchKeys={['name', 'type']} defaults={{ type: 'custom' }}
        columns={[
          { key: 'name', header: 'Template', render: (r) => <span className="font-semibold">{r.name}</span> },
          { key: 'type', header: 'Type', render: (r) => titleCase(r.type) },
          { key: 'body', header: 'Preview', width: 'minmax(260px, 3fr)', render: (r) => <span className="truncate text-xs muted">{r.body.replace(/\n+/g, ' ')}</span> },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'type', label: 'Type', type: 'select', noEmpty: true, options: [['offer', 'Offer letter (candidates)'], ['experience', 'Experience'], ['relieving', 'Relieving'], ['salary', 'Salary certificate'], ['address', 'Address proof'], ['confirmation', 'Confirmation'], ['custom', 'Other']] },
          { name: 'body', label: 'Letter body', type: 'textarea', required: true, full: true, hint: 'Use placeholders like {{employee_name}}; blank lines separate paragraphs.' },
        ]} />
    </div>
  );
}

export default function Documents() {
  const { isHR, user } = useAuth();
  const { data = [], isLoading } = useGet('documents');
  const [act] = useAction();
  const toast = useToast();
  const add = useDisclosure();
  const [view, setView] = useState(null);
  const [preview, setPreview] = useState(null);
  const [del, setDel] = useState(null);
  const [q, setQ] = useState('');
  const [acks, setAcks] = useState(null);
  const [versionOf, setVersionOf] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [signing, setSigning] = useState(null);
  const bulk = useDisclosure();
  const { data: ackData } = useGet(acks ? `hr/documents/${acks.id}/acknowledgements` : null);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'docs';
  const pendingAcks = data.filter((d) => d.requires_ack && !d.acknowledged && !d.employee_id).length;
  const filtered = data.filter((d) => !q || `${d.title} ${d.category} ${d.file_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const company = filtered.filter((d) => !d.employee_id);
  const folders = company.reduce((m, d) => ({ ...m, [d.folder || 'General']: [...(m[d.folder || 'General'] || []), d] }), {});
  const toSign = data.filter((d) => d.requires_signature && !d.signed_at && d.employee_id === user.id).length;
  const personal = filtered.filter((d) => d.employee_id);

  const fileOf = (d) => ({ id: d.file_id, original_name: d.file_name, mime_type: d.file_type, size: d.file_size });
  const open = (d) => {
    if (d.file_id && isPreviewable(d.file_type)) setPreview(fileOf(d));
    else if (d.file_id && !d.content) downloadAttachment(d.file_id, d.file_name).catch((e) => toast(e.message, 'error'));
    else setView(d);
  };
  const canDelete = (d) => isHR || d.employee_id === user.id;

  const Card = ({ d }) => (
    <div className="card group flex cursor-pointer items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => open(d)} data-testid="document-card">
      {d.file_id ? <FileTypeIcon mime={d.file_type} /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white"><FileText size={18} /></div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{d.title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs muted">{d.content || d.file_name}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge color="slate">{d.category}</Badge>
          {d.version > 1 && <Badge color="blue">v{d.version}</Badge>}
          {isHR && !d.employee_id && d.audience_type && d.audience_type !== 'all' && <Badge color="violet">{d.audience_type === 'department' ? 'Department only' : d.audience_type === 'location' ? 'Location only' : 'Entity only'}</Badge>}
          {d.verification && <Badge status={d.verification === 'verified' ? 'approved' : d.verification === 'rejected' ? 'rejected' : 'pending'}>{d.verification === 'verified' ? 'Verified' : d.verification === 'rejected' ? 'Sent back' : 'Awaiting verification'}</Badge>}
          {d.expires_on && <Badge color={d.expires_on < new Date().toISOString().slice(0, 10) ? 'red' : 'slate'}>Expires {date(d.expires_on)}</Badge>}
          {d.requires_signature && (d.signed_at ? <Badge color="green">Signed</Badge> : <Badge color="amber">Signature needed</Badge>)}
          {d.requires_ack && !d.acknowledged ? <Badge color="amber" data-testid="ack-required">Action required</Badge> : null}
          {d.requires_ack && d.acknowledged ? <Badge color="green">Acknowledged</Badge> : null}
          {isHR && d.requires_ack ? <button className="text-[11px] font-semibold text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); setAcks(d); }} data-testid="ack-progress">{d.ack_count}/{d.ack_total} acknowledged</button> : null}
          {d.file_id && <span className="text-[11px] text-slate-400">{d.file_name.split('.').pop().toUpperCase()} · {formatBytes(d.file_size)}</span>}
          <span className="text-[11px] text-slate-400">{date(d.created_at)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        {d.file_id && isPreviewable(d.file_type) && <button className="btn-ghost btn-sm !px-1.5" aria-label={`Preview ${d.title}`} onClick={() => setPreview(fileOf(d))}><Eye size={15} /></button>}
        {d.requires_signature && !d.signed_at && d.employee_id === user.id && <button className="btn-primary btn-sm" onClick={() => setSigning(d)} data-testid="sign-document"><PenLine size={14} /> Sign</button>}
        {d.version > 1 && <button className="btn-ghost btn-sm !px-1.5" aria-label={`Versions of ${d.title}`} onClick={() => setHistoryOf(d)}><History size={15} /></button>}
        {(isHR || d.employee_id === user.id) && d.file_id && <button className="btn-ghost btn-sm !px-1.5" aria-label={`Upload new version of ${d.title}`} onClick={() => setVersionOf(d)} data-testid="new-version"><Upload size={15} /></button>}
        {d.requires_ack && !d.acknowledged && <button className="btn-primary btn-sm" onClick={() => act(`hr/documents/${d.id}/acknowledge`, { success: `Acknowledged: ${d.title}`, invalidates: ['documents'] })} data-testid="acknowledge-btn">Acknowledge</button>}
        {d.file_id && <button className="btn-ghost btn-sm !px-1.5" aria-label={`Download ${d.title}`} onClick={() => downloadAttachment(d.file_id, d.file_name).catch((e) => toast(e.message, 'error'))}><Download size={15} /></button>}
        {canDelete(d) && <button className="btn-ghost btn-sm !px-1.5 opacity-0 transition group-hover:opacity-100 hover:text-rose-500 focus:opacity-100" aria-label={`Delete ${d.title}`} onClick={() => setDel(d)}><Trash2 size={15} /></button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader icon={FileText} title="Documents" subtitle="Company policies and your personal documents"
        actions={<>
          <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input w-56 pl-9" placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" /></div>
          <button className="btn-primary" onClick={() => add.onOpen()} data-testid="upload-document"><Upload size={16} /> Upload</button>
        </>} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: 'docs', label: 'Documents', count: pendingAcks + toSign || undefined },
        { value: 'checklist', label: 'My checklist' },
        ...(isHR ? [{ value: 'compliance', label: 'Compliance' }] : []),
        { value: 'requests', label: 'Letter requests' },
        ...(isHR ? [{ value: 'templates', label: 'Letter templates' }] : []),
      ]} />
      {tab === 'checklist' && <Checklist />}
      {tab === 'compliance' && isHR && <Compliance />}
      {tab === 'requests' && <>{isHR && <div className="flex justify-end"><button className="btn-secondary" onClick={() => bulk.onOpen()} data-testid="bulk-letters"><Files size={16} /> Bulk letters</button></div>}<LetterRequests /></>}
      {tab === 'templates' && isHR && <LetterTemplates />}
      {tab === 'docs' && (isLoading ? <CardSkeleton lines={5} /> : (
        <>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen size={16} className="text-brand-500" /> Company policies</h2>
            {company.length === 0 ? <div className="card"><EmptyState title="No policies found" /></div> : (
              <div className="space-y-5">
                {Object.entries(folders).sort(([a], [b]) => a.localeCompare(b)).map(([folder, docs]) => (
                  <div key={folder} data-testid="folder">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><Folder size={13} /> {folder} <span className="font-normal">({docs.length})</span></h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{docs.map((d) => <Card key={d.id} d={d} />)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><User size={16} className="text-brand-500" /> {isHR ? 'Personal documents' : 'My documents'}</h2>
            {personal.length === 0 ? <div className="card"><EmptyState title="No personal documents" message="Upload KYC documents and certificates, or find letters HR has shared with you." /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{personal.map((d) => <Card key={d.id} d={d} />)}</div>}
          </section>
        </>
      ))}
      <Modal open={!!acks} onClose={() => setAcks(null)} title={acks ? `Acknowledgements · ${acks.title}` : ''}>
        {ackData ? (
          <div className="space-y-3" data-testid="ack-list">
            <div className="flex items-center justify-between"><span className="text-sm"><b>{ackData.acknowledged}</b> of {ackData.total} acknowledged</span>
              <button className="btn-secondary btn-sm" onClick={() => act(`hr/documents/${acks.id}/remind`, { success: 'Reminders sent to everyone pending' })}>Send reminder</button></div>
            <Progress value={ackData.total ? (ackData.acknowledged / ackData.total) * 100 : 0} color="bg-emerald-500" />
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {ackData.rows.map((r) => <div key={r.id} className="flex items-center justify-between py-2 text-sm"><span className="flex items-center gap-2"><Avatar name={r.name} color={r.avatar_color} size="xs" />{r.name}</span>{r.acknowledged_at ? <span className="text-xs text-emerald-600">{date(r.acknowledged_at)}</span> : <Badge color="amber">Pending</Badge>}</div>)}
            </div>
          </div>
        ) : <CardSkeleton lines={4} />}
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title} size="lg">
        <Badge color="slate">{view?.category}</Badge>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{view?.content}</p>
        {view?.file_id && <button className="btn-secondary mt-4" onClick={() => downloadAttachment(view.file_id, view.file_name)}><Download size={16} /> {view.file_name}</button>}
      </Modal>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
      <UploadModal open={add.open} onClose={add.onClose} />
      <VersionUpload doc={versionOf} onClose={() => setVersionOf(null)} />
      <VersionsModal doc={historyOf} onClose={() => setHistoryOf(null)} />
      <SignModal doc={signing} onClose={() => setSigning(null)} />
      <BulkLetters open={bulk.open} onClose={bulk.onClose} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete document?" confirmLabel="Delete" message={del ? `“${del.title}” and its file will be permanently removed.` : ''}
        onConfirm={() => act(`documents/${del.id}`, { method: 'DELETE', success: 'Document deleted' })} />
    </div>
  );
}
