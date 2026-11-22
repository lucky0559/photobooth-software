import { describe, expect, it } from 'vitest';
import type { FilterId } from '@pb/core';
import { FILTERS, filterCss } from '../src/renderer/src/compose/filters';

describe('FILTERS', () => {
  it('lists none, bw, warm in order', () => {
    expect(Object.keys(FILTERS)).toEqual(['none', 'bw', 'warm']);
  });

  it('pins labels and CSS filter strings', () => {
    expect(FILTERS.none).toEqual({ label: 'Original', css: 'none' });
    expect(FILTERS.bw).toEqual({ label: 'Black & White', css: 'grayscale(1) contrast(1.1)' });
    expect(FILTERS.warm).toEqual({ label: 'Warm', css: 'sepia(0.25) saturate(1.2) brightness(1.03)' });
  });

  it('filterCss maps known ids and falls back to none for unknown ids', () => {
    expect(filterCss('bw')).toBe('grayscale(1) contrast(1.1)');
    expect(filterCss('sepia' as FilterId)).toBe('none');
    expect(filterCss('toString' as FilterId)).toBe('none');
  });
});
