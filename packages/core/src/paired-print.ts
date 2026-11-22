import type { KioskSettings, LayoutId } from './types.ts';

export const PAIR_WAIT_MS = 600_000;

export function heldStripDue(held: { heldAt: number }, now: number, waitMs: number = PAIR_WAIT_MS): boolean {
  return now - held.heldAt >= waitMs;
}

export function isPairedMode(settings: Pick<KioskSettings, 'pairedPrint'>, layout: LayoutId | null | undefined): boolean {
  return settings.pairedPrint === true && layout === 'strip_2x6';
}
