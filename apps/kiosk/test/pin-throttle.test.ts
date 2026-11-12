import { describe, expect, it } from 'vitest';
import { createPinThrottle, PIN_FREE_ATTEMPTS } from '../src/main/pin-throttle';

function setup() {
  let t = 1_000_000;
  const throttle = createPinThrottle(() => t);
  return { throttle, advance: (ms: number) => (t += ms) };
}

const S = 1000;

describe('createPinThrottle', () => {
  it('allows the first 4 wrong PINs, then locks for 30 s on the 5th', () => {
    const { throttle } = setup();
    expect(PIN_FREE_ATTEMPTS).toBe(5);
    for (let i = 0; i < 4; i++) {
      expect(throttle.retryAfterMs()).toBe(0);
      expect(throttle.recordFailure()).toBe(0);
    }
    expect(throttle.recordFailure()).toBe(30 * S);
    expect(throttle.retryAfterMs()).toBe(30 * S);
  });

  it('counts the lockout down and lifts it after 30 s', () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 5; i++) throttle.recordFailure();
    advance(10 * S);
    expect(throttle.retryAfterMs()).toBe(20 * S);
    advance(20 * S - 1);
    expect(throttle.retryAfterMs()).toBe(1);
    advance(1);
    expect(throttle.retryAfterMs()).toBe(0);
  });

  it('doubles the lockout for every further wrong PIN, capped at 5 minutes', () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 4; i++) throttle.recordFailure();
    const locks: number[] = [];
    for (let i = 0; i < 7; i++) {
      const ms = throttle.recordFailure();
      locks.push(ms);
      advance(ms);
    }
    expect(locks).toEqual([30 * S, 60 * S, 120 * S, 240 * S, 300 * S, 300 * S, 300 * S]);
  });

  it('resets after a correct PIN', () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 5; i++) throttle.recordFailure();
    advance(30 * S);
    throttle.recordSuccess();
    for (let i = 0; i < 4; i++) expect(throttle.recordFailure()).toBe(0);
    expect(throttle.recordFailure()).toBe(30 * S);
  });

  it('a clock that jumps backwards never extends a lockout past its length', () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 5; i++) throttle.recordFailure();
    advance(-3_600_000);
    expect(throttle.retryAfterMs()).toBeLessThanOrEqual(30 * S);
  });
});
