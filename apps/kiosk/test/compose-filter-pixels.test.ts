import { describe, expect, it } from 'vitest';
import { applyFilterPixels } from '../src/renderer/src/compose/compose';

describe('applyFilterPixels', () => {
  it('leaves the unfiltered RGBA pixels unchanged', () => {
    const pixels = new Uint8ClampedArray([12, 90, 240, 77]);
    const original = Array.from(pixels);

    applyFilterPixels(pixels, 'none');

    expect(Array.from(pixels)).toEqual(original);
  });

  it('applies monochrome contrast and preserves alpha', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 41]);

    applyFilterPixels(pixels, 'bw');

    expect(Array.from(pixels)).toEqual([47, 47, 47, 41]);
  });

  it('warms the color and keeps every channel in range', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 123]);

    applyFilterPixels(pixels, 'warm');

    expect(pixels[0]).toBeGreaterThan(pixels[1]!);
    expect(pixels[1]).toBeGreaterThan(pixels[2]!);
    expect(pixels[3]).toBe(123);
    expect(Array.from(pixels).slice(0, 3).every((channel) => channel >= 0 && channel <= 255)).toBe(true);
  });
});
