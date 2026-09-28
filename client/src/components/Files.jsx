import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, FileImage, FileSpreadsheet, File as FileIcon, X, Download, Eye, Trash2, Paperclip, Loader2 } from 'lucide-react';
import { useGet, useToast } from '../lib/hooks';
import { Modal, Skeleton, Confirm, cx } from './ui';
import {
  ACCEPT, MAX_UPLOAD_MB, formatBytes, validateFile, uploadAttachment, downloadAttachment, attachmentObjectUrl,
  isPreviewable, invalidateFiles, deleteAttachment,
} from '../lib/files';
import { timeAgo } from '../lib/format';

export function FileTypeIcon({ mime = '', size = 18, className = '' }) {
  const Icon = mime.startsWith('image/') ? FileImage : mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv' ? FileSpreadsheet
    : mime === 'application/pdf' || mime.includes('word') || mime.startsWith('text/') ? FileText : FileIcon;
  const tone = mime === 'application/pdf' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10' : mime.startsWith('image/') ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/10'
    : mime.includes('sheet') || mime === 'text/csv' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10';
  return <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone, className)}><Icon size={size} /></span>;
}

/** Drag-and-drop / click-to-browse file picker. Controlled: `file` + `onChange(file | null)`. */
export function FileDrop({ file, onChange, label = 'Attach a file', hint, testId = 'file-drop' }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const pick = (f) => {
    if (!f) return;
    const err = validateFile(f);
    setError(err || '');
    onChange(err ? null : f);
  };
  return (
    <div>
      <div className="label">{label}</div>
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60" data-testid={`${testId}-selected`}>
          <FileTypeIcon mime={file.type} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{file.name}</div><div className="text-xs muted">{formatBytes(file.size)}</div></div>
          <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => { onChange(null); if (input.current) input.current.value = ''; }} aria-label="Remove file"><X size={16} /></button>
        </div>
      ) : (
        <div
          role="button" tabIndex={0} data-testid={testId}
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
          className={cx('flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition',
            over ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50')}>
          <UploadCloud size={22} className="text-brand-500" />
          <div className="text-sm font-semibold">Drop a file here or <span className="text-brand-600 dark:text-brand-400">browse</span></div>
          <div className="text-xs muted">{hint || `PDF, images, Word, Excel, CSV · up to ${MAX_UPLOAD_MB} MB`}</div>
        </div>
      )}
      <input ref={input} type="file" accept={ACCEPT} className="hidden" aria-label={label} data-testid={`${testId}-input`} onChange={(e) => pick(e.target.files?.[0])} />
      {error && <p className="mt-1.5 text-xs font-medium text-rose-600" role="alert">{error}</p>}
    </div>
  );
}

/** In-app viewer for images and PDFs (fetched with auth, rendered from a blob URL). */
export function FilePreview({ file, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) return undefined;
    let active = true;
    let objectUrl;
    setUrl(null);
    setError('');
    attachmentObjectUrl(file.id).then((u) => { objectUrl = u; if (active) setUrl(u); else URL.revokeObjectURL(u); }).catch((e) => active && setError(e.message));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);
  // Modal children are evaluated even when closed, so bail out before touching `file`.
  if (!file) return null;
  return (
    <Modal open onClose={onClose} title={file.original_name} size="xl">
      <div className="flex min-h-[60vh] items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800" data-testid="file-preview">
        {error ? <p className="text-sm text-rose-600">{error}</p>
          : !url ? <Loader2 className="animate-spin text-slate-400" />
            : file.mime_type === 'application/pdf' ? <iframe src={url} title={file.original_name} className="h-[70vh] w-full rounded-xl bg-white" />
              : <img src={url} alt={file.original_name} className="max-h-[70vh] max-w-full rounded-xl object-contain" />}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-secondary" onClick={() => downloadAttachment(file.id, file.original_name)}><Download size={16} /> Download</button>
      </div>
    </Modal>
  );
}

/** A single attachment row with preview / download / delete. */
export function FileRow({ file, onDelete, compact }) {
  const [preview, setPreview] = useState(null);
  const toast = useToast();
  const download = () => downloadAttachment(file.id, file.original_name).catch((e) => toast(e.message, 'error'));
  return (
    <div className={cx('flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 dark:border-slate-800', compact && 'p-2')} data-testid="attachment">
      <FileTypeIcon mime={file.mime_type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{file.original_name}</div>
        <div className="truncate text-xs muted">{formatBytes(file.size)}{file.uploaded_by_name ? ` · ${file.uploaded_by_name}` : ''}{file.created_at ? ` · ${timeAgo(file.created_at)}` : ''}</div>
      </div>
      {isPreviewable(file.mime_type) && <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => setPreview(file)} aria-label={`Preview ${file.original_name}`}><Eye size={15} /></button>}
      <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={download} aria-label={`Download ${file.original_name}`}><Download size={15} /></button>
      {onDelete && <button type="button" className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" onClick={() => onDelete(file)} aria-label={`Delete ${file.original_name}`}><Trash2 size={15} /></button>}
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** Attachment list + uploader for any supported record (expenses, tickets, candidates, documents). */
export function Attachments({ entity, entityId, canUpload = true, canDelete = true, title = 'Attachments', related = [] }) {
  const { data = [], isLoading, error } = useGet(entityId ? 'attachments' : null, { entity, entity_id: entityId });
  const toast = useToast();
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [del, setDel] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    const err = validateFile(file);
    if (err) return toast(err, 'error');
    setProgress(0);
    try {
      await uploadAttachment(entity, entityId, file, setProgress);
      toast(`${file.name} uploaded`);
      invalidateFiles(entity, ...related);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    try {
      await deleteAttachment(del.id);
      toast('File removed');
      invalidateFiles(entity, ...related);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (error?.status === 403) return null;
  return (
    <div data-testid="attachments">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip size={14} /> {title}{data.length ? ` (${data.length})` : ''}</span>
        {canUpload && (
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={progress !== null} data-testid="add-attachment"><UploadCloud size={14} /> Upload</button>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" aria-label={`Upload to ${title}`} data-testid="attachment-input" onChange={(e) => upload(e.target.files?.[0])} />
          </>
        )}
      </div>
      {progress !== null && (
        <div className="mb-2 rounded-xl bg-brand-50 p-2.5 dark:bg-brand-500/10" data-testid="upload-progress">
          <div className="mb-1 flex justify-between text-xs font-semibold text-brand-700 dark:text-brand-300"><span>Uploading…</span><span>{progress}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white dark:bg-slate-800"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      {isLoading ? <Skeleton className="h-14 w-full rounded-xl" /> : data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs muted dark:border-slate-700">No files attached{canUpload ? ' yet' : ''}.</p>
      ) : (
        <div className="space-y-2">{data.map((f) => <FileRow key={f.id} file={f} onDelete={canDelete ? setDel : undefined} />)}</div>
      )}
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Remove file?" confirmLabel="Remove" message={del ? `${del.original_name} will be permanently deleted.` : ''} onConfirm={remove} />
    </div>
  );
}
