import type { KioskBridge } from '../../../shared/bridge';
import type { QueueJob, QueueResult } from '../../../shared/queue';
import type { KioskApi } from '../api/kiosk-api';

export type { QueueJob, QueueResult } from '../../../shared/queue';

export const QUEUE_INTERVAL_MS = 10_000;

/** Exponential backoff: 5 s, 10 s, 20 s, … capped at 5 minutes. */
export function nextAttemptAt(attempts: number, now: number): number {
  return now + Math.min(5000 * 2 ** attempts, 300_000);
}

export interface QueueDeps {
  api: Pick<KioskApi, 'upsertSession' | 'uploadPhoto'>;
  readPhoto(path: string): Promise<ArrayBuffer>;
  now: number;
}

/** Readable message for anything thrown (Supabase rejects with plain `{ message, code }` objects). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const { message } = err as { message?: unknown };
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Runs the due jobs in order. Per session, `upsert_session` jobs run FIFO (a later row never syncs before an
 * earlier one that is still pending, so a stale row cannot overwrite a newer one), and an `upload_photo` job is
 * never attempted while an `upsert_session` job for the same session is still queued (not due, failed, or
 * listed after it). Never rejects.
 */
export async function processQueue(jobs: QueueJob[], deps: QueueDeps): Promise<QueueResult> {
  const result: QueueResult = { done: [], failed: [] };
  const pendingRows = new Map<string, number>();
  for (const j of jobs) if (j.kind === 'upsert_session') pendingRows.set(j.row.id, (pendingRows.get(j.row.id) ?? 0) + 1);
  /** Sessions with an earlier upsert that was skipped or failed in this run. */
  const blockedRows = new Set<string>();

  for (const job of jobs) {
    if (job.kind === 'upsert_session') {
      if (blockedRows.has(job.row.id) || job.nextAttemptAt > deps.now) {
        blockedRows.add(job.row.id);
        continue;
      }
    } else if (job.nextAttemptAt > deps.now || (pendingRows.get(job.sessionId) ?? 0) > 0) {
      continue;
    }
    try {
      if (job.kind === 'upsert_session') {
        await deps.api.upsertSession(job.row);
        pendingRows.set(job.row.id, (pendingRows.get(job.row.id) ?? 1) - 1);
      } else {
        await deps.api.uploadPhoto(job.sessionId, await deps.readPhoto(job.filePath));
      }
      result.done.push(job.id);
    } catch (err) {
      if (job.kind === 'upsert_session') blockedRows.add(job.row.id);
      result.failed.push({ id: job.id, error: errorMessage(err), nextAttemptAt: nextAttemptAt(job.attempts, deps.now) });
    }
  }
  return result;
}

export interface QueueRunner {
  /** Runs the queue now (or right after the run in progress). */
  kick(): void;
  stop(): void;
}

/** Runs `processQueue` against the persisted queue every `intervalMs` and on `kick()`, one run at a time. */
export function startQueueRunner(
  api: QueueDeps['api'],
  bridge: Pick<KioskBridge, 'queueList' | 'queueApply' | 'readPhoto'>,
  intervalMs = QUEUE_INTERVAL_MS,
  /** Called after every `queueList` call (resolved or rejected), e.g. to re-check queue health. */
  onListed?: () => void,
): QueueRunner {
  let running = false;
  let again = false;
  let stopped = false;
  const run = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const jobs = await bridge.queueList().finally(() => onListed?.());
        // A runner stopped mid-run neither starts processing nor applies its (possibly stale) result.
        if (stopped || jobs.length === 0) continue;
        const result = await processQueue(jobs, { api, readPhoto: (p) => bridge.readPhoto(p), now: Date.now() });
        if (stopped) break;
        if (result.done.length > 0 || result.failed.length > 0) await bridge.queueApply(result);
      } while (again && !stopped);
    } catch (err) {
      console.error('Sync queue run failed', err);
    } finally {
      running = false;
    }
  };
  const id = setInterval(() => void run(), intervalMs);
  void run();
  return {
    kick: () => void run(),
    stop: () => {
      stopped = true;
      clearInterval(id);
    },
  };
}
