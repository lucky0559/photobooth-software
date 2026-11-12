const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True if the bytes start with the 8-byte PNG signature (the client's mime type and filename are never trusted). */
export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * True if the PNG can carry transparency: IHDR colour type 4 (grey + alpha) or 6 (RGBA), or a `tRNS`
 * chunk before the first IDAT (palette / grey / RGB with a transparent colour). Walks chunk headers
 * only (no decoding); anything malformed counts as "no".
 */
export function pngHasTransparency(bytes: Uint8Array): boolean {
  if (!hasPngSignature(bytes)) return false;
  // IHDR must be first: length 13 at byte 8, type at 12, colour type at 8 + 8 + 9 = 25.
  if (bytes.length < 33 || u32(bytes, 8) !== 13 || chunkType(bytes, 12) !== 'IHDR') return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;

  let at = 33; // after IHDR (8 signature + 8 header + 13 data + 4 crc)
  while (at + 8 <= bytes.length) {
    const length = u32(bytes, at);
    const next = at + 12 + length;
    if (next > bytes.length) return false; // chunk runs past the end: malformed
    const type = chunkType(bytes, at + 4);
    if (type === 'IDAT' || type === 'IEND') return false;
    if (type === 'tRNS') return true;
    at = next;
  }
  return false;
}
