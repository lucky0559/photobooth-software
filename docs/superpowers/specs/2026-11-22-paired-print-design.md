# Paired print (two guests per 4x6 sheet): design

Date: 2026-11-22. Status: approved 2026-11-22 (the owner approved the design and asked that the installer name carry a "Paired" mark).
Builds on the Windows trial build ([trial-build design](2026-11-22-trial-build-design.md), [trial expiry](2026-11-22-trial-expiry-design.md)). Stacked on branch `feat/trial-expiry`.

## Intent

The owner wants to save paper. Today one guest gets one 2x6 strip printed twice on a 4x6 sheet (the second strip is a
duplicate). With paired print, two different guests share one sheet: guest A's strip on the left, guest B's on the right,
and the owner cuts the 4x6 down the middle. Guests come one after another, not together: A's strip is held until B finishes.

## Goals

- In paired mode a guest takes their normal shots (up to 4) and the kiosk prints one 4x6 sheet per two guests.
- A's strip is held on disk (survives restarts and power cuts) until a second guest finishes, then one sheet prints.
- If no second guest comes within 10 minutes, the held strip prints alone (right half blank), so no guest waits forever.
- Each guest still gets their own download QR for their own strip (their session photo is their single strip).
- A guest whose strip is held is told when their print will come out.
- A new Windows trial installer with this behaviour on by default.

## Non-goals

- Guests at the booth together (8 shots in one session), more than two guests per sheet, any settings or admin-web UI
  for this (the real product would need a database setting later), reprints, a cut guide on the paper.
- Changing the real (Supabase) build's behaviour: it must act exactly as today. Gate = `settings.pairedPrint === true`
  plus a `strip_2x6` template; the real build never sets that flag, so it never takes the paired path, never polls
  the held strip, and never shows the guest message. The new bridge methods, IPC handlers and store code may ship dormant
  in every build (no build-time stripping is required).

## Anti-goals

- Losing or double-printing a held strip (a power cut, a restart, a timeout racing a second guest).
- A guest's photo or QR depending on the pairing (a print problem must never block their download).

## Constraints

- Paired mode applies only when `settings.pairedPrint === true` **and** the active template layout is `strip_2x6`.
  Otherwise the existing path runs unchanged (this includes `print_4r`, the full-sheet 2x2 layout).
- One held strip at most. 10-minute wait (`PAIR_WAIT_MS = 600_000`). Paper size and strip size unchanged
  (sheet 1200x1800, strip 600x1800, `printSheetPlacements('strip_2x6')`).
- Money stays integer centavos; each guest pays the full price separately (sessions stay independent).
- No AI trailers in commits. Obsidian notes are updated by the controller only.

## Approaches considered

- **A. Renderer-orchestrated, main process only stores the held record (chosen).** The renderer already composes and
  uploads photos and calls `print`. It composes each guest's strip, and a new small store in main holds one
  record pointing at the already-saved strip photo. The pair sheet is composed in the renderer from two strips. Least
  new code, reuses `composeLayout`, `runOutput`, the photo store and upload queue; the held record is tiny.
- **B. Main-process print spooler.** Main owns pairing, the timer and printing. More robust against a reloaded
  renderer, but main has no canvas, so combining two JPEGs there means a new compositing path (or CSS in the print
  window), and the logic would be split across processes. More code for the same behaviour. Rejected.
- **C. Hold in renderer memory only.** Simplest, but a restart or power cut loses the held strip, which you ruled out.
  Rejected.

## Design

1. **Core** (`packages/core`): `KioskSettings` gets an optional `pairedPrint?: boolean` (absent means off; the
   Supabase mapping never sets it, so the real build is unchanged; `validateSettings` still validates only the known
   fields and passes this one through). `PAIR_WAIT_MS = 600_000`. A pure `heldStripDue(held, now): boolean`
   (`now - held.heldAt >= PAIR_WAIT_MS`). The session machine's `OUTPUT_DONE` event gains an optional `held?: boolean`
   and the `delivery` state gets `printHeld: boolean` (false unless `held` is true).
2. **Held record** (`apps/kiosk` main + bridge): `interface HeldStrip { sessionId: string; filePath: string; heldAt: number }`.
   New bridge methods `getHeldStrip(): Promise<HeldStrip | null>`, `holdStrip(h: HeldStrip): Promise<void>` and
   `claimHeldStrip(): Promise<HeldStrip | null>`. Claim is an atomic read-and-clear in main, so only one caller can take
   the held strip (this removes the timeout-vs-second-guest race). `holdStrip` rejects when a strip is already held.
   Stored as `<userData>/held-strip.json` through the existing JSON store; every IPC argument is untrusted: `sessionId`
   must be a UUID, `filePath` must pass `resolvePhotoReadPath` (inside the photos folder), `heldAt` a finite number.
3. **Compose** (`compose/compose.ts`): `composeStrip(input): Promise<Blob>` renders one 600x1800 strip JPEG (the layout
   canvas as a JPEG); `composePairSheet(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>` draws two strips at
   the two `strip_2x6` placements on a white 1200x1800 sheet (`right === null` leaves the right half blank).
4. **Output** (`output/run-output.ts`, `screens/Output.tsx`): in paired mode `runOutput` composes the guest's single
   strip, saves it as their session photo and queues the upload exactly as today (their QR shows their strip). It then
   calls `claimHeldStrip()`. Nothing held: `holdStrip({ sessionId, filePath, heldAt: now })` and resolve
   `{ held: true, printError: null }` (no print). Something held: read that strip's photo, compose the pair sheet (held on
   the left, this guest on the right), print one copy, resolve `{ held: false, printError }`. If the held photo cannot be
   read or decoded, print this guest's strip alone and log one fixed line. `copiesPerSession` is ignored in paired mode
   (one sheet per pair). The print outcome is recorded on this (second) guest's session row only. A failed
   `holdStrip` must reject so the existing "Try again" path runs. **Retry rules** (settled after the builder check):
   the claim/hold step happens after this guest's strip is composed, saved and queued. Its outcome (`held`, or the
   print result) is remembered per session in the `Output` component exactly like `priorPrint` is today, and a retry
   that has a remembered outcome skips the claim/hold/print step, so a retry never claims its own held strip and never
   prints twice. `holdStrip` is also idempotent for the same `sessionId` (a repeat of the same record is a no-op).
   If anything throws after a successful claim and before the print is attempted (reading or composing), the claimed
   strip is put back with `holdStrip` and the error is rethrown, so "Try again" can pair it again.
   **Accepted trade-off:** a crash or power cut in the few seconds between a successful claim and the print finishing
   loses that pair's sheet (both guests' photos and QR downloads are unaffected; the owner sees no paper). This is
   preferred over a two-phase claim/confirm protocol, which would add a store state and reopen the timeout race.
5. **Timeout** (`App.tsx` `KioskFlow`): only when `settings.pairedPrint === true` (so the real build never runs or calls
   it), while the state is `attract`, every 30 s call `getHeldStrip()`; when
   `heldStripDue(held, Date.now())`, `claimHeldStrip()` and, if it returned a strip, print it alone (right half blank).
   The timer runs only on the attract screen, so a guest mid-session is never raced; it also fires on the first tick after
   an app restart with an old held strip. A failed print here logs one fixed line (the claimed strip is not re-held;
   the guest's photo and QR are unaffected).
6. **Guest message** (`screens/Delivery.tsx`): when `printHeld`, show a clear line such as "Your print comes out when the
   next guest finishes, or within 10 minutes. Ask the owner for your print." The existing print-error line is unchanged.
7. **Demo backend** (`api/demo-api.ts`): `getSettings()` returns `pairedPrint: true`. The e2e `FakeKioskApi` already merges
   arbitrary partial settings, so e2e can set `pairedPrint` through `PB_FAKE_CONFIG`.
8. **Windows build**: bump `apps/kiosk/package.json` `version` to `0.2.0`, and mark the feature in the installer file
   name: `electron-builder.trial.yml` `nsis.artifactName` becomes `Photobooth-Trial-Paired-Setup-${version}.${ext}`, so the
   new installer is `Photobooth-Trial-Paired-Setup-0.2.0.exe` and cannot be confused with the old
   `Photobooth-Trial-Setup-0.1.0.exe` (owner's instruction: the name must show the installer has paired print).
   Only the file name changes: appId, productName and data folder stay, so installing it over the old trial keeps the same
   data folder and the same 3-day trial clock. Update the file-name and version references in
   `docs/DEPLOY.md` E and E.9. E.9 and the README get a short "Paired print" note: what the owner does (cut the 4x6
   down the middle), the 10-minute wait, one held strip at most.

## Verification

Unit tests: core `heldStripDue`, `OUTPUT_DONE`/`printHeld` state, optional setting pass-through; main held-strip store
(hold/get/claim atomicity, a second `holdStrip` rejects, IPC validation, persistence across a store reload);
`composePairSheet` placements; `runOutput` paired: first guest holds and does not print, second guest prints one sheet and
clears, missing held photo falls back to a solo print, a print failure is recorded on the second guest only, retry never
holds or prints twice; real path (no `pairedPrint`) unchanged. Kiosk e2e (fake API): two guests in a row give 0 prints then
1 print; a held strip older than the wait prints alone from the attract screen (the wait must be shortened for the test
through the fake config, test-only); a real-path test shows that without `pairedPrint` the existing flow neither holds,
polls nor prints differently. Existing suites, typecheck, real-build guard and the trial build still pass. Not verifiable here: printing on a real printer, cutting the paper, Windows install.

## Left to the builder

File layout and names inside the files named above, the exact guest message wording and styling, how the test-only wait
override is exposed in the fake config, the held-record JSON shape on disk beyond the three fields.
