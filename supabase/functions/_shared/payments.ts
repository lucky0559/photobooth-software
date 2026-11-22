// Payment state rules shared by the webhook and cancel-payment. The store does every change as one conditional
// update (see the SQL functions in supabase/migrations/20261111000002_payment_functions.sql), so concurrent webhook
// deliveries and a cancel racing a payment can never apply twice or turn a paid payment into a cancelled one.

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled';

export interface PaymentStore {
  /** pending|failed → paid (+ session paid), atomically. */
  markPaidIfPending(intentId: string, paidAt: string): Promise<'updated' | 'not_pending' | 'not_found'>;
  getStatusByIntent(intentId: string): Promise<PaymentStatus | null>;
  /** cancelled → paid (+ session paid_after_cancel), atomically. `not_cancelled`: another delivery got there first. */
  markPaidAfterCancel(intentId: string, paidAt: string): Promise<'updated' | 'not_cancelled'>;
  /** pending|failed → cancelled (+ session cancelled) for the owning kiosk only, atomically. */
  cancelIfPending(paymentId: string, kioskId: string): Promise<'cancelled' | 'not_pending' | 'forbidden' | 'not_found'>;
  getStatus(paymentId: string): Promise<PaymentStatus | null>;
  /** Intent id, owning kiosk and status of a payment (null: no such payment). */
  getForCancel(paymentId: string): Promise<{ intentId: string; kioskId: string; status: PaymentStatus } | null>;
}

/**
 * Asks PayMongo whether the intent succeeded. Must never throw: a PayMongo problem answers false (the caller then
 * cancels as before, so an outage can never make cancel fail).
 */
export type IntentSucceeded = (intentId: string) => Promise<boolean>;

export async function applyPaidEvent(
  store: PaymentStore,
  intentId: string,
  paidAt: string,
): Promise<'marked_paid' | 'paid_after_cancel' | 'duplicate' | 'unknown_intent'> {
  const r = await store.markPaidIfPending(intentId, paidAt);
  if (r === 'updated') return 'marked_paid';
  if (r === 'not_found') return 'unknown_intent';
  const status = await store.getStatusByIntent(intentId);
  if (status === 'cancelled') {
    // Only one delivery can win this conditional update; the loser sees the row already paid.
    return (await store.markPaidAfterCancel(intentId, paidAt)) === 'updated' ? 'paid_after_cancel' : 'duplicate';
  }
  if (status === 'paid') return 'duplicate';
  throw new Error(`payment for intent is in an unexpected state: ${status}`);
}

/**
 * Never turns a paid payment into a cancelled one; calling it again gives the same answer.
 *
 * Reconciliation (R19): the webhook is not the only way to learn about a payment. Before cancelling, the owning kiosk's
 * payment intent is looked up at PayMongo (`intentSucceeded`); if it already succeeded, the payment is marked paid
 * exactly as a `payment.paid` delivery would (pending → paid; a cancelled payment → paid + session paid_after_cancel)
 * and the answer is `paid`. A lost or rejected webhook (wrong secret, unregistered endpoint) then still records the
 * money as soon as the kiosk gives up waiting.
 */
export async function cancelPayment(
  store: PaymentStore,
  paymentId: string,
  kioskId: string,
  intentSucceeded?: IntentSucceeded,
  now: string = new Date().toISOString(),
): Promise<'cancelled' | 'paid' | 'forbidden' | 'not_found'> {
  if (intentSucceeded) {
    const row = await store.getForCancel(paymentId);
    if (!row) return 'not_found';
    if (row.kioskId !== kioskId) return 'forbidden';
    if (row.status === 'paid') return 'paid';
    if (await intentSucceeded(row.intentId)) {
      if ((await applyPaidEvent(store, row.intentId, now)) !== 'unknown_intent') return 'paid';
    }
  }
  const r = await store.cancelIfPending(paymentId, kioskId);
  if (r !== 'not_pending') return r;
  const status = await store.getStatus(paymentId);
  if (status === 'paid' || status === 'cancelled') return status;
  throw new Error(`payment is in an unexpected state: ${status}`);
}
