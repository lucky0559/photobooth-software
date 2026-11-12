import type { SessionSync } from '@pb/core';
import { TEMPLATE_ID_PATTERN } from '../shared/bridge';
import { MAX_PRINT_ERROR_CHARS, truncatePrintError, UUID_PATTERN, type QueueJob, type QueueResult } from '../shared/queue';
import { photoPath, type CompletedUpload } from './photos';

/** Shape of `<userData>/queue.json`. */
export interface QueueFile {
  jobs: QueueJob[];
  completedUploads: CompletedUpload[];
}

export const EMPTY_QUEUE: QueueFile = { jobs: [], completedUploads: [] };

const MAX_JOBS_PER_ADD = 10;
const MAX_ERROR_CHARS = MAX_PRINT_ERROR_CHARS;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function fail(what: string): never {
  throw new Error(`Invalid queue ${what}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_PATTERN.test(v);
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO_PATTERN.test(v) && !Number.isNaN(Date.parse(v));

function validateRow(r: unknown): SessionSync {
  if (!isObject(r)) fail('session row');
  const { id, downloadToken, templateId, amountCentavos, status, printError, createdAt, completedAt } = r;
  if (!isUuid(id)) fail('session id');
  if (typeof downloadToken !== 'string' || !TOKEN_PATTERN.test(downloadToken)) fail('download token');
  if (typeof templateId !== 'string' || !TEMPLATE_ID_PATTERN.test(templateId)) fail('template id');
  if (typeof amountCentavos !== 'number' || !Number.isInteger(amountCentavos) || amountCentavos < 0 || amountCentavos > 100_000) {
    fail('amount');
  }
  if (status !== 'free' && status !== 'completed') fail('status');
  if (printError !== null && typeof printError !== 'string') fail('print error');
  if (!isIso(createdAt)) fail('createdAt');
  if (completedAt !== null && !isIso(completedAt)) fail('completedAt');
  // Too long is cut, not rejected: rejecting would make a guest see an error for an already queued photo.
  return { id, downloadToken, templateId, amountCentavos, status, printError: printError === null ? null : truncatePrintError(printError), createdAt, completedAt };
}

/** Validates untrusted `queueAdd` input. Returned jobs are due now with no attempts. */
export function validateQueueJobs(input: unknown, photosDir: string): QueueJob[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_JOBS_PER_ADD) fail('job list');
  return input.map((j: unknown): QueueJob => {
    if (!isObject(j) || !isUuid(j.id)) fail('job');
    const fresh = { attempts: 0, nextAttemptAt: 0, lastError: null };
    if (j.kind === 'upsert_session') return { id: j.id, kind: 'upsert_session', row: validateRow(j.row), ...fresh };
    if (j.kind === 'upload_photo') {
      if (!isUuid(j.sessionId)) fail('session id');
      const filePath = photoPath(photosDir, j.sessionId);
      if (j.filePath !== filePath) fail('photo path');
      return { id: j.id, kind: 'upload_photo', sessionId: j.sessionId, filePath, ...fresh };
    }
    return fail('job kind');
  });
}

/** Validates untrusted `queueApply` input; long error messages are truncated. */
export function validateQueueResult(input: unknown): QueueResult {
  if (!isObject(input) || !Array.isArray(input.done) || !Array.isArray(input.failed)) fail('result');
  const done = input.done.map((id: unknown) => (isUuid(id) ? id : fail('done id')));
  const failed = input.failed.map((f: unknown) => {
    if (!isObject(f) || !isUuid(f.id) || typeof f.error !== 'string') fail('failure');
    if (typeof f.nextAttemptAt !== 'number' || !Number.isFinite(f.nextAttemptAt)) fail('failure time');
    return { id: f.id, error: f.error.slice(0, MAX_ERROR_CHARS), nextAttemptAt: f.nextAttemptAt };
  });
  return { done, failed };
}

/** Appends jobs, ignoring ids already queued. */
export function addJobs(q: QueueFile, jobs: QueueJob[]): QueueFile {
  const known = new Set(q.jobs.map((j) => j.id));
  return { ...q, jobs: [...q.jobs, ...jobs.filter((j) => !known.has(j.id))] };
}

/** Drops done jobs (remembering finished uploads for photo cleanup) and records failures. */
export function applyResult(q: QueueFile, r: QueueResult, now: number): QueueFile {
  const done = new Set(r.done);
  const failed = new Map(r.failed.map((f) => [f.id, f]));
  const completedUploads = [...q.completedUploads];
  const jobs: QueueJob[] = [];
  for (const job of q.jobs) {
    if (done.has(job.id)) {
      if (job.kind === 'upload_photo') completedUploads.push({ sessionId: job.sessionId, filePath: job.filePath, completedAt: now });
      continue;
    }
    const f = failed.get(job.id);
    jobs.push(f ? { ...job, attempts: job.attempts + 1, nextAttemptAt: f.nextAttemptAt, lastError: f.error } : job);
  }
  return { jobs, completedUploads };
}
