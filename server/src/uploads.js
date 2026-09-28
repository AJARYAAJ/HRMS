import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all, run } from './db.js';
import { httpError } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 10;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Extension → accepted MIME types. Both must match, so a renamed executable is rejected.
export const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.txt': ['text/plain'],
};
// Types a browser may render inline; everything else is always served as a download.
export const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Magic-number checks for binary formats, so the declared type has to match the actual bytes.
const SIGNATURES = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [[0x50, 0x4b, 0x03, 0x04]],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [[0x50, 0x4b, 0x03, 0x04]],
  'application/msword': [[0xd0, 0xcf, 0x11, 0xe0]],
  'application/vnd.ms-excel': [[0xd0, 0xcf, 0x11, 0xe0], [0x0d, 0x0a], [0x22], [0x41]],
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED[ext] || !ALLOWED[ext].includes(file.mimetype)) {
      return cb(httpError(415, `Unsupported file type. Allowed: ${Object.keys(ALLOWED).join(', ')}`));
    }
    cb(null, true);
  },
});

/** Express middleware: single file under `file`, with friendly errors and content sniffing. */
export const singleFile = (required = true) => (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(413, `File is too large (max ${MAX_UPLOAD_MB} MB)`));
      return next(err.status ? err : httpError(400, err.message));
    }
    if (!req.file) return required ? next(httpError(400, 'Please choose a file to upload')) : next();
    const sigs = SIGNATURES[req.file.mimetype];
    if (sigs && req.file.mimetype !== 'application/vnd.ms-excel') {
      const fd = fs.openSync(req.file.path, 'r');
      const head = Buffer.alloc(8);
      fs.readSync(fd, head, 0, 8, 0);
      fs.closeSync(fd);
      if (!sigs.some((sig) => sig.every((b, i) => head[i] === b))) {
        removeFile(req.file.filename);
        return next(httpError(415, 'File content does not match its type'));
      }
    }
    next();
  });
};

export function removeFile(storedName) {
  const target = path.join(UPLOAD_DIR, path.basename(storedName));
  fs.rm(target, { force: true }, () => {});
}

export const filePath = (storedName) => path.join(UPLOAD_DIR, path.basename(storedName));

/** Delete every attachment (rows and files) belonging to a record. */
export function deleteAttachmentsFor(entity, entityId) {
  for (const a of all('SELECT stored_name FROM attachments WHERE entity = ? AND entity_id = ?', entity, entityId)) removeFile(a.stored_name);
  run('DELETE FROM attachments WHERE entity = ? AND entity_id = ?', entity, entityId);
}

export const attachmentSummary = (entity, entityId) =>
  get('SELECT id, original_name, mime_type, size FROM attachments WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1', entity, entityId);
