import type { SessionSync } from '@pb/core';
import type { HeldStrip, KioskBridge } from '../../../shared/bridge';
import { truncatePrintError, type QueueJob } from '../../../shared/queue';

export type PairedOutcome = { held: true } | { held: false; printError: string | null };

export interface PairedDeps {
  bridge: Pick<KioskBridge, 'claimHeldStrip' | 'holdStrip' | 'readPhoto'>;
  decode(jpeg: Blob): Promise<ImageBitmap>;
  composePair(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>;
  /** Outcome of an earlier run for this session: when set, the strip is not claimed, held or printed again. */
  prior?: PairedOutcome;
  /** Called once the outcome is known, so a retry can pass it back as `prior`. */
  onOutcome?(outcome: PairedOutcome): void;
}

export const HELD_UNREADABLE_LOG = 'paired print: the held strip could not be read; printing this strip alone';
export const REHOLD_FAILED_LOG = 'paired print: could not put the held strip back';

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
  /** Outcome of an earlier run's print for this session: when set, the sheet is not printed again. */
  priorPrint?: { printError: string | null };
  /** Called once the print outcome is known, so a retry can pass it back as `priorPrint`. */
  onPrinted?(printError: string | null): void;
  /** Paired print: the sheet is a single strip that is held for, or paired with, another guest's. */
  paired?: PairedDeps;
}

const fresh = { attempts: 0, nextAttemptAt: 0, lastError: null } as const;

/**
 * compose → savePhoto → in parallel: print and queue (session row + upload). Resolves with the print failure
 * reason (or null); a print failure never blocks queueing. Rejects if the photo could not be composed, saved or
 * queued, since the guest's photo could then be lost. A retry passes `priorPrint` so the sheet prints only once.
 */
export async function runOutput(d: OutputDeps): Promise<{ printError: string | null; held: boolean; sheet: Blob }> {
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
    printError: printError === null ? null : truncatePrintError(printError),
    createdAt,
    completedAt: new Date(d.now()).toISOString(),
  });
  const enqueue = async (jobs: QueueJob[]): Promise<void> => {
    await d.bridge.queueAdd(jobs);
    d.onEnqueued();
  };

  if (d.paired) {
    const outcome = await pairedOutcome(d, d.paired, sheet, filePath, () =>
      enqueue([
        { id: d.newId(), kind: 'upsert_session', row: row(null), ...fresh },
        { id: d.newId(), kind: 'upload_photo', sessionId, filePath, ...fresh },
      ]),
    );
    if (!outcome.held && outcome.printError !== null) {
      await enqueue([{ id: d.newId(), kind: 'upsert_session', row: row(outcome.printError), ...fresh }]);
    }
    return { printError: outcome.held ? null : outcome.printError, held: outcome.held, sheet };
  }

  const printing = d.priorPrint
    ? Promise.resolve(d.priorPrint.printError)
    : d.bridge
        .print(jpeg, d.copies)
        .then(
          (r) => (r.ok ? null : r.reason),
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        )
        .then((printError) => {
          d.onPrinted?.(printError);
          return printError;
        });
  const queued = enqueue([
    { id: d.newId(), kind: 'upsert_session', row: row(null), ...fresh },
    { id: d.newId(), kind: 'upload_photo', sessionId, filePath, ...fresh },
  ]);
  const [printError, queue] = await Promise.all([printing, queued.then(() => null, (err: unknown) => err)]);
  if (queue !== null) throw queue;
  // The row was queued before printing finished; record the failure with a follow-up upsert.
  if (printError !== null) await enqueue([{ id: d.newId(), kind: 'upsert_session', row: row(printError), ...fresh }]);
  return { printError, held: false, sheet };
}

const failureReason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Paired branch, after compose and save. Order matters: the guest's own rows are queued first (so a hold or print
 * problem can never lose their photo), then the held strip is claimed, so a failure before the claim leaves the
 * held strip untouched and a failure after it puts it back.
 */
async function pairedOutcome(
  d: OutputDeps,
  p: PairedDeps,
  sheet: Blob,
  filePath: string,
  enqueueOwn: () => Promise<void>,
): Promise<PairedOutcome> {
  const { sessionId } = d.session;
  await enqueueOwn();
  if (p.prior) return p.prior;

  const claimed = await p.bridge.claimHeldStrip();
  let outcome: PairedOutcome;
  if (claimed === null || claimed.sessionId === sessionId) {
    await p.bridge.holdStrip(claimed ?? { sessionId, filePath, heldAt: d.now() });
    outcome = { held: true };
  } else {
    outcome = { held: false, printError: await printPair(d, p, claimed, sheet) };
  }
  p.onOutcome?.(outcome);
  return outcome;
}

async function printPair(d: OutputDeps, p: PairedDeps, claimed: HeldStrip, sheet: Blob): Promise<string | null> {
  const bitmaps: ImageBitmap[] = [];
  let heldBitmap: ImageBitmap | null = null;
  try {
    try {
      const bytes = await p.bridge.readPhoto(claimed.filePath);
      heldBitmap = await p.decode(new Blob([bytes], { type: 'image/jpeg' }));
      bitmaps.push(heldBitmap);
    } catch {
      console.error(HELD_UNREADABLE_LOG);
    }
    const own = await p.decode(sheet);
    bitmaps.push(own);
    const pair = await p.composePair(heldBitmap ?? own, heldBitmap ? own : null);
    const jpeg = await pair.arrayBuffer();
    return await d.bridge.print(jpeg, 1).then(
      (r) => (r.ok ? null : r.reason),
      (err: unknown) => failureReason(err),
    );
  } catch (err) {
    if (heldBitmap !== null) {
      try {
        await p.bridge.holdStrip(claimed);
      } catch {
        console.error(REHOLD_FAILED_LOG);
      }
    }
    throw err;
  } finally {
    for (const b of bitmaps) b.close();
  }
}
