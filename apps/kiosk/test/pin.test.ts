import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from '../src/main/pin';

describe('pin', () => {
  it('verifies the right PIN only', () => {
    const h = hashPin('2468');
    expect(h).toMatch(/^scrypt\$/);
    expect(verifyPin('2468', h)).toBe(true);
    expect(verifyPin('2469', h)).toBe(false);
    expect(hashPin('2468')).not.toBe(h); // random salt
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPin('2468', '')).toBe(false);
    expect(verifyPin('2468', 'scrypt$abc')).toBe(false);
    expect(verifyPin('2468', 'bcrypt$AAAA$AAAA')).toBe(false);
    expect(verifyPin('2468', 'scrypt$AAAA$AAAA')).toBe(false);
  });
});
