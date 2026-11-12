'use client';

import { useActionState, useState } from 'react';
import type { Result } from '@pb/core';
import { markRefunded, undoRefund } from './refund-actions';

/**
 * "Mark refunded" with an inline confirmation step, or "Undo" for a payment already marked (R20). The page re-renders
 * after a successful action (revalidatePath), which moves the row between the two lists.
 */
export function RefundButton({ paymentId, mode }: { paymentId: string; mode: 'mark' | 'undo' }) {
  const [confirming, setConfirming] = useState(false);
  const [state, run, pending] = useActionState<Result<true> | null, void>(
    () => (mode === 'mark' ? markRefunded(paymentId) : undoRefund(paymentId)),
    null,
  );
  const error = state && !state.ok ? Object.values(state.errors)[0] : null;
  const errorId = `refund-${paymentId}-error`;

  return (
    <div className="refund-action">
      {mode === 'undo' ? (
        <form aria-describedby={error ? errorId : undefined}>
          <button type="submit" className="btn" disabled={pending} formAction={() => run()}>
            Undo
          </button>
        </form>
      ) : confirming ? (
        <form className="actions" aria-describedby={error ? errorId : undefined}>
          <span className="refund-confirm-text">Refunded this payment in PayMongo?</span>
          <button type="submit" className="btn btn-primary" disabled={pending} formAction={() => run()}>
            Yes, mark refunded
          </button>
          <button type="button" className="btn" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setConfirming(true)}>
          Mark refunded
        </button>
      )}
      {error && (
        <p id={errorId} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
