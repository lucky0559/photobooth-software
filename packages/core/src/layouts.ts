import type { LayoutId, Rect, ShotCount } from './types.ts';

export const SHEET = { w: 1200, h: 1800 } as const;

const PADDING = 40;
const GAP = 20;
const STRIP = { w: 600, h: 1800, footer: 260 } as const;
const PRINT_4R = { w: 1200, h: 1800, footer: 360 } as const;

export function layoutSize(layout: LayoutId): { w: number; h: number } {
  const c = layout === 'strip_2x6' ? STRIP : PRINT_4R;
  return { w: c.w, h: c.h };
}

function stacked(canvas: { w: number; h: number; footer: number }, n: number): Rect[] {
  const usable = canvas.h - PADDING - canvas.footer;
  const slotH = Math.floor((usable - GAP * (n - 1)) / n);
  const slotW = canvas.w - PADDING * 2;
  return Array.from({ length: n }, (_, i) => ({
    x: PADDING,
    y: PADDING + i * (slotH + GAP),
    w: slotW,
    h: slotH,
  }));
}

/**
 * Strip slots keep one fixed size (the 4-shot size, close to the camera's landscape frame) whatever the shot count, so
 * 1-3 shots are not stretched tall and cropped. They are centred vertically in the photo area above the footer.
 */
function stripSlots(n: number): Rect[] {
  const usable = STRIP.h - PADDING - STRIP.footer;
  const slotH = Math.floor((usable - GAP * 3) / 4);
  const total = slotH * n + GAP * (n - 1);
  const top = PADDING + Math.floor((usable - total) / 2);
  return Array.from({ length: n }, (_, i) => ({ x: PADDING, y: top + i * (slotH + GAP), w: STRIP.w - PADDING * 2, h: slotH }));
}

export function slotsFor(layout: LayoutId, shots: ShotCount): Rect[] {
  if (layout === 'strip_2x6') return stripSlots(shots);
  if (shots < 4) return stacked(PRINT_4R, shots);
  const usable = PRINT_4R.h - PADDING - PRINT_4R.footer;
  const w = (PRINT_4R.w - PADDING * 2 - GAP) / 2;
  const h = (usable - GAP) / 2;
  return [0, 1, 2, 3].map((i) => ({
    x: PADDING + (i % 2) * (w + GAP),
    y: PADDING + Math.floor(i / 2) * (h + GAP),
    w,
    h,
  }));
}

export function printSheetPlacements(layout: LayoutId): Rect[] {
  if (layout === 'print_4r') return [{ x: 0, y: 0, w: SHEET.w, h: SHEET.h }];
  return [
    { x: 0, y: 0, w: STRIP.w, h: STRIP.h },
    { x: STRIP.w, y: 0, w: STRIP.w, h: STRIP.h },
  ];
}

export function coverFit(
  src: { w: number; h: number },
  dst: { w: number; h: number },
): { sx: number; sy: number; sw: number; sh: number } {
  const valid = (n: number) => Number.isFinite(n) && n > 0;
  // Nothing to crop from: an empty rect (drawImage with a zero-size source draws nothing).
  if (!valid(src.w) || !valid(src.h)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  // No usable destination aspect: take the whole source rather than computing NaN.
  if (!valid(dst.w) || !valid(dst.h)) return { sx: 0, sy: 0, sw: src.w, sh: src.h };
  const scale = Math.max(dst.w / src.w, dst.h / src.h);
  const sw = Math.round(dst.w / scale);
  const sh = Math.round(dst.h / scale);
  return { sx: Math.round((src.w - sw) / 2), sy: Math.round((src.h - sh) / 2), sw, sh };
}
