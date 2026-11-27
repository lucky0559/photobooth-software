import { layoutSize, printSheetPlacements, type LayoutId } from '@pb/core';
import sampleStripDataUrl from '../assets/sample-strip.png?inline';

function decodePngDataUrl(dataUrl: string): ArrayBuffer {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Bundled sample strip is not a PNG data URL');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const sampleStripPng = decodePngDataUrl(sampleStripDataUrl);

/** The project Sample strip overlay; 4R demo sheets use two strips side by side. */
export async function renderDemoOverlay(layout: LayoutId): Promise<ArrayBuffer> {
  if (layout === 'strip_2x6') return sampleStripPng.slice(0);

  const strip = await createImageBitmap(new Blob([new Uint8Array(sampleStripPng)], { type: 'image/png' }));
  try {
    const { w, h } = layoutSize(layout);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    for (const placement of printSheetPlacements('strip_2x6')) {
      ctx.drawImage(strip, placement.x, placement.y, placement.w, placement.h);
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  } finally {
    strip.close();
  }
}
