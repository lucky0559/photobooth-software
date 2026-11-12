# PayMongo fixtures

> **SYNTHETIC — built from PayMongo docs, NOT captured from the live API; verify with a real test-mode run (docs/ACCEPTANCE.md).**

No PayMongo credentials existed when Task 5 was implemented, so the brief's Step 1 (capture real responses with a
test key) could not be done. These files were written by hand from the published documentation (read 2026-11-12):

- QR Ph API flow and QR location: https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api
- Attach response (Payment Intent resource): https://docs.paymongo.com/reference/attach-to-paymentintent
- Create Payment Intent / Payment Method: https://docs.paymongo.com/reference/create-a-paymentintent,
  https://docs.paymongo.com/reference/create-a-paymentmethod
- Webhook events and the `payment.paid` payload: https://docs.paymongo.com/docs/developer-tools-webhooks-events

| File | What it stands for | Fields the code reads |
| --- | --- | --- |
| `attach-qrph.json` | `POST /v1/payment_intents/{id}/attach` response for a `qrph` payment method | `data.id` (intent id), `data.attributes.next_action.code.image_url` (QR image) |
| `webhook-payment-paid.json` | Body of a `payment.paid` webhook delivery | `data.attributes.type`, `data.attributes.data.attributes.payment_intent_id`, `data.attributes.data.attributes.amount` |

Guessed (documented nowhere we could read): `next_action.type` (`consume_qr`), the keys of `next_action.code` other
than `image_url`, and whether `image_url` carries the `data:image/png;base64,` prefix (the docs call it a "Base64
string"; `paymongo.ts` accepts both forms). Everything the code reads is isolated in the mapping functions at the
top of `../paymongo.ts`, so a correction after the real test-mode run is a one-line change there plus an update of
these files.
