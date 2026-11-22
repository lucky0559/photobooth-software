import { describe, it, expect } from 'vitest';
import { validateTemplateImage, TEMPLATE_MAX_BYTES } from '../src/templates.ts';

const png = (width: number, height: number, bytes = 500_000) => ({ width, height, mime: 'image/png', bytes });

const MIME = 'Template must be a PNG with transparent photo areas';
const STRIP = 'Strip templates must be exactly 600 × 1800 px (2×6 in at 300 DPI)';
const FOUR_R = '4R templates must be exactly 1200 × 1800 px (4×6 in at 300 DPI)';
const BYTES = 'Template must be 10 MB or smaller';

describe('validateTemplateImage', () => {
  it('accepts a 600×1800 PNG strip', () => {
    expect(validateTemplateImage(png(600, 1800), 'strip_2x6')).toEqual({ ok: true, value: true });
  });
  it('rejects a 1200×1800 strip with the strip message', () => {
    expect(validateTemplateImage(png(1200, 1800), 'strip_2x6')).toEqual({ ok: false, errors: { size: STRIP } });
  });
  it('accepts a 1200×1800 PNG 4R', () => {
    expect(validateTemplateImage(png(1200, 1800), 'print_4r')).toEqual({ ok: true, value: true });
  });
  it('rejects a 600×1800 4R with the 4R message', () => {
    expect(validateTemplateImage(png(600, 1800), 'print_4r')).toEqual({ ok: false, errors: { size: FOUR_R } });
  });
  it('rejects image/jpeg with the PNG message', () => {
    expect(validateTemplateImage({ ...png(600, 1800), mime: 'image/jpeg' }, 'strip_2x6')).toEqual({
      ok: false,
      errors: { mime: MIME },
    });
  });
  it('accepts exactly 10 MB and rejects 10_485_761 bytes', () => {
    expect(TEMPLATE_MAX_BYTES).toBe(10_485_760);
    expect(validateTemplateImage(png(600, 1800, 10_485_760), 'strip_2x6').ok).toBe(true);
    expect(validateTemplateImage(png(600, 1800, 10_485_761), 'strip_2x6')).toEqual({
      ok: false,
      errors: { bytes: BYTES },
    });
  });
  it('reports every problem at once', () => {
    const r = validateTemplateImage({ width: 1, height: 1, mime: 'image/gif', bytes: 20_000_000 }, 'print_4r');
    expect(r).toEqual({ ok: false, errors: { mime: MIME, size: FOUR_R, bytes: BYTES } });
  });
});
