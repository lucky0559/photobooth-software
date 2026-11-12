# Environments

Two phases. The code is the same in both; only accounts, keys, and plans change.

## Testing phase (now): free tiers only

| Need | Service | Plan | Limits that matter |
|---|---|---|---|
| Dev DB, auth, storage, functions, tests | Supabase CLI local stack (Docker) | Free | Runs only on the dev machine |
| Shared test backend for the kiosk PC | Supabase cloud | Free | 500 MB DB, 1 GB storage, project pauses after ~7 days without activity (restore from dashboard) |
| Admin panel + download page | Vercel | Hobby | Non-commercial use only — fine for testing, not for a paying client |
| Payments | PayMongo | Test mode keys | No real money moves; QR Ph test flow only |
| Email (full scope only) | Resend | Free | Daily/monthly send caps; test domain or one verified domain |
| Code hosting | GitHub | Free | — |
| Installer signing | none | — | Windows SmartScreen warns on install; acceptable for testing |

Rules for this phase:
- `PAYMONGO_MODE=test` everywhere. Live keys never go into the testing projects.
- Seed users from `supabase/seed.sql` exist only in the local stack. The cloud test project gets its own admin and kiosk users.
- **Never seed a hosted project.** Do not run `supabase db reset --linked` or `supabase db push --include-seed` against the cloud test or production project: both load `seed.sql`, which creates `admin@local.test` / `kiosk@local.test` with a published password. Apply schema to hosted projects with plain `supabase db push` only.
- Photos in the cloud test project are test data; purge them freely.

## Production phase (later): paid tiers

Check current pricing at migration time; plans change.

| Service | Move to | Why |
|---|---|---|
| Supabase | Pro | No pausing, daily backups, more storage and egress |
| Vercel | Pro (or another host that allows commercial use) | Hobby forbids commercial use |
| PayMongo | Live keys | Requires the client's verified business account (DTI/SEC) |
| Resend | Paid plan if volume exceeds the free cap | Event volume |
| Code signing | OV/EV certificate (optional) | Removes the SmartScreen warning |

## Migration checklist (testing → production)

1. Create a new Supabase Pro project (do not upgrade the test project in place; keep test data separate).
2. `supabase link --project-ref <prod-ref>` → `supabase db push`.
3. Create production admin and kiosk users and their `profiles` rows.
4. `supabase secrets set PAYMONGO_SECRET_KEY=<live> PAYMONGO_WEBHOOK_SECRET=<live> PAYMONGO_MODE=live` (+ `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` for full scope).
5. Deploy all Edge Functions; register the live PayMongo webhook to the production URL.
6. Deploy `apps/web` to the production host with production env vars and the client's domain.
7. Rebuild the kiosk installer with production `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_BASE_URL`.
8. Re-run `docs/ACCEPTANCE.md` row 1 with a real ₱20 payment, then refund it from the PayMongo dashboard.
