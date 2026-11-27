import { coverFit, layoutSize, printSheetPlacements, SHEET, slotsFor, type FilterId, type LayoutId, type ShotCount } from '@pb/core';
import { filterCss } from './filters';

export interface ComposeInput {
  layout: LayoutId;
  shots: ImageBitmap[];
  overlay: ImageBitmap;
  filter: FilterId;
}

const JPEG_QUALITY = 0.92;
let canvasFiltersSupported: boolean | null = null;

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

function supportsCanvasFilters(): boolean {
  if (canvasFiltersSupported !== null) return canvasFiltersSupported;
  try {
    const probe = new OffscreenCanvas(1, 1);
    const ctx = context2d(probe);
    ctx.filter = 'grayscale(1)';
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    canvasFiltersSupported = Math.abs(r! - g!) < 2 && Math.abs(g! - b!) < 2;
  } catch {
    canvasFiltersSupported = false;
  }
  return canvasFiltersSupported;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Applies the existing CSS filter sequence to one RGBA pixel when canvas filters are unavailable. */
export function applyFilterPixels(data: Uint8ClampedArray, filter: FilterId): void {
  if (filter === 'none') return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]! / 255;
    let g = data[i + 1]! / 255;
    let b = data[i + 2]! / 255;
    if (filter === 'bw') {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = clamp01((gray - 0.5) * 1.1 + 0.5);
      g = r;
      b = r;
    } else if (filter === 'warm') {
      const sepiaR = 0.393 * r + 0.769 * g + 0.189 * b;
      const sepiaG = 0.349 * r + 0.686 * g + 0.168 * b;
      const sepiaB = 0.272 * r + 0.534 * g + 0.131 * b;
      r = r * 0.75 + sepiaR * 0.25;
      g = g * 0.75 + sepiaG * 0.25;
      b = b * 0.75 + sepiaB * 0.25;
      const luma = 0.213 * r + 0.715 * g + 0.072 * b;
      r = clamp01((luma + (r - luma) * 1.2) * 1.03);
      g = clamp01((luma + (g - luma) * 1.2) * 1.03);
      b = clamp01((luma + (b - luma) * 1.2) * 1.03);
    }
    data[i] = Math.round(clamp01(r) * 255);
    data[i + 1] = Math.round(clamp01(g) * 255);
    data[i + 2] = Math.round(clamp01(b) * 255);
  }
}

function drawFilteredSlot(
  output: OffscreenCanvasRenderingContext2D,
  shot: ImageBitmap,
  source: { sx: number; sy: number; sw: number; sh: number },
  slot: { x: number; y: number; w: number; h: number },
  filter: FilterId,
): void {
  if (filter === 'none' || supportsCanvasFilters()) {
    output.filter = filterCss(filter);
    output.drawImage(shot, source.sx, source.sy, source.sw, source.sh, slot.x, slot.y, slot.w, slot.h);
    output.filter = 'none';
    return;
  }
  const tile = new OffscreenCanvas(slot.w, slot.h);
  const ctx = context2d(tile);
  ctx.drawImage(shot, source.sx, source.sy, source.sw, source.sh, 0, 0, slot.w, slot.h);
  const pixels = ctx.getImageData(0, 0, slot.w, slot.h);
  applyFilterPixels(pixels.data, filter);
  ctx.putImageData(pixels, 0, 0);
  output.drawImage(tile, slot.x, slot.y);
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
    const source = coverFit({ w: shot.width, h: shot.height }, slot);
    drawFilteredSlot(ctx, shot, source, slot, filter);
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

/** One 600×1800 strip as JPEG q0.92: the layout canvas on its own, for pairing on a shared sheet later. */
export function composeStrip(input: ComposeInput): Promise<Blob> {
  return composeLayout(input).convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

/** The 1200×1800 shared sheet: `left` on the left half, `right` on the right half (left white when `null`). */
export function composePairSheet(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob> {
  const sheet = new OffscreenCanvas(SHEET.w, SHEET.h);
  const ctx = context2d(sheet);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  const [l, r] = printSheetPlacements('strip_2x6');
  ctx.drawImage(left, l!.x, l!.y, l!.w, l!.h);
  if (right) ctx.drawImage(right, r!.x, r!.y, r!.w, r!.h);
  return sheet.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
