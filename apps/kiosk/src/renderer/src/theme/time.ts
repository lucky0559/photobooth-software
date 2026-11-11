import { useEffect, useState } from 'react';

/** `m:ss`, rounding up so a fresh 60 s deadline reads 1:00 and the pill hits 0:00 only at the deadline. */
export function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Milliseconds left until `deadline`, re-rendering once a second. Display only: the state machine's
 * TICK owns the actual timeout, this never dispatches anything.
 */
export function useRemainingMs(deadline: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, deadline - now);
}
