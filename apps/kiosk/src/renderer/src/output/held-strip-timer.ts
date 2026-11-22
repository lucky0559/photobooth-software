import { heldStripDue, PAIR_WAIT_MS, type KioskSettings, type KioskState } from '@pb/core';
import type { KioskBridge } from '../../../shared/bridge';

export const HELD_STRIP_POLL_MS = 30_000;

export interface PairTiming {
  waitMs: number;
  pollMs: number;
}

export const DEFAULT_PAIR_TIMING: PairTiming = { waitMs: PAIR_WAIT_MS, pollMs: HELD_STRIP_POLL_MS };

export const HELD_PRINT_FAILED_LOG = 'paired print: the held strip could not be printed alone';

/** The attract-screen timer only runs for paired print, and only while no guest is mid-session. */
export function heldStripTimerActive(settings: Pick<KioskSettings, 'pairedPrint'>, stateName: KioskState['name']): boolean {
  return settings.pairedPrint === true && stateName === 'attract';
}

export interface HeldStripTimerDeps {
  bridge: Pick<KioskBridge, 'getHeldStrip' | 'claimHeldStrip' | 'readPhoto' | 'print'>;
  decode(jpeg: Blob): Promise<ImageBitmap>;
  composePair(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>;
  now(): number;
  waitMs: number;
}

/**
 * Prints the held strip alone once it has waited long enough. The strip is claimed first, so a guest finishing
 * at the same moment cannot print it twice; a claimed strip that fails to print is not put back (the guest still
 * has their QR download). Never rejects.
 */
export async function flushDueHeldStrip(d: HeldStripTimerDeps): Promise<'none' | 'waiting' | 'printed' | 'failed'> {
  let bitmap: ImageBitmap | null = null;
  try {
    const held = await d.bridge.getHeldStrip();
    if (held === null) return 'none';
    if (!heldStripDue(held, d.now(), d.waitMs)) return 'waiting';
    const claimed = await d.bridge.claimHeldStrip();
    if (claimed === null) return 'none';
    const bytes = await d.bridge.readPhoto(claimed.filePath);
    bitmap = await d.decode(new Blob([bytes], { type: 'image/jpeg' }));
    const sheet = await d.composePair(bitmap, null);
    const result = await d.bridge.print(await sheet.arrayBuffer(), 1);
    if (!result.ok) throw new Error(result.reason);
    return 'printed';
  } catch {
    console.error(HELD_PRINT_FAILED_LOG);
    return 'failed';
  } finally {
    bitmap?.close();
  }
}
