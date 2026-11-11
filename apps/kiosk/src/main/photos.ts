import { isAbsolute, join, resolve, sep } from 'node:path';
import { UUID_PATTERN } from '../shared/queue';
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

/** Uploads whose local photo is due for deletion (`completedAt` at least 7 days before `now`). */
export function selectPhotosToDelete(now: number, completedUploads: CompletedUpload[]): CompletedUpload[] {
  return completedUploads.filter((u) => now - u.completedAt >= PHOTO_RETENTION_MS);
}
