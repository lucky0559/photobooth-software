import { isAbsolute, join, resolve, sep } from 'node:path';
import { UUID_PATTERN, type QueueJob } from '../shared/queue';
import { validateJpegBytes } from './print';

/** Local photos are deleted this long after their upload job completed. */
export const PHOTO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CompletedUpload {
  sessionId: string;
  filePath: string;
  /** Epoch ms when the upload job was done. */
  completedAt: number;
}

/** `<photosDir>/<sessionId>.jpg`; throws unless `sessionId` is a UUID (so it can never traverse paths). */
export function photoPath(photosDir: string, sessionId: unknown): string {
  if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) throw new Error('Invalid session id');
  return join(photosDir, `${sessionId}.jpg`);
}

/** Validates an untrusted read path: an absolute `.jpg` directly inside `photosDir`, with no `..` segments. */
export function resolvePhotoReadPath(photosDir: string, path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024 || !isAbsolute(path)) {
    throw new Error('Invalid photo path');
  }
  if (path.split(/[\\/]/).includes('..')) throw new Error('Invalid photo path');
  const dir = resolve(photosDir);
  const full = resolve(path);
  const name = full.startsWith(dir + sep) ? full.slice(dir.length + 1) : '';
  if (name === '' || name.includes(sep) || name.includes('/') || !name.endsWith('.jpg')) {
    throw new Error('Invalid photo path');
  }
  return full;
}

export const validateJpeg = validateJpegBytes;

/** Names and mtimes of the files in `dir`; a file that vanishes or cannot be stat'ed is skipped, not fatal. */
export function listPhotoFiles(
  dir: string,
  fs: { readdirSync(d: string): string[]; statSync(p: string): { mtimeMs: number } },
): { name: string; mtimeMs: number }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    try {
      out.push({ name, mtimeMs: fs.statSync(join(dir, name)).mtimeMs });
    } catch {
      // Deleted meanwhile (or unreadable): skip just this file.
    }
  }
  return out;
}

/** A photo younger than this may still belong to a session in flight. */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Names of `<uuid>.jpg` files at least 1 hour old with no pending `upload_photo` job and no completed upload.
 * Log-only: the session row cannot be rebuilt from a photo, so these are never re-uploaded automatically.
 */
export function findOrphanPhotos(
  files: { name: string; mtimeMs: number }[],
  queue: { jobs: QueueJob[]; completedUploads: CompletedUpload[] },
  now: number,
): string[] {
  const known = new Set<string>(queue.completedUploads.map((u) => u.sessionId));
  for (const j of queue.jobs) if (j.kind === 'upload_photo') known.add(j.sessionId);
  return files
    .filter((f) => {
      if (!f.name.endsWith('.jpg')) return false;
      const id = f.name.slice(0, -'.jpg'.length);
      return UUID_PATTERN.test(id) && !known.has(id) && now - f.mtimeMs >= ORPHAN_MIN_AGE_MS;
    })
    .map((f) => f.name);
}

/** Uploads whose local photo is due for deletion (`completedAt` at least 7 days before `now`). */
export function selectPhotosToDelete(now: number, completedUploads: CompletedUpload[]): CompletedUpload[] {
  return completedUploads.filter((u) => now - u.completedAt >= PHOTO_RETENTION_MS);
}
