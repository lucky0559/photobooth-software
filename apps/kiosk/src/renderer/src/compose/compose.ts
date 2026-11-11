import { coverFit, layoutSize, printSheetPlacements, SHEET, slotsFor, type FilterId, type LayoutId, type ShotCount } from '@pb/core';
import { filterCss } from './filters';

export interface ComposeInput {
  layout: LayoutId;
  shots: ImageBitmap[];
  overlay: ImageBitmap;
  filter: FilterId;
}

const JPEG_QUALITY = 0.92;

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/** Renders the layout canvas: white background, filtered shots cover-fitted into their slots, overlay on top. */
export function composeLayout({ layout, shots, overlay, filter }: ComposeInput): OffscreenCanvas {
  const n = shots.length;
  if (n < 1 || n > 4) throw new Error(`Expected 1–4 shots, got ${n}`);
  const { w, h } = layoutSize(layout);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  slotsFor(layout, n as ShotCount).forEach((slot, i) => {
    const shot = shots[i] as ImageBitmap;
    const { sx, sy, sw, sh } = coverFit({ w: shot.width, h: shot.height }, slot);
    ctx.filter = filterCss(filter);
    ctx.drawImage(shot, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
    ctx.filter = 'none';
  });
  ctx.drawImage(overlay, 0, 0, w, h);
  return canvas;
}

/** The 1200×1800 print sheet: the layout canvas drawn at each print placement, as JPEG q0.92. */
export function composeSheet(input: ComposeInput): Promise<Blob> {
  const layoutCanvas = composeLayout(input);
  const sheet = new OffscreenCanvas(SHEET.w, SHEET.h);
  const ctx = context2d(sheet);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  for (const r of printSheetPlacements(input.layout)) ctx.drawImage(layoutCanvas, r.x, r.y, r.w, r.h);
  return sheet.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
