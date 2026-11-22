import type { PinCheckResult } from '../../../shared/bridge';

/** Error line for a failed PIN check (null on success). */
export function pinErrorMessage(result: PinCheckResult): string | null {
  if (result.ok) return null;
  if (result.retryAfterMs !== null && result.retryAfterMs > 0) {
    return `Too many attempts. Try again in ${Math.ceil(result.retryAfterMs / 1000)} s.`;
  }
  return 'Wrong PIN';
}
