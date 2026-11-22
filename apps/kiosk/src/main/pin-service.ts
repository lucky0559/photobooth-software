import { PIN_PATTERN, type LocalConfig, type PinCheckResult } from '../shared/bridge';
import type { JsonStore } from './json-store';
import { hashPin, verifyPin } from './pin';
import { createPinThrottle, type PinThrottle } from './pin-throttle';

export interface PinService {
  check(pin: unknown): PinCheckResult;
  /** Sets the PIN; once one is set, `currentPin` must match it. Throws on refusal (hash unchanged). */
  set(pin: unknown, currentPin: unknown): void;
}

/** PIN checks and changes, sharing one wrong-PIN throttle kept in main-process memory. */
export function createPinService(
  store: Pick<JsonStore<LocalConfig>, 'get' | 'update'>,
  throttle: PinThrottle = createPinThrottle(),
): PinService {
  const check = (pin: unknown): PinCheckResult => {
    const locked = throttle.retryAfterMs();
    if (locked > 0) return { ok: false, retryAfterMs: locked };
    const stored = store.get().pinHash;
    if (typeof pin === 'string' && stored !== null && verifyPin(pin, stored)) {
      throttle.recordSuccess();
      return { ok: true };
    }
    const lock = throttle.recordFailure();
    return { ok: false, retryAfterMs: lock > 0 ? lock : null };
  };

  return {
    check,
    set(pin, currentPin) {
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
      // First run only without the current PIN: a compromised renderer cannot reset an existing PIN.
      if (store.get().pinHash !== null) {
        const r = check(currentPin);
        if (!r.ok) {
          throw new Error(
            r.retryAfterMs ? `Too many attempts. Try again in ${Math.ceil(r.retryAfterMs / 1000)} s.` : 'Current PIN is wrong',
          );
        }
      }
      // Finishing Setup (which always sets the PIN) clears the staff notices.
      store.update((c) => ({ ...c, pinHash: hashPin(pin), recoveredFromCorruption: false, uploadsDropped: false }));
    },
  };
}
