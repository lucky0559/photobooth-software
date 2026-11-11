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
