import { describe, it, expect } from 'vitest';
import { sessionAmountCentavos } from '../src/pricing.ts';
import { DEFAULT_SETTINGS } from '../src/session-machine.ts';

describe('sessionAmountCentavos', () => {
  it('free mode is 0, otherwise the price', () => {
    expect(sessionAmountCentavos({ ...DEFAULT_SETTINGS, freeMode: true })).toBe(0);
    expect(sessionAmountCentavos(DEFAULT_SETTINGS)).toBe(15000);
  });
});
