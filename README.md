# Photobooth Software

Self-service photobooth kiosk for the Philippine market: GCash/Maya QR Ph payment (PayMongo), 1–4 shots, a printed
copy, and a QR code to download the photo on a phone. Software only; the client supplies the Windows PC, camera and
photo printer. This repo is the **lean MVP** ([plan](docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md)); everything in it is
built and tested automatically, but not yet run on real hardware or against real PayMongo (see "Known limitations").

## Architecture

1. **Kiosk** (`apps/kiosk`): Electron + React app on the Windows PC. Runs the guest flow, composes the print sheet,
   prints silently, and keeps an offline queue (`queue.json`) of sessions and photo uploads.
2. **Supabase**: Postgres (RLS: `admin` and `kiosk` roles), Auth (email + password), Storage (`templates`, `photos`).
3. **Edge Functions** (`supabase/functions`): `create-payment` and `cancel-payment` (kiosk → PayMongo) and
   `paymongo-webhook` (PayMongo → database). Only they hold PayMongo secrets.
4. **Web** (`apps/web`): Next.js admin (`/admin`: dashboard, price, templates, settings) and the public download page
   (`/d/<token>`).
5. **Core** (`packages/core`): shared TypeScript (money, settings validation, layouts, templates), used by all three.
6. Money is integer centavos everywhere; dates group by Asia/Manila.

## Repo layout

```text
apps/kiosk/         Electron kiosk (main, preload, renderer), unit tests in test/, Playwright e2e in e2e/
apps/web/           Next.js admin + download page, unit tests next to the code, Playwright e2e in e2e/
packages/core/      Shared TypeScript library (@pb/core)
supabase/           config.toml, migrations/, seed.sql (local only), tests/ (pgTAP), functions/ (Deno)
scripts/            sync-core-to-functions.mjs (copies @pb/core into supabase/functions/_shared/core/)
docs/               Spec, design, environments, deploy guide, acceptance checklist, plans
```

## Quick start (development, macOS/Windows/Linux)

Needs Node 22, pnpm 9 (`corepack enable` uses the pinned `pnpm@9.15.0`), Docker, the Supabase CLI and Deno.

```sh
pnpm install

# Electron's binary download is an install script. If pnpm skipped it (pnpm 10+ blocks scripts unless approved
# with `pnpm approve-builds`), the kiosk fails with "Electron failed to install correctly". Fix:
cd apps/kiosk/node_modules/electron && node install.js && cd -

# Local Supabase (Docker). Applies the migrations and supabase/seed.sql, which creates the LOCAL-ONLY users
# admin@local.test and kiosk@local.test, password localpass123, plus a sample template row.
supabase start
supabase status -o env            # local URL and keys for the .env files below
supabase db reset                 # re-create the local database and re-seed it (local only)
```

Web (admin at <http://localhost:3000/admin/login>, sign in as `admin@local.test`):

```sh
cp apps/web/.env.example apps/web/.env.local     # fill in the local URL, anon and service-role keys
pnpm --filter web dev
```

Kiosk:

```sh
cp apps/kiosk/.env.example apps/kiosk/.env       # local URL + anon key; VITE_WEB_BASE_URL=http://localhost:3000
pnpm --filter kiosk dev                          # first run opens Setup: set a PIN, sign in as kiosk@local.test
```

Edge Functions locally (needs `supabase/.env.local`, copied from `supabase/.env.example`; dummy PayMongo values):

```sh
node scripts/sync-core-to-functions.mjs
supabase functions serve --env-file supabase/.env.local
```

## Tests

| What | Command |
| --- | --- |
| All unit tests (core, web, kiosk) | `pnpm test` |
| Typecheck all packages | `pnpm typecheck` (same as `pnpm -r typecheck`) |
| Core | `pnpm --filter @pb/core test` |
| Kiosk unit | `pnpm --filter kiosk test` |
| Kiosk e2e (fake API, builds into `out-e2e/`, launches Electron) | `pnpm --filter kiosk e2e` |
| Kiosk production build + bundle guard | `pnpm --filter kiosk build` |
| Web unit | `pnpm --filter web test` |
| Web lint | `pnpm --filter web lint` |
| Web e2e (local Supabase running; production build on :3100) | `pnpm --filter web e2e` (first time: `pnpm --filter web exec playwright install chromium`) |
| Database (pgTAP, local stack) | `supabase test db` |
| Edge Function unit tests | `cd supabase/functions && deno task test` |
| Edge Function integration (local stack; PayMongo stub) | `cd supabase/functions && deno task test:integration` |

Packaging: `pnpm --filter kiosk package` (unpacked app in `apps/kiosk/dist/`) and `pnpm --filter kiosk build:win`
(Windows installer; run it on the Windows PC). Both always run the production build first. See
[docs/DEPLOY.md](docs/DEPLOY.md) section E.

Trial flavour (in-memory demo backend, no Supabase/PayMongo, simulated payment): `pnpm --filter kiosk dev:trial` (any OS) to
run it in development, `pnpm --filter kiosk build:trial` for the installer (`apps/kiosk/dist-trial/`). The trial runs paired print (two guests per 4x6 sheet, cut down the
middle, a 10-minute wait for the second guest, one held strip at most). See
[docs/DEPLOY.md](docs/DEPLOY.md) section E.9.

## Documents

| Document | What it is |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | Agreed scope for both tiers, outputs, PC requirements, budget |
| [docs/DESIGN.md](docs/DESIGN.md) | Kiosk visual design ("Pop Film Lab" theme) |
| [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) | Free tiers for testing, paid tiers for production, migration checklist |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Step-by-step deploy (Supabase, Edge Functions, PayMongo, Vercel, kiosk installer), Windows hardening, operator runbook |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Real-hardware acceptance checklist (not run yet) |
| [docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md](docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md) | Lean MVP plan (this build) |
| [docs/plans/full-scope/IMPLEMENTATION_PLAN.md](docs/plans/full-scope/IMPLEMENTATION_PLAN.md) | Full scope: lean MVP + extension tasks |

**Free tiers now, paid later.** The testing phase uses only free tiers: local Supabase in Docker, Supabase Free, Vercel
Hobby (non-commercial use only) and PayMongo test keys. Taking real money needs the paid production setup in
[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md).

## Known limitations / not yet verified

- **Real printer:** silent printing, 4x6 borderless output and strip cutting are untested on the client's printer
  (ACCEPTANCE.md, Task 9 and rows 6–7).
- **Real PayMongo:** every PayMongo response and webhook shape is synthetic (from the docs); signature encoding, QR
  format, PayMongo's own minimum (₱20 is our own validation), `expiry_seconds` and the intent-retrieve status used by
  `cancel-payment` are unverified until the Task 5 run in ACCEPTANCE.md.
- **Windows installer:** the NSIS installer has been cross-built on macOS only (it built, with icon/version metadata),
  never installed or run on Windows. It is unsigned (SmartScreen warning) and has no auto-update.
- **Hosted Edge Function bundle:** `supabase functions deploy` has not been run against a hosted project; only local
  `functions serve` is verified (DEPLOY.md B.4).
- **Templates over ~4.2 MB on Vercel:** the platform's request-body limit blocks them; direct-to-Storage upload (signed
  upload URL) is a follow-up. Local and self-hosted deployments accept 10 MB.
- **CSP:** uses `script-src 'unsafe-inline'` instead of per-request nonces (nonce CSP is a possible hardening pass).
- **Template archive vs set-active race:** handled by a database trigger (migration
  `20261111000004_template_integrity.sql`), not in the app.
- No reprint (lean MVP scope). Refunds are made in the PayMongo dashboard; the admin only records them ("Mark
  refunded", DEPLOY.md G.3).
- **Out-of-paper:** silent printing may not report it (Chromium only reports that the job was spooled); staff watch the
  printer (ACCEPTANCE.md row 6).
