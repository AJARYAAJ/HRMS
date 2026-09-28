import { store } from '../store';
import { api } from '../store/api';

export const MAX_UPLOAD_MB = 10;
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt';
const EXTENSIONS = ACCEPT.split(',');

export const formatBytes = (n) => {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const isPreviewable = (mime) => /^image\/(png|jpeg|webp|gif)$/.test(mime) || mime === 'application/pdf';

/** Client-side check mirroring the server rules, so users get instant feedback. */
export function validateFile(file) {
  if (!file) return 'Please choose a file';
  const ext = `.${file.name.split('.').pop().toLowerCase()}`;
  if (!EXTENSIONS.includes(ext)) return `Unsupported file type. Allowed: ${EXTENSIONS.join(', ')}`;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is too large (max ${MAX_UPLOAD_MB} MB)`;
  return null;
}

const token = () => store.getState().auth.token;

/** fetch() with the signed-in user's bearer token (for downloads that RTK Query shouldn't cache). */
export const authFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` } });

/** Refresh cached lists that show attachment info. */
export function invalidateFiles(...extra) {
  store.dispatch(api.util.invalidateTags(['attachments', ...extra].map((id) => ({ type: 'R', id }))));
}

/**
 * Multipart POST with upload progress (fetch can't report upload progress, XHR can).
 * Resolves with the parsed JSON response; rejects with an Error carrying the server's message.
 */
export function uploadForm(url, fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
    if (file) body.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/${url}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(body);
  });
}

export const uploadAttachment = (entity, entityId, file, onProgress) =>
  uploadForm('attachments', { entity, entity_id: entityId }, file, onProgress);

async function fetchBlob(id, inline) {
  const res = await fetch(`/api/attachments/${id}/download${inline ? '?inline=1' : ''}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) {
    let msg = 'Could not open file';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.blob();
}

/** Object URL for previewing an attachment in-app. Caller must URL.revokeObjectURL it. */
export async function attachmentObjectUrl(id) {
  return URL.createObjectURL(await fetchBlob(id, true));
}

export async function downloadAttachment(id, name) {
  const url = URL.createObjectURL(await fetchBlob(id, false));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function deleteAttachment(id) {
  const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) {
    let msg = 'Could not remove file';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
}
