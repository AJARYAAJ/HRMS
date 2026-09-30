#!/usr/bin/env node
/**
 * Consistent online backup of the PeopleHub database and uploaded files.
 *   npm run backup                 → backups/<timestamp>/{hrms.db, uploads/}
 * Env: DB_PATH, UPLOAD_DIR (same as the server), BACKUP_DIR (default ./backups), BACKUP_KEEP (default 14).
 * Safe while the server is running: SQLite's VACUUM INTO writes a transactionally consistent copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || path.join(root, 'server', 'data', 'hrms.db');
const uploads = process.env.UPLOAD_DIR || path.join(root, 'server', 'data', 'uploads');
const backupRoot = process.env.BACKUP_DIR || path.join(root, 'backups');
const keep = Number(process.env.BACKUP_KEEP) || 14;

if (!fs.existsSync(dbPath)) { console.error(`Database not found: ${dbPath}`); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(backupRoot, stamp);
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`VACUUM INTO '${path.join(dir, 'hrms.db').replace(/'/g, "''")}'`);
db.close();
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dir, 'uploads'), { recursive: true });
const size = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0) : fs.statSync(p).size);
console.log(`Backup written to ${dir} (${(size(dir) / 1e6).toFixed(1)} MB)`);

const old = fs.readdirSync(backupRoot).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort().reverse().slice(keep);
for (const d of old) fs.rmSync(path.join(backupRoot, d), { recursive: true, force: true });
if (old.length) console.log(`Removed ${old.length} old backup(s); keeping the latest ${keep}.`);
