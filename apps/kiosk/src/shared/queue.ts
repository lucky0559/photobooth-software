import type { SessionSync } from '@pb/core';

/** A pending cloud sync job, persisted by the main process in `<userData>/queue.json`. */
export type QueueJob = (
  | { id: string; kind: 'upsert_session'; row: SessionSync }
  | { id: string; kind: 'upload_photo'; sessionId: string; filePath: string }
) & {
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /** Epoch ms of the first failed attempt; absent before any failure (and in queue.json files from older builds). */
  firstFailedAt?: number;
};

/**
 * Renderer-safe summary of sync jobs that keep failing (R22): jobs with at least `FAILING_MIN_ATTEMPTS` attempts, or
 * failing for more than `FAILING_AFTER_MS` since their first failure.
 */
export interface SyncFailureStatus {
  failingCount: number;
  /** Earliest `firstFailedAt` among failing jobs; null when none of them recorded it. */
  oldestFailingSince: number | null;
  /** Error of the failing job that failed most recently. */
  lastError: string | null;
}

export const FAILING_MIN_ATTEMPTS = 10;
export const FAILING_AFTER_MS = 60 * 60 * 1000;
export const NO_SYNC_FAILURES: SyncFailureStatus = { failingCount: 0, oldestFailingSince: null, lastError: null };

export interface QueueResult {
  done: string[];
  failed: { id: string; error: string; nextAttemptAt: number }[];
}

/** Session ids come from `crypto.randomUUID()`; job ids too. Strict so they can never form a path. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database allows 1000 chars; the kiosk keeps 500. */
export const MAX_PRINT_ERROR_CHARS = 500;

/** Cuts a print error to at most `MAX_PRINT_ERROR_CHARS` (ending in `…` when cut), never splitting a surrogate pair. */
export function truncatePrintError(e: string): string {
  if (e.length <= MAX_PRINT_ERROR_CHARS) return e;
  let head = e.slice(0, MAX_PRINT_ERROR_CHARS - 1);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return `${head}…`;
}
