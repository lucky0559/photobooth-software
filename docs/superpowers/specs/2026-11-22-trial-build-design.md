# Windows trial build: design

Date: 2026-11-22. Status: approved 2026-11-22.

## Intent

The client wants to install the kiosk on a Windows PC and click through the whole guest flow (start, pay, countdown,
shots, review, print, download QR) to judge it, without any server, account or real payment. The trial is for the
client's evaluation only; nothing in it handles real money.

## Goals

- One Windows installer, `Photobooth-Trial-Setup-<version>.exe`, that runs the full guest flow offline.
- The real camera and the real printer work, so the client sees real photos and a real print.
- Payment is simulated: the QR screen shows a demo QR and confirms itself after about 5 seconds.
- Installs next to, never over, a real kiosk install (own app ID, product name and data folder).
- The real installer's safety guard stays exactly as strict as today.

## Non-goals

- Licence keys or an online lock-out. (Expiry itself was added later: a 3-day limit from first launch, see `2026-11-22-trial-expiry-design.md`.)
- Editing price, shots or templates from an admin page. The trial has one fixed set of settings.
- A real download page, Supabase, PayMongo or Vercel.
- Code signing, auto-update, or testing the installer on Windows (cross-built on macOS only).

## Anti-goals

- A trial that could be mistaken for, or packaged as, the real installer.
- Test hooks (`__pbDebug`, `__pbFake`, `PB_FAKE_*`) shipping in any installer.

## Approaches considered

- **A. Separate trial flavour with its own demo backend (chosen).** `VITE_TRIAL=1` build, new in-memory `DemoKioskApi`,
  own output folder and installer config. Costs a new file plus build wiring. Keeps the test-hook guard intact.
- **B. Package the existing e2e fake build and loosen the guard.** Least work, but ships test hooks, the payment never
  completes in a packaged app (test switches fail closed), and templates say "FAKE". Rejected.
- **C. Real backend on free tiers.** Most faithful, but needs accounts and unrun deploy steps, and a test QR cannot
  be paid from a phone, so it shows no more of the flow than A. Rejected.

## Design

1. **Build flavour.** `electron.vite.config.ts`: when `VITE_TRIAL=1`, output goes to `out-trial/` and
   `__PB_TEST_BUILD__` stays `false`. `VITE_FAKE_API` stays unset, so the existing `fake-api.ts` and its test hooks
   are not bundled.
2. **Demo backend.** New `src/renderer/src/api/demo-api.ts` implements `KioskApi` in memory: fixed settings (the core
   defaults, free mode off), the project's bundled `Sample strip` overlay (600×1800) with no trial footer, and a 4R
   overlay composed from two copies side by side; `createPayment` returns a demo QR image labelled "DEMO PAYMENT",
   `getPaymentStatus` returns `paid` 5 seconds after creation, `cancelPayment` returns `cancelled` unless already paid,
   and `upsertSession` and `uploadPhoto` are no-ops. Auth is `null`, which makes Setup skip its sign-in step. It reads
   no `window` globals. The same bundled overlay is used by the Windows and iPad trial builds.
3. **Wiring.** `main.tsx` picks `DemoKioskApi` when `VITE_TRIAL === '1'`. `env-check.ts` treats a trial build as
   configured (no Supabase or web URL needed).
4. **Download QR.** In a trial build `Delivery.tsx` encodes a short plain-text message instead of a URL, so scanning
   it shows "Trial build: the real kiosk shows your download link here". Without this the screen would show "QR
   unavailable, please call staff", which reads as a bug. My call.
5. **Packaging.** New `electron-builder.trial.yml`: `appId com.photobooth.kiosk.trial`, `productName Photobooth Kiosk
   Trial`, `files: out-trial/**`, output `dist-trial/`, artifact `Photobooth-Trial-Setup-${version}.exe`, same icon and
   NSIS options. New script `build:trial`: trial build, run the existing hook check against `out-trial/`, then
   `electron-builder --win --config electron-builder.trial.yml`. The `build:win` and `package` scripts are unchanged.
6. **Docs.** A short "Trial build" section in `docs/DEPLOY.md` and a line in the README.

## Verification

Unit tests for `DemoKioskApi` (payment timing, cancel, templates) and `checkEnv` in trial mode; typecheck; the full
existing `pnpm test` and kiosk e2e still green; the hook check passes on `out-trial/`; `build:trial` produces the
`.exe` on this Mac. Not verified: installing or running on Windows.

## Client update (2026-11-23)

The initial Electron build's cached `Sample strip` overlay is the trial print artwork. It is bundled in both Windows and
iPad trial builds. The 4R demo overlay places two copies side by side, matching paired-print output. Demo payment and
download QR indicators remain; printed photos do not carry a trial footer.

## Remaining choices

The demo QR graphic and its on-screen copy remain demo-specific.
