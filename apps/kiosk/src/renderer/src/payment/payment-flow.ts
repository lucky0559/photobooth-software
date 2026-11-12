import type { KioskApi } from '../api/kiosk-api';

/** Payment status poll interval (plan: every 2 s). */
export const POLL_MS = 2_000;
/** Delay between `cancelPayment` retries after it throws or times out. */
export const CANCEL_RETRY_MS = 2_000;
/** Retries after the first failed `cancelPayment` before giving up (the row stays pending on the server; if the guest later pays it lands as `paid` and never `completed`, which the admin dashboard lists as "paid and not completed after 10 min", the refund signal). */
export const CANCEL_RETRIES = 15;
/** How long "Payments are unavailable" stays up before returning to attract. */
export const UNAVAILABLE_MS = 10_000;
/** A `getPaymentStatus`/`cancelPayment` call with no answer by then counts as failed (venue Wi-Fi can stall). */
export const CALL_TIMEOUT_MS = 8_000;
/** A `createPayment` with no answer by then counts as failed ("Payments are unavailable"). */
export const CREATE_TIMEOUT_MS = 15_000;

export type CreatedPayment = Awaited<ReturnType<KioskApi['createPayment']>>;

/** `unavailable`: createPayment failed. `checking`: a cancel attempt failed and is being retried. */
export type PaymentFlowStatus = 'unavailable' | 'checking';

export interface PaymentFlowOptions {
  api: Pick<KioskApi, 'getPaymentStatus' | 'cancelPayment'>;
  /** The (deduplicated) createPayment call, see `createPaymentOnce`. */
  payment: Promise<CreatedPayment>;
  /** Absolute ms (payment `startedAt + PAYMENT_TIMEOUT_MS`), so a remount never extends the timeout. */
  deadline: number;
  onReady(payment: CreatedPayment): void;
  onStatus(status: PaymentFlowStatus): void;
  /** `amountCentavos` is the server's amount when createPayment resolved, else undefined (keep the local one). */
  onPaid(amountCentavos?: number): void;
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
 * Every API call is raced against a timeout, so a stalled request can never trap the kiosk on this screen.
 */
export function startPaymentFlow(o: PaymentFlowOptions): PaymentFlow {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let finished = false;
  let cancelling = false;
  let paymentId: string | null = null;
  let serverAmount: number | undefined;
  /** Creation still pending (or timed out) when the flow ended: cancel the intent if it ever arrives. */
  let voidOnArrival = false;

  const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const clear = (id: ReturnType<typeof setTimeout>): void => {
    clearTimeout(id);
    timers.delete(id);
  };

  /** `p`, or a rejection after `ms`. A late settlement of `p` is dropped (p stays handled: no unhandled rejection). */
  const timed = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = later(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      p.then(
        (v) => {
          clear(id);
          resolve(v);
        },
        (err: unknown) => {
          clear(id);
          reject(err);
        },
      );
    });

  const stop = (): void => {
    finished = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  const finish = (outcome: 'paid' | 'cancelled'): void => {
    if (finished) return;
    stop();
    if (outcome === 'paid') o.onPaid(serverAmount);
    else o.onCancelled();
  };

  const poll = (id: string): void => {
    later(() => {
      timed(o.api.getPaymentStatus(id), CALL_TIMEOUT_MS, 'getPaymentStatus').then(
        (status) => {
          if (finished) return;
          if (status === 'paid') {
            finish('paid');
            return;
          }
          poll(id);
          // `cancelled` server-side: the QR is dead, so ask the server and follow its answer.
          // `failed` keeps the QR up: a QR Ph intent can still be paid.
          if (status === 'cancelled') cancel();
          // Backstop for a deadline timer that fired late (e.g. timers paused while the machine slept).
          else if (Date.now() >= o.deadline) cancel();
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
    const call = o.api.cancelPayment(id);
    // Any answer decides, even one that arrives after its timeout while retries are going (finish() is latched).
    call.then(finish, () => undefined);
    timed(call, CALL_TIMEOUT_MS, 'cancelPayment').catch((err: unknown) => {
      if (finished) return;
      console.warn(`cancelPayment failed (attempt ${retry + 1})`, err);
      if (retry >= CANCEL_RETRIES) {
        // The row stays pending on the server; a later payment lands as `paid`, never `completed` (refund signal).
        finish('cancelled');
        return;
      }
      o.onStatus('checking');
      later(() => attemptCancel(id, retry + 1), CANCEL_RETRY_MS);
    });
  };

  function cancel(): void {
    if (finished || cancelling) return;
    cancelling = true;
    if (paymentId === null) {
      // No QR was ever shown, so nobody can have paid: leave now and void the intent when it arrives.
      voidOnArrival = true;
      finish('cancelled');
      return;
    }
    attemptCancel(paymentId, 0);
  }

  const createTimeout = later(() => {
    voidOnArrival = true;
    createFailed(new Error(`createPayment timed out after ${CREATE_TIMEOUT_MS} ms`));
  }, CREATE_TIMEOUT_MS);

  function createFailed(err: unknown): void {
    if (finished) return;
    console.error('createPayment failed', err);
    o.onStatus('unavailable');
    later(() => finish('cancelled'), UNAVAILABLE_MS);
  }

  o.payment.then(
    (p) => {
      // Checked before `finished`: this runs even after the screen unmounted (dispose).
      if (voidOnArrival) {
        // Fire and forget: nothing waits on it, so it needs no timeout.
        o.api.cancelPayment(p.paymentId).catch((err: unknown) => console.warn('Voiding late payment failed', err));
        return;
      }
      if (finished) return; // Disposed (StrictMode re-run, remount): the next flow picks the payment up.
      clear(createTimeout);
      paymentId = p.paymentId;
      serverAmount = p.amountCentavos;
      o.onReady(p);
      poll(p.paymentId);
    },
    (err: unknown) => {
      if (voidOnArrival) return;
      clear(createTimeout);
      createFailed(err);
    },
  );

  later(cancel, Math.max(0, o.deadline - Date.now()));

  return { cancel, dispose: stop };
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
