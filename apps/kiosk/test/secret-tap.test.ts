import { describe, expect, it } from 'vitest';
import { registerTap } from '../src/renderer/src/setup/secret-tap';

describe('registerTap', () => {
  it('triggers on the 5th tap within 3s and resets', () => {
    let t: number[] = [];
    for (const now of [0, 500, 1000, 1500]) ({ taps: t } = registerTap(t, now));
    const r = registerTap(t, 2999);
    expect(r).toEqual({ taps: [], triggered: true });
  });

  it('drops taps older than 3s', () => {
    expect(registerTap([0, 100, 200, 300], 3200).triggered).toBe(false);
  });

  it('does not trigger on 4 taps', () => {
    expect(registerTap([0, 100, 200], 300)).toEqual({ taps: [0, 100, 200, 300], triggered: false });
  });
});
