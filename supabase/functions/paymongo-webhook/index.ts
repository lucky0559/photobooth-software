// POST /functions/v1/paymongo-webhook  (no JWT: config.toml verify_jwt = false; deploy with --no-verify-jwt)
//
// 401 when the `Paymongo-Signature` does not verify; otherwise 200 for every verified event, including unknown
// intents and event types we ignore, so PayMongo stops retrying. 500 only when our database fails (PayMongo retries).
//
// payment.paid   → applyPaidEvent: pending → paid (session paid); cancelled → paid (session paid_after_cancel, the
//                  operator refunds); already paid → nothing (duplicate delivery).
// payment.failed → logged and stored in last_event only; the payment stays pending, because a failed attempt on a
//                  QR Ph intent can still be followed by a successful one before the QR expires.
// The raw event of every verified payment.* delivery for a known intent is stored in payments.last_event.
import { handle, HttpError, json, readBodyText, requireEnv } from '../_shared/http.ts';
import { applyPaidEvent } from '../_shared/payments.ts';
import { parsePaidEvent, parseWebhookEvent, verifyWebhookSignature } from '../_shared/paymongo.ts';
import { serviceClient, SupabasePaymentStore } from '../_shared/supabase.ts';

const MAX_BODY_BYTES = 256 * 1024;

Deno.serve(
  handle(
    'paymongo-webhook',
    async (req) => {
      if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, false);

      const secret = requireEnv('PAYMONGO_WEBHOOK_SECRET');
      const mode = requireEnv('PAYMONGO_MODE');
      if (mode !== 'test' && mode !== 'live') throw new Error('PAYMONGO_MODE must be test or live');

      const raw = await readBodyText(req, MAX_BODY_BYTES);
      const ok = await verifyWebhookSignature(req.headers.get('paymongo-signature') ?? '', raw, secret, mode);
      if (!ok) return json(401, { error: 'invalid_signature' }, false);

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'invalid_json');
      }
      const event = parseWebhookEvent(body);
      if (!event) {
        console.warn('paymongo-webhook: verified delivery without an event type, ignored');
        return json(200, { received: true }, false);
      }

      const store = new SupabasePaymentStore(serviceClient());
      if (event.type === 'payment.paid') {
        const paid = parsePaidEvent(body);
        if (!paid) {
          console.warn('paymongo-webhook: payment.paid without a payment intent id or amount, ignored');
          return json(200, { received: true }, false);
        }
        // paid_at is our clock: the event's own timestamp is informational and stays in last_event.
        const outcome = await applyPaidEvent(store, paid.intentId, new Date().toISOString());
        if (outcome !== 'unknown_intent') await store.recordEvent(paid.intentId, body);
        console.log(`paymongo-webhook: payment.paid ${paid.intentId} -> ${outcome}`);
        return json(200, { received: true }, false);
      }

      if (event.type === 'payment.failed') {
        console.warn(`paymongo-webhook: payment.failed for ${event.intentId ?? 'unknown intent'}; payment left pending`);
        if (event.intentId) await store.recordEvent(event.intentId, body);
        return json(200, { received: true }, false);
      }

      console.log(`paymongo-webhook: ${event.type} ignored`);
      return json(200, { received: true }, false);
    },
    false,
  ),
);
