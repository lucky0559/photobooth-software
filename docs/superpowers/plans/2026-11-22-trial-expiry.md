# Trial Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Windows trial locks 3 days after first launch and shows a "Trial ended" page, with a clock-rollback check.

**Architecture:** A pure clock-evaluation module plus a tiny fail-closed file store in the Electron main process, compiled in only for trial builds (`__PB_TRIAL_BUILD__`). Main swaps the window to a static page when the trial ends. The real-bundle guard rejects the trial marker.

**Tech Stack:** Electron 45 main process, TypeScript, vitest, electron-vite, node `fs`.

**Spec:** `docs/superpowers/specs/2026-11-22-trial-expiry-design.md`

## Global Constraints

- Work in `apps/kiosk` on branch `feat/trial-expiry`. Node 22, pnpm 9.15.0.
- `TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000`, `CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000`. State file `<userData>/trial.json`. Heartbeat every 60 000 ms.
- Fail closed: an unreadable, unparsable or invalid `trial.json`, or any failure to persist the state, means the trial has ended (reason `unavailable`). Never reset a trial because a file is corrupt.
- Do not use `createJsonStore` for trial state (it resets corrupt files to defaults).
- The real (`build`) and e2e (`build:e2e`) bundles must contain none of this: no `trial.json` string, guarded by `check-prod-bundle.mjs`. No `Co-Authored-By` or any AI attribution trailer in commits.
- No renderer changes. No change to `electron-builder.yml`, `build:win`, `package`, or the existing trial identity.
- Obsidian sync is controller-only: never edit the vault.

## Review Focus

1. Backwards clock jump of 5 minutes (NTP fix) must not lock the trial and must not give time back; 11 minutes must lock it (Task 1).
2. A corrupt or empty `trial.json`, and a failure to write the first-launch state, must end the trial, never restart it (Task 1).
3. Restart after the deadline while the app was closed (PC off for 5 days) must show the ended page at launch (Task 1 logic; Task 2 wiring).
4. The real and e2e bundles must not contain `trial.json` (Task 2).
5. The ended page must be script-free static HTML and the heartbeat must stop after the trial ends (Task 2).

---

### Task 1: Trial clock and store

**Files:**
- Create: `apps/kiosk/src/main/trial.ts`
- Test: `apps/kiosk/test/trial.test.ts`

**Interfaces:**
- Produces (Task 2 imports these):
  - `TRIAL_DURATION_MS`, `CLOCK_ROLLBACK_TOLERANCE_MS`, `TRIAL_HEARTBEAT_MS = 60_000`.
  - `type TrialReason = 'time' | 'clock' | 'unavailable'`.
  - `interface TrialState { firstLaunchAt: number; lastSeenAt: number; expired: boolean; reason: TrialReason | null }`.
  - `type TrialStatus = { state: 'active'; remainingMs: number } | { state: 'ended'; reason: TrialReason }`.
  - `evaluateTrial(state: TrialState | null, now: number): { status: TrialStatus; next: TrialState }`: pure, rules exactly as the spec's Design item 1.
  - `createTrialGuard(file: string, opts?: { now?: () => number; fs?: Partial<Pick<typeof import('node:fs'), 'readFileSync' | 'writeFileSync' | 'renameSync'>> }): { check(): TrialStatus }`: reads the file (missing = first launch), evaluates, persists `next` atomically (temp file + rename) when it changed and at most once per `TRIAL_HEARTBEAT_MS` of `lastSeenAt` advance (a state change to `expired` is always persisted), and fails closed per the Global Constraints. `check()` never throws.

- [ ] **Step 1: Write the failing tests** in `test/trial.test.ts` with a controllable clock and a temp directory (real `fs` is fine) or injected fs. Assertions, with `D = TRIAL_DURATION_MS`, `T = 1_000_000`:
  - `evaluateTrial(null, T)` returns active with `remainingMs === D` and `next` `{ firstLaunchAt: T, lastSeenAt: T, expired: false, reason: null }`.
  - Active at `firstLaunchAt + D - 1` with `remainingMs === 1`; ended `reason 'time'` at exactly `firstLaunchAt + D`.
  - An already `expired: true` state stays ended with its stored reason even when `now` is earlier than `firstLaunchAt` (sticky).
  - **Review Focus 1:** with `lastSeenAt = T`, `now = T - 5 * 60_000` is active and `next.lastSeenAt === T` (no time given back; `remainingMs` computed from `T`); `now = T - 11 * 60_000` is ended `reason 'clock'` and `next.expired === true`.
  - **Review Focus 3:** state `{ firstLaunchAt: T, lastSeenAt: T + 60_000 }`, `now = T + 5 * 24 * 3600_000` is ended `reason 'time'`.
  - Guard: first `check()` with no file creates `trial.json` and returns active; a second guard instance on the same file with the clock advanced 2 days is active with the remaining time reduced by 2 days; with the clock advanced past 3 days it is ended and a third instance (same file) is still ended even if the clock is then set back to the start.
  - **Review Focus 2:** an existing file containing `not json`, `{}`, a JSON array, or `{"firstLaunchAt":"x"}` gives ended `reason 'unavailable'` and the file is not overwritten with a fresh trial; an injected `writeFileSync` that throws on the first launch gives ended `reason 'unavailable'`; `check()` never throws in any of these.
  - Heartbeat persistence: two `check()` calls 10 s apart write once; two calls 61 s apart write twice (count injected writes).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/trial.test.ts`
Expected: FAIL (cannot resolve `../src/main/trial`).

- [ ] **Step 3: Implement `trial.ts`** with the signatures above. Validate the parsed JSON strictly (finite numbers, boolean, reason in the allowed set or null, `lastSeenAt >= firstLaunchAt` not required but both must be finite). Atomic write: write `<file>.tmp` then `renameSync`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter kiosk exec vitest run test/trial.test.ts && pnpm --filter kiosk typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/main/trial.ts apps/kiosk/test/trial.test.ts
git commit -m "feat(kiosk): add the trial clock and fail-closed trial state store"
```

### Task 2: Enforcement, build flag, guard, docs

**Files:**
- Create: `apps/kiosk/src/main/trial-ended-page.ts`
- Modify: `apps/kiosk/src/main/index.ts`, `apps/kiosk/src/main/build-flags.d.ts`, `apps/kiosk/electron.vite.config.ts`, `apps/kiosk/scripts/check-prod-bundle.mjs`, `docs/DEPLOY.md`
- Test: `apps/kiosk/test/trial-ended-page.test.ts`, `apps/kiosk/test/check-prod-bundle.test.ts` (extend)

**Interfaces:**
- Consumes: `createTrialGuard(file, opts?)`, `TRIAL_HEARTBEAT_MS`, `TrialStatus` from `./trial` (Task 1).
- Produces: `trialEndedUrl(): string` in `trial-ended-page.ts` (a `data:text/html;charset=utf-8,` URL whose HTML is static, contains the text "Trial ended" and "Please contact your vendor to continue.", and contains no `<script`, no `javascript:` and no external `http` references); `declare const __PB_TRIAL_BUILD__: boolean;` in `build-flags.d.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `trial-ended-page.test.ts`: `trialEndedUrl()` starts with `data:text/html;charset=utf-8,`; decoded HTML contains `Trial ended` and `Please contact your vendor to continue.`; **Review Focus 5:** it contains none of `<script`, `javascript:`, `http://`, `https://`, and `<!doctype html>` is present (case-insensitive).
  - `check-prod-bundle.test.ts`: **Review Focus 4:** a real-mode bundle dir (required files present) with a `.js` containing `trial.json` fails with a trial-marker problem; the same dir passes in trial mode. (Extend the existing `DEMO PAYMENT` tests' pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/trial-ended-page.test.ts test/check-prod-bundle.test.ts`
Expected: FAIL (module missing; marker not yet checked).

- [ ] **Step 3: Implement.**
  - `trial-ended-page.ts`: `trialEndedUrl()` builds the static page (dark background matching the kiosk, large readable text, portrait friendly) and returns the data URL via `encodeURIComponent`.
  - `electron.vite.config.ts`: add `__PB_TRIAL_BUILD__: JSON.stringify(trialBuild)` to the main-process `define` only (not preload, not renderer); `trialBuild` is the existing `process.env.VITE_TRIAL === '1'` flag. `build-flags.d.ts` declares it.
  - `check-prod-bundle.mjs`: extend the trial-only marker list with `trial.json` (the real-mode check rejects it, trial mode ignores it).
  - `index.ts` (main): inside `startKiosk`, `if (__PB_TRIAL_BUILD__) { ... }` creates `createTrialGuard(join(userData, 'trial.json'))`, evaluates once before the window is created; if ended, the window loads `trialEndedUrl()` (via `win.loadURL`) instead of the app page and no heartbeat runs; if active, start `setInterval(..., TRIAL_HEARTBEAT_MS)` that calls `check()` and, on `ended`, clears the interval and loads `trialEndedUrl()` into the main window. Log one fixed line per transition (`trial: started`, `trial: ended (time|clock|unavailable)`), nothing else. All of it sits inside the `__PB_TRIAL_BUILD__` branch so the real and e2e bundles drop it. The existing navigation guard must not block main-initiated `loadURL` (it does not); verify rather than assume.
  - `docs/DEPLOY.md` E.9: replace the "no expiry" statement with the 3-day limit: how it works (first launch starts a 72-hour clock stored in `trial.json`; a clock moved back more than 10 minutes ends the trial; ended page text), that reinstalling does not reset it (the data folder survives), how to grant a fresh trial (delete `%APPDATA%\Photobooth Kiosk Trial\trial.json`, or the whole folder), the known weakness (a determined user can do the same), and how to test it quickly (edit `firstLaunchAt` in `trial.json` to 4 days ago, relaunch). Fix any other sentence in E.9 or the README that says the trial has no expiry.

- [ ] **Step 4: Run tests, typecheck and build checks**

Run: `pnpm --filter kiosk test && pnpm --filter kiosk typecheck && pnpm --filter kiosk build && pnpm --filter kiosk build:trial`
Expected: all green; `grep -rl "trial.json" apps/kiosk/out apps/kiosk/out-e2e` prints nothing; `grep -rl "trial.json" apps/kiosk/out-trial` lists the trial main bundle; the build guard lines print for `out` and `out-trial`; the installer builds.

- [ ] **Step 5: Smoke the expiry for real (dev, trial flavour)**

With a throwaway `userData` you control, run the trial dev app and exercise the three paths against the real file: (a) no `trial.json` → app starts, file created with `expired: false`, log `trial: started`; (b) set `firstLaunchAt` to 4 days ago and relaunch → ended page, log `trial: ended (time)`; (c) with a fresh file, set `lastSeenAt` 1 hour in the future and relaunch → ended (clock). The dev userData folder is `~/Library/Application Support/kiosk` on macOS; back up and restore anything already there, and leave no `trial.json` behind. State plainly what you could and could not observe (the window's content cannot be seen from a terminal; the log lines and file contents can).

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/main apps/kiosk/electron.vite.config.ts apps/kiosk/scripts/check-prod-bundle.mjs apps/kiosk/test docs/DEPLOY.md
git commit -m "feat(kiosk): end the trial three days after first launch"
```
