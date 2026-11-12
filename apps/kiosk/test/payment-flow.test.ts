import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentStatus } from '../src/renderer/src/api/kiosk-api';
import {
  CALL_TIMEOUT_MS,
  CANCEL_RETRIES,
  CANCEL_RETRY_MS,
  CREATE_TIMEOUT_MS,
  POLL_MS,
  UNAVAILABLE_MS,
  createPaymentOnce,
  startPaymentFlow,
  type CreatedPayment,
  type PaymentFlowStatus,
} from '../src/renderer/src/payment/payment-flow';

const T0 = 1_000_000;
const TIMEOUT = 180_000;
const created: CreatedPayment = { paymentId: 'p1', qrImageDataUrl: 'data:image/png;base64,AA', amountCentavos: 15000 };

/** Controllable fake of the three payment calls. */
function fakeApi() {
  let status: PaymentStatus = 'pending';
  const api = {
    getPaymentStatus: vi.fn(async (_id: string): Promise<PaymentStatus> => status),
    cancelPayment: vi.fn(async (_id: string): Promise<'cancelled' | 'paid'> => 'cancelled'),
  };
  return { api, setStatus: (s: PaymentStatus) => (status = s) };
}

function setup(opts: { startedAt?: number; payment?: Promise<CreatedPayment> } = {}) {
  const { api, setStatus } = fakeApi();
  const events: string[] = [];
  const statuses: PaymentFlowStatus[] = [];
  const paidAmounts: (number | undefined)[] = [];
  const onReady = vi.fn();
  const flow = startPaymentFlow({
    api,
    payment: opts.payment ?? Promise.resolve(created),
    deadline: (opts.startedAt ?? T0) + TIMEOUT,
    onReady,
    onStatus: (s) => statuses.push(s),
    onPaid: (amount) => {
      events.push('paid');
      paidAmounts.push(amount);
    },
    onCancelled: () => events.push('cancelled'),
  });
  return { api, setStatus, events, statuses, onReady, flow, paidAmounts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startPaymentFlow', () => {
  it('onPaid receives the server amount from the created payment', async () => {
    const { paidAmounts, setStatus } = setup({ payment: Promise.resolve({ ...created, amountCentavos: 17500 }) });
    await vi.advanceTimersByTimeAsync(0);
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(paidAmounts).toEqual([17500]);
  });
  it('never-resolved createPayment: cancel leaves without onPaid', async () => {
    const { events, flow } = setup({ payment: new Promise<CreatedPayment>(() => undefined) });
    flow.cancel();
    expect(events).toEqual(['cancelled']);
  });

  it('shows the payment, then polls every 2 s until paid', async () => {
    const { api, setStatus, events, onReady } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(onReady).toHaveBeenCalledWith(created);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(api.getPaymentStatus).toHaveBeenCalledWith('p1');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(events).toEqual(['paid']);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(3);
    expect(events).toEqual(['paid']);
  });

  it('keeps polling after a failed poll', async () => {
    const { api, setStatus, events } = setup();
    api.getPaymentStatus.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(events).toEqual(['paid']);
  });

  it('Cancel that the server answers "paid" pays (guest paid at the last second)', async () => {
    const { api, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPayment.mockResolvedValueOnce('paid');
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.cancelPayment).toHaveBeenCalledWith('p1');
    expect(events).toEqual(['paid']);
  });

  it('Cancel that the server answers "cancelled" cancels and stops polling', async () => {
    const { api, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['cancelled']);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.getPaymentStatus).not.toHaveBeenCalled();
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('a double Cancel tap calls cancelPayment once', async () => {
    const { api, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    flow.cancel();
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    flow.cancel();
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('times out at startedAt + 180 s with exactly one cancel', async () => {
    const { api, events } = setup();
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(api.cancelPayment).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
  });

  it('a poll past the deadline cancels even if the deadline timer has not fired (clock jumped)', async () => {
    const { api, events } = setup();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(T0 + TIMEOUT + 5_000);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('a remount does not extend the deadline: it is based on startedAt', async () => {
    // Mounted 170 s into the session: only 10 s are left.
    const { api, events } = setup({ startedAt: T0 - 170_000 });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(api.cancelPayment).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('a remount after the deadline cancels right away', async () => {
    const { api, events } = setup({ startedAt: T0 - 200_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('a failing cancel shows "checking" and retries every 2 s, then follows the answer', async () => {
    const { api, events, statuses, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPayment.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    api.cancelPayment.mockResolvedValueOnce('paid');
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toContain('checking');
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.cancelPayment).toHaveBeenCalledTimes(3);
    expect(events).toEqual(['paid']);
  });

  it('gives up after 15 retries and cancels', async () => {
    const { api, events, flow } = setup();
    api.cancelPayment.mockRejectedValue(new Error('offline'));
    // The poll keeps failing too, so only the retries decide.
    api.getPaymentStatus.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    flow.cancel();
    await vi.advanceTimersByTimeAsync(CANCEL_RETRIES * 2_000 - 1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(CANCEL_RETRIES);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // First attempt + 15 retries.
    expect(api.cancelPayment).toHaveBeenCalledTimes(CANCEL_RETRIES + 1);
    expect(events).toEqual(['cancelled']);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(CANCEL_RETRIES + 1);
    expect(events).toEqual(['cancelled']);
  });

  it('a poll that says paid during an in-flight cancel wins, and nothing follows it', async () => {
    const { api, setStatus, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    let answerCancel: (r: 'cancelled' | 'paid') => void = () => undefined;
    api.cancelPayment.mockImplementationOnce(() => new Promise((resolve) => (answerCancel = resolve)));
    flow.cancel();
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(events).toEqual(['paid']);
    answerCancel('cancelled');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(events).toEqual(['paid']);
  });

  it('a poll that says paid between cancel retries wins', async () => {
    const { api, setStatus, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPayment.mockRejectedValue(new Error('offline'));
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(events).toEqual(['paid']);
    const calls = api.cancelPayment.mock.calls.length;
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(calls);
  });

  it('dispose stops polling, timeout and retries and never reports afterwards', async () => {
    const { api, setStatus, events, statuses, flow } = setup();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(1);
    api.cancelPayment.mockRejectedValue(new Error('offline'));
    flow.cancel();
    await vi.advanceTimersByTimeAsync(0);
    const seen = statuses.length;
    flow.dispose();
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    expect(statuses).toHaveLength(seen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose before the payment is created ignores the result (a remount picks it up)', async () => {
    const { api, events, onReady, flow } = setup();
    flow.dispose();
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2);
    expect(onReady).not.toHaveBeenCalled();
    expect(api.getPaymentStatus).not.toHaveBeenCalled();
    expect(api.cancelPayment).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('createPayment failure shows "unavailable", then cancels after 10 s', async () => {
    const { api, events, statuses } = setup({ payment: Promise.reject(new Error('down')) });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(['unavailable']);
    await vi.advanceTimersByTimeAsync(UNAVAILABLE_MS - 1);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(['cancelled']);
    expect(api.cancelPayment).not.toHaveBeenCalled();
  });

  // No QR was ever shown, so nobody can have paid: leave at once and void the late intent in the background.
  it('Cancel tapped before the payment exists cancels at once and voids the late payment', async () => {
    let resolve: (p: CreatedPayment) => void = () => undefined;
    const { api, events, onReady, flow } = setup({ payment: new Promise((r) => (resolve = r)) });
    flow.cancel();
    expect(events).toEqual(['cancelled']);
    resolve(created);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(onReady).not.toHaveBeenCalled();
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(api.getPaymentStatus).not.toHaveBeenCalled();
    expect(events).toEqual(['cancelled']);
  });

  it('a payment still being created at the deadline cancels at once and voids the late payment', async () => {
    let resolve: (p: CreatedPayment) => void = () => undefined;
    // Remounted with 5 s left, so the deadline comes before the create timeout.
    const { api, events } = setup({ startedAt: T0 - 175_000, payment: new Promise((r) => (resolve = r)) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toEqual(['cancelled']);
    resolve(created);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('voids the late payment even after the screen unmounted (dispose)', async () => {
    let resolve: (p: CreatedPayment) => void = () => undefined;
    const { api, events, onReady, flow } = setup({ payment: new Promise((r) => (resolve = r)) });
    flow.cancel();
    flow.dispose();
    resolve({ ...created, paymentId: 'late-1' });
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(api.cancelPayment).toHaveBeenCalledWith('late-1');
    expect(onReady).not.toHaveBeenCalled();
    expect(events).toEqual(['cancelled']);
  });
});

describe('startPaymentFlow: hung calls time out', () => {
  const hang = <T,>(): Promise<T> => new Promise<T>(() => undefined);

  it('a cancelPayment that never answers retries, then cancels when the retries run out', async () => {
    const { api, events, statuses, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPayment.mockImplementation(hang);
    flow.cancel();
    // Each attempt: CALL_TIMEOUT_MS, then CANCEL_RETRY_MS before the next one.
    const exhausted = (CANCEL_RETRIES + 1) * CALL_TIMEOUT_MS + CANCEL_RETRIES * CANCEL_RETRY_MS;
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(statuses).toContain('checking');
    await vi.advanceTimersByTimeAsync(exhausted - CALL_TIMEOUT_MS - 1);
    expect(api.cancelPayment).toHaveBeenCalledTimes(CANCEL_RETRIES + 1);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(['cancelled']);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(api.cancelPayment).toHaveBeenCalledTimes(CANCEL_RETRIES + 1);
    expect(events).toEqual(['cancelled']);
  });

  it('a cancelPayment that times out once and then answers "paid" pays', async () => {
    const { api, events, statuses, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPayment.mockImplementationOnce(hang).mockResolvedValueOnce('paid');
    flow.cancel();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(statuses).toEqual(['checking']);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(CANCEL_RETRY_MS);
    expect(api.cancelPayment).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['paid']);
  });

  it('a timed-out cancel that answers "paid" late is honoured, once', async () => {
    const { api, events, flow } = setup();
    await vi.advanceTimersByTimeAsync(0);
    let answerLate: (r: 'cancelled' | 'paid') => void = () => undefined;
    api.cancelPayment
      .mockImplementationOnce(() => new Promise((r) => (answerLate = r)))
      .mockResolvedValueOnce('cancelled');
    flow.cancel();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 500);
    answerLate('paid');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(events).toEqual(['paid']);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
  });

  it('a getPaymentStatus that never answers does not stop later polls', async () => {
    const { api, setStatus, events } = setup();
    api.getPaymentStatus.mockImplementationOnce(hang);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(1);
    setStatus('paid');
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + POLL_MS);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['paid']);
  });

  it('a createPayment that never answers shows "unavailable", then cancels 10 s later', async () => {
    const { api, events, statuses, onReady } = setup({ payment: hang() });
    await vi.advanceTimersByTimeAsync(CREATE_TIMEOUT_MS - 1);
    expect(statuses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses).toEqual(['unavailable']);
    await vi.advanceTimersByTimeAsync(UNAVAILABLE_MS);
    expect(events).toEqual(['cancelled']);
    expect(onReady).not.toHaveBeenCalled();
    expect(api.cancelPayment).not.toHaveBeenCalled();
  });

  it('a createPayment that answers after its timeout is voided, not shown', async () => {
    let resolve: (p: CreatedPayment) => void = () => undefined;
    const { api, events, onReady } = setup({ payment: new Promise((r) => (resolve = r)) });
    await vi.advanceTimersByTimeAsync(CREATE_TIMEOUT_MS + 1_000);
    resolve(created);
    await vi.advanceTimersByTimeAsync(UNAVAILABLE_MS);
    expect(onReady).not.toHaveBeenCalled();
    expect(api.cancelPayment).toHaveBeenCalledWith('p1');
    expect(events).toEqual(['cancelled']);
  });
});

describe('startPaymentFlow: server-side status', () => {
  it('a poll that says "cancelled" asks the server and follows its answer', async () => {
    const { api, setStatus, events } = setup();
    setStatus('cancelled');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(api.cancelPayment).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancelled']);
  });

  it('a poll that says "failed" keeps the QR up and keeps polling', async () => {
    const { api, setStatus, events } = setup();
    setStatus('failed');
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(api.getPaymentStatus).toHaveBeenCalledTimes(3);
    expect(api.cancelPayment).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe('createPaymentOnce', () => {
  it('creates one payment per session, however often it is asked (StrictMode, remounts)', async () => {
    const create = vi.fn(async () => created);
    const a = createPaymentOnce('s1', create);
    const b = createPaymentOnce('s1', create);
    expect(b).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);
    createPaymentOnce('s2', create);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed creation for the same session', async () => {
    const create = vi.fn(async (): Promise<CreatedPayment> => {
      throw new Error('down');
    });
    await expect(createPaymentOnce('s3', create)).rejects.toThrow('down');
    await expect(createPaymentOnce('s3', create)).rejects.toThrow('down');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
