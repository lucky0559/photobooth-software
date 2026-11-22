import { describe, expect, it } from 'vitest';
import { createPinService } from '../src/main/pin-service';
import { hashPin } from '../src/main/pin';
import { createPinThrottle } from '../src/main/pin-throttle';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from '../src/shared/bridge';

function memoryStore(initial: Partial<LocalConfig> = {}) {
  let c: LocalConfig = { ...DEFAULT_LOCAL_CONFIG, ...initial };
  return {
    get: () => c,
    update: (fn: (x: LocalConfig) => LocalConfig) => (c = fn(c)),
  };
}

const HASH_1234 = hashPin('1234');

describe('createPinService', () => {
  it('first run: sets the PIN without a current PIN and clears the staff notices', () => {
    const store = memoryStore({ recoveredFromCorruption: true, uploadsDropped: true });
    createPinService(store).set('2468', undefined);
    expect(store.get().pinHash).toMatch(/^scrypt\$/);
    expect(store.get()).toMatchObject({ recoveredFromCorruption: false, uploadsDropped: false });
  });

  it('rejects setPin without the current PIN once a PIN is set, leaving the hash unchanged', () => {
    const store = memoryStore({ pinHash: HASH_1234 });
    const pins = createPinService(store);
    expect(() => pins.set('1111', undefined)).toThrow('Current PIN is wrong');
    expect(() => pins.set('1111', '9999')).toThrow('Current PIN is wrong');
    expect(store.get().pinHash).toBe(HASH_1234);
  });

  it('changes the PIN with the correct current PIN', () => {
    const store = memoryStore({ pinHash: HASH_1234, uploadsDropped: true });
    const pins = createPinService(store);
    pins.set('5678', '1234');
    expect(store.get().pinHash).not.toBe(HASH_1234);
    expect(pins.check('5678')).toEqual({ ok: true });
    expect(store.get().uploadsDropped).toBe(false);
  });

  it('wrong current PINs count toward the same throttle as checkPin', () => {
    let t = 0;
    const store = memoryStore({ pinHash: HASH_1234 });
    const pins = createPinService(store, createPinThrottle(() => t));
    for (let i = 0; i < 4; i++) expect(pins.check('0000')).toEqual({ ok: false, retryAfterMs: null });
    expect(() => pins.set('1111', '0000')).toThrow('Too many attempts. Try again in 30 s.');
    // Locked: even the right PIN is refused, by both paths.
    expect(() => pins.set('1111', '1234')).toThrow('Too many attempts');
    expect(pins.check('1234')).toEqual({ ok: false, retryAfterMs: 30_000 });
    t += 30_000;
    expect(pins.check('1234')).toEqual({ ok: true });
    expect(store.get().pinHash).toBe(HASH_1234);
  });

  it('rejects a malformed new PIN before anything else', () => {
    const store = memoryStore();
    expect(() => createPinService(store).set('12', undefined)).toThrow('PIN must be 4 to 8 digits');
    expect(store.get().pinHash).toBeNull();
  });
});
