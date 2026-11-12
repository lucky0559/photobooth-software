# Deploy guide

How to put the photobooth online and onto the kiosk PC, in order. Do the sections A → G once per environment.

- **Testing phase (now):** Supabase **Free**, Vercel **Hobby**, PayMongo **test** keys, `PAYMONGO_MODE=test`. No paid
  service is needed.
- **Production phase (later):** Supabase Pro, a commercial web host, PayMongo **live** keys. Follow the same sections
  against a new production project, using [ENVIRONMENTS.md](ENVIRONMENTS.md) → "Migration checklist" as the order of
  work; it lists what changes between the phases.

Never put a real key, password or `.env` file into git. Placeholders below look like `<project-ref>`.

Tools on the machine you deploy from: Node 22, pnpm 9 (`corepack enable` picks up `pnpm@9.15.0` from the root
`package.json`), the Supabase CLI (these steps were written against CLI 3.1.0), and a clone of this repo.

> Supabase CLI 3.x targets the **local** database by default. Every command that must hit the hosted project below
> says `--remote` (meaning: the linked project). Without it, `db push` changes your local Docker stack instead.

## A. Supabase project

1. In the Supabase dashboard create a project (testing: Free plan; production: a new Pro project, see
   ENVIRONMENTS.md). Pick the region closest to the Philippines (Singapore). Keep the database password in a password
   manager.
2. From the repo root, log in and link:

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   ```

3. Apply the schema (migrations `supabase/migrations/20261111000001_init.sql` … `20261111000004_template_integrity.sql`;
   they also create the `templates` and `photos` storage buckets):

   ```sh
   supabase db push --remote --dry-run   # lists the migrations it would apply
   supabase db push --remote
   ```

   **Never** add `--include-seed`, and never run `supabase db reset --remote` (older CLIs: `--linked`) against a hosted
   project. `supabase/seed.sql` is for the local stack only: it creates users with a published password.
4. Turn off public sign-ups: Dashboard → Authentication → Sign In / Providers → turn off "Allow new users to sign
   up". Only the two accounts below should exist.
5. Create the two accounts: Dashboard → Authentication → Users → Add user → Create new user, with a strong password
   and "Auto Confirm User" ticked:
   - the **admin** account (the operator signs in to `/admin` with it), e.g. `owner@<client-domain>`;
   - the **kiosk** account (the kiosk PC signs in with it in Setup), e.g. `kiosk1@<client-domain>`. Use an address
     that is not a person's mailbox; nothing is ever emailed to it.
6. Give each account its role. Dashboard → SQL Editor, replace the two emails, run:

   ```sql
   insert into public.profiles (user_id, role)
   select id, 'admin' from auth.users where email = 'owner@example.com';

   insert into public.profiles (user_id, role)
   select id, 'kiosk' from auth.users where email = 'kiosk1@example.com';

   -- Check: exactly two rows, one admin and one kiosk.
   select p.role, u.email from public.profiles p join auth.users u on u.id = p.user_id;
   ```

   An account without a `profiles` row can sign in to Supabase but can read and write nothing (RLS).
7. Auth redirect URLs / Site URL: not used. The admin and the kiosk sign in with email + password only; no email links
   or OAuth redirects are sent, so the defaults can stay.
8. Note for sections D and E (Dashboard → Project Settings → API / API Keys): the project URL
   `https://<project-ref>.supabase.co`, the **anon / publishable** key, and the **service_role / secret** key
   (server-only, section D).

## B. Edge Functions

Three functions: `create-payment` and `cancel-payment` (called by the kiosk with its login) and `paymongo-webhook`
(called by PayMongo, no login).

1. Copy `@pb/core` into the functions folder (run after every change to `packages/core` and before every deploy):

   ```sh
   node scripts/sync-core-to-functions.mjs
   ```

   The Supabase CLI only bundles files under `supabase/functions`, so `supabase/functions/deno.json` maps `@pb/core`
   to the gitignored copy in `supabase/functions/_shared/core/`.
2. Secrets. The functions read exactly these (checked against `supabase/functions/**`):

   | Variable | Read by | Value |
   | --- | --- | --- |
   | `PAYMONGO_SECRET_KEY` | `create-payment` | `sk_test_…` (testing) / `sk_live_…` (production) |
   | `PAYMONGO_WEBHOOK_SECRET` | `paymongo-webhook` | The webhook signing secret from section C |
   | `PAYMONGO_MODE` | `paymongo-webhook` | `test` or `live`; anything else makes every webhook call fail. It picks which signature (`te` or `li`) is checked, so it must match the keys. |
   | `PAYMONGO_API_BASE` | `create-payment` | **Leave unset** on hosted projects (defaults to `https://api.paymongo.com`; only the local stub tests set it). |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | all three | Provided by the platform. Do not set them. |

   `cancel-payment` reads only the platform variables. Set the first two now (the webhook secret comes in section C):

   ```sh
   supabase secrets set PAYMONGO_SECRET_KEY=sk_test_xxx PAYMONGO_MODE=test
   supabase secrets list
   ```

3. Deploy:

   ```sh
   supabase functions deploy create-payment cancel-payment
   supabase functions deploy paymongo-webhook --no-verify-jwt
   ```

   `paymongo-webhook` must accept calls without a Supabase JWT (PayMongo has none); its own signature check is the
   protection. `supabase/config.toml` also sets `verify_jwt = false` for it, the flag makes it explicit.

   ⚠️ Unverified (not yet deployed against a hosted project): by default the CLI bundles functions locally with
   Docker. On a machine without Docker running, add `--use-api` (bundles server-side) to both commands, e.g.
   `supabase functions deploy paymongo-webhook --no-verify-jwt --use-api`.
4. **Caveat: the deploy bundle has not been verified.** The CLI has no dry-run bundle, and no hosted project existed
   while this was built, so only `supabase functions serve` (local) has been exercised. After the first deploy, open
   Dashboard → Edge Functions → each function → Logs, and run the Task 5 section of [ACCEPTANCE.md](ACCEPTANCE.md). A
   boot error such as `Module not found` for `@pb/core` means step 1 was skipped.

Function URLs: `https://<project-ref>.supabase.co/functions/v1/<name>`.

## C. PayMongo

1. Testing: use the PayMongo dashboard in **test mode** and its test keys (Developers → API keys): the secret key
   `sk_test_…` goes into `PAYMONGO_SECRET_KEY` (section B). The public key is not used.
2. Register the webhook for the same mode:
   - URL: `https://<project-ref>.supabase.co/functions/v1/paymongo-webhook`
   - Events: `payment.paid` and `payment.failed` (nothing else is needed).

   In the dashboard: Developers → Webhooks → add an endpoint, if your account shows that page. Otherwise create it
   through the API with the same secret key (one call; check the request shape against PayMongo's current "Create a
   webhook" reference):

   ```sh
   curl https://api.paymongo.com/v1/webhooks -u sk_test_xxx: \
     -H 'Content-Type: application/json' \
     -d '{"data":{"attributes":{"url":"https://<project-ref>.supabase.co/functions/v1/paymongo-webhook","events":["payment.paid","payment.failed"]}}}'
   ```

3. Copy the webhook's **signing secret** (`whsk_…`; shown on the webhook's page, or `data.attributes.secret_key` in
   the API response) and set it:

   ```sh
   supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_xxx
   ```

4. Test-mode QR Ph codes are **live** QR Ph codes: never pay one with a real wallet or bank app. Use the test
   simulation link (see ACCEPTANCE.md, Task 5 section).
5. Going live (production phase): live keys exist only after PayMongo verifies the client's business. Create a
   **separate** live webhook with the live secret key, then
   `supabase secrets set PAYMONGO_SECRET_KEY=sk_live_xxx PAYMONGO_WEBHOOK_SECRET=<live whsk> PAYMONGO_MODE=live` on
   the production project, and run the go-live row in ACCEPTANCE.md.

## D. Web app (admin + download page) on Vercel

1. Vercel → Add New → Project → import this Git repository.
2. **Root Directory: `apps/web`.** Framework preset: Next.js (detected). Leave build and install commands at their
   defaults: Vercel installs the pnpm workspace from the repo-root `pnpm-lock.yaml` (`@pb/core` comes from
   `packages/core`). If the install picks the wrong pnpm version, add the environment variable
   `ENABLE_EXPERIMENTAL_COREPACK=1` so the `packageManager` field (`pnpm@9.15.0`) is used.
3. Environment variables (Production, and Preview if you use previews):

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Build time: also baked into the Content-Security-Policy, so **redeploy** after changing it. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon / publishable key | Browser-safe; RLS enforces admin-only access. |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key | **Required. Mark it Sensitive.** Server only, never with a `NEXT_PUBLIC_` prefix. Only the public download page `/d/<token>` uses it (`apps/web/lib/download.ts`). Without it every download link shows an error page. |
   | `NEXT_PUBLIC_TEMPLATE_UPLOAD_MAX_BYTES` | `4404020` on Hobby | Optional elsewhere (default and ceiling 10485760). Vercel Functions reject request bodies over 4.5 MB, so on Vercel the form refuses templates over 4.2 MB up front instead of failing mid-upload. |

4. Deploy. Check: `https://<vercel-url>/admin/login` loads and the admin account from A.5 signs in.
5. Notes:
   - **Vercel Hobby is for non-commercial use only.** It is fine for the testing phase; production needs Vercel Pro
     or another host (ENVIRONMENTS.md).
   - Template overlays over 4.2 MB cannot be uploaded on Vercel (the platform's ~4.5 MB body limit wins over the
     11 MB Server Action limit in `next.config.ts`). With `NEXT_PUBLIC_TEMPLATE_UPLOAD_MAX_BYTES=4404020` the form
     answers "Template must be 4.2 MB or smaller" before sending; a request the host still rejects shows "Upload
     failed. The file may be larger than this server accepts (limit 4.2 MB)." Local and self-hosted `next start`
     accept the full 10 MB. The fix for larger templates (direct upload to Storage) is not built yet.
   - HSTS is sent with `includeSubDomains` and a 2-year max-age (no preload): every subdomain of the production
     domain must serve HTTPS before go-live.
   - Do not put a caching CDN rule in front of `/d/*` (it sends `Cache-Control: no-store`).
   - Login rate limiting is Supabase Auth's built-in limits; the admin app adds none.
6. Before building the kiosk, sign in to `/admin`, upload at least one template, make it active, and set the price
   (or free mode) and the link expiry. The kiosk refuses to start sessions without an active template
   ("Setup needed: no active template").

## E. Kiosk PC (Windows 10/11 x64)

Build the installer **on the Windows PC** (or another Windows machine) for the real run: the build bakes the
environment below into the app, and the installer is meant to be built, installed and tested there. A cross-build on
macOS has produced a Windows exe with the correct name and version metadata, but it is not a substitute for building
and installing on Windows.

No app icon is configured yet: the installer and the exe use Electron's default icon (later: add
`apps/kiosk/build/icon.ico` and `win.icon` in `electron-builder.yml`).

1. Install Node 22 LTS and Git for Windows.
2. **Pre-flight: pnpm 9.** In a new terminal:

   ```powershell
   corepack enable
   corepack prepare pnpm@9.15.0 --activate
   pnpm -v
   ```

   `pnpm -v` must print `9.x` (the repo pins `pnpm@9.15.0`). pnpm 9 runs dependency install scripts, including
   Electron's binary download. If you are on pnpm 10+ anyway (it blocks install scripts by default), run
   `pnpm approve-builds` after the install and approve `electron`.
3. Get the code and install:

   ```powershell
   git clone <repo-url> photobooth-software
   cd photobooth-software
   pnpm install --frozen-lockfile
   ```

   Check that Electron's binary was downloaded:

   ```powershell
   dir apps\kiosk\node_modules\electron\dist\electron.exe
   ```

   If it is missing (dev/e2e runs would fail with "Electron failed to install correctly"), run the skipped script:

   ```powershell
   cd apps\kiosk\node_modules\electron
   node install.js
   cd ..\..\..\..
   ```

   Packaging itself downloads its own Electron copy, so the installer build does not depend on that script.
4. Create `apps\kiosk\.env` (copy `apps\kiosk\.env.example`; it is gitignored):

   ```ini
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   VITE_WEB_BASE_URL=https://<vercel-url>
   VITE_FAKE_API=
   ```

   `VITE_WEB_BASE_URL` is the deployed web app (section D) without a trailing path; the download QR points at
   `<VITE_WEB_BASE_URL>/d/<token>`. Never put the service-role key here: everything in this file is readable inside the
   installed app.
5. Build the installer:

   ```powershell
   pnpm --filter kiosk build:win
   ```

   This always runs the production build first (`pnpm build`, which refuses any test-only hook), then electron-builder
   with `apps/kiosk/electron-builder.yml`. A `beforePack` check also refuses a missing or test build in `out/`.
   Output: `apps\kiosk\dist\Photobooth-Kiosk-Setup-0.1.0.exe` (about 120 MB). `pnpm --filter kiosk package` builds
   only the unpacked folder (`dist\win-unpacked` on Windows) for a quick look.
6. Install: run the `.exe` as an administrator. It installs for all users (default
   `C:\Program Files\Photobooth Kiosk`) and lets you change the folder.
   - **SmartScreen:** the installer is not code-signed, so Windows shows "Windows protected your PC". Click "More
     info" → "Run anyway". Some antivirus tools may also quarantine it; allow it. The production fix is an OV/EV
     code-signing certificate (ENVIRONMENTS.md); signing is not configured yet.
   - There is no auto-update. To update, build a new installer with a higher `version` in `apps/kiosk/package.json`
     and run it over the old install; the data folder (G.5) is kept.
7. First run (signed in to Windows as the account that will run the kiosk; the data folder is per Windows user):
   - The app opens full screen in kiosk mode on **Kiosk setup**. Set the **Admin PIN** (4–8 digits; staff need it to
     reopen Setup later).
   - Sign in with the **kiosk** account from A.5 (not the admin account).
   - Pick the **Camera** and the **Printer** (in the printer's own driver preferences set paper 4x6 / borderless
     first, see ACCEPTANCE.md Task 9), click **Print test page**, check the sheet, then **Done**.
   - The start screen shows the price (or "Free today!") from the admin settings. Price and template changes reach
     the kiosk within about 1 minute while it is on the start screen.
   - Reopen Setup later: on the start screen tap the top-left corner 5 times within 3 seconds, then enter the PIN.
   - "This kiosk is not configured. Please call staff." on launch means step 4's `.env` was missing or invalid when
     the installer was built: fix it and rebuild.
8. Windows auto-start: press `Win+R`, type `shell:startup`, Enter, and copy the "Photobooth Kiosk" desktop shortcut
   into that folder (this is the Startup folder of the signed-in Windows user, which is what the kiosk needs). With
   the single-instance lock, a second launch only brings the running kiosk to the front.

## F. Windows kiosk hardening checklist

None of this is done by the app; set it up once on the kiosk PC and re-run the ACCEPTANCE.md rows afterwards.

- [ ] A dedicated local Windows account for the kiosk (standard user, not an administrator), signed in automatically
      at boot, with the Startup-folder shortcut from E.8.
- [ ] Power: Settings → System → Power: screen off **Never**, sleep **Never**. Disable hibernate / Fast Startup if the
      PC does not come back cleanly from power cuts. Set "Restore on AC power loss" in the BIOS if offered.
- [ ] Screen saver: None. Lock screen on resume: off for the kiosk account.
- [ ] Taskbar: "Automatically hide the taskbar" on (the kiosk window covers it in kiosk mode; this hides it during
      start-up and restarts).
- [ ] Notifications: turn on Do Not Disturb / Focus so toasts do not cover the screen.
- [ ] Windows Update: set Active hours to cover event hours; pause updates before an event; never let it restart during
      an event.
- [ ] Printer: set it as the Windows default, turn off "Let Windows manage my default printer", set 4x6 borderless in
      its driver preferences.
- [ ] Camera: in Settings → Privacy & security → Camera, allow desktop apps to use the camera; close other camera
      apps (only one app can use it).
- [ ] Network: Ethernet preferred; the kiosk keeps working offline in free mode and queues uploads, but paid sessions
      need the internet.
- [ ] Optional, not tested with this app: Windows Assigned Access ("Set up a kiosk") for a single-app kiosk account.
      It changes how the app starts and what it may access; if you use it, redo E.7 under that account and re-run the
      whole ACCEPTANCE.md checklist.
- [ ] Physical: keyboard and mouse put away (Alt+F4 closes the app, the keyboard can reach Windows), PC in a locked
      enclosure.

## G. Operator runbook

### G.1 Daily start-up

1. Turn on the PC; the kiosk starts on its own (E.8). Wait for the start screen with the price.
2. Check the camera preview and that the printer has paper and ink/ribbon.
3. If anything looks wrong, open Setup (corner taps + PIN), check Camera/Printer, print a test page.
4. In `/admin` (phone or laptop), check today's dashboard and the **Needs attention** list (G.3).

### G.2 What the guest sees, and what to do

| Message on screen | Where | Meaning | What to do |
| --- | --- | --- | --- |
| `Out of service. Please call staff.` | Start screen; Tap to start is disabled | The kiosk cannot read its saved-sessions file (`queue.json`), so it cannot queue a new session safely. It re-checks every 10 s and clears by itself once the file is readable. Setup shows "Saved sessions file could not be read…". | Restart the kiosk. If it stays, check the data folder (G.5): disk full, antivirus lock, or file permissions on `queue.json`. Do not delete the file; send it to the developer. |
| `Camera not available. Please call staff.` | Capture | The camera is unplugged, used by another app, or blocked. | Replug the camera, close other camera apps, tap Try again. If it persists, reopen Setup and pick the camera again. |
| `Payments are unavailable right now. Please call staff.` | Payment | The kiosk could not create the PayMongo QR (no internet, PayMongo error, or wrong Edge Function secrets). | Check the internet. If online, check Supabase → Edge Functions → `create-payment` logs. Switch the admin to free mode if you must keep the booth running. |
| `We couldn't save your photo. Please call staff.` | After Review | The photo could not be composed or saved/queued on the PC (disk full, data folder unwritable). The guest has paid. | Tap Try again. If it fails again, note the time, refund the guest if they paid (G.3), restart the kiosk and check free disk space. |
| `Printing failed. Please call staff — your photo is still available through the QR code.` | Delivery | The printer reported an error (paper, ribbon, offline, wrong printer). The photo is saved and uploads as usual. | Fix the printer. There is no reprint in the lean MVP: the guest uses the QR download; print the downloaded file manually if you want to give them a copy. |
| `This kiosk is not configured. Please call staff.` | Instead of the app, at launch | The installer was built without valid `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_WEB_BASE_URL`. | Rebuild the installer with a correct `apps\kiosk\.env` (E.4) and reinstall. |

Other start-screen banners: "Setup needed: no active template" (activate a template in `/admin`), "Offline — payments
unavailable" (paid mode with no internet; free mode keeps working offline).

### G.3 Refunds

The admin dashboard's **Needs attention** list shows paid sessions that need a decision:

- **Paid after cancel — consider a refund:** the guest cancelled (or the payment screen timed out) and the payment
  still arrived. The guest got no photo. Refund it.
- **Paid but not completed — consider a refund:** paid, but the session was not completed within 10 minutes. Usually a
  guest who left during an outage, or a crash. An offline kiosk's sessions can also show here until it reconnects and
  syncs, so wait for the kiosk to be online before refunding.

To refund: PayMongo dashboard → Payments → find the payment (amount and time; the session row in `/admin` shows the
time) → Refund. Note the refund in your own records; the app has no "resolved" state, so refunded sessions stay in
the list (the newest 100 are shown).

The dashboard's money totals come from the `payments` table (`status = 'paid'`, by payment time in Asia/Manila) and
include paid-after-cancel payments, because the money was received.

### G.4 Reprints

None in the lean MVP. Each session prints its copies once. The guest can always download the photo through the QR
code until the link expires (admin setting, 1–30 days; old links then show "This link has expired.").

### G.5 Where the kiosk keeps its data

Per Windows user: `%APPDATA%\Photobooth Kiosk` (for example `C:\Users\<kiosk user>\AppData\Roaming\Photobooth Kiosk`).
The folder name is the packaged `productName` (set in `apps/kiosk/electron-builder.yml`).

| Path | What it is |
| --- | --- |
| `config.json` | Local setup: PIN hash, chosen camera and printer, cached price/template settings. |
| `queue.json` | Sessions and photo uploads waiting to reach Supabase (the offline queue). |
| `photos\` | Composed photo sheets. Deleted 7 days after their upload succeeded. |
| `overlays\` | Cached template overlays. |
| Chromium folders (`Local Storage`, etc.) | The kiosk account's Supabase login. |
| `config.json.corrupt-<ms>`, `queue.json.corrupt-<ms>` | The file could not be read as valid JSON, so the kiosk set it aside (renamed) and started with defaults. Setup shows a notice. Keep these for the developer; the newest 3 are kept. |
| `queue.json.dropped-<ms>` (or `config.json.dropped-<ms>`) | Some entries in the file were invalid and were skipped; this is a copy of the original file before that. The valid entries kept working. Setup shows "Some saved photo uploads could not be restored…". Newest 3 kept. |

Do not edit these files while the kiosk runs.

### G.6 Backups

- Cloud data (sessions, payments, settings, templates, photos) lives in Supabase. Supabase Free has no point-in-time
  recovery; take a data dump before risky changes and regularly during events, and keep it outside the repo:

  ```sh
  supabase db dump --remote --data-only --file <backup-folder>/photobooth-data-YYYYMMDD.sql
  ```

  Storage files (photos, template PNGs) are not in this dump; download important ones from Dashboard → Storage.
- Kiosk PC: back up `%APPDATA%\Photobooth Kiosk` (app closed) before reinstalling Windows or moving to a new PC. Photo
  paths are re-derived on load, so the folder can be restored for another Windows user and its queued uploads still
  run.

### G.7 Rotating the kiosk password

1. Dashboard → Authentication → Users → the kiosk user → change its password.
2. On the kiosk: open Setup (corner taps + PIN), sign in with the new password, Done.

Changing the password does not instantly end a login that already exists on a lost or stolen kiosk PC. To cut such a
PC off: delete that kiosk user in the dashboard, create a new one (A.5), give it the `kiosk` row (A.6, the old row
goes away with the deleted user), and sign in with it on the remaining kiosk. Rotate the admin password the same way in
the dashboard.

### G.8 Local development

See [README.md](../README.md) for running everything locally (local Supabase via Docker, `supabase/.env.local` for
`supabase functions serve --env-file supabase/.env.local`, unit/integration/e2e commands).
