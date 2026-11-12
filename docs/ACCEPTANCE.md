## Task 9 — printer check (Windows, real printer)

Not yet run: requires the client's Windows machine and printer.

Steps:

1. Install and launch the kiosk build on Windows. Open Setup (PIN, then the devices step).
2. In the Printer dropdown, pick the client's photo printer.
3. In the printer driver preferences, set paper to 4x6 (borderless if offered) and note whether the 2-inch cut is on or off.
4. Click `Print test page`.

Expected:

- `Test page sent` appears and one 4x6 sheet prints with no print dialog.
- The 10 px black border is visible on all four edges, or bleeds evenly off all four (borderless). Nothing is cropped unevenly.
- `4x6 TEST` is centered.

| Printer model | Driver / version | Paper size | Cut on/off | Result (pass/fail, notes) |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

Additional Task 9 check: print a REAL photo sheet (a full-colour 1200x1800 photo composed in the kiosk, JPEG of at least 1 MB), not only the test page, and confirm it prints.

| Printer model | Real photo sheet size (MB) | Result (pass/fail, notes) |
| --- | --- | --- |
|  |  |  |

## Task 5 — real PayMongo test-mode run before go-live

**Mandatory. Not yet run:** no PayMongo credentials existed when Task 5 was built. The fixtures in
`supabase/functions/_shared/__fixtures__/` and the JSON paths in `supabase/functions/_shared/paymongo.ts` are
SYNTHETIC, written from PayMongo's docs, and every automated test ran against a local stub. Do not take real money
until every row below passes.

Safety: PayMongo's testing docs warn that test-mode QR Ph codes are **live QR Ph codes**. Do **not** scan and pay one
with a real banking or e-wallet app: that moves real money. Use the test simulation link PayMongo returns instead.

Setup (Supabase Free test project, PayMongo test keys only):

1. `node scripts/sync-core-to-functions.mjs`, then deploy the three functions; `paymongo-webhook` without JWT
   verification (`config.toml` sets it; or `supabase functions deploy paymongo-webhook --no-verify-jwt`).
2. `supabase secrets set PAYMONGO_SECRET_KEY=sk_test_… PAYMONGO_MODE=test` (no `PAYMONGO_API_BASE`).
3. In the PayMongo dashboard (test mode), add a webhook to
   `https://<project-ref>.supabase.co/functions/v1/paymongo-webhook` for `payment.paid` and `payment.failed`; then
   `supabase secrets set PAYMONGO_WEBHOOK_SECRET=<the secret the dashboard shows>`.

Steps and checks:

1. Create a test intent: call `create-payment` with the kiosk user's JWT (or start a paid session on the kiosk).
   Save the raw attach response once (temporary `console.log` or the same three calls with `curl` and the test key).
   - [ ] The QR is at `data.attributes.next_action.code.image_url` and is a `data:image/png;base64,…` URL or bare
     base64 (`qrImageDataUrlFrom` in `paymongo.ts`). If not, fix that one function and the fixture.
   - [ ] The intent id is `data.id` (`pi_…`).
   - [ ] The QR shows on the kiosk; the amount equals the admin price.
   - [ ] Note the field that holds the test simulation link (docs: "test_url"): ______
2. Pay with the PayMongo test flow (simulation link, not a real wallet).
   - [ ] A `payment.paid` delivery reaches `paymongo-webhook` and gets **200** (Supabase function logs). A **401**
     means the signature check disagrees with PayMongo: check `te` vs `li`, hex encoding, and that the raw body is
     signed as `${t}.${rawBody}`.
   - [ ] The intent id is at `data.attributes.data.attributes.payment_intent_id` and the amount at
     `data.attributes.data.attributes.amount` (`parseWebhookEvent` / `parsePaidEvent`).
   - [ ] `payments.status = 'paid'`, `paid_at` set, `sessions.status = 'paid'`, `payments.last_event` holds the event;
     the kiosk leaves the payment screen.
   - [ ] Save the real webhook body (amounts and ids only, no keys) over `__fixtures__/webhook-payment-paid.json`, the
     real attach response over `__fixtures__/attach-qrph.json`, remove the SYNTHETIC banners, rerun the unit tests.
3. Retries and replay window: in the dashboard, resend the same event a few minutes later.
   - [ ] It gets 200 and changes nothing. Note whether `t` in `Paymongo-Signature` is fresh on each resend. If a
     retry keeps the original `t`, the 10-minute window (`SIGNATURE_TOLERANCE_SECONDS`) would reject late retries:
     widen it before go-live.
4. Cancel race: start a payment, tap Cancel, then pay the (still valid) QR through the simulation link.
   - [ ] `payments.status = 'paid'`, `sessions.status = 'paid_after_cancel'` (operator refund signal).
5. Failure: trigger a failed attempt through the simulation link if offered.
   - [ ] `payment.failed` gets 200, the payment stays `pending`, `last_event` holds it.
6. Minimum: set the price to ₱20.00 and create a payment.
   - [ ] PayMongo accepts 2000 centavos for QR Ph.
7. QR expiry: `paymongo.ts` sets `expiry_seconds = 300` on the payment method.
   - [ ] PayMongo accepts it (an error here shows as "Payments are unavailable" on the kiosk).

| Date | PayMongo mode | Check | Result (pass/fail, notes) |
| --- | --- | --- | --- |
|  | test |  |  |
