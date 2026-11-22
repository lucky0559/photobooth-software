import { layoutSize, type LayoutId } from '@pb/core';

const FOOTER_PX = 220;

/** Transparent PNG of the layout canvas with a "TRIAL" footer band. Browser-only (OffscreenCanvas); call, don't import-time run. */
export async function renderDemoOverlay(layout: LayoutId): Promise<ArrayBuffer> {
  const { w, h } = layoutSize(layout);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#495057';
  ctx.fillRect(0, h - FOOTER_PX, w, FOOTER_PX);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TRIAL', w / 2, h - FOOTER_PX / 2 + 22);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}
