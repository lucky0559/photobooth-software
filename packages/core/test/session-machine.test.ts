import { describe, it, expect } from 'vitest';
import { transition, DEFAULT_SETTINGS, type KioskState } from '../src/session-machine.ts';

const paid = { ...DEFAULT_SETTINGS, priceCentavos: 15000, freeMode: false, shotsPerSession: 2 as const };
const free = { ...paid, freeMode: true };

describe('transition', () => {
  it('START goes to payment when not free', () => {
    expect(transition({ name: 'attract' }, { type: 'START', sessionId: 's1', now: 0 }, paid))
      .toEqual({ name: 'payment', sessionId: 's1', amountCentavos: 15000, startedAt: 0 });
  });
  it('START skips payment in free mode', () => {
    expect(transition({ name: 'attract' }, { type: 'START', sessionId: 's1', now: 0 }, free))
      .toEqual({ name: 'capture', sessionId: 's1', amountCentavos: 0, shots: [] });
  });
  it('PAYMENT_PAID -> capture, PAYMENT_CANCELLED -> attract', () => {
    const p = { name: 'payment', sessionId: 's1', amountCentavos: 15000, startedAt: 0 } as KioskState;
    expect(transition(p, { type: 'PAYMENT_PAID' }, paid)).toEqual({ name: 'capture', sessionId: 's1', amountCentavos: 15000, shots: [] });
    expect(transition(p, { type: 'PAYMENT_CANCELLED' }, paid)).toEqual({ name: 'attract' });
  });
  it('collects shots then enters review with filter none', () => {
    let s = { name: 'capture', sessionId: 's1', amountCentavos: 0, shots: [] } as KioskState;
    s = transition(s, { type: 'SHOT_TAKEN', shotId: 'a', now: 0 }, paid);
    expect(s).toMatchObject({ name: 'capture', shots: ['a'] });
    s = transition(s, { type: 'SHOT_TAKEN', shotId: 'b', now: 0 }, paid);
    expect(s).toMatchObject({ name: 'review', shots: ['a', 'b'], filter: 'none', enteredAt: 0 });
  });
  it('CAMERA_ERROR keeps the session and shots; CAMERA_RETRY clears the error', () => {
    const s = { name: 'capture', sessionId: 's1', amountCentavos: 15000, shots: ['a'] } as KioskState;
    const e = transition(s, { type: 'CAMERA_ERROR' }, paid);
    expect(e).toEqual({ ...s, error: 'camera_unavailable' });
    expect(transition(e, { type: 'CAMERA_RETRY' }, paid)).toEqual(s);
  });
  it('review auto-confirms after 60s', () => {
    const r = { name: 'review', sessionId: 's1', amountCentavos: 0, shots: ['a'], filter: 'bw', enteredAt: 1000 } as KioskState;
    expect(transition(r, { type: 'TICK', now: 60_999 }, paid)).toBe(r);
    expect(transition(r, { type: 'TICK', now: 61_000 }, paid)).toMatchObject({ name: 'output', filter: 'bw' });
  });
  it('delivery returns to attract after 45s', () => {
    const d = { name: 'delivery', sessionId: 's1', printError: null, enteredAt: 0 } as KioskState;
    expect(transition(d, { type: 'TICK', now: 44_999 }, paid)).toBe(d);
    expect(transition(d, { type: 'TICK', now: 45_000 }, paid)).toEqual({ name: 'attract' });
  });
  it('ignores events that do not apply (same reference)', () => {
    const a = { name: 'attract' } as KioskState;
    expect(transition(a, { type: 'SHOT_TAKEN', shotId: 'x', now: 0 }, paid)).toBe(a);
  });
});
