import { describe, it, expect } from 'vitest';
import { hasPngSignature } from './png';

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
