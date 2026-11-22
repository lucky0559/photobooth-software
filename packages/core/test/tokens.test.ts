import { describe, it, expect } from 'vitest';
import { newDownloadToken } from '../src/tokens.ts';

describe('newDownloadToken', () => {
  it('22-char base64url and unique', () => {
    const a = newDownloadToken(), b = newDownloadToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});
