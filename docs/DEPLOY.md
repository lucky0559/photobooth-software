# Deploy notes

Started by Task 5; later tasks extend it.

## Edge Functions (create-payment, cancel-payment, paymongo-webhook)

1. Copy `@pb/core` into the functions folder: `node scripts/sync-core-to-functions.mjs`.
   The Supabase CLI only sees files under `supabase/functions` (an import of `../../packages/core` fails at worker
   boot with "Module not found"), so `supabase/functions/deno.json` maps `@pb/core` to the gitignored copy in
   `supabase/functions/_shared/core/`. Run the script after every change to `packages/core` and before every deploy.
2. Secrets (never in git): `supabase secrets set PAYMONGO_SECRET_KEY=… PAYMONGO_WEBHOOK_SECRET=… PAYMONGO_MODE=test|live`.
   `PAYMONGO_API_BASE` stays unset outside local tests. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.
3. `supabase db push` (applies `20261111000002_payment_functions.sql`), then `supabase functions deploy`.
   `paymongo-webhook` must run without JWT verification: `config.toml` sets `[functions.paymongo-webhook]
   verify_jwt = false`; the explicit form is `supabase functions deploy paymongo-webhook --no-verify-jwt`.
4. Register the webhook in the PayMongo dashboard (events `payment.paid`, `payment.failed`) and set
   `PAYMONGO_WEBHOOK_SECRET` to the secret it shows.
5. Before taking real money: `docs/ACCEPTANCE.md`, "Task 5 — real PayMongo test-mode run before go-live".

## Operator note: refund signals

- `paid_after_cancel`: the guest cancelled (or the payment screen timed out and the server confirmed the cancel), then
  the payment still arrived. Refund it.
- **Paid and not completed after 10 minutes**: during an outage the kiosk can give up asking the server to cancel
  (about 2.5 minutes of retries) and return to the start screen while the server row is still `awaiting_payment`. If
  the payment then lands, the webhook records it as plain `paid` (not `paid_after_cancel`, because the cancel never
  reached the server) and the session is never completed, since the guest has left. The Task 13 dashboard's
  `needsAttention` list ("paid sessions not completed within 10 minutes", next to `paid_after_cancel`) is therefore
  the refund signal for this case too.

## Local

- `supabase/.env.local` (gitignored; copy `supabase/.env.example`, dummy values) for
  `supabase functions serve --env-file supabase/.env.local`.
- Unit tests: `cd supabase/functions && deno task test`.
- Integration tests (local stack running): `cd supabase/functions && deno task test:integration`. It syncs core,
  starts the PayMongo stub on :54399 and `functions serve`, runs `_integration/`, and stops both.
