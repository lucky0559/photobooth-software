import { describe, expect, it } from 'vitest';
import { formatMmSs } from '../src/renderer/src/theme/time';

describe('formatMmSs', () => {
  it.each([
    [180_000, '3:00'],
    [60_000, '1:00'],
    [45_000, '0:45'],
    [59_001, '1:00'],
    [9_000, '0:09'],
    [1, '0:01'],
    [0, '0:00'],
    [-500, '0:00'],
  ])('%i ms -> %s', (ms, text) => {
    expect(formatMmSs(ms)).toBe(text);
  });
});
