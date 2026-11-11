import type { SessionSync } from '@pb/core';
import type { KioskBridge } from '../../../shared/bridge';
import type { QueueJob } from '../../../shared/queue';

export interface OutputDeps {
  /** Composes the 1200×1800 print sheet JPEG. */
  compose(): Promise<Blob>;
  bridge: Pick<KioskBridge, 'savePhoto' | 'print' | 'queueAdd'>;
  /** Called after each successful `queueAdd`, so the sync queue can run right away. */
  onEnqueued(): void;
  copies: number;
  session: { sessionId: string; downloadToken: string; templateId: string; amountCentavos: number; createdAt: string };
  now(): number;
  newId(): string;
}

const fresh = { attempts: 0, nextAttemptAt: 0, lastError: null } as const;

/**
 * compose → savePhoto → in parallel: print and queue (session row + upload). Resolves with the print failure
 * reason (or null); a print failure never blocks queueing. Rejects if the photo could not be composed, saved or
 * queued, since the guest's photo could then be lost.
 */
export async function runOutput(d: OutputDeps): Promise<{ printError: string | null; sheet: Blob }> {
  const sheet = await d.compose();
  const jpeg = await sheet.arrayBuffer();
  const { sessionId, downloadToken, templateId, amountCentavos, createdAt } = d.session;
  const filePath = await d.bridge.savePhoto(sessionId, jpeg);

  const row = (printError: string | null): SessionSync => ({
    id: sessionId,
    downloadToken,
    templateId,
    amountCentavos,
    status: amountCentavos === 0 ? 'free' : 'completed',
    printError,
    createdAt,
    completedAt: new Date(d.now()).toISOString(),
  });
  const enqueue = async (jobs: QueueJob[]): Promise<void> => {
    await d.bridge.queueAdd(jobs);
    d.onEnqueued();
  };

  const printing = d.bridge.print(jpeg, d.copies).then(
    (r) => (r.ok ? null : r.reason),
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
  const queued = enqueue([
    { id: d.newId(), kind: 'upsert_session', row: row(null), ...fresh },
    { id: d.newId(), kind: 'upload_photo', sessionId, filePath, ...fresh },
  ]);
  const [printError, queue] = await Promise.all([printing, queued.then(() => null, (err: unknown) => err)]);
  if (queue !== null) throw queue;
  // The row was queued before printing finished; record the failure with a follow-up upsert.
  if (printError !== null) await enqueue([{ id: d.newId(), kind: 'upsert_session', row: row(printError), ...fresh }]);
  return { printError, sheet };
}
