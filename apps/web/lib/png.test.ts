import { describe, it, expect } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { hasPngSignature, pngHasTransparency } from './png';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Tiny 2×2 PNG of the given IHDR colour type, with optional extra chunks before IDAT (and after it). */
function png(colorType: number, before: Buffer[] = [], after: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 4;
  const raw = Buffer.alloc((2 * channels + 1) * 2);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...before,
    chunk('IDAT', deflateSync(raw)),
    ...after,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PLTE = chunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255]));
const TRNS_PALETTE = chunk('tRNS', Buffer.from([0]));
const TRNS_RGB = chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 0]));

describe('hasPngSignature', () => {
  it('accepts the PNG magic number', () => {
    expect(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(true);
  });
  it('rejects JPEG, truncated and empty input', () => {
    expect(hasPngSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false);
    expect(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(hasPngSignature(new Uint8Array([]))).toBe(false);
  });
});

describe('pngHasTransparency', () => {
  it('accepts RGBA and grey+alpha', () => {
    expect(pngHasTransparency(png(6))).toBe(true);
    expect(pngHasTransparency(png(4))).toBe(true);
  });
  it('rejects opaque RGB, grey and palette without tRNS', () => {
    expect(pngHasTransparency(png(2))).toBe(false);
    expect(pngHasTransparency(png(0))).toBe(false);
    expect(pngHasTransparency(png(3, [PLTE]))).toBe(false);
  });
  it('accepts any colour type with a tRNS chunk before IDAT', () => {
    expect(pngHasTransparency(png(3, [PLTE, TRNS_PALETTE]))).toBe(true);
    expect(pngHasTransparency(png(2, [TRNS_RGB]))).toBe(true);
  });
  it('ignores a tRNS chunk after IDAT (invalid placement)', () => {
    expect(pngHasTransparency(png(2, [], [TRNS_RGB]))).toBe(false);
  });
  it('rejects non-PNG, truncated and malformed input', () => {
    expect(pngHasTransparency(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(pngHasTransparency(png(6).subarray(0, 20))).toBe(false);
    const badFirstChunk = Buffer.concat([SIGNATURE, chunk('tEXt', Buffer.from('x')), png(6).subarray(8)]);
    expect(pngHasTransparency(badFirstChunk)).toBe(false); // IHDR must come first
    const hugeLength = png(2, [TRNS_RGB]);
    hugeLength.writeUInt32BE(0xffffffff, 33); // first chunk after IHDR claims 4 GB
    expect(pngHasTransparency(hugeLength)).toBe(false);
  });
});
