/** The 1200x1800 printer test page: 10 px black border and a centered "4x6 TEST" label, as JPEG. */
export async function buildTestPageJpeg(): Promise<ArrayBuffer> {
  const w = 1200;
  const h = 1800;
  const border = 10;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, border);
  ctx.fillRect(0, h - border, w, border);
  ctx.fillRect(0, 0, border, h);
  ctx.fillRect(w - border, 0, border, h);
  ctx.font = 'bold 160px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('4x6 TEST', w / 2, h / 2);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return blob.arrayBuffer();
}
