import { describe, expect, it } from 'vitest';
import { FILTERS } from '../src/renderer/src/compose/filters';

describe('FILTERS', () => {
  it('lists none, bw, warm in order', () => {
    expect(Object.keys(FILTERS)).toEqual(['none', 'bw', 'warm']);
  });

  it('pins labels and CSS filter strings', () => {
    expect(FILTERS.none).toEqual({ label: 'Original', css: 'none' });
    expect(FILTERS.bw).toEqual({ label: 'Black & White', css: 'grayscale(1) contrast(1.1)' });
    expect(FILTERS.warm).toEqual({ label: 'Warm', css: 'sepia(0.25) saturate(1.2) brightness(1.03)' });
  });
});
