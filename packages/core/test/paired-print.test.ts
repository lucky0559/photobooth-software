import { describe, it, expect } from 'vitest';
import { PAIR_WAIT_MS, heldStripDue, isPairedMode } from '../src/paired-print.ts';

describe('paired print', () => {
  it('waits ten minutes', () => expect(PAIR_WAIT_MS).toBe(600_000));
  it('heldStripDue flips at exactly the wait', () => {
    expect(heldStripDue({ heldAt: 1000 }, 600_999)).toBe(false);
    expect(heldStripDue({ heldAt: 1000 }, 601_000)).toBe(true);
    expect(heldStripDue({ heldAt: 1000 }, 0)).toBe(false);
  });
  it('heldStripDue honours a custom wait', () => {
    expect(heldStripDue({ heldAt: 0 }, 1999, 2000)).toBe(false);
    expect(heldStripDue({ heldAt: 0 }, 2000, 2000)).toBe(true);
  });
  it('isPairedMode needs the setting true and the strip layout', () => {
    expect(isPairedMode({ pairedPrint: true }, 'strip_2x6')).toBe(true);
    expect(isPairedMode({ pairedPrint: true }, 'print_4r')).toBe(false);
    expect(isPairedMode({}, 'strip_2x6')).toBe(false);
    expect(isPairedMode({ pairedPrint: false }, 'strip_2x6')).toBe(false);
    expect(isPairedMode({ pairedPrint: 'true' as never }, 'strip_2x6')).toBe(false);
    expect(isPairedMode({ pairedPrint: 1 as never }, 'strip_2x6')).toBe(false);
    expect(isPairedMode({ pairedPrint: true }, null)).toBe(false);
    expect(isPairedMode({ pairedPrint: true }, undefined)).toBe(false);
  });
});
