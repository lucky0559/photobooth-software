import type { KioskApi } from '../api/kiosk-api';

/** Payment status poll interval (plan: every 2 s). */
export const POLL_MS = 2_000;
/** Delay between `cancelPayment` retries after it throws. */
export const CANCEL_RETRY_MS = 2_000;
/** Retries after the first failed `cancelPayment` before giving up (the late webhook then flags the row). */
export const CANCEL_RETRIES = 15;
/** How long "Payments are unavailable" stays up before returning to attract. */
export const UNAVAILABLE_MS = 10_000;

export type CreatedPayment = Awaited<ReturnType<KioskApi['createPayment']>>;

/** `unavailable`: createPayment failed. `checking`: a cancel attempt threw and is being retried. */
export type PaymentFlowStatus = 'unavailable' | 'checking';

export interface PaymentFlowOptions {
  api: Pick<KioskApi, 'getPaymentStatus' | 'cancelPayment'>;
  /** The (deduplicated) createPayment call, see `createPaymentOnce`. */
  payment: Promise<CreatedPayment>;
  /** Absolute ms (payment `startedAt + PAYMENT_TIMEOUT_MS`), so a remount never extends the timeout. */
  deadline: number;
  onReady(payment: CreatedPayment): void;
  onStatus(status: PaymentFlowStatus): void;
  onPaid(): void;
  onCancelled(): void;
}

export interface PaymentFlow {
  /** Guest tapped Cancel. Safe to call repeatedly. */
  cancel(): void;
  /** Stops every timer; no callback fires afterwards. */
  dispose(): void;
}

/**
 * Runs one payment: polls every 2 s, and on Cancel or at the deadline asks the server to cancel and follows its
 * answer (`paid` wins: the guest paid at the last second). The poll keeps running while a cancel is in flight or
 * being retried; whichever reports first decides. Exactly one of `onPaid`/`onCancelled` fires, at most once.
 */
export function startPaymentFlow(o: PaymentFlowOptions): PaymentFlow {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let finished = false;
  let cancelling = false;
  let paymentId: string | null = null;

  const later = (fn: () => void, ms: number): void => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const stop = (): void => {
    finished = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  const finish = (outcome: 'paid' | 'cancelled'): void => {
    if (finished) return;
    stop();
    if (outcome === 'paid') o.onPaid();
    else o.onCancelled();
  };

  const poll = (id: string): void => {
    later(() => {
      o.api.getPaymentStatus(id).then(
        (status) => {
          if (finished) return;
          if (status === 'paid') {
            finish('paid');
            return;
          }
          poll(id);
          // Backstop for a deadline timer that fired late (e.g. timers paused while the machine slept).
          if (Date.now() >= o.deadline) cancel();
        },
        (err: unknown) => {
          if (finished) return;
          console.warn('Payment status poll failed', err);
          poll(id);
          if (Date.now() >= o.deadline) cancel();
        },
      );
    }, POLL_MS);
  };

  const attemptCancel = (id: string, retry: number): void => {
    o.api.cancelPayment(id).then(
      (result) => finish(result),
      (err: unknown) => {
        if (finished) return;
        console.warn(`cancelPayment failed (attempt ${retry + 1})`, err);
        if (retry >= CANCEL_RETRIES) {
          // Server row stays awaiting_payment; a late webhook marks it paid_after_cancel for staff.
          finish('cancelled');
          return;
        }
        o.onStatus('checking');
        later(() => attemptCancel(id, retry + 1), CANCEL_RETRY_MS);
      },
    );
  };

  const cancel = (): void => {
    if (finished || cancelling) return;
    cancelling = true;
    if (paymentId === null) {
      // No QR was ever shown, so nobody can have paid: leave now and void the intent when it arrives.
      finish('cancelled');
      return;
    }
    attemptCancel(paymentId, 0);
  };

  let disposed = false;
  o.payment.then(
    (p) => {
      if (disposed) return;
      if (finished) {
        // Cancelled or timed out while creating: void the late intent in the background.
        o.api.cancelPayment(p.paymentId).catch((err: unknown) => console.warn('Voiding late payment failed', err));
        return;
      }
      paymentId = p.paymentId;
      o.onReady(p);
      poll(p.paymentId);
    },
    (err: unknown) => {
      if (finished) return;
      console.error('createPayment failed', err);
      o.onStatus('unavailable');
      later(() => finish('cancelled'), UNAVAILABLE_MS);
    },
  );

  later(cancel, Math.max(0, o.deadline - Date.now()));

  return {
    cancel,
    dispose: () => {
      disposed = true;
      stop();
    },
  };
}

let created: { sessionId: string; promise: Promise<CreatedPayment> } | null = null;

/**
 * One createPayment per session, even when React StrictMode double-runs the effect or the screen remounts: a
 * second call would create a second PayMongo intent. A failed creation is not retried for the same session.
 */
export function createPaymentOnce(sessionId: string, create: () => Promise<CreatedPayment>): Promise<CreatedPayment> {
  if (created?.sessionId !== sessionId) created = { sessionId, promise: create() };
  return created.promise;
}
