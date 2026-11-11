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

/**
 * Runs the due jobs in order. An `upload_photo` job is never attempted while an `upsert_session` job for the
 * same session is still queued (not due, failed, or listed after it). Never rejects.
 */
export async function processQueue(jobs: QueueJob[], deps: QueueDeps): Promise<QueueResult> {
  const result: QueueResult = { done: [], failed: [] };
  const pendingRows = new Map<string, number>();
  for (const j of jobs) if (j.kind === 'upsert_session') pendingRows.set(j.row.id, (pendingRows.get(j.row.id) ?? 0) + 1);

  for (const job of jobs) {
    if (job.nextAttemptAt > deps.now) continue;
    if (job.kind === 'upload_photo' && (pendingRows.get(job.sessionId) ?? 0) > 0) continue;
    try {
      if (job.kind === 'upsert_session') {
        await deps.api.upsertSession(job.row);
        pendingRows.set(job.row.id, (pendingRows.get(job.row.id) ?? 1) - 1);
      } else {
        await deps.api.uploadPhoto(job.sessionId, await deps.readPhoto(job.filePath));
      }
      result.done.push(job.id);
    } catch (err) {
      result.failed.push({
        id: job.id,
        error: err instanceof Error ? err.message : String(err),
        nextAttemptAt: nextAttemptAt(job.attempts, deps.now),
      });
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
): QueueRunner {
  let running = false;
  let again = false;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const jobs = await bridge.queueList();
        if (jobs.length === 0) continue;
        const result = await processQueue(jobs, { api, readPhoto: (p) => bridge.readPhoto(p), now: Date.now() });
        if (result.done.length > 0 || result.failed.length > 0) await bridge.queueApply(result);
      } while (again);
    } catch (err) {
      console.error('Sync queue run failed', err);
    } finally {
      running = false;
    }
  };
  const id = setInterval(() => void run(), intervalMs);
  void run();
  return { kick: () => void run(), stop: () => clearInterval(id) };
}
