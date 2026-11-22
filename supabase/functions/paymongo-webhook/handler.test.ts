import { assertEquals } from '@std/assert';
import type { TrimmedEvent } from '../_shared/paymongo.ts';
import type { PaymentStatus } from '../_shared/payments.ts';
import { webhookHandler, type WebhookStore } from './handler.ts';

const SECRET = 'whsk_unit';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

const paidBody = (intentId: string, amount: number) =>
  JSON.stringify({
    data: {
      id: 'evt_unit',
      attributes: {
        type: 'payment.paid',
        data: {
          attributes: {
            payment_intent_id: intentId,
            amount,
            currency: 'PHP',
            status: 'paid',
            billing: { name: 'Juan dela Cruz', email: 'juan@example.com' },
          },
        },
      },
    },
  });

async function signed(raw: string, t = Math.floor(Date.now() / 1000)): Promise<Request> {
  const sig = await hmacHex(SECRET, `${t}.${raw}`);
  return new Request('http://local/paymongo-webhook', {
    method: 'POST',
    headers: { 'paymongo-signature': `t=${t},te=${sig},li=` },
    body: raw,
  });
}

/** One pending payment `pi_1` stored at 15000 centavos. */
class MemStore implements WebhookStore {
  status: PaymentStatus = 'pending';
  events: TrimmedEvent[] = [];
  failWith: Error | null = null;

  private check(): void {
    if (this.failWith) throw this.failWith;
  }
  markPaidIfPending(intentId: string) {
    this.check();
    if (intentId !== 'pi_1') return Promise.resolve('not_found' as const);
    if (this.status !== 'pending') return Promise.resolve('not_pending' as const);
    this.status = 'paid';
    return Promise.resolve('updated' as const);
  }
  getStatusByIntent(intentId: string) {
    return Promise.resolve(intentId === 'pi_1' ? this.status : null);
  }
  markPaidAfterCancel() {
    return Promise.resolve('not_cancelled' as const);
  }
  cancelIfPending() {
    return Promise.resolve('not_pending' as const);
  }
  getStatus() {
    return Promise.resolve(this.status);
  }
  getForCancel() {
    return Promise.resolve({ intentId: 'pi_1', kioskId: 'kiosk-a', status: this.status });
  }
  recordEvent(intentId: string, event: TrimmedEvent) {
    this.check();
    if (intentId !== 'pi_1') return Promise.resolve(null);
    this.events.push(event);
    return Promise.resolve(15000);
  }
}

const handlerFor = (store: MemStore) => webhookHandler(() => ({ store, secret: SECRET, mode: 'test' }));

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const saved = { warn: console.warn, error: console.error, log: console.log };
  console.warn = console.error = console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

Deno.test('webhook: a database failure answers 500 (PayMongo retries), not 200', async () => {
  const store = new MemStore();
  store.failWith = Object.assign(new Error('connection refused'), { code: 'PGRST000' });
  const { result: res } = await captureConsole(async () => handlerFor(store)(await signed(paidBody('pi_1', 15000))));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'internal' });
});

Deno.test('logs: a database error is logged by its code only, never its message', async () => {
  const store = new MemStore();
  store.failWith = Object.assign(new Error('duplicate key (download_token)=(SECRETTOKENVALUE012345)'), { code: '23505' });
  const { lines } = await captureConsole(async () => handlerFor(store)(await signed(paidBody('pi_1', 15000))));
  assertEquals(lines.some((l) => l.includes('code 23505')), true);
  assertEquals(lines.some((l) => l.includes('SECRETTOKENVALUE')), false);
});

Deno.test('webhook: an amount that differs from the stored payment is logged and still applied', async () => {
  const store = new MemStore();
  const { result: res, lines } = await captureConsole(async () => handlerFor(store)(await signed(paidBody('pi_1', 9900))));
  assertEquals(res.status, 200);
  assertEquals(store.status, 'paid');
  const warning = lines.find((l) => l.includes('amount mismatch'));
  assertEquals(typeof warning, 'string');
  assertEquals(warning!.includes('9900') && warning!.includes('15000'), true);
  assertEquals(warning!.includes(SECRET), false);
});

Deno.test('webhook: matching amount, no warning; last_event is the trimmed event without billing', async () => {
  const store = new MemStore();
  const { result: res, lines } = await captureConsole(async () => handlerFor(store)(await signed(paidBody('pi_1', 15000))));
  assertEquals(res.status, 200);
  assertEquals(lines.some((l) => l.includes('amount mismatch')), false);
  assertEquals(store.events, [
    { id: 'evt_unit', type: 'payment.paid', amount: 15000, currency: 'PHP', status: 'paid', paid_at: null, payment_intent_id: 'pi_1' },
  ]);
});

Deno.test('webhook: an old but correctly signed delivery is applied; a bad signature is 401', async () => {
  const store = new MemStore();
  const { result: old } = await captureConsole(async () => handlerFor(store)(await signed(paidBody('pi_1', 15000), 1700000000)));
  assertEquals(old.status, 200);
  assertEquals(store.status, 'paid');
  const bad = new Request('http://local/paymongo-webhook', {
    method: 'POST',
    headers: { 'paymongo-signature': `t=1,te=${'0'.repeat(64)},li=` },
    body: paidBody('pi_1', 15000),
  });
  assertEquals((await handlerFor(new MemStore())(bad)).status, 401);
});

Deno.test('webhook: a rejected signature logs exactly one fixed line (no body, headers or secret)', async () => {
  const body = paidBody('pi_1', 15000);
  const bad = new Request('http://local/paymongo-webhook', {
    method: 'POST',
    headers: { 'paymongo-signature': `t=1,te=${'0'.repeat(64)},li=` },
    body,
  });
  const { result, lines } = await captureConsole(() => handlerFor(new MemStore())(bad));
  assertEquals(result.status, 401);
  assertEquals(lines, ['webhook: signature rejected']);
});
