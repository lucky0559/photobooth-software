import type { SessionSync } from '@pb/core';

/** A pending cloud sync job, persisted by the main process in `<userData>/queue.json`. */
export type QueueJob = (
  | { id: string; kind: 'upsert_session'; row: SessionSync }
  | { id: string; kind: 'upload_photo'; sessionId: string; filePath: string }
) & { attempts: number; nextAttemptAt: number; lastError: string | null };

export interface QueueResult {
  done: string[];
  failed: { id: string; error: string; nextAttemptAt: number }[];
}

/** Session ids come from `crypto.randomUUID()`; job ids too. Strict so they can never form a path. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database allows 1000 chars; the kiosk keeps 500. */
export const MAX_PRINT_ERROR_CHARS = 500;

/** Cuts a print error to at most `MAX_PRINT_ERROR_CHARS` (ending in `…` when cut). */
export function truncatePrintError(e: string): string {
  return e.length <= MAX_PRINT_ERROR_CHARS ? e : `${e.slice(0, MAX_PRINT_ERROR_CHARS - 1)}…`;
}
