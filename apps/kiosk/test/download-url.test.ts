import { describe, expect, it } from 'vitest';
import { downloadUrl } from '../src/renderer/src/screens/download-url';

describe('downloadUrl', () => {
  it('joins an absolute http(s) base and the token', () => {
    expect(downloadUrl('https://photos.example.com', 'tok')).toBe('https://photos.example.com/d/tok');
    expect(downloadUrl('https://photos.example.com/', 'tok')).toBe('https://photos.example.com/d/tok');
    expect(downloadUrl('http://localhost:3000', 'tok')).toBe('http://localhost:3000/d/tok');
  });
  it.each([undefined, '', '   ', '/app', 'photos.example.com', 'ftp://x.com', 'javascript:alert(1)'])(
    'returns null for a missing or relative base %j',
    (base) => {
      expect(downloadUrl(base, 'tok')).toBeNull();
    },
  );
});
