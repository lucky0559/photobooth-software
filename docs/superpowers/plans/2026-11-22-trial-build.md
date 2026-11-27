# Windows Trial Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows installer of the kiosk that runs the whole guest flow with a simulated payment and no backend, for the client to evaluate.

**Architecture:** A third build flavour (`VITE_TRIAL=1`) next to the real build and the e2e build. It swaps the Supabase API for an in-memory `DemoKioskApi`, builds into its own `out-trial/` folder, and is packaged by its own electron-builder config. The existing test-hook guard (`check-prod-bundle.mjs`) is reused on `out-trial/`.

**Tech Stack:** Electron 45, electron-vite, React 19, TypeScript, vitest, electron-builder (NSIS), pnpm 9 workspace.

**Spec:** `docs/superpowers/specs/2026-11-22-trial-build-design.md`

## Global Constraints

- Work in `apps/kiosk` unless a task says otherwise. Node 22, pnpm 9.15.0.
- Never import `src/renderer/src/api/fake-api.ts` from trial code: it contains the forbidden bundle marker `__pbFake`. No file the trial bundle includes may contain `__pbDebug`, `__pbFake`, `__pbPrintCalls`, `PB_FAKE` or `PB_USER_DATA` (`FORBIDDEN` in `scripts/check-prod-bundle.mjs`).
- `build:win`, `package`, `build:e2e` and `electron-builder.yml` behave exactly as before.
- Money is integer centavos. Demo price comes from `DEFAULT_SETTINGS.priceCentavos` (`@pb/core`), not a copy.
- Trial identity: appId `com.photobooth.kiosk.trial`, productName `Photobooth Kiosk Trial`, artifact `Photobooth-Trial-Setup-${version}.exe`, output `dist-trial/`, bundle `out-trial/`.
- Commit messages: Conventional Commits, subject and body only. **No `Co-Authored-By` or any AI attribution trailer** (user's global rule overrides any default).
- Obsidian sync (`~/.claude/CLAUDE.md`): before Task 1 edits source, mark the task In Progress in the project's `Tasks.md`; after Task 4, move it to Done with a verification summary and read the notes back.

## Review Focus

Failure modes the spec implies that a person using the trial could hit (each is pinned by a test or check in the named task):

1. Guest cancels at the exact moment the demo payment confirms: must report `paid`, not `cancelled` (Task 1).
2. A second guest right after a paid one: their payment must start `pending` with its own 5 s timer (Task 1).
3. A developer's `.env` sets `VITE_WEB_BASE_URL`: the trial download QR must still show the trial text, not a dead link (Task 2).
4. Trial build with no Supabase or web variables set: must not show "This kiosk is not configured" (Task 2).
5. Stale or missing `out-trial/`, or a test hook leaking into it: packaging must refuse (Task 3).

---

### Task 1: Demo backend

**Files:**
- Create: `apps/kiosk/src/renderer/src/api/demo-overlay.ts`
- Create: `apps/kiosk/src/renderer/src/api/demo-api.ts`
- Test: `apps/kiosk/test/demo-api.test.ts`

**Interfaces:**
- Consumes: `KioskApi`, `PaymentStatus` from `./kiosk-api`; `DEFAULT_SETTINGS`, `layoutSize`, `KioskSettings`, `LayoutId`, `SessionSync`, `Template` from `@pb/core`.
- Produces (Task 2 imports these):
  - `demo-overlay.ts`: `renderDemoOverlay(layout: LayoutId): Promise<ArrayBuffer>`: uses the bundled project `Sample strip` PNG for `strip_2x6`; derives a 4R overlay by placing two strips side by side. Printed photos have no trial footer.
  - `demo-api.ts`: `DEMO_PAY_AFTER_MS = 5000`, `DEMO_ACTIVE_TEMPLATE_ID = 'demo-strip'`, `DEMO_TEMPLATES: Record<string, Template>` with `demo-strip` (`strip_2x6`) and `demo-4r` (`print_4r`), `class DemoKioskApi implements KioskApi` with `constructor(now: () => number = Date.now, overlay: (layout: LayoutId) => Promise<ArrayBuffer> = renderDemoOverlay)`, and `createDemoKioskApi(): DemoKioskApi`.

- [ ] **Step 1: Write the failing test** `test/demo-api.test.ts`. Build the API with a controllable clock (`let t = 0`) and a stub overlay `async (layout) => new TextEncoder().encode(layout).buffer`. Assertions:
  - `getSettings()` equals `{ ...DEFAULT_SETTINGS, activeTemplateId: 'demo-strip' }` and `freeMode` is `false`.
  - `getTemplate('demo-strip')` returns `template.layout === 'strip_2x6'` and the stub's bytes for `'strip_2x6'`; `getTemplate('demo-4r')` uses `'print_4r'`; `getTemplate('nope')` rejects with `Unknown template nope`.
  - `createPayment({sessionId:'s1',downloadToken:'t',templateId:'demo-strip'})` returns `amountCentavos === DEFAULT_SETTINGS.priceCentavos` and a `qrImageDataUrl` that starts with `data:image/svg+xml` and, once decoded with `decodeURIComponent`, contains `DEMO PAYMENT`.
  - Status is `pending` at `t = 4999` and `paid` at `t = 5000`.
  - **Review Focus 1:** `cancelPayment` at `t = 5000` resolves `'paid'`; at `t = 100` resolves `'cancelled'` and the status then stays `cancelled`.
  - **Review Focus 2:** after the first payment is paid, a second `createPayment` at the same clock reads `pending`, then `paid` 5000 ms after its own creation.
  - `getPaymentStatus('unknown')` rejects; `uploadPhoto('s1', buf)` resolves `'s1.jpg'`; `upsertSession(row)` resolves.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter kiosk exec vitest run test/demo-api.test.ts`
Expected: FAIL (cannot resolve `../src/renderer/src/api/demo-api`).

- [ ] **Step 3: Implement `demo-overlay.ts` and `demo-api.ts`** with the signatures above. The current client build bundles the project `Sample strip` overlay and derives the paired 4R overlay from it; no trial text is burned into photos. Do not import from `fake-api.ts`. `DemoKioskApi` keeps a `Map<string, number>` of payment creation times and a `Set<string>` of cancelled ids, ids `demo-pay-<n>`, reads status from the injected clock, and returns the demo QR as an inline SVG data URL (white square with black block and the text "DEMO PAYMENT", same pattern as `FAKE_QR`). `upsertSession` and `uploadPhoto` store nothing. No `window` globals, none of the forbidden marker strings.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter kiosk exec vitest run test/demo-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/renderer/src/api/demo-overlay.ts apps/kiosk/src/renderer/src/api/demo-api.ts apps/kiosk/test/demo-api.test.ts
git commit -m "feat(kiosk): add in-memory demo backend for the trial build"
```

### Task 2: Trial wiring (env check, API selection, download QR)

**Files:**
- Modify: `apps/kiosk/src/renderer/src/env.d.ts` (add `readonly VITE_TRIAL?: string;` to `ImportMetaEnv`)
- Modify: `apps/kiosk/src/renderer/src/env-check.ts` (`KioskEnv` gets `VITE_TRIAL?: string`)
- Modify: `apps/kiosk/src/renderer/src/screens/download-url.ts`
- Modify: `apps/kiosk/src/renderer/src/screens/Delivery.tsx:34`
- Modify: `apps/kiosk/src/renderer/src/main.tsx:22-30`
- Modify: `apps/kiosk/.env.example`
- Test: `apps/kiosk/test/env-check.test.ts`, `apps/kiosk/test/download-url.test.ts`

**Interfaces:**
- Consumes: `createDemoKioskApi(): DemoKioskApi` (Task 1).
- Produces: `deliveryQrPayload(trial: boolean, base: string | undefined, token: string): string | null` and `TRIAL_QR_TEXT` in `download-url.ts`. Returns `TRIAL_QR_TEXT` when `trial`, else `downloadUrl(base, token)`.

- [ ] **Step 1: Write the failing tests.**
  - `env-check.test.ts`: **Review Focus 4:** `checkEnv({ VITE_TRIAL: '1' })` equals `{ ok: true, warnings: [] }`.
  - `download-url.test.ts`: `deliveryQrPayload(true, undefined, 'tok')` returns `TRIAL_QR_TEXT`; **Review Focus 3:** `deliveryQrPayload(true, 'https://booth.example.com', 'tok')` still returns `TRIAL_QR_TEXT`; `deliveryQrPayload(false, 'https://booth.example.com', 'tok')` returns `downloadUrl('https://booth.example.com', 'tok')`; `deliveryQrPayload(false, undefined, 'tok')` returns `null`. `TRIAL_QR_TEXT` is exactly `Trial build: the real kiosk shows your photo download link here.`

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter kiosk exec vitest run test/env-check.test.ts test/download-url.test.ts`
Expected: FAIL (`deliveryQrPayload` not exported; `checkEnv` reports missing variables).

- [ ] **Step 3: Implement.**
  - `checkEnv`: first line returns `{ ok: true, warnings: [] }` when `env.VITE_TRIAL === '1'`.
  - `download-url.ts`: add `TRIAL_QR_TEXT` and `deliveryQrPayload` as specified.
  - `Delivery.tsx`: replace the `downloadUrl(...)` call with `deliveryQrPayload(import.meta.env.VITE_TRIAL === '1', import.meta.env.VITE_WEB_BASE_URL, downloadToken)` and keep the existing null handling.
  - `main.tsx` `createApi()`: add a branch before the Supabase one, `if (import.meta.env.VITE_TRIAL === '1') return { api: createDemoKioskApi(), auth: null };` (`auth: null` makes Setup skip the sign-in step).
  - `.env.example`: add a commented line documenting `VITE_TRIAL=1` (used by `build:trial`).

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm --filter kiosk exec vitest run test/env-check.test.ts test/download-url.test.ts && pnpm --filter kiosk typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/renderer/src apps/kiosk/.env.example apps/kiosk/test/env-check.test.ts apps/kiosk/test/download-url.test.ts
git commit -m "feat(kiosk): select the demo backend and trial download QR when VITE_TRIAL=1"
```

### Task 3: Build and packaging

**Files:**
- Modify: `apps/kiosk/electron.vite.config.ts`
- Modify: `apps/kiosk/scripts/check-prod-bundle.mjs` (CLI block only)
- Create: `apps/kiosk/scripts/before-pack-trial.mjs`
- Create: `apps/kiosk/electron-builder.trial.yml`
- Modify: `apps/kiosk/package.json` (scripts `dev:trial`, `build:trial`)
- Modify: `.gitignore` (add `out-trial/` and `dist-trial/`)
- Test: `apps/kiosk/test/check-prod-bundle.test.ts` (extend)

**Interfaces:**
- Consumes: `assertPackageableBundle(dir?: string)` and `checkPackageableBundle(dir)` from `scripts/check-prod-bundle.mjs`.
- Produces: `pnpm --filter kiosk build:trial` → `apps/kiosk/dist-trial/Photobooth-Trial-Setup-<version>.exe`; `pnpm --filter kiosk dev:trial` → dev run against the demo backend.

- [ ] **Step 1: Write the failing test** in `check-prod-bundle.test.ts`: **Review Focus 5:** `checkPackageableBundle` on a temp dir that has the three `REQUIRED` files plus one `.js` containing `__pbFake` reports a `test-only hook` problem, and on a temp dir missing `renderer/index.html` reports `missing renderer/index.html`. (Reuse the file's existing temp-dir helper if present; this pins the guard the trial now depends on.)

- [ ] **Step 2: Run it**

Run: `pnpm --filter kiosk exec vitest run test/check-prod-bundle.test.ts`
Expected: PASS if the existing guard already behaves this way (then the test is a regression pin); if it FAILs, fix the guard, not the test.

- [ ] **Step 3: Implement.**
  - `electron.vite.config.ts`: `const trialBuild = process.env.VITE_TRIAL === '1'`; throw if both `testBuild` and `trialBuild`; `outRoot` is `out-e2e` for test, `out-trial` for trial, else `out`. `__PB_TEST_BUILD__` stays `testBuild` only.
  - `check-prod-bundle.mjs`: in the `import.meta.url` CLI block pass `process.argv[2] ? resolve(process.argv[2]) : undefined` to `assertPackageableBundle`; update the success message to name the directory checked.
  - `before-pack-trial.mjs`: default export calling `assertPackageableBundle` on `out-trial` (resolved next to the script).
  - `electron-builder.trial.yml`: copy `electron-builder.yml`, change `appId`, `productName`, `extraMetadata.productName`, `directories.output: dist-trial`, `files: out-trial/**/*` (plus `package.json`, same exclusions), `beforePack: scripts/before-pack-trial.mjs`, `nsis.artifactName: Photobooth-Trial-Setup-${version}.${ext}`. Keep icons and NSIS options. Note: `package.json` `main` is `./out/main/index.js`; set `extraMetadata.main: out-trial/main/index.js` so the packaged app finds its entry.
  - `package.json`: `"dev:trial": "cross-env VITE_TRIAL=1 electron-vite dev"` and `"build:trial": "cross-env VITE_TRIAL=1 VITE_FAKE_API= electron-vite build && node scripts/check-prod-bundle.mjs out-trial && electron-builder --win --config electron-builder.trial.yml"`.

- [ ] **Step 4: Build the installer**

Run: `pnpm --filter kiosk build:trial`
Expected: `check-prod-bundle: out-trial is complete and has no test-only hooks`, then `apps/kiosk/dist-trial/Photobooth-Trial-Setup-0.1.0.exe` exists (roughly 100 MB+). Confirm `grep -rl "__pbFake\|PB_FAKE" apps/kiosk/out-trial` prints nothing, `apps/kiosk/out` is untouched, and `electron-builder.yml` is unchanged (`git diff --stat`).

- [ ] **Step 5: Smoke the flow locally**

Run: `pnpm --filter kiosk dev:trial`. Expected: kiosk opens on Setup with no sign-in step; after Setup the start screen shows ₱150.00; paying shows the "DEMO PAYMENT" QR and advances about 5 s later; the delivery QR scans to the trial text. Record what was and was not exercised (camera and printer depend on this Mac).

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/electron.vite.config.ts apps/kiosk/scripts apps/kiosk/electron-builder.trial.yml apps/kiosk/package.json apps/kiosk/test/check-prod-bundle.test.ts .gitignore
git commit -m "feat(kiosk): add the trial installer build (build:trial)"
```

### Task 4: Docs, notes and full verification

**Files:**
- Modify: `docs/DEPLOY.md` (new short section "E.9 Trial build" after E.8, and one line in the section E intro pointing to it)
- Modify: `README.md` (one line under Packaging; one row noting `pnpm --filter kiosk dev:trial`)
- Obsidian: project `Tasks.md` (Done entry with verification), `Architecture.md` (third build flavour), `Decisions.md` (trial = separate flavour, no expiry)

- [ ] **Step 1: Write the docs.** E.9 covers: what the trial is and is not (no backend, simulated payment, bundled Sample strip artwork with no printed trial footer, trial QR text, 3-day expiry), how to build (`pnpm --filter kiosk build:trial`), the output file, installing beside a real kiosk, the data folder `%APPDATA%\Photobooth Kiosk Trial`, SmartScreen note (unsigned), and "cross-built on macOS, not installed on Windows yet".

- [ ] **Step 2: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm --filter kiosk build && pnpm --filter kiosk e2e`
Expected: all green; `pnpm --filter kiosk build` still prints `check-prod-bundle: ... out/ ...` ok.

- [ ] **Step 3: Sync the Obsidian notes** (vault resolved per `~/.claude/CLAUDE.md`), then read `Tasks.md` back and confirm the item is under `## Done` with the date and the verification summary.

- [ ] **Step 4: Commit**

```bash
git add docs README.md
git commit -m "docs: describe the Windows trial build"
```
