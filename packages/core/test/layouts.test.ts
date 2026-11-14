import { describe, it, expect } from 'vitest';
import { layoutSize, slotsFor, printSheetPlacements, coverFit } from '../src/layouts.ts';

describe('layouts', () => {
  it('layout sizes', () => {
    expect(layoutSize('strip_2x6')).toEqual({ w: 600, h: 1800 });
    expect(layoutSize('print_4r')).toEqual({ w: 1200, h: 1800 });
  });

  it('strip slots', () => {
    // fixed 520x360 slots (the 4-shot size), centred vertically in the 1500-high photo area
    expect(slotsFor('strip_2x6', 1)).toEqual([{ x: 40, y: 610, w: 520, h: 360 }]);
    expect(slotsFor('strip_2x6', 2).map((s) => [s.y, s.h])).toEqual([
      [420, 360],
      [800, 360],
    ]);
    expect(slotsFor('strip_2x6', 3).map((s) => [s.y, s.h])).toEqual([
      [230, 360],
      [610, 360],
      [990, 360],
    ]);
    expect(slotsFor('strip_2x6', 4).map((s) => [s.y, s.h])).toEqual([
      [40, 360],
      [420, 360],
      [800, 360],
      [1180, 360],
    ]);
  });

  it('4R slots', () => {
    expect(slotsFor('print_4r', 2)).toEqual([
      { x: 40, y: 40, w: 1120, h: 690 },
      { x: 40, y: 750, w: 1120, h: 690 },
    ]);
    expect(slotsFor('print_4r', 3).map((s) => [s.y, s.h])).toEqual([
      [40, 453],
      [513, 453],
      [986, 453],
    ]);
    expect(slotsFor('print_4r', 4)).toEqual([
      { x: 40, y: 40, w: 550, h: 690 },
      { x: 610, y: 40, w: 550, h: 690 },
      { x: 40, y: 750, w: 550, h: 690 },
      { x: 610, y: 750, w: 550, h: 690 },
    ]);
  });

  it('print sheet placements', () => {
    expect(printSheetPlacements('strip_2x6')).toEqual([
      { x: 0, y: 0, w: 600, h: 1800 },
      { x: 600, y: 0, w: 600, h: 1800 },
    ]);
    expect(printSheetPlacements('print_4r')).toEqual([{ x: 0, y: 0, w: 1200, h: 1800 }]);
  });

  it('coverFit crops the center', () => {
    expect(coverFit({ w: 1920, h: 1080 }, { w: 520, h: 360 })).toEqual({ sx: 180, sy: 0, sw: 1560, sh: 1080 });
    expect(coverFit({ w: 1920, h: 1080 }, { w: 520, h: 1500 })).toEqual({ sx: 773, sy: 0, sw: 374, sh: 1080 });
    expect(coverFit({ w: 1080, h: 1920 }, { w: 1120, h: 690 })).toEqual({ sx: 0, sy: 628, sw: 1080, sh: 665 });
  });

  it('coverFit uses the whole source when the aspect ratios are equal', () => {
    expect(coverFit({ w: 1920, h: 1080 }, { w: 640, h: 360 })).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    expect(coverFit({ w: 600, h: 600 }, { w: 1200, h: 1200 })).toEqual({ sx: 0, sy: 0, sw: 600, sh: 600 });
  });

  it('coverFit returns the full source rect for a zero-size or invalid destination', () => {
    const full = { sx: 0, sy: 0, sw: 1920, sh: 1080 };
    expect(coverFit({ w: 1920, h: 1080 }, { w: 0, h: 0 })).toEqual(full);
    expect(coverFit({ w: 1920, h: 1080 }, { w: 520, h: 0 })).toEqual(full);
    expect(coverFit({ w: 1920, h: 1080 }, { w: -5, h: 360 })).toEqual(full);
    expect(coverFit({ w: 1920, h: 1080 }, { w: Number.NaN, h: 360 })).toEqual(full);
    expect(coverFit({ w: 1920, h: 1080 }, { w: Infinity, h: 360 })).toEqual(full);
  });

  it('coverFit returns an empty rect (never NaN) for a zero-size or invalid source', () => {
    const empty = { sx: 0, sy: 0, sw: 0, sh: 0 };
    expect(coverFit({ w: 0, h: 0 }, { w: 520, h: 360 })).toEqual(empty);
    expect(coverFit({ w: 1920, h: 0 }, { w: 520, h: 360 })).toEqual(empty);
    expect(coverFit({ w: Number.NaN, h: 1080 }, { w: 520, h: 360 })).toEqual(empty);
    expect(coverFit({ w: 0, h: 0 }, { w: 0, h: 0 })).toEqual(empty);
    for (const r of [coverFit({ w: 0, h: 0 }, { w: 1, h: 1 }), coverFit({ w: 1, h: 1 }, { w: 0, h: 0 })]) {
      expect(Object.values(r).every(Number.isFinite)).toBe(true);
    }
  });
});
