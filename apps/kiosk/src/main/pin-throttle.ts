/** Wrong PINs allowed before the first lockout. */
export const PIN_FREE_ATTEMPTS = 5;
const FIRST_LOCK_MS = 30_000;
const MAX_LOCK_MS = 5 * 60_000;

export interface PinThrottle {
  /** ms until the next attempt is allowed (0 = allowed now). */
  retryAfterMs(): number;
  /** Records a wrong PIN; returns the lockout it starts (0 = none). */
  recordFailure(): number;
  recordSuccess(): void;
}

/**
 * Brute-force guard for the admin PIN, kept in main-process memory (never in the renderer).
 * The 5th consecutive wrong PIN locks for 30 s; each further wrong PIN doubles it (60 s, 120 s, ...)
 * up to 5 min. A correct PIN resets everything.
 */
export function createPinThrottle(now: () => number = Date.now): PinThrottle {
  let failures = 0;
  let lockedAt = 0;
  let lockMs = 0;
  return {
    retryAfterMs() {
      if (lockMs === 0) return 0;
      // Clamp so a clock jumping backwards cannot stretch a lockout.
      const elapsed = Math.max(0, now() - lockedAt);
      return Math.min(lockMs, Math.max(0, lockMs - elapsed));
    },
    recordFailure() {
      failures += 1;
      if (failures < PIN_FREE_ATTEMPTS) return 0;
      lockMs = Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** (failures - PIN_FREE_ATTEMPTS));
      lockedAt = now();
      return lockMs;
    },
    recordSuccess() {
      failures = 0;
      lockMs = 0;
    },
  };
}
