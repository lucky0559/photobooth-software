# iPad trial web app: design

Date: 2026-11-22. Status: approved by delegation (the owner said "do what's best so we can ship and send to the client
for testing on their iPad"; the approach was proposed in the previous message and not objected to).
Builds on the kiosk renderer, the Windows trial ([trial build](2026-11-22-trial-build-design.md),
[expiry](2026-11-22-trial-expiry-design.md)). Stacked on branch `feat/paired-print` (PR #1 is open).

## Intent

The client will run the booth on an iPad, using the iPad's own camera, printing through AirPrint to a Canon SELPHY. The
owner wants something to send the client for testing now, and the same app is the starting point for the final iPad
product. The kiosk screens are already web code, so the iPad build is a Safari web app, installed to the Home Screen and
locked with Guided Access, running the same guest flow against the demo backend (like the Windows trial).

## Goals

- The Windows trial guest flow on an iPad in Safari or from the Home Screen: attract, demo payment, capture with the iPad
  camera, review with looks, output, delivery (with the trial QR text), plus first-run Setup (PIN, camera, test print).
- Printing: one 1200x1800 sheet through the AirPrint print sheet (guest taps Print each time). Setup's "Print test page"
  prints the 4x6 test page, which is how the client checks borderless 4x6 on their SELPHY.
- Trial prints use the same bundled project `Sample strip` artwork as the Windows trial, without a printed trial footer.
- Everything stored on the iPad (config, PIN, overlays, photos, sync queue) in browser storage, with a request for
  persistent storage.
- The same 3-day trial as the Windows trial (first launch starts a 72 h clock, a clock moved back over 10 min ends it,
  fails closed on a corrupt value), stored in `localStorage`, with the same "Trial ended" page.
- Installable and usable offline after the first load (web app manifest, iPad meta tags, a small service worker).
- Output: `pnpm --filter kiosk build:web` produces a static folder `apps/kiosk/dist-web/` to host over HTTPS, and
  `docs/IPAD.md` explains hosting, installing, Guided Access, AirPrint and what to test.

## Non-goals

- The real backend (Supabase, PayMongo, the admin web) on the iPad. The renderer already has that code path, but it is
  not wired, built or tested for the web in this work.
- Silent printing (a native iOS shell could do it later), paired print on iPad (its timeout print needs a tap; it stays
  off in the web build), iPhone layouts, App Store or TestFlight distribution, publishing the site
  (hosting needs the owner's account and approval; this work ends at a deployable folder).
- Any behaviour change to the Electron kiosk, the Windows trial or the real build.

## Anti-goals

- The Electron builds, their bundle guards, or their e2e changing behaviour.
- The demo flavour being able to take real money, or a test hook shipping in the web build.
- A silent failure on an iPad: no camera, a blocked print, cleared browser storage, or an old iPadOS must show a clear
  message, not a blank screen.

## Constraints

- iPadOS 16.4 or newer (needed for `OffscreenCanvas` and WebKit canvas APIs the compose code uses); iPadOS 17+ recommended.
  The app shows a clear "update your iPad" message when a required API is missing.
- The page must be served over HTTPS (the camera and service worker need a secure context).
- Safari does not support the canvas 2D `filter` property the Black & White and Warm looks use in `compose.ts`: the web
  build needs a pixel-based fallback that produces the same looks.
- The iPad web layout supports portrait and landscape with responsive screen compositions and safe-area sizing. Rotation must
  keep the current guest screen visible; no orientation lock or rotate overlay is shown.
- No new runtime dependencies unless the plan justifies one. Money stays integer centavos. No AI trailers in commits.
  Obsidian notes are updated by the controller only.

## Approaches considered

- **A. Safari web app, installed to the Home Screen (chosen).** One new build target of the existing renderer with a
  browser implementation of the `window.kiosk` bridge. Reuses every screen and the compose/print-sheet code. Printing
  through the AirPrint sheet needs a tap per print.
- **B. Native iOS shell (Capacitor or similar) around the same web app.** Can print to a saved AirPrint printer with no
  dialog, and gets a real app icon and kiosk behaviour, but needs an Apple developer account, a native plugin and a signing
  and distribution step. A later upgrade for the final product, not for this trial. The bridge boundary below keeps it open.
- **C. Remote desktop to a PC.** Does not use the iPad camera. Rejected.

## Design

1. **Web build target.** `apps/kiosk/vite.web.config.ts` builds the existing renderer sources to `apps/kiosk/dist-web/`
   (relative base) with the trial/demo flags on (`VITE_TRIAL=1`, plus a new `VITE_WEB=1`), blanking the Supabase and web
   URL variables like `build:trial` does. A web HTML entry (`src/renderer/web/index.html`, or equivalent) carries the iPad
   meta tags (`viewport` with `viewport-fit=cover` and no zoom, apple-mobile-web-app-capable, status bar style, touch
   icon, manifest link) and a CSP that allows only what the web app needs. A web entry script installs `window.kiosk`
   (the browser bridge) before the existing renderer entry runs. New scripts: `build:web`, `dev:web`, `preview:web`. The
   Electron builds, `electron.vite.config.ts` and their output folders are untouched.
2. **Browser bridge** (`implements KioskBridge`, all methods the interface has today, including the held-strip ones). Storage
   behind a small injectable key-value interface (IndexedDB in the app, an in-memory implementation in tests): config
   object (same shape and validation rules as `LocalConfig`/`ConfigPatch`, no PIN hash exposed), overlays (PNG blobs), photos
   (JPEG blobs under a synthetic path), the sync queue (jobs list with the same add/apply semantics). Photos older than 7
   days are deleted at start, and `navigator.storage.persist()` is requested. Pure helpers from `src/main/` (queue
   validation, config patch validation, pin throttle) are reused only if they import nothing from `node:*`; otherwise the
   plan gives each a browser equivalent with the same rules and tests. Held-strip methods exist and work trivially (paired
   print is off).
3. **PIN.** The 4 to 8 digit rule and the wrong-PIN throttle (5 free attempts, then 30 s doubling to 5 min, in memory) are the
   same as the kiosk's. Hashing uses WebCrypto (PBKDF2-SHA-256, 100 000 iterations, 16-byte random salt, stored as
   `pbkdf2$<iterations>$<saltB64>$<hashB64>`); the Node `scrypt` module is not used in the browser.
4. **Printing.** `print(jpeg, copies)` renders the sheet as a full-bleed image in a print-only layer (`@page { size: 4in 6in;
   margin: 0 }`), calls `window.print()`, and resolves `{ ok: true }` after `afterprint` or a 90 s timeout; `copies` is ignored
   (the AirPrint sheet has its own copies). `listPrinters()` returns one entry, "AirPrint (choose the printer in the print
   sheet)". `printTestPage()` prints the existing 4x6 test page through the same path. A failure to open the print sheet
   resolves `{ ok: false, reason }`. The guest screens say "Tap Print on the iPad's print sheet".
5. **Trial clock.** The pure clock rules (`evaluateTrial`, `TrialState`, the duration and tolerance constants) move from
   `src/main/trial.ts` to a shared module (`src/shared/trial-clock.ts`); `main/trial.ts` imports them and its tests stay
   green unchanged. A web store keeps the state under one `localStorage` key, evaluates at start and every 60 s, fails
   closed on an unparsable value, and replaces the app with the static "Trial ended" page when over. Clearing Safari's site
   data starts a new trial (a known, documented weakness; the owner can also take the site down).
6. **Look fallback.** `compose.ts` keeps `ctx.filter` where the browser supports it (feature-detected by setting and reading
   it back) and otherwise applies a pixel version (`getImageData`/`putImageData`) of the same three looks
   (none, bw = `grayscale(1) contrast(1.1)`, warm = `sepia(0.25) saturate(1.2) brightness(1.03)`) to each shot before drawing.
   The pixel function is pure and unit-tested against known pixels; the Electron path is unchanged.
7. **iPad behaviour.** `<video>` elements get `playsinline` and `muted`; the camera opens the front camera by default
   (`facingMode: 'user'`) unless Setup picked a device; text selection, pinch zoom and pull-to-refresh are disabled by CSS and
   meta tags; guest screens reflow for both portrait and landscape; a "Camera blocked" and an "iPad too old" message exist.
   All new UI text is short and plain.
8. **Offline and install.** `manifest.webmanifest` (name "Photobooth Trial", standalone, any orientation, icons from
   `apps/kiosk/build/icon.png`), an `apple-touch-icon` (180x180 PNG committed under the web entry's public folder), and a
   small hand-written service worker that precaches the build output and serves it cache-first, versioned by the build so a
   new deploy replaces the old cache. Registered only in the web build.
9. **Docs.** `docs/IPAD.md`: build and host (any static HTTPS host; the exact `dist-web/` upload), open in Safari, Share, Add to
   Home Screen, Guided Access (Settings, Accessibility), connect the iPad and the SELPHY to the same Wi-Fi, the first-run
   Setup, what to check in the test print (borderless, centred, 4x6) and the paper size in the print sheet, the 3-day trial,
   and what is not verified. A short pointer in README.

## Verification

Unit tests: browser bridge over the in-memory store (config validate/patch, PIN set/check/throttle with WebCrypto, overlays,
photos, queue add/apply, held-strip stubs), the print layer (the sheet becomes the print layer, `print` is called once,
`afterprint` and the timeout resolve, failure to print resolves not-ok), the trial clock reuse (the Windows tests stay green;
the web store fails closed on a corrupt value and ends on a rollback), the pixel look fallback, the capability check
messages. Web e2e: Playwright with Chromium and a fake camera against `vite preview` of `dist-web/`, `window.print` stubbed:
set up the PIN, take a guest through demo payment, capture, review and delivery; reload and confirm offline start through
the service worker and persistence of the config. A Playwright WebKit smoke at iPad portrait (820x1180) and landscape (1180x820) viewports checks the app remains visible,
fits without clipped controls and loads without console errors (no camera). The Electron suite, typecheck, the real-build guard
and `build:trial` must still pass unchanged. Not verifiable here, and said so in `docs/IPAD.md`: AirPrint to the SELPHY and
its borderless 4x6 result, Safari's camera permission behaviour from the Home Screen, Guided Access, real iPad rendering and
performance.

## Left to the builder

File layout under `src/renderer/web/` and `src/renderer/src/web/`, the storage schema and database names, the exact print
layer CSS, icon file generation (`sips` or a committed asset), service worker details, message wording, test names.
