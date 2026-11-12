# Acceptance checklist

Run on the client's real hardware (Windows kiosk PC, camera, photo printer) against the deployed test environment
(`docs/DEPLOY.md`, PayMongo **test** mode), then the go-live rows with live keys. Nothing below has been run yet: every
result cell is blank on purpose. Record real results only; a row that was not run stays blank.

Order: the Task 9 printer check and the Task 5 PayMongo run first (they validate the integrations), then the Task 14
checklist.

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
   - [ ] `payments.status = 'paid'`, `paid_at` set, `sessions.status = 'paid'`, `payments.last_event` holds the trimmed
     event (id, type, amount, currency, status, paid_at, payment_intent_id; no billing details);
     the kiosk leaves the payment screen.
   - [ ] Save the real webhook body (amounts and ids only, no keys) over `__fixtures__/webhook-payment-paid.json`, the
     real attach response over `__fixtures__/attach-qrph.json`, remove the SYNTHETIC banners, rerun the unit tests.
3. Retries: in the dashboard, resend the same event a few minutes later.
   - [ ] It gets 200 and changes nothing. We do **not** enforce a replay window on `t` (a late retry carrying the
     original `t` must still land, or a paid event could be lost after an outage); idempotent state changes are the
     protection against replays. For the record, note whether `t` is fresh on each resend: ______
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

## Task 14 — full acceptance checklist (real hardware)

Setup before the rows: the installer built on the Windows PC (`docs/DEPLOY.md` section E) is installed, Setup is done
with the kiosk account, the admin has an active template, and PayMongo is in **test** mode unless the row says
otherwise. Keep a phone on mobile data (not the kiosk's Wi-Fi) for the download rows.

Evidence: a phone photo or screenshot of the screen, the printed sheet, the relevant `/admin` row, and Supabase logs
or table rows where named. Never paste keys, passwords or guests' personal data into the notes.

**1. Paid session with a GCash test payment → print + QR → phone download.**
Do: set a price (e.g. ₱50) in `/admin`, start a session, take the photos, pay with PayMongo's **test simulation
link** (never scan a test QR with a real wallet: test QR Ph codes are live codes).
Expected: the kiosk leaves Payment within a few seconds of paying, prints the sheet(s), shows the download QR; the QR
opens `<web URL>/d/<token>` on the phone and the photo downloads. `/admin` shows the session as completed and the
payment in Today's money.
Evidence: printed sheet, phone screenshot of the download page, `/admin` session row, `payments` row (`status = paid`).

**2. Free mode session.**
Do: turn on free mode in `/admin`, wait up to 1 minute, run a session.
Expected: the start screen shows "Free today!", no Payment screen, print + QR + download work; no payment row is
created.
Evidence: start-screen photo, printed sheet, `/admin` session row.

**3. Cancel at 2:59 right after paying.**
Do: start a paid session, pay through the simulation link, then immediately tap Cancel (timer around 2:59).
Expected: either the session continues to print (the payment won the race), or it returns to the start screen and the
session appears in `/admin` → Needs attention as "Paid after cancel — consider a refund". Never: paid, cancelled and
not listed.
Evidence: what the kiosk did, the Needs attention entry (if any), `sessions.status`.

**4. Unplug Ethernet after paying.**
Do: pay, then unplug the network before the photo is printed; leave it out for 2–3 minutes; plug it back in.
Expected: print works and the QR is shown while offline; the photo appears on the download page within 1 minute of
reconnecting.
Evidence: time of reconnect, time the download page first showed the photo.

**5. Unplug the camera during capture.**
Do: start a session, unplug the USB camera during the countdown.
Expected: `Camera not available. Please call staff.`; after replugging, "Try again" restores the preview and the
session continues.
Evidence: photo of the error screen, note whether the same session continued.

**6. Printer out of paper.**
Do: remove the paper (or open the tray) and run a session.
Expected: `Printing failed. Please call staff — your photo is still available through the QR code.` with the QR; the
photo downloads on the phone; `/admin` records the print error.
Evidence: photo of the screen, phone screenshot, `/admin` session row.

**7. Strip prints two identical strips; 4R prints full bleed.**
Do: one session with a strip template (600×1800), one with a 4R template (1200×1800); cutter on for the strip if the
printer has one.
Expected: the strip sheet holds two identical 2×6 strips side by side (cut into two); the 4R sheet fills the paper with
no white border (borderless driver setting).
Evidence: photos of both prints next to a ruler.

**8. Admin price change reaches the kiosk within ~1 minute.**
Do: with the kiosk on the start screen, change the price in `/admin` from a phone.
Expected: the kiosk shows the new price within about 1 minute (it re-reads settings every 60 s on the start screen);
the next paid session's QR is for the new amount.
Evidence: time of change, time the kiosk showed it, the amount on the Payment screen.

**9. Link past expiry shows "This link has expired."**
Do: set link expiry to 1 day, run a session, open its link more than 1 day later (or ask the developer to backdate the
session's `created_at` in the test project).
Expected: the download page shows `This link has expired.` and no photo.
Evidence: phone screenshot, the session's created time.

**10. Windows navigation/reload sanity with a non-ASCII profile path.**
Do: create a Windows user whose name has a non-ASCII letter (e.g. `José`), sign in as it, install/launch the kiosk
(its data folder is `C:\Users\José\AppData\Roaming\Photobooth Kiosk`), run Setup and a session, close and restart the
app, run another session.
Expected: the kiosk window loads after every restart (no blank or black screen; the `isAllowedNavigation` file-URL
check accepts the app page on Windows), and Print works.
Evidence: install path, profile path, photos of both prints.

**11. Camera names in Setup.**
Do: open Setup → devices step with the real camera (and a second camera if available).
Expected: the Camera list shows the real device names (e.g. the camera model), not empty labels or only "Camera 1",
even though the app only ever grants video (never microphone) permission.
Evidence: photo of the Setup camera list.

**12. PIN lockout after 5 wrong PINs.**
Do: tap the top-left corner 5 times within 3 s on the start screen, enter a wrong PIN 5 times, then try the correct
PIN at once; wait, try again.
Expected: the 5th wrong PIN shows `Too many attempts. Try again in 30 s.`; the correct PIN is refused until the wait
ends, then works. A further wrong PIN after a lockout locks again for longer (60 s, 120 s, … up to 5 min). Restarting
the app resets the counter (expected, documented).
Evidence: photo of the lockout message.

**13. Copy the kiosk data to another Windows user; queued uploads are restored.**
Do: unplug the network, run 2 sessions (they queue), close the app, copy `%APPDATA%\Photobooth Kiosk` to the same
place in a second Windows user's profile, sign in as that user, start the kiosk, plug the network back in.
Expected: no "Some saved photo uploads could not be restored" notice in Setup; both queued photos upload (photo paths
are re-derived from the new folder) and both download links work.
Evidence: Setup screenshot, both download pages.

**14. Kill the app mid-session; no data loss.**
Do: in Task Manager, End task on Photobooth Kiosk (a) on the Delivery screen after printing, and (b) during Capture of
a paid session; restart it each time.
Expected: (a) the session and its photo still reach `/admin` and the download link works after restart; (b) the paid
session shows in Needs attention as "Paid but not completed" after 10 minutes. No `.corrupt-` file appears in the data
folder.
Evidence: `/admin` rows, a directory listing of the data folder.

**15. Unreadable `queue.json` → "Out of service", then clears.**
Do: with the kiosk running on the start screen, in `%APPDATA%\Photobooth Kiosk\queue.json` → Properties → Security →
Edit, add **Deny Read** for the kiosk Windows user; wait 20 s. Then remove the Deny entry; wait 20 s.
Expected: the start screen shows `Out of service. Please call staff.` with start disabled (Setup shows "Saved sessions
file could not be read…"); after removing the Deny it clears by itself within about 10 s and sessions work; the file's
content is unchanged. Also note, for the record, what a plain Read-only attribute (Properties → Read-only) does during
a session (it blocks writes, not reads, so a different error such as `We couldn't save your photo. Please call staff.`
is possible).
Evidence: photos of both screens, notes on the Read-only variant.

**16. PayMongo live-mode go-live check.**
Do: on the production project, `supabase secrets set PAYMONGO_SECRET_KEY=<live> PAYMONGO_WEBHOOK_SECRET=<live whsk>
PAYMONGO_MODE=live` (live webhook registered, `docs/DEPLOY.md` C.5); set the price to ₱20.00; repeat row 1 paying
with a real wallet; then refund the ₱20 in the PayMongo dashboard.
Expected: row 1 passes with real money; the webhook gets 200; the refund shows in PayMongo.
Evidence: PayMongo payment and refund ids (no keys), `/admin` row.

**17. Unsigned installer and SmartScreen.**
Do: download/copy `Photobooth-Kiosk-Setup-0.1.0.exe` to a clean Windows PC and run it.
Expected: SmartScreen warns ("Windows protected your PC"); "More info" → "Run anyway" installs it per machine into
`C:\Program Files\Photobooth Kiosk` (or the chosen folder); a Start menu and desktop shortcut exist; the exe's
Properties → Details show "Photobooth Kiosk" 0.1.0.
Evidence: screenshots of the warning and the Details tab.

**18. "Out of service" and "This kiosk is not configured" screens.**
Do: (a) see row 15 for `Out of service. Please call staff.`; (b) build an installer with `VITE_SUPABASE_URL` empty in
`apps\kiosk\.env`, install it on a test PC (not the event kiosk), launch it.
Expected: (b) shows `This kiosk is not configured. Please call staff.` and nothing else; reinstalling the correct
build fixes it.
Evidence: photo of the screen.

**19. Download page from a phone on mobile data.**
Do: turn off the phone's Wi-Fi, scan the kiosk QR of a fresh session.
Expected: the download page loads over mobile data and the photo saves to the phone (Android and iPhone if
available).
Evidence: screenshots, phone models.

**20. Admin on a phone.**
Do: sign in to `/admin` on a phone; check the dashboard, change a setting, set a template active.
Expected: everything is usable without zooming or horizontal scrolling; changes save and reach the kiosk (row 8).
Evidence: screenshots.

**21. Vercel Hobby upload limit.**
Do: on the Vercel deployment (with `NEXT_PUBLIC_TEMPLATE_UPLOAD_MAX_BYTES=4404020`), upload a valid 5 MB PNG
template.
Expected: a clear error (`Template must be 4.2 MB or smaller`), no error page; a 4 MB PNG uploads.
Evidence: screenshot of the message.

**22. Single instance and auto-start.**
Do: with the kiosk running, launch it again from the desktop shortcut; then restart Windows.
Expected: no second window or process appears (the running kiosk comes to the front); after the restart the kiosk
starts on its own (Startup folder) and reaches the start screen.
Evidence: Task Manager screenshot, time from power-on to the start screen.

**23. One-hour mock-event soak.**
Do: for 1 hour, run 20+ sessions mixed paid (test mode) and free, both layouts, a few cancels and timeouts; keep the
printer stocked.
Expected: no crash, freeze or memory growth that slows the kiosk; every completed session is in `/admin` and
downloadable; the money total equals the paid test payments; Needs attention lists only the deliberate cancels.
Evidence: session count, Task Manager memory at the start and end, any errors seen.

### Results

| # | Date | Tester | Pass/fail | Notes |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |
| 5 |  |  |  |  |
| 6 |  |  |  |  |
| 7 |  |  |  |  |
| 8 |  |  |  |  |
| 9 |  |  |  |  |
| 10 |  |  |  |  |
| 11 |  |  |  |  |
| 12 |  |  |  |  |
| 13 |  |  |  |  |
| 14 |  |  |  |  |
| 15 |  |  |  |  |
| 16 |  |  |  |  |
| 17 |  |  |  |  |
| 18 |  |  |  |  |
| 19 |  |  |  |  |
| 20 |  |  |  |  |
| 21 |  |  |  |  |
| 22 |  |  |  |  |
| 23 |  |  |  |  |
