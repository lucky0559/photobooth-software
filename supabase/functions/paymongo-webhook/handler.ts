// The paymongo-webhook request handler, separate from Deno.serve so unit tests can drive it with an in-memory store.
//
// 401 when the `Paymongo-Signature` does not verify; otherwise 200 for every verified event, including unknown
// intents and event types we ignore, so PayMongo stops retrying. 500 when our database fails (PayMongo retries).
//
// payment.paid   → applyPaidEvent: pending → paid (session paid); cancelled → paid (session paid_after_cancel, the
//                  operator refunds); already paid → nothing (duplicate delivery). A paid amount that differs from
//                  the stored one is logged and still applied.
// payment.failed → logged and stored in last_event only; the payment stays pending, because a failed attempt on a
//                  QR Ph intent can still be followed by a successful one before the QR expires.
// last_event holds a trimmed copy of the event (trimEvent): no payer billing/contact details.
import { handle, HttpError, json, readBodyText } from '../_shared/http.ts';
import { parsePaidEvent, parseWebhookEvent, type TrimmedEvent, trimEvent, verifyWebhookSignature } from '../_shared/paymongo.ts';
import { applyPaidEvent, type PaymentStore } from '../_shared/payments.ts';

const MAX_BODY_BYTES = 256 * 1024;

export interface WebhookStore extends PaymentStore {
  /** Stores the trimmed event on the intent's payment; returns that payment's amount, or null when there is none. */
  recordEvent(intentId: string, event: TrimmedEvent): Promise<number | null>;
}

export interface WebhookDeps {
  store: WebhookStore;
  secret: string;
  mode: 'test' | 'live';
}

/** `deps` is called per request, inside the error handler, so a missing secret is a 500 rather than a crash. */
export function webhookHandler(deps: () => WebhookDeps): (req: Request) => Promise<Response> {
  const ok = () => json(200, { received: true }, false);
  return handle(
    'paymongo-webhook',
    async (req) => {
      if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, false);
      const { store, secret, mode } = deps();

      const raw = await readBodyText(req, MAX_BODY_BYTES);
      if (!(await verifyWebhookSignature(req.headers.get('paymongo-signature') ?? '', raw, secret, mode))) {
        // One fixed line (no body, headers or secret) so a wrong PAYMONGO_WEBHOOK_SECRET / PAYMONGO_MODE or an
        // attacker is visible in the function logs (docs/DEPLOY.md, webhook health check).
        console.warn('webhook: signature rejected');
        return json(401, { error: 'invalid_signature' }, false);
      }

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'invalid_json');
      }
      const event = parseWebhookEvent(body);
      if (!event) {
        console.warn('paymongo-webhook: verified delivery without an event type, ignored');
        return ok();
      }

      if (event.type === 'payment.paid') {
        const paid = parsePaidEvent(body);
        if (!paid) {
          console.warn('paymongo-webhook: payment.paid without a payment intent id or amount, ignored');
          return ok();
        }
        // paid_at is our clock: the event's own timestamp is informational and stays in last_event.
        const outcome = await applyPaidEvent(store, paid.intentId, new Date().toISOString());
        if (outcome !== 'unknown_intent') {
          const stored = await store.recordEvent(paid.intentId, trimEvent(body));
          if (stored !== null && stored !== paid.amountCentavos) {
            console.warn(
              `paymongo-webhook: amount mismatch for ${paid.intentId}: paid ${paid.amountCentavos}, stored ${stored} (applied anyway)`,
            );
          }
        }
        console.log(`paymongo-webhook: payment.paid ${paid.intentId} -> ${outcome}`);
        return ok();
      }

      if (event.type === 'payment.failed') {
        console.warn(`paymongo-webhook: payment.failed for ${event.intentId ?? 'unknown intent'}; payment left pending`);
        if (event.intentId) await store.recordEvent(event.intentId, trimEvent(body));
        return ok();
      }

      console.log(`paymongo-webhook: ${event.type} ignored`);
      return ok();
    },
    false,
  );
}
