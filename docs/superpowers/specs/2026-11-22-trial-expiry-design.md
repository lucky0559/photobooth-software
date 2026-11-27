# Trial expiry: design

Date: 2026-11-22. Status: approved 2026-11-22 (the owner chose "days from first launch plus a clock-rollback check, 3 days").
Amends [2026-11-22-trial-build-design.md](2026-11-22-trial-build-design.md): its non-goal "no expiry" no longer applies.

## Intent

The client may test the Windows trial for 3 days only. After that the kiosk must stop working, so the trial cannot be
used as the product. The app is offline, so this is a deterrent against a casual client, not a licence system.

## Goals

- The trial locks 72 hours after its first launch and shows a "Trial ended" page instead of the app.
- The lock survives restarts, reboots and reinstalling over the same install.
- Moving the PC clock backwards does not give time back: a backwards jump larger than 10 minutes locks the trial at once.
- The real kiosk installer contains none of this code.

## Non-goals

- Defeating a determined user. Deleting `%APPDATA%\Photobooth Kiosk Trial\trial.json` (or the whole data folder) starts a
  new trial; only an online licence check could stop that, and there is no backend. Accepted, documented as the way
  to grant a fresh trial.
- A staff bypass, an unlock PIN, a countdown banner, or showing days left in the UI.
- Any change to the real build, Supabase, or the web app.

## Anti-goals

- A bug or a broken file that restarts the trial or bricks it silently: every failure mode is decided below.
- Expiry code or its marker string shipping in the real installer.

## Approaches considered

- **Fixed end date baked into the build.** Trivial, but the client starts the clock whenever they like and one build
  per client date is needed. Rejected.
- **N days from first launch, enforced in the main process (chosen).** Start time stored in the data folder, checked at
  launch and every minute; the window is replaced by a static page, so the renderer cannot skip it.
- **Online licence check.** The only unbypassable option; needs a server the trial deliberately does not have. Rejected.

## Design

1. **Clock logic** (`apps/kiosk/src/main/trial.ts`, pure and unit-tested). State is
   `{ firstLaunchAt, lastSeenAt, expired, reason }` in epoch ms. `TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000`,
   `CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000`. Evaluate with `now`:
   no state → first launch, active; `expired` already set → stay expired (sticky); `now < lastSeenAt - tolerance` →
   expired, reason `clock`; otherwise use `max(now, lastSeenAt)` so a small backwards jump gives no time back, and expire
   with reason `time` once that is at least `TRIAL_DURATION_MS` after `firstLaunchAt`.
2. **Persistence** (same file, `<userData>/trial.json`, own tiny store, not `createJsonStore`: that store resets a corrupt
   file to defaults, which would restart the trial). Written atomically (temp file + rename). Writes are durable (the temp
   file is fsynced before the rename). A missing file means first launch. **Fails closed** (trial ended, reason
   `unavailable`): an existing file that cannot be parsed or validated (including an empty one), and a first-launch
   state that cannot be written. After one good evaluation the state is also held in memory, and a transient I/O error
   on a later heartbeat (read, or a write that only advances `lastSeenAt`) does not end the trial: it retries on the
   next tick (amended after the final review: Windows antivirus often blocks a rename briefly, and the trial must not
   lock a legitimate client for that). `lastSeenAt` is persisted at most once a minute.
3. **Enforcement** (main process, trial builds only, behind a compile-time flag `__PB_TRIAL_BUILD__`). At start the main
   process evaluates the trial; if ended it loads the "Trial ended" page into the window instead of the app. While
   running it re-evaluates every 60 s and swaps the window to that page the moment the trial ends, even mid-session (a
   guest in progress loses the session; accepted for a trial). The page is static HTML with no script, loaded by main as a
   data URL, naming no private details: "Trial ended. Thank you for trying Photobooth. Please contact your vendor to
   continue."
4. **Build flag.** `electron.vite.config.ts` defines `__PB_TRIAL_BUILD__` (true only for `VITE_TRIAL=1` builds) for the
   main bundle. The real and e2e builds compile the code out. The real-bundle guard also rejects the marker string
   `trial.json` (added next to `DEMO PAYMENT`), so a leak into the real installer fails the build.
5. **Docs.** `docs/DEPLOY.md` E.9 states the 3-day limit, how it works, that reinstalling does not reset it (the data
   folder survives), how to grant a fresh trial (delete `trial.json`), and the known weakness.

## Left to the builder

Exact HTML/CSS of the ended page (dark, simple, readable on a portrait kiosk), the log line wording (one fixed line per
state change, no paths or timestamps of private data), file layout inside `main/`.
