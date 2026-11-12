// End-to-end tests of create-payment, cancel-payment and paymongo-webhook against the LOCAL stack, with the PayMongo
// stub in place of api.paymongo.com. Run: `deno task test:integration` from supabase/functions (see run.ts).
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { newDownloadToken } from '@pb/core';
import { asUser, callFn, ENABLED, ensureUser, localStack, sendWebhook, service, signIn, stub, webhookEvent } from './helpers.ts';

const TEMPLATE_ID = '00000000-0000-0000-0000-0000000057a1';
/** Deliberately not the default 15000, so "amount from server settings" is visible. */
const PRICE = 17500;

Deno.test({
  name: 'payment Edge Functions (integration)',
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const db = await service();
    await ensureUser('kiosk-b@local.test', 'kiosk');
    const kioskA = await signIn('kiosk@local.test');
    const kioskB = await signIn('kiosk-b@local.test');
    const admin = await signIn('admin@local.test');
    const { anonKey } = await localStack();

    const { data: original, error: sErr } = await db.from('settings').select('price_centavos, free_mode').eq('id', 1).single();
    if (sErr) throw sErr;
    const sessions: string[] = [];
    const templates: string[] = [];

    const setSettings = async (price: number, free: boolean) => {
      const { error } = await db.from('settings').update({ price_centavos: price, free_mode: free }).eq('id', 1);
      if (error) throw error;
    };
    const newSession = () => {
      const id = crypto.randomUUID();
      sessions.push(id);
      return { sessionId: id, downloadToken: newDownloadToken(), templateId: TEMPLATE_ID };
    };
    const create = async (jwt = kioskA.jwt, extra: Record<string, unknown> = {}) => {
      const input = newSession();
      const r = await callFn('create-payment', { jwt, body: { ...input, ...extra } });
      return { input, r };
    };
    const payment = async (paymentId: string) => {
      const { data, error } = await db
        .from('payments')
        .select('status, paid_at, provider_intent_id, amount_centavos, qr_image, last_event, sessions(status, kiosk_id, amount_centavos, download_token)')
        .eq('id', paymentId)
        .single();
      if (error) throw error;
      return data as unknown as {
        status: string;
        paid_at: string | null;
        provider_intent_id: string;
        amount_centavos: number;
        qr_image: string | null;
        last_event: Record<string, unknown> | null;
        sessions: { status: string; kiosk_id: string; amount_centavos: number; download_token: string };
      };
    };
    const created = async () => {
      const { input, r } = await create();
      assertEquals(r.status, 200, JSON.stringify(r.body));
      const paymentId = r.body!.paymentId as string;
      return { input, paymentId, intentId: (await payment(paymentId)).provider_intent_id };
    };
    const calls = async () => (await stub('/__calls')) as { createIntent: number; createMethod: number; attach: number; lastIntent: { amount: number } | null };

    try {
      await setSettings(PRICE, false);
      await stub('/__reset');

      await t.step('create-payment: 200 with the QR; rows exist; amount from server settings, not the body', async () => {
        const { input, r } = await create(kioskA.jwt, { amountCentavos: 2000, amount: 1, kioskId: kioskB.userId });
        assertEquals(r.status, 200, JSON.stringify(r.body));
        assertEquals(r.body!.amountCentavos, PRICE);
        assert(String(r.body!.qrImageDataUrl).startsWith('data:image/png;base64,'));
        assertEquals(r.headers.get('access-control-allow-origin'), '*');
        const c = await calls();
        assertEquals([c.createIntent, c.createMethod, c.attach], [1, 1, 1]);
        assertEquals(c.lastIntent?.amount, PRICE);
        const p = await payment(r.body!.paymentId as string);
        assertEquals(p.status, 'pending');
        assertEquals(p.amount_centavos, PRICE);
        assert(p.provider_intent_id.startsWith('pi_stub'));
        assertEquals(p.qr_image, r.body!.qrImageDataUrl);
        assertEquals(p.sessions.status, 'awaiting_payment');
        assertEquals(p.sessions.kiosk_id, kioskA.userId);
        assertEquals(p.sessions.amount_centavos, PRICE);
        assertEquals(p.sessions.download_token, input.downloadToken);
      });

      await t.step('create-payment replayed for the same session: same payment and QR, no second PayMongo call', async () => {
        await stub('/__reset');
        const { input, r } = await create();
        const again = await callFn('create-payment', { jwt: kioskA.jwt, body: input });
        assertEquals(again.status, 200);
        assertEquals(again.body, r.body);
        assertEquals((await calls()).createIntent, 1);
        // Same session id with another token, or from another kiosk: conflict, still no PayMongo call.
        const other = await callFn('create-payment', { jwt: kioskA.jwt, body: { ...input, downloadToken: newDownloadToken() } });
        assertEquals([other.status, other.body], [409, { error: 'session_conflict' }]);
        const byB = await callFn('create-payment', { jwt: kioskB.jwt, body: input });
        assertEquals([byB.status, byB.body], [409, { error: 'session_conflict' }]);
        assertEquals((await calls()).createIntent, 1);
      });

      await t.step('create-payment: two concurrent first calls for one session return one payment', async () => {
        const input = newSession();
        const [a, b] = await Promise.all([
          callFn('create-payment', { jwt: kioskA.jwt, body: input }),
          callFn('create-payment', { jwt: kioskA.jwt, body: input }),
        ]);
        assertEquals([a.status, b.status], [200, 200]);
        assertEquals(a.body!.paymentId, b.body!.paymentId);
        assertEquals(a.body!.qrImageDataUrl, b.body!.qrImageDataUrl);
      });

      await t.step('create-payment: free mode -> 409 free_mode, no PayMongo call, no rows', async () => {
        await setSettings(PRICE, true);
        await stub('/__reset');
        const { input, r } = await create();
        await setSettings(PRICE, false);
        assertEquals([r.status, r.body], [409, { error: 'free_mode' }]);
        assertEquals((await calls()).createIntent, 0);
        const { count } = await db.from('sessions').select('id', { count: 'exact', head: true }).eq('id', input.sessionId);
        assertEquals(count, 0);
      });

      await t.step('create-payment: input validation', async () => {
        const good = newSession();
        const cases: [unknown, number][] = [
          [{ ...good, downloadToken: 'short' }, 400],
          [{ ...good, downloadToken: `${good.downloadToken}x` }, 400],
          [{ ...good, downloadToken: 'abcdefghijABCDEFGHIJ+/' }, 400],
          [{ ...good, sessionId: 'not-a-uuid' }, 400],
          [{ ...good, sessionId: `${good.sessionId}'; drop table payments; --` }, 400],
          [{ ...good, templateId: 42 }, 400],
          [{ ...good, templateId: crypto.randomUUID() }, 400],
          [{}, 400],
          [[good], 400],
        ];
        for (const [body, status] of cases) {
          const r = await callFn('create-payment', { jwt: kioskA.jwt, body });
          assertEquals(r.status, status, JSON.stringify(body));
          assert(typeof r.body?.error === 'string');
        }
        assertEquals((await callFn('create-payment', { jwt: kioskA.jwt, rawBody: '{"sessionId":' })).status, 400);
        assertEquals((await callFn('create-payment', { jwt: kioskA.jwt, rawBody: 'x'.repeat(5000) })).status, 413);
        assertEquals((await callFn('create-payment', { jwt: kioskA.jwt, method: 'GET' })).status, 405);
        const pre = await callFn('create-payment', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
        assert(pre.status < 300, `preflight ${pre.status}`);
        assertEquals(pre.headers.get('access-control-allow-credentials'), null);
      });

      await t.step('create-payment: archived template -> 400, no PayMongo call (active template not required)', async () => {
        const archivedId = crypto.randomUUID();
        const otherId = crypto.randomUUID();
        templates.push(archivedId, otherId);
        const { error } = await db.from('templates').insert([
          { id: archivedId, name: 'it archived', layout: 'strip_2x6', overlay_path: 'x.png', archived: true },
          { id: otherId, name: 'it not active', layout: 'print_4r', overlay_path: 'y.png', archived: false },
        ]);
        if (error) throw error;
        await stub('/__reset');
        const input = newSession();
        const r = await callFn('create-payment', { jwt: kioskA.jwt, body: { ...input, templateId: archivedId } });
        assertEquals([r.status, r.body], [400, { error: 'invalid_template_id' }]);
        assertEquals((await calls()).createIntent, 0);
        // A live template that is not the active one is fine (the kiosk's cached template can lag).
        const ok = await callFn('create-payment', { jwt: kioskA.jwt, body: { ...newSession(), templateId: otherId } });
        assertEquals(ok.status, 200);
      });

      await t.step('create-payment: no JWT 401, anon key 401, admin 403', async () => {
        const input = newSession();
        assertEquals((await callFn('create-payment', { body: input })).status, 401);
        assertEquals((await callFn('create-payment', { jwt: anonKey, body: input })).status, 401);
        const asAdmin = await callFn('create-payment', { jwt: admin.jwt, body: input });
        assertEquals([asAdmin.status, asAdmin.body], [403, { error: 'forbidden' }]);
      });

      await t.step('create-payment: PayMongo failure or a hosted QR URL -> 502, nothing stored', async () => {
        await stub('/__fail', { call: 'attach', status: 500 });
        const { input, r } = await create();
        assertEquals([r.status, r.body], [502, { error: 'payment_provider_error' }]);
        await stub('/__image', { value: 'https://example.com/qr.png' });
        const second = await create();
        await stub('/__image', { value: null });
        assertEquals(second.r.status, 502);
        const { count } = await db.from('sessions').select('id', { count: 'exact', head: true }).in('id', [input.sessionId, second.input.sessionId]);
        assertEquals(count, 0);
      });

      await t.step('webhook: bad, missing, malformed or wrong-mode signature -> 401, nothing changes', async () => {
        const { paymentId, intentId } = await created();
        const raw = webhookEvent('payment.paid', intentId);
        assertEquals((await sendWebhook(raw, { secret: 'whsk_wrong' })).status, 401);
        assertEquals((await callFn('paymongo-webhook', { rawBody: raw })).status, 401);
        assertEquals((await sendWebhook(raw, { header: 'garbage' })).status, 401);
        assertEquals((await sendWebhook(raw, { header: 't=,te=,li=' })).status, 401);
        assertEquals((await payment(paymentId)).status, 'pending');
        assertEquals((await callFn('paymongo-webhook', { method: 'GET' })).status, 405);
      });

      await t.step('webhook paid -> payment paid + session paid; second delivery changes nothing', async () => {
        const { paymentId, intentId } = await created();
        const raw = webhookEvent('payment.paid', intentId, PRICE);
        const r = await sendWebhook(raw);
        assertEquals(r.status, 200);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid']);
        assert(p.paid_at);
        assertEquals(p.last_event?.id, JSON.parse(raw).data.id);
        assertEquals((await sendWebhook(webhookEvent('payment.paid', intentId, PRICE))).status, 200);
        const again = await payment(paymentId);
        assertEquals([again.status, again.sessions.status, again.paid_at], ['paid', 'paid', p.paid_at]);
      });

      await t.step('webhook: an OLD but correctly signed event is accepted and applied (no replay window)', async () => {
        const { paymentId, intentId } = await created();
        const r = await sendWebhook(webhookEvent('payment.paid', intentId, PRICE), { t: Math.floor(Date.now() / 1000) - 3 * 86400 });
        assertEquals(r.status, 200);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid']);
      });

      await t.step('webhook: last_event is trimmed (no billing/contact details)', async () => {
        const { paymentId, intentId } = await created();
        const ev = JSON.parse(webhookEvent('payment.paid', intentId, PRICE));
        ev.data.attributes.data.attributes.billing = { name: 'Juan dela Cruz', email: 'juan@example.com', phone: '09111111111' };
        assertEquals((await sendWebhook(JSON.stringify(ev))).status, 200);
        const p = await payment(paymentId);
        assertEquals(p.last_event, {
          id: ev.data.id,
          type: 'payment.paid',
          amount: PRICE,
          currency: 'PHP',
          status: 'paid',
          paid_at: ev.data.attributes.data.attributes.paid_at,
          payment_intent_id: intentId,
        });
        // The kiosk can read last_event of its own payments: it must not see the payer's details.
        const res = await fetch(`${(await localStack()).apiUrl}/rest/v1/payments?id=eq.${paymentId}&select=last_event`, {
          headers: { apikey: anonKey, authorization: `Bearer ${kioskA.jwt}` },
        });
        const text = await res.text();
        assertEquals(res.status, 200);
        assert(text.includes(intentId));
        assertEquals(text.includes('juan'), false);
      });

      await t.step('webhook: concurrent duplicate deliveries -> one transition', async () => {
        const { paymentId, intentId } = await created();
        const rs = await Promise.all([1, 2, 3, 4].map(() => sendWebhook(webhookEvent('payment.paid', intentId, PRICE))));
        assertEquals(rs.map((r) => r.status), [200, 200, 200, 200]);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid']);
      });

      await t.step('webhook: unknown intent and ignored event types -> 200', async () => {
        assertEquals((await sendWebhook(webhookEvent('payment.paid', 'pi_does_not_exist'))).status, 200);
        assertEquals((await sendWebhook(JSON.stringify({ data: { attributes: { type: 'qr.expired' } } }))).status, 200);
      });

      await t.step('webhook payment.failed -> stays pending, last_event stored', async () => {
        const { paymentId, intentId } = await created();
        assertEquals((await sendWebhook(webhookEvent('payment.failed', intentId, PRICE))).status, 200);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['pending', 'awaiting_payment']);
        assertEquals(p.last_event?.type, 'payment.failed');
      });

      await t.step('cancel-payment: pending -> cancelled (payment and session); idempotent', async () => {
        const { paymentId } = await created();
        const r = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals([r.status, r.body], [200, { status: 'cancelled' }]);
        assertEquals(r.headers.get('access-control-allow-origin'), '*');
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['cancelled', 'cancelled']);
        const again = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals([again.status, again.body], [200, { status: 'cancelled' }]);
      });

      await t.step('cancel-payment after paid -> paid; payment stays paid', async () => {
        const { paymentId, intentId } = await created();
        await sendWebhook(webhookEvent('payment.paid', intentId, PRICE));
        const r = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals([r.status, r.body], [200, { status: 'paid' }]);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid']);
      });

      await t.step('cancel then late webhook -> payment paid, session paid_after_cancel; cancel now says paid', async () => {
        const { paymentId, intentId } = await created();
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'cancelled' });
        assertEquals((await sendWebhook(webhookEvent('payment.paid', intentId, PRICE))).status, 200);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid_after_cancel']);
        assert(p.paid_at);
        assertEquals((await sendWebhook(webhookEvent('payment.paid', intentId, PRICE))).status, 200);
        assertEquals((await payment(paymentId)).paid_at, p.paid_at);
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'paid' });
      });

      await t.step('cancel racing the webhook: the outcomes always agree', async () => {
        for (let i = 0; i < 5; i++) {
          const { paymentId, intentId } = await created();
          const [c, w] = await Promise.all([
            callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } }),
            sendWebhook(webhookEvent('payment.paid', intentId, PRICE)),
          ]);
          assertEquals([c.status, w.status], [200, 200]);
          const p = await payment(paymentId);
          assertEquals(p.status, 'paid');
          if (c.body!.status === 'paid') assertEquals(p.sessions.status, 'paid');
          else {
            assertEquals(c.body!.status, 'cancelled');
            assertEquals(p.sessions.status, 'paid_after_cancel');
          }
        }
      });

      // R19: reconciliation with PayMongo at cancel time.
      await t.step('cancel-payment: intent succeeded but the webhook never came -> paid; payment and session paid', async () => {
        const { paymentId, intentId } = await created();
        await stub('/__intent_status', { intentId, status: 'succeeded' });
        const before = (await calls()) as unknown as { retrieve: number };
        const r = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals([r.status, r.body], [200, { status: 'paid' }]);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['paid', 'paid']);
        assert(p.paid_at);
        assertEquals(((await calls()) as unknown as { retrieve: number }).retrieve, before.retrieve + 1);
        // A late webhook afterwards is a duplicate: nothing changes.
        assertEquals((await sendWebhook(webhookEvent('payment.paid', intentId, PRICE))).status, 200);
        assertEquals((await payment(paymentId)).paid_at, p.paid_at);
      });

      await t.step('cancel-payment: intent still awaiting payment -> cancelled as before', async () => {
        const { paymentId } = await created();
        const r = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals(r.body, { status: 'cancelled' });
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status], ['cancelled', 'cancelled']);
      });

      await t.step('cancel-payment: PayMongo lookup fails -> still cancelled (an outage never fails cancel)', async () => {
        const { paymentId, intentId } = await created();
        await stub('/__intent_status', { intentId, status: 'succeeded' });
        await stub('/__fail', { call: 'retrieve', status: 500 });
        const r = await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } });
        assertEquals([r.status, r.body], [200, { status: 'cancelled' }]);
        assertEquals((await payment(paymentId)).status, 'cancelled');
      });

      await t.step('cancel-payment: another kiosk never triggers a PayMongo lookup', async () => {
        const { paymentId, intentId } = await created();
        await stub('/__intent_status', { intentId, status: 'succeeded' });
        const before = ((await calls()) as unknown as { retrieve: number }).retrieve;
        const byB = await callFn('cancel-payment', { jwt: kioskB.jwt, body: { paymentId } });
        assertEquals([byB.status, byB.body], [403, { error: 'forbidden' }]);
        assertEquals(((await calls()) as unknown as { retrieve: number }).retrieve, before);
        assertEquals((await payment(paymentId)).status, 'pending');
      });

      // R18: a guest who paid during the kiosk's cancel retry window was served; the kiosk's `completed` upsert lands.
      const kioskUpsertCompleted = async (input: { sessionId: string; downloadToken: string; templateId: string }) => {
        const kiosk = await asUser(kioskA.jwt);
        return await kiosk.from('sessions').upsert({
          id: input.sessionId,
          template_id: input.templateId,
          download_token: input.downloadToken,
          amount_centavos: 15000, // stale cached price: healed to the stored amount by the guard
          status: 'completed',
          print_error: null,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
      };

      await t.step('cancel -> late webhook paid (paid_after_cancel) -> kiosk upsert completed succeeds', async () => {
        const { input, paymentId, intentId } = await created();
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'cancelled' });
        assertEquals((await sendWebhook(webhookEvent('payment.paid', intentId, PRICE))).status, 200);
        assertEquals((await payment(paymentId)).sessions.status, 'paid_after_cancel');
        const { error } = await kioskUpsertCompleted(input);
        assertEquals(error, null);
        const p = await payment(paymentId);
        assertEquals([p.status, p.sessions.status, p.sessions.amount_centavos], ['paid', 'completed', PRICE]);
      });

      await t.step('cancel -> intent succeeds, no webhook -> cancel retry says paid -> kiosk completes', async () => {
        const { input, paymentId, intentId } = await created();
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'cancelled' });
        await stub('/__intent_status', { intentId, status: 'succeeded' });
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'paid' });
        assertEquals((await payment(paymentId)).sessions.status, 'paid_after_cancel');
        assertEquals((await kioskUpsertCompleted(input)).error, null);
        assertEquals((await payment(paymentId)).sessions.status, 'completed');
      });

      await t.step('cancelled session (never paid): kiosk upsert completed is still rejected', async () => {
        const { input, paymentId } = await created();
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId } })).body, { status: 'cancelled' });
        const { error } = await kioskUpsertCompleted(input);
        assert(error, 'expected the guard to reject');
        assertEquals((await payment(paymentId)).sessions.status, 'cancelled');
      });

      // M8: a retry for a session whose payment is no longer pending never shows the old QR.
      await t.step('create-payment replay after cancel or paid -> 409 not_pending', async () => {
        const c = await created();
        await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId: c.paymentId } });
        const afterCancel = await callFn('create-payment', { jwt: kioskA.jwt, body: c.input });
        assertEquals([afterCancel.status, afterCancel.body], [409, { error: 'not_pending' }]);
        const p = await created();
        await sendWebhook(webhookEvent('payment.paid', p.intentId, PRICE));
        const afterPaid = await callFn('create-payment', { jwt: kioskA.jwt, body: p.input });
        assertEquals([afterPaid.status, afterPaid.body], [409, { error: 'not_pending' }]);
      });

      await t.step('cancel-payment: other kiosk 403, admin 403, no JWT 401, unknown 404, bad input 400', async () => {
        const { paymentId } = await created();
        const byB = await callFn('cancel-payment', { jwt: kioskB.jwt, body: { paymentId } });
        assertEquals([byB.status, byB.body], [403, { error: 'forbidden' }]);
        assertEquals((await payment(paymentId)).status, 'pending');
        assertEquals((await callFn('cancel-payment', { jwt: admin.jwt, body: { paymentId } })).status, 403);
        assertEquals((await callFn('cancel-payment', { body: { paymentId } })).status, 401);
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId: crypto.randomUUID() } })).status, 404);
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, body: { paymentId: 'nope' } })).status, 400);
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, rawBody: 'not json' })).status, 400);
        assertEquals((await callFn('cancel-payment', { jwt: kioskA.jwt, method: 'GET' })).status, 405);
        assertNotEquals((await payment(paymentId)).status, 'cancelled');
      });
    } finally {
      await setSettings(original.price_centavos, original.free_mode);
      if (sessions.length > 0) {
        await db.from('payments').delete().in('session_id', sessions);
        await db.from('sessions').delete().in('id', sessions);
      }
      if (templates.length > 0) await db.from('templates').delete().in('id', templates);
    }
  },
});
