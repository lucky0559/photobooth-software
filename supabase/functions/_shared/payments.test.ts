import { assertEquals, assertRejects } from '@std/assert';
import { applyPaidEvent, cancelPayment, type PaymentStatus, type PaymentStore } from './payments.ts';

type SessionStatus = 'awaiting_payment' | 'paid' | 'cancelled' | 'paid_after_cancel';

interface Row {
  id: string;
  intentId: string;
  kioskId: string;
  status: PaymentStatus;
  paidAt: string | null;
  session: SessionStatus;
}

/** In-memory PaymentStore with the same conditional-update semantics as the SQL functions. */
class FakeStore implements PaymentStore {
  rows = new Map<string, Row>();

  add(id: string, intentId: string, status: PaymentStatus, kioskId = 'kiosk-a'): Row {
    const session: SessionStatus = status === 'paid' ? 'paid' : status === 'cancelled' ? 'cancelled' : 'awaiting_payment';
    const row = { id, intentId, kioskId, status, paidAt: null, session };
    this.rows.set(id, row);
    return row;
  }

  private byIntent(intentId: string): Row | undefined {
    for (const r of this.rows.values()) if (r.intentId === intentId) return r;
    return undefined;
  }

  markPaidIfPending(intentId: string, paidAt: string): Promise<'updated' | 'not_pending' | 'not_found'> {
    const r = this.byIntent(intentId);
    if (!r) return Promise.resolve('not_found');
    if (r.status !== 'pending' && r.status !== 'failed') return Promise.resolve('not_pending');
    r.status = 'paid';
    r.paidAt = paidAt;
    if (r.session === 'awaiting_payment') r.session = 'paid';
    return Promise.resolve('updated');
  }

  getStatusByIntent(intentId: string): Promise<PaymentStatus | null> {
    return Promise.resolve(this.byIntent(intentId)?.status ?? null);
  }

  markPaidAfterCancel(intentId: string, paidAt: string): Promise<'updated' | 'not_cancelled'> {
    const r = this.byIntent(intentId);
    if (!r || r.status !== 'cancelled') return Promise.resolve('not_cancelled');
    r.status = 'paid';
    r.paidAt = paidAt;
    r.session = 'paid_after_cancel';
    return Promise.resolve('updated');
  }

  cancelIfPending(paymentId: string, kioskId: string): Promise<'cancelled' | 'not_pending' | 'forbidden' | 'not_found'> {
    const r = this.rows.get(paymentId);
    if (!r) return Promise.resolve('not_found');
    if (r.kioskId !== kioskId) return Promise.resolve('forbidden');
    if (r.status !== 'pending' && r.status !== 'failed') return Promise.resolve('not_pending');
    r.status = 'cancelled';
    if (r.session === 'awaiting_payment') r.session = 'cancelled';
    return Promise.resolve('cancelled');
  }

  getStatus(paymentId: string): Promise<PaymentStatus | null> {
    return Promise.resolve(this.rows.get(paymentId)?.status ?? null);
  }

  getForCancel(paymentId: string): Promise<{ intentId: string; kioskId: string; status: PaymentStatus } | null> {
    const r = this.rows.get(paymentId);
    return Promise.resolve(r ? { intentId: r.intentId, kioskId: r.kioskId, status: r.status } : null);
  }
}

const T1 = '2026-11-12T01:00:00.000Z';
const T2 = '2026-11-12T01:05:00.000Z';

Deno.test('pending -> marked_paid', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  assertEquals(await applyPaidEvent(s, 'pi_1', T1), 'marked_paid');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid']);
});

Deno.test('second delivery -> duplicate, no change', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  await applyPaidEvent(s, 'pi_1', T1);
  assertEquals(await applyPaidEvent(s, 'pi_1', T2), 'duplicate');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid']);
});

Deno.test('cancelled then paid -> paid_after_cancel', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a'), 'cancelled');
  assertEquals(await applyPaidEvent(s, 'pi_1', T1), 'paid_after_cancel');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid_after_cancel']);
  // A redelivery of the same event changes nothing.
  assertEquals(await applyPaidEvent(s, 'pi_1', T2), 'duplicate');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid_after_cancel']);
});

Deno.test('cancelled, then a concurrent delivery wins markPaidAfterCancel -> duplicate', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'cancelled');
  // The other delivery flips the row between our markPaidIfPending and markPaidAfterCancel.
  const inner = s.markPaidIfPending.bind(s);
  s.markPaidIfPending = async (intentId, paidAt) => {
    const res = await inner(intentId, paidAt);
    await s.markPaidAfterCancel(intentId, T1);
    return res;
  };
  assertEquals(await applyPaidEvent(s, 'pi_1', T2), 'duplicate');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid_after_cancel']);
});

Deno.test('failed attempt then paid -> marked_paid', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'failed');
  assertEquals(await applyPaidEvent(s, 'pi_1', T1), 'marked_paid');
  assertEquals(r.status, 'paid');
});

Deno.test('unknown intent -> unknown_intent', async () => {
  const s = new FakeStore();
  s.add('p1', 'pi_1', 'pending');
  assertEquals(await applyPaidEvent(s, 'pi_nope', T1), 'unknown_intent');
  assertEquals(s.rows.get('p1')?.status, 'pending');
});

Deno.test('cancelPayment on pending -> cancelled', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a'), 'cancelled');
  assertEquals([r.status, r.session], ['cancelled', 'cancelled']);
  // Idempotent: the second call gives the same answer.
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a'), 'cancelled');
});

Deno.test('cancelPayment when already paid -> paid', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  await applyPaidEvent(s, 'pi_1', T1);
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a'), 'paid');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a'), 'paid');
  assertEquals([r.status, r.session], ['paid', 'paid']);
});

Deno.test('cancelPayment by another kiosk -> forbidden, nothing changes', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending', 'kiosk-a');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-b'), 'forbidden');
  assertEquals(r.status, 'pending');
});

Deno.test('cancelPayment on an unknown payment -> not_found', async () => {
  assertEquals(await cancelPayment(new FakeStore(), 'p-none', 'kiosk-a'), 'not_found');
});

// R19: cancel reconciles with PayMongo first (the webhook may never arrive).
const succeeded = (seen: string[] = []) => (intentId: string) => {
  seen.push(intentId);
  return Promise.resolve(true);
};
const notSucceeded = () => Promise.resolve(false);

Deno.test('cancelPayment: intent already succeeded (no webhook) -> paid, payment and session paid', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  const seen: string[] = [];
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a', succeeded(seen), T1), 'paid');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T1, 'paid']);
  assertEquals(seen, ['pi_1']);
});

Deno.test('cancelPayment: intent not succeeded -> cancelled as before', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a', notSucceeded, T1), 'cancelled');
  assertEquals([r.status, r.session], ['cancelled', 'cancelled']);
});

Deno.test('cancelPayment: retry after cancel, intent succeeded meanwhile -> paid, session paid_after_cancel', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a', notSucceeded, T1), 'cancelled');
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a', succeeded(), T2), 'paid');
  assertEquals([r.status, r.paidAt, r.session], ['paid', T2, 'paid_after_cancel']);
});

Deno.test('cancelPayment: another kiosk or an unknown payment never reaches PayMongo', async () => {
  const s = new FakeStore();
  const r = s.add('p1', 'pi_1', 'pending', 'kiosk-a');
  const seen: string[] = [];
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-b', succeeded(seen), T1), 'forbidden');
  assertEquals(await cancelPayment(s, 'p-none', 'kiosk-a', succeeded(seen), T1), 'not_found');
  assertEquals(seen, []);
  assertEquals(r.status, 'pending');
});

Deno.test('cancelPayment: an already paid payment is not looked up again', async () => {
  const s = new FakeStore();
  s.add('p1', 'pi_1', 'paid');
  const seen: string[] = [];
  assertEquals(await cancelPayment(s, 'p1', 'kiosk-a', succeeded(seen), T1), 'paid');
  assertEquals(seen, []);
});

Deno.test('cancelPayment: a row that is neither cancellable nor final throws', async () => {
  const s = new FakeStore();
  s.add('p1', 'pi_1', 'pending');
  s.cancelIfPending = () => Promise.resolve('not_pending');
  await assertRejects(() => cancelPayment(s, 'p1', 'kiosk-a'));
});
