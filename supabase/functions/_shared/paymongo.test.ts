import { assertEquals, assertRejects } from '@std/assert';
import {
  createQrPhPayment,
  parsePaidEvent,
  parseWebhookEvent,
  PayMongoError,
  qrImageDataUrlFrom,
  verifyWebhookSignature,
} from './paymongo.ts';
import { startPayMongoStub } from '../_testing/paymongo-stub.ts';

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

const fixture = (name: string): unknown =>
  JSON.parse(Deno.readTextFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

Deno.test('valid test-mode signature passes; tampered body fails; live uses li', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const now = { nowSeconds: 1700000000 };
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'test', now), true);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body + ' ', secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=${sig}`, body, secret, 'live', now), true);
  assertEquals(await verifyWebhookSignature('garbage', body, secret, 'test', now), false);
});

Deno.test('signature: mode picks te or li, never the other one', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const now = { nowSeconds: 1700000000 };
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=${sig}`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'live', now), false);
});

Deno.test('signature: wrong secret, wrong timestamp, malformed parts fail', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const now = { nowSeconds: 1700000000 };
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, 'whsk_other', 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=1700000001,te=${sig},li=`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`te=${sig},li=`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig.slice(2)},li=`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig}zz,li=`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=abc,te=${sig},li=`, body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature('', body, secret, 'test', now), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, '', 'test', now), false);
  // Uppercase hex is the same signature.
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig.toUpperCase()},li=`, body, secret, 'test', now), true);
  // Whitespace around parts is tolerated.
  assertEquals(await verifyWebhookSignature(`t=${t}, te=${sig}, li=`, body, secret, 'test', now), true);
});

Deno.test('signature: timestamps outside the 10 minute tolerance are rejected (replay)', async () => {
  const body = '{"a":1}', t = 1700000000, secret = 'whsk_test';
  const sig = await hmacHex(secret, `${t}.${body}`);
  const header = `t=${t},te=${sig},li=`;
  assertEquals(await verifyWebhookSignature(header, body, secret, 'test', { nowSeconds: t + 600 }), true);
  assertEquals(await verifyWebhookSignature(header, body, secret, 'test', { nowSeconds: t + 601 }), false);
  assertEquals(await verifyWebhookSignature(header, body, secret, 'test', { nowSeconds: t - 601 }), false);
  // Default clock: a fresh timestamp passes.
  const nowT = Math.floor(Date.now() / 1000);
  const fresh = await hmacHex(secret, `${nowT}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${nowT},te=${fresh},li=`, body, secret, 'test'), true);
});

Deno.test('parsePaidEvent reads the fixture; returns null for other events', () => {
  const ev = fixture('webhook-payment-paid.json');
  assertEquals(typeof parsePaidEvent(ev)?.intentId, 'string');
  assertEquals(parsePaidEvent(ev), { intentId: 'pi_SyntheticFixture0000000001', amountCentavos: 15000 });
  assertEquals(parsePaidEvent({ data: { attributes: { type: 'payment.failed' } } }), null);
});

Deno.test('parsePaidEvent rejects malformed paid events', () => {
  const paid = (payment: unknown) => ({ data: { attributes: { type: 'payment.paid', data: payment } } });
  assertEquals(parsePaidEvent(null), null);
  assertEquals(parsePaidEvent('payment.paid'), null);
  assertEquals(parsePaidEvent([]), null);
  assertEquals(parsePaidEvent(paid(null)), null);
  assertEquals(parsePaidEvent(paid({ attributes: { amount: 15000 } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: '', amount: 15000 } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: 42, amount: 15000 } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: 'pi_x', amount: '15000' } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: 'pi_x', amount: 150.5 } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: 'pi_x'.padEnd(300, 'x'), amount: 1 } })), null);
  assertEquals(parsePaidEvent(paid({ attributes: { payment_intent_id: 'pi_x', amount: 15000 } })), {
    intentId: 'pi_x',
    amountCentavos: 15000,
  });
});

Deno.test('parseWebhookEvent reads type and intent id of failed events too', () => {
  assertEquals(
    parseWebhookEvent({
      data: { attributes: { type: 'payment.failed', data: { attributes: { payment_intent_id: 'pi_y' } } } },
    }),
    { type: 'payment.failed', intentId: 'pi_y' },
  );
  assertEquals(parseWebhookEvent({ data: { attributes: { type: 'qr.expired' } } }), {
    type: 'qr.expired',
    intentId: null,
  });
  assertEquals(parseWebhookEvent({ data: {} }), null);
});

Deno.test('qrImageDataUrlFrom: data URL passes, bare base64 gets a PNG prefix, hosted URL is refused', () => {
  const att = (image_url: unknown) => ({ data: { attributes: { next_action: { code: { image_url } } } } });
  assertEquals(qrImageDataUrlFrom(att('data:image/png;base64,iVBORw0KGgo=')), 'data:image/png;base64,iVBORw0KGgo=');
  assertEquals(qrImageDataUrlFrom(att('iVBORw0KGgo=')), 'data:image/png;base64,iVBORw0KGgo=');
  assertEquals(qrImageDataUrlFrom(att('https://example.com/qr.png')), null);
  assertEquals(qrImageDataUrlFrom(att('data:text/html;base64,PGgxPg==')), null);
  assertEquals(qrImageDataUrlFrom(att('data:image/svg+xml,<svg onload=alert(1)>')), null);
  assertEquals(qrImageDataUrlFrom(att('')), null);
  assertEquals(qrImageDataUrlFrom(att(42)), null);
  assertEquals(qrImageDataUrlFrom({ data: { attributes: { next_action: null } } }), null);
  assertEquals(qrImageDataUrlFrom(fixture('attach-qrph.json'))?.startsWith('data:image/png;base64,'), true);
});

Deno.test('createQrPhPayment runs create intent -> create method -> attach against the stub', async () => {
  const stub = startPayMongoStub();
  try {
    const r = await createQrPhPayment({
      secretKey: 'sk_test_unit',
      amountCentavos: 15000,
      description: 'Photobooth session',
      metadata: { session_id: 's1' },
      apiBase: stub.url,
    });
    assertEquals(r.intentId.startsWith('pi_'), true);
    assertEquals(r.qrImageDataUrl.startsWith('data:image/png;base64,'), true);
    const c = stub.calls();
    assertEquals([c.createIntent, c.createMethod, c.attach], [1, 1, 1]);
    assertEquals(c.lastKey, 'sk_test_unit');
    assertEquals(c.lastIntent?.amount, 15000);
    assertEquals(c.lastIntent?.currency, 'PHP');
    assertEquals(c.lastIntent?.payment_method_allowed, ['qrph']);
    assertEquals(c.lastIntent?.metadata, { session_id: 's1' });
    assertEquals(c.lastMethod?.type, 'qrph');
  } finally {
    await stub.close();
  }
});

Deno.test('createQrPhPayment: a PayMongo error or a hosted QR URL throws PayMongoError', async () => {
  const stub = startPayMongoStub();
  const args = { secretKey: 'sk_test_unit', amountCentavos: 15000, description: 'x', metadata: {}, apiBase: stub.url };
  try {
    stub.failNext('attach', 500);
    await assertRejects(() => createQrPhPayment(args), PayMongoError);
    stub.failNext('intent', 401);
    await assertRejects(() => createQrPhPayment(args), PayMongoError);
    stub.setImageUrl('https://example.com/qr.png');
    await assertRejects(() => createQrPhPayment(args), PayMongoError, 'QR');
    // Amounts below PayMongo's and the DB's minimum never reach the network.
    stub.setImageUrl(null);
    stub.reset();
    await assertRejects(() => createQrPhPayment({ ...args, amountCentavos: 1999 }), RangeError);
    await assertRejects(() => createQrPhPayment({ ...args, amountCentavos: 150.5 }), RangeError);
    assertEquals(stub.calls().createIntent, 0);
  } finally {
    await stub.close();
  }
});
