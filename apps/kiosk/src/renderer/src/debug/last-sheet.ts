// e2e-only: the last composed print sheet, read by `window.__pbDebug`. Call sites are gated on
// `import.meta.env.VITE_FAKE_API === '1'`, so production builds drop this module.

type Rgba = [number, number, number, number];

let last: Blob | null = null;

export function recordSheet(blob: Blob): void {
  last = blob;
}

export async function lastSheetInfo(): Promise<{ width: number; height: number; type: string } | null> {
  if (!last) return null;
  const bmp = await createImageBitmap(last);
  const info = { width: bmp.width, height: bmp.height, type: last.type };
  bmp.close();
  return info;
}

export async function lastSheetPixel(x: number, y: number): Promise<Rgba | null> {
  if (!last) return null;
  const bmp = await createImageBitmap(last);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(x, y, 1, 1).data;
  return [r, g, b, a];
}
