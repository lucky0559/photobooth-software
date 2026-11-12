import { assertEquals, assertRejects } from '@std/assert';
import {
  createQrPhPayment,
  parsePaidEvent,
  parseWebhookEvent,
  PayMongoError,
  qrImageDataUrlFrom,
  trimEvent,
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
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'test'), true);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body + ' ', secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=${sig}`, body, secret, 'live'), true);
  assertEquals(await verifyWebhookSignature('garbage', body, secret, 'test'), false);
});

Deno.test('signature: mode picks te or li, never the other one', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=${sig}`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'live'), false);
});

Deno.test('signature: wrong secret, wrong timestamp, malformed parts fail', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const sig = await hmacHex(secret, `${t}.${body}`);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, 'whsk_other', 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=1700000001,te=${sig},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`te=${sig},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=,te=${sig},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig.slice(2)},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig}zz,li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=abc,te=${sig},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=-1,te=${sig},li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature('', body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, '', 'test'), false);
  // Empty or missing te/li never verify.
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=`, body, secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=`, body, secret, 'live'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},li=${sig}`, body, secret, 'test'), false);
  // Uppercase hex is the same signature.
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig.toUpperCase()},li=`, body, secret, 'test'), true);
  // Whitespace around parts is tolerated.
  assertEquals(await verifyWebhookSignature(`t=${t}, te=${sig}, li=`, body, secret, 'test'), true);
});

Deno.test('signature: no replay window; an old but correctly signed event verifies (idempotency protects)', async () => {
  const body = '{"a":1}', secret = 'whsk_test';
  for (const t of [1, 1700000000, Math.floor(Date.now() / 1000) - 7 * 86400, Math.floor(Date.now() / 1000)]) {
    const sig = await hmacHex(secret, `${t}.${body}`);
    assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'test'), true, `t=${t}`);
  }
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

Deno.test('trimEvent keeps only the payment summary, never billing or contact details', () => {
  const ev = fixture('webhook-payment-paid.json') as {
    data: { attributes: { data: { attributes: Record<string, unknown> } } };
  };
  ev.data.attributes.data.attributes.billing = {
    name: 'Juan dela Cruz',
    email: 'juan@example.com',
    phone: '09111111111',
    address: { line1: '1 Rizal St', city: 'Manila' },
  };
  const trimmed = trimEvent(ev);
  assertEquals(trimmed, {
    id: 'evt_SyntheticFixture00000001',
    type: 'payment.paid',
    amount: 15000,
    currency: 'PHP',
    status: 'paid',
    paid_at: 1762900100,
    payment_intent_id: 'pi_SyntheticFixture0000000001',
  });
  const text = JSON.stringify(trimmed);
  for (const leaked of ['Juan', 'juan@example.com', '0911', 'Rizal', 'metadata', 'billing']) {
    assertEquals(text.includes(leaked), false, leaked);
  }
  // Missing or wrongly typed fields become null; nothing else is copied.
  assertEquals(trimEvent({ data: { id: 5, attributes: { type: 'qr.expired', extra: 'x' } } }), {
    id: null,
    type: 'qr.expired',
    amount: null,
    currency: null,
    status: null,
    paid_at: null,
    payment_intent_id: null,
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
