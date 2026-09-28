import { useEffect, useState } from 'react';
import { FileText, Upload, Trash2, BookOpen, User, Search, Download, Eye } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState, Modal, Confirm } from '../components/ui';
import { FormFields } from '../components/Form';
import { FileDrop, FilePreview, FileTypeIcon } from '../components/Files';
import { uploadForm, downloadAttachment, isPreviewable, formatBytes, invalidateFiles } from '../lib/files';
import { date } from '../lib/format';

function UploadModal({ open, onClose }) {
  const { isHR } = useAuth();
  const toast = useToast();
  const [values, setValues] = useState({});
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!open) return;
    setValues({ category: isHR ? 'Policy' : 'KYC' });
    setFile(null);
    setProgress(null);
  }, [open, isHR]);
  const fields = isHR
    ? [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['Policy', 'Compliance', 'Calendar', 'Letter', 'Form', 'Personal'] },
      { name: 'employee_id', label: 'Share with (empty = everyone)', type: 'employee' },
      { name: 'content', label: 'Description / content', type: 'textarea', full: true, hint: 'Optional when a file is attached.' },
    ]
    : [
      { name: 'title', label: 'Title', required: true, full: true, placeholder: 'e.g. PAN card, Degree certificate' },
      { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['KYC', 'Certificate', 'Personal', 'Medical', 'Other'], full: true },
    ];
  const submit = async (e) => {
    e.preventDefault();
    if (!file && (!isHR || !values.content)) return toast(isHR ? 'Attach a file or enter content' : 'Please attach a file', 'error');
    setProgress(0);
    try {
      await uploadForm('documents', values, file, setProgress);
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
  const filtered = data.filter((d) => !q || `${d.title} ${d.category} ${d.file_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const company = filtered.filter((d) => !d.employee_id);
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
          {d.file_id && <span className="text-[11px] text-slate-400">{d.file_name.split('.').pop().toUpperCase()} · {formatBytes(d.file_size)}</span>}
          <span className="text-[11px] text-slate-400">{date(d.created_at)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        {d.file_id && isPreviewable(d.file_type) && <button className="btn-ghost btn-sm !px-1.5" aria-label={`Preview ${d.title}`} onClick={() => setPreview(fileOf(d))}><Eye size={15} /></button>}
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
      {isLoading ? <CardSkeleton lines={5} /> : (
        <>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen size={16} className="text-brand-500" /> Company policies</h2>
            {company.length === 0 ? <div className="card"><EmptyState title="No policies found" /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{company.map((d) => <Card key={d.id} d={d} />)}</div>}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><User size={16} className="text-brand-500" /> {isHR ? 'Personal documents' : 'My documents'}</h2>
            {personal.length === 0 ? <div className="card"><EmptyState title="No personal documents" message="Upload KYC documents and certificates, or find letters HR has shared with you." /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{personal.map((d) => <Card key={d.id} d={d} />)}</div>}
          </section>
        </>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title} size="lg">
        <Badge color="slate">{view?.category}</Badge>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{view?.content}</p>
        {view?.file_id && <button className="btn-secondary mt-4" onClick={() => downloadAttachment(view.file_id, view.file_name)}><Download size={16} /> {view.file_name}</button>}
      </Modal>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
      <UploadModal open={add.open} onClose={add.onClose} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete document?" confirmLabel="Delete" message={del ? `“${del.title}” and its file will be permanently removed.` : ''}
        onConfirm={() => act(`documents/${del.id}`, { method: 'DELETE', success: 'Document deleted' })} />
    </div>
  );
}
