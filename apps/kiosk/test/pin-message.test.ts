import { describe, expect, it } from 'vitest';
import { pinErrorMessage } from '../src/renderer/src/screens/pin-message';

describe('pinErrorMessage', () => {
  it('is null on success', () => {
    expect(pinErrorMessage({ ok: true })).toBeNull();
  });

  it('says Wrong PIN without a lockout', () => {
    expect(pinErrorMessage({ ok: false, retryAfterMs: null })).toBe('Wrong PIN');
  });

  it('shows the lockout in whole seconds, rounded up', () => {
    expect(pinErrorMessage({ ok: false, retryAfterMs: 30_000 })).toBe('Too many attempts. Try again in 30 s.');
    expect(pinErrorMessage({ ok: false, retryAfterMs: 1 })).toBe('Too many attempts. Try again in 1 s.');
    expect(pinErrorMessage({ ok: false, retryAfterMs: 299_001 })).toBe('Too many attempts. Try again in 300 s.');
  });
});
