# Paired Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In paired mode two guests in a row share one 4x6 sheet (first guest's strip on the left, second on the right). The first strip waits on disk for the second guest, for up to 10 minutes. The Windows trial installer ships with paired mode on, as `Photobooth-Trial-Paired-Setup-0.2.0.exe`.

**Architecture:** The renderer orchestrates (design approach A). `runOutput` composes the guest's single strip, saves and queues it as today, then claims the held strip or holds its own. The main process only stores one held record (`held-strip.json` through the existing JSON store) behind an atomic claim. The renderer composes the pair sheet from two strip JPEGs. An attract-screen timer prints a held strip alone once it has waited too long. Everything is gated on `settings.pairedPrint === true` plus a `strip_2x6` template. Only the demo backend sets that flag.

**Tech Stack:** TypeScript, React 19, Electron 45 (main + preload IPC), OffscreenCanvas, vitest, Playwright (Electron), electron-builder (NSIS), pnpm 9 workspace.

**Spec:** `docs/superpowers/specs/2026-11-22-paired-print-design.md`

## Global Constraints

- Branch `feat/paired-print` (stacked on `feat/trial-expiry`, created by the controller before execution). Node 22, pnpm 9.15.0.
- Paired mode applies only when `settings.pairedPrint === true` **and** the active template layout is `strip_2x6`. Otherwise the existing path runs unchanged, including for `print_4r`. The test is `isPairedMode` (Task 1); nothing else decides it.
- `PAIR_WAIT_MS = 600_000`. One held strip at most. Sheet 1200x1800 and strip 600x1800, placed with `printSheetPlacements('strip_2x6')`. The pair sheet prints 1 copy; `copiesPerSession` is ignored in paired mode.
- The real (Supabase) build must act exactly as it does today. `SupabaseKioskApi.getSettings` never sets `pairedPrint`, so the real build never takes the paired path, never polls the held strip and never shows the guest message. The new bridge, IPC and store code may ship dormant in every build. Do not add `pairedPrint` to `settingsOrNull` in `config-validation.ts`: the cached-settings copy keeps only the known fields.
- Do not add any of the strings the trial-bundle guard forbids (`__pbDebug`, `__pbFake`, `__pbPrintCalls`, `PB_FAKE`, `PB_USER_DATA`) to non-test code. The e2e wait override reaches the app as a `pairTiming` prop. `main.tsx` sets it only in its existing `VITE_FAKE_API === '1'` branch, from a `FakeKioskApi` method (Task 4).
- Every IPC argument is untrusted. `sessionId` must match `UUID_PATTERN`. `filePath` must pass `resolvePhotoReadPath(photosDir, …)`. `heldAt` must be a finite number.
- A guest's photo and QR never depend on the pairing. Fixed log lines carry no paths or ids.
- Money stays integer centavos. Each guest pays the full price, and sessions stay independent.
- Commits use Conventional Commits with a subject and body only. Add **no `Co-Authored-By` or any AI attribution trailer**.
- Stage only the files each task names. The tree has unrelated untracked `docs/PRICING.md`, `docs/history/` and `docs/superpowers/`; never `git add -A`, `git add .` or `git add docs`.
- Only the controller edits the Obsidian vault. Implementers never touch it.

## Review Focus

1. **Try again after the pair step already ran.** Case one: the hold succeeded. Case two: the pair sheet printed and a later queue write failed. Case three: a hold persisted in main but its reply was lost. In every case the retry must not claim again, hold twice, pair the guest with their own strip or print a second sheet (Task 3).
2. **Timeout against a second guest.** The timer runs only on the attract screen with paired mode on. The claim is atomic, so the strip goes out once. When a guest's claim wins, the timer prints nothing (Task 2 store, Task 4 timer gate and flush).
3. **App restarted (or power cut) with an old held strip.** The record survives a reload. The first attract tick after restart prints it alone once it is due. A claim whose clear cannot be saved rejects and keeps the strip, so it is never printed twice (Task 2, Task 4 unit and e2e).
4. **Held photo missing or unreadable** (deleted, cleaned up by the 7-day photo retention, corrupt). The second guest still gets a print (their strip alone), one fixed line is logged, and the dead strip is not re-held. The timeout path logs once and does not retry it (Task 3, Task 4).
5. **The real build entering the paired path.** An absent, `false` or non-boolean `pairedPrint`, or a `print_4r` template, must take today's path: duplicated-strip sheet, `copiesPerSession` copies, no `held-strip.json`, no timer (Task 1, Task 3, Task 4 gate and e2e).

---

### Task 1: Core: setting, wait, gate and delivery flag

**Files:**
- Modify: `packages/core/src/types.ts:12-20` (`KioskSettings`)
- Create: `packages/core/src/paired-print.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './paired-print.ts';`)
- Modify: `packages/core/src/session-machine.ts:16,28,86-88`
- Test: `packages/core/test/paired-print.test.ts` (new), `packages/core/test/session-machine.test.ts`, `packages/core/test/settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `@pb/core`):
  - `KioskSettings.pairedPrint?: boolean`. Absent means off. Do not add it to `DEFAULT_SETTINGS`. `validateSettings` stays unchanged: it already returns the input object, so the field passes through.
  - `PAIR_WAIT_MS = 600_000`.
  - `heldStripDue(held: { heldAt: number }, now: number, waitMs: number = PAIR_WAIT_MS): boolean` returns `now - held.heldAt >= waitMs`.
  - `isPairedMode(settings: Pick<KioskSettings, 'pairedPrint'>, layout: LayoutId | null | undefined): boolean` returns `settings.pairedPrint === true && layout === 'strip_2x6'`.
  - `KioskEvent` `OUTPUT_DONE` becomes `{ type: 'OUTPUT_DONE'; printError: string | null; held?: boolean; now: number }`.
  - `KioskState` `delivery` becomes `{ name: 'delivery'; sessionId: string; printError: string | null; printHeld: boolean; enteredAt: number }`. `printHeld` is `event.held === true`.

- [ ] **Step 1: Write the failing tests**
  - `paired-print.test.ts`:
    - `PAIR_WAIT_MS === 600_000`.
    - `heldStripDue({ heldAt: 1000 }, 600_999)` is `false` and `heldStripDue({ heldAt: 1000 }, 601_000)` is `true`.
    - `heldStripDue({ heldAt: 1000 }, 0)` is `false`.
    - With `waitMs` `2000`: `heldStripDue({ heldAt: 0 }, 1999, 2000)` is `false` and `heldStripDue({ heldAt: 0 }, 2000, 2000)` is `true`.
    - **Review Focus 5:** `isPairedMode({ pairedPrint: true }, 'strip_2x6')` is `true`. Each of these is `false`:
      - `({ pairedPrint: true }, 'print_4r')`
      - `({}, 'strip_2x6')`
      - `({ pairedPrint: false }, 'strip_2x6')`
      - `({ pairedPrint: 'true' as never }, 'strip_2x6')`
      - `({ pairedPrint: 1 as never }, 'strip_2x6')`
      - `({ pairedPrint: true }, null)`
      - `({ pairedPrint: true }, undefined)`
  - `session-machine.test.ts`:
    - Change the `OUTPUT_DONE moves output to delivery` expectation to `{ name: 'delivery', sessionId: 's1', printError: 'jam', printHeld: false, enteredAt: 7 }`.
    - Add `OUTPUT_DONE with held: true sets printHeld`. The event is `{ type: 'OUTPUT_DONE', printError: null, held: true, now: 7 }` and the result is `{ name: 'delivery', sessionId: 's1', printError: null, printHeld: true, enteredAt: 7 }`.
    - Add `printHeld: false` to the two delivery literals at lines 50 and 55.
  - `settings.test.ts`:
    - `validateSettings({ ...DEFAULT_SETTINGS, pairedPrint: true })` is `ok` with `value.pairedPrint === true`.
    - `'pairedPrint' in DEFAULT_SETTINGS` is `false`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pb/core test`
Expected: FAIL. `paired-print.test.ts` cannot resolve `../src/paired-print.ts`, and the `OUTPUT_DONE` tests fail on `printHeld`.

- [ ] **Step 3: Implement** the items listed under Produces. `transition`'s `output` case adds `printHeld: event.held === true`. Nothing else in the machine changes.

- [ ] **Step 4: Run to verify pass (core and kiosk stay green)**

Run: `pnpm --filter @pb/core test && pnpm --filter @pb/core typecheck && pnpm --filter kiosk test && pnpm --filter kiosk typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/paired-print.ts packages/core/src/index.ts packages/core/src/session-machine.ts packages/core/test/paired-print.test.ts packages/core/test/session-machine.test.ts packages/core/test/settings.test.ts
git commit -m "feat(core): add the paired print setting, wait and delivery flag"
```

### Task 2: Held-strip store, IPC and bridge

**Files:**
- Create: `apps/kiosk/src/main/held-strip.ts`
- Modify: `apps/kiosk/src/shared/bridge.ts:63-109` (`HeldStrip`, three `KioskBridge` methods, three `IPC` names)
- Modify: `apps/kiosk/src/preload/index.ts:6-21`
- Modify: `apps/kiosk/src/main/ipc.ts:26-32` (new parameter and handlers)
- Modify: `apps/kiosk/src/main/index.ts:149-157` (create the store and pass it)
- Test: `apps/kiosk/test/held-strip.test.ts` (new)

**Interfaces:**
- Consumes: `createJsonStore`, `JsonStore<T>`, `Normalized<T>` from `./json-store`; `resolvePhotoReadPath` from `./photos`; `UUID_PATTERN` from `../shared/queue`.
- Produces:
  - `shared/bridge.ts`:
    - `export interface HeldStrip { sessionId: string; filePath: string; heldAt: number }`.
    - New `KioskBridge` methods:
      - `getHeldStrip(): Promise<HeldStrip | null>`
      - `holdStrip(h: HeldStrip): Promise<void>`: rejects while a different session's strip is held; a repeat for the same `sessionId` is a no-op.
      - `claimHeldStrip(): Promise<HeldStrip | null>`: atomic read-and-clear.
    - New `IPC` entries: `getHeldStrip: 'held:get'`, `holdStrip: 'held:hold'`, `claimHeldStrip: 'held:claim'`.
  - `main/held-strip.ts`:
    - `HELD_STRIP_FILE = 'held-strip.json'`.
    - `interface HeldStripFile { held: HeldStrip | null }` and `EMPTY_HELD_STRIP: HeldStripFile = { held: null }`. On disk the file is `{"held":null}` or `{"held":{"sessionId":…,"filePath":…,"heldAt":…}}`.
    - `validateHeldStrip(v: unknown, photosDir: string): HeldStrip` throws `Error('Invalid held strip')`. It returns only the three fields, with `filePath` as resolved by `resolvePhotoReadPath`.
    - `normalizeHeldStripFile(photosDir: string): (v: unknown) => Normalized<HeldStripFile> | null`. It returns `null` (the store then treats the file as corrupt) when `held` is neither `null` nor valid.
    - `createHeldStripApi(store: JsonStore<HeldStripFile>, photosDir: string): { get(): HeldStrip | null; hold(h: unknown): void; claim(): HeldStrip | null }`.
  - `registerIpc(store, overlayDir, photosDir, queue, heldStrips: JsonStore<HeldStripFile>, switches)`: the new parameter goes before `switches`.

- [ ] **Step 1: Write the failing tests** in `test/held-strip.test.ts`. Use a temp dir as in `store-api.test.ts` (`mkdtempSync`, `console.error` spied), `photosDir = join(dir, 'photos')`, `file = join(dir, 'held-strip.json')`, `SID`/`SID2` UUIDs and `rec = { sessionId: SID, filePath: join(photosDir, SID + '.jpg'), heldAt: 1000 }`. Use `open(fs?)` to build `createJsonStore(file, EMPTY_HELD_STRIP, { normalize: normalizeHeldStripFile(photosDir), sleep: () => {}, fs })` plus `createHeldStripApi`. Assertions:
  - A fresh store has `get() === null`, and `existsSync(file)` is `false` after `get()` and `claim()` (dormant: nothing is written).
  - `hold(rec)` makes `get()` equal `rec`, and the file parses to `{ held: rec }`.
  - **Review Focus 3:** after `hold(rec)`, a second `open()` on the same file has `get()` equal to `rec`.
  - **Review Focus 2:** after `hold(rec)`, the first `claim()` equals `rec`, the second `claim()` is `null`, `get()` is `null`, and the file parses to `{ held: null }`.
  - `hold({ ...rec, sessionId: SID2, filePath: join(photosDir, SID2 + '.jpg') })` throws `A strip is already held`, and `get()` still equals `rec`.
  - `hold({ ...rec, heldAt: 5000 })` (same `sessionId`) does not throw, and `get().heldAt === 1000`.
  - Each of these makes `hold(x)` throw `Invalid held strip`, and `existsSync(file)` stays `false`:
    - `null`, `[]` and `'x'`
    - `{ ...rec, sessionId: 'abc' }`
    - `{ ...rec, filePath: '/etc/passwd.jpg' }`
    - `{ ...rec, filePath: 'photos/a.jpg' }`
    - `{ ...rec, filePath: photosDir + '/../x.jpg' }` (a literal `..` segment; do not use `join`, which removes it)
    - `{ ...rec, heldAt: Number.NaN }`, `{ ...rec, heldAt: Infinity }` and `{ ...rec, heldAt: '1000' }`
  - With a hand-written file `{ held: { ...rec, filePath: join(dir, 'elsewhere.jpg') } }`, `get()` is `null` on open. The file was tampered with, so it is moved aside and never returned.
  - **Review Focus 3:** `hold(rec)` on one store. A second `open({ renameSync: () => { throw new Error('EPERM') } })` on the same file has `claim()` throw. A third plain `open()` still has `get()` equal to `rec`. A claim whose clear was not saved hands nothing out.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/held-strip.test.ts`
Expected: FAIL (cannot resolve `../src/main/held-strip`).

- [ ] **Step 3: Implement.**
  - `held-strip.ts`:
    - `hold` validates first. Then it is a no-op when `get()?.sessionId === h.sessionId`, throws `A strip is already held` when another record is held, and otherwise calls `store.update(() => ({ held: h }))`.
    - `claim` reads `held`. When `held` is `null` it returns `null` without writing. Otherwise it calls `store.update(() => ({ held: null }))` and then returns the record, so a failed write throws before anything is handed out. All of this is synchronous in the main process, which makes the claim atomic.
  - `ipc.ts`: `const held = createHeldStripApi(heldStrips, photosDir)` and three `ipcMain.handle` calls (`get`, `hold(h: unknown)`, `claim`).
  - `index.ts`: create `createJsonStore<HeldStripFile>(join(userData, HELD_STRIP_FILE), EMPTY_HELD_STRIP, { normalize: normalizeHeldStripFile(photosDir) })` next to `queue`, and pass it to `registerIpc`.
  - `preload/index.ts`: `getHeldStrip: () => ipcRenderer.invoke(IPC.getHeldStrip)`, `holdStrip: (h) => ipcRenderer.invoke(IPC.holdStrip, h)` and `claimHeldStrip: () => ipcRenderer.invoke(IPC.claimHeldStrip)`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter kiosk exec vitest run test/held-strip.test.ts && pnpm --filter kiosk test && pnpm --filter kiosk typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/main/held-strip.ts apps/kiosk/src/main/ipc.ts apps/kiosk/src/main/index.ts apps/kiosk/src/shared/bridge.ts apps/kiosk/src/preload/index.ts apps/kiosk/test/held-strip.test.ts
git commit -m "feat(kiosk): add the held strip store with an atomic claim"
```

### Task 3: Strip and pair-sheet composition, paired `runOutput`

**Files:**
- Modify: `apps/kiosk/src/renderer/src/compose/compose.ts` (add two functions after `composeSheet`)
- Modify: `apps/kiosk/src/renderer/src/compose/session-sheet.ts` (add `buildSessionStrip`)
- Modify: `apps/kiosk/src/renderer/src/output/run-output.ts`
- Test: `apps/kiosk/test/compose.test.ts` (new), `apps/kiosk/test/output.test.ts`

**Interfaces:**
- Consumes: `HeldStrip`, and the `KioskBridge` methods `claimHeldStrip`, `holdStrip` and `readPhoto` (Task 2); `printSheetPlacements`, `SHEET`, `layoutSize` from `@pb/core`.
- Produces:
  - `compose.ts`:
    - `composeStrip(input: ComposeInput): Promise<Blob>`: `composeLayout(input)` as JPEG q0.92 (600x1800 for `strip_2x6`).
    - `composePairSheet(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>`: a white 1200x1800 canvas, `left` at `printSheetPlacements('strip_2x6')[0]`, `right` (when not `null`) at `[1]`, as JPEG q0.92.
  - `session-sheet.ts`: `buildSessionStrip(args: SessionSource & { filter: FilterId }): Promise<Blob>`. This mirrors `buildSessionSheet` but calls `composeStrip`.
  - `run-output.ts`:
    - `export type PairedOutcome = { held: true } | { held: false; printError: string | null }`.
    - `export interface PairedDeps { bridge: Pick<KioskBridge, 'claimHeldStrip' | 'holdStrip' | 'readPhoto'>; decode(jpeg: Blob): Promise<ImageBitmap>; composePair(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>; prior?: PairedOutcome; onOutcome?(outcome: PairedOutcome): void }`.
    - `OutputDeps` gets `paired?: PairedDeps`. When it is absent, today's path runs byte-for-byte.
    - `runOutput(d): Promise<{ printError: string | null; held: boolean; sheet: Blob }>`. `held` is `false` on the existing path. `sheet` is always the guest's own session photo.
    - `export const HELD_UNREADABLE_LOG = 'paired print: the held strip could not be read; printing this strip alone'`.
    - `export const REHOLD_FAILED_LOG = 'paired print: could not put the held strip back'`.

- [ ] **Step 1: Write the failing tests.**
  - `compose.test.ts`: use `vi.stubGlobal('OffscreenCanvas', FakeCanvas)`, a minimal fake that records each instance's `width`/`height`, `fillStyle` sets, `fillRect`, `drawImage` and `convertToBlob` calls; its `convertToBlob(o)` resolves `new Blob([], { type: o.type })`. Bitmaps are plain objects `{ width, height }` cast to `ImageBitmap`. Unstub in `afterEach`.
    - `composePairSheet(L, R)`:
      - It creates one 1200x1800 canvas.
      - `fillStyle` is `'#ffffff'` and `fillRect(0, 0, 1200, 1800)` runs before any draw.
      - The `drawImage` calls are exactly `[[L, 0, 0, 600, 1800], [R, 600, 0, 600, 1800]]`.
      - `convertToBlob` gets `{ type: 'image/jpeg', quality: 0.92 }`.
    - `composePairSheet(L, null)`: the `drawImage` calls are exactly `[[L, 0, 0, 600, 1800]]`, so the right half stays white.
    - `composeStrip({ layout: 'strip_2x6', shots: [S], overlay: O, filter: 'none' })`:
      - It creates exactly one canvas, 600x1800.
      - That canvas gets `convertToBlob({ type: 'image/jpeg', quality: 0.92 })`.
      - The last `drawImage` is `[O, 0, 0, 600, 1800]`.
  - `output.test.ts`: add `describe('runOutput paired')`. Reuse `deps()` and set `paired: pairedDeps()`. The helper uses:
    - `HELD = { sessionId: 'held-1', filePath: '/photos/held-1.jpg', heldAt: 1 }` and `HELD_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4])` (7 bytes; the guest's `JPEG` is 5).
    - `claimHeldStrip: vi.fn(async () => null)`, `holdStrip: vi.fn(async () => {})` and `readPhoto: vi.fn(async () => HELD_JPEG.buffer)`.
    - `decode: vi.fn(async (b: Blob) => ({ size: b.size, close: vi.fn() }) as unknown as ImageBitmap)` and `composePair: vi.fn(async () => new Blob([JPEG], { type: 'image/jpeg' }))`.

    Tests:
    - `first guest holds and does not print`:
      - `holdStrip` is called once with `{ sessionId: 's1', filePath: '/photos/s1.jpg', heldAt: Date.parse('2026-01-01T00:02:00.000Z') }`.
      - `print` is not called.
      - The result matches `{ held: true, printError: null }` and `onOutcome` is called with `{ held: true }`.
      - `added(d)` has exactly the 2 jobs from the existing first test.
      - `queueAdd`'s first `invocationCallOrder` is below `claimHeldStrip`'s.
    - `second guest prints one sheet with the held strip on the left` (`claimHeldStrip` resolves `HELD`, and `d.copies` is `2`):
      - `readPhoto` is called with `'/photos/held-1.jpg'`.
      - `composePair.mock.calls[0]` has a first argument of size 7 and a second of size 5.
      - `print` is called once with `(expect.any(ArrayBuffer), 1)`.
      - `holdStrip` is not called and the result is `{ held: false, printError: null }`.
      - Both decoded bitmaps had `close` called.
    - `a pair-sheet print failure is recorded on the second guest only` (`print` resolves `{ ok: false, reason: 'out of paper' }`):
      - Job kinds are `['upsert_session', 'upload_photo', 'upsert_session']`, all for `s1`.
      - The last job's row has `printError: 'out of paper'`.
      - No job mentions `held-1`.
    - **Review Focus 4:** `held photo unreadable prints this strip alone`. When `readPhoto` rejects `ENOENT`:
      - `console.error` is called exactly once, with `HELD_UNREADABLE_LOG` as its only argument.
      - `composePair` is called with `(size-5 bitmap, null)` and `print` once.
      - `holdStrip` is not called and `held` is `false`.
    - The same unreadable-photo outcome when `decode` rejects for the 7-byte blob only.
    - `a compose failure after the claim puts the held strip back and rejects`: `composePair` rejects `canvas failed`, so `runOutput` rejects `canvas failed`, `holdStrip` is called with exactly `HELD`, `print` is not called and `onOutcome` is not called.
    - When the put-back `holdStrip` also rejects, the original `canvas failed` is still the rejection and `REHOLD_FAILED_LOG` is logged once.
    - **Review Focus 1:** `retry after the pair printed and the follow-up enqueue failed does not claim or print again`:
      - Setup: `print` resolves `{ ok: false, reason: 'jam' }`, and `queueAdd` resolves once, then rejects `disk full`.
      - The first run rejects `disk full`, and `onOutcome` got `{ held: false, printError: 'jam' }`.
      - A second run with `prior` set to that outcome means `claimHeldStrip` and `print` were each called once in total, the last job's row has `printError: 'jam'`, and the result is `held: false`.
    - **Review Focus 1:** `retry with a prior hold skips claim, hold and print`: with `prior: { held: true }`, `claimHeldStrip`, `holdStrip` and `print` are not called, and the result is `{ held: true, printError: null }`.
    - **Review Focus 1:** `a claim that returns this guest's own strip re-holds it instead of pairing`: when `claimHeldStrip` resolves `{ sessionId: 's1', filePath: '/photos/s1.jpg', heldAt: 5 }`, `holdStrip` is called with that exact record, `print` and `composePair` are not called, and the result is `held: true`.
    - `a failed hold rejects so Try again runs`: `holdStrip` rejects `disk full`, so `runOutput` rejects `disk full` and `onOutcome` is not called.
    - `a failed claim rejects without printing or holding`.
    - **Review Focus 5:** `without paired deps the held strip is never touched`:
      - Setup: `Object.assign(d.bridge, { claimHeldStrip: spy, holdStrip: spy })` with no `paired`.
      - `spy` is not called.
      - `print` is called with `(expect.any(ArrayBuffer), 2)`.
      - The result has `held: false`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/compose.test.ts test/output.test.ts`
Expected: FAIL. `composePairSheet` and `composeStrip` are not exported, the paired tests fail, and the existing `runOutput` tests still pass.

- [ ] **Step 3: Implement.** Keep the existing path as it is. The paired branch shares `compose()` and `savePhoto` with it and differs from there on. The paired branch runs in this order (the order is the point):
  1. Run `compose()` (the caller passes `buildSessionStrip`), then `savePhoto`, then `await enqueue([upsert row(null), upload_photo])`. Rethrow any failure.
  2. Get the outcome: `paired.prior` if set. Otherwise:
     - `claimed = await claimHeldStrip()`.
     - If `claimed` is `null`, or `claimed.sessionId === sessionId`: run `holdStrip(claimed ?? { sessionId, filePath, heldAt: d.now() })`, and the outcome is `{ held: true }`.
     - Otherwise, decode the held photo (`readPhoto` bytes as an `image/jpeg` Blob). If that fails, log `HELD_UNREADABLE_LOG` and the held bitmap is `null`.
     - Then decode this guest's strip blob and run `composePair(held ?? own, held ? own : null)` and `arrayBuffer()`. If any of these throws and the held bitmap was not `null`, `await holdStrip(claimed)` (on failure log `REHOLD_FAILED_LOG`) and rethrow the original error. Close every decoded bitmap in `finally`.
     - Print 1 copy, mapping a resolved failure or a rejection to `printError` exactly as the existing path does. The outcome is `{ held: false, printError }`.
     - Call `onOutcome(outcome)` once the outcome exists.
  3. If `!outcome.held && outcome.printError !== null`, enqueue the follow-up `upsert_session` with `row(printError)`. Return `{ printError: outcome.held ? null : outcome.printError, held: outcome.held, sheet }`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter kiosk exec vitest run test/compose.test.ts test/output.test.ts && pnpm --filter kiosk test && pnpm --filter kiosk typecheck`
Expected: all PASS (the existing `runOutput` tests pass unchanged), no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/renderer/src/compose/compose.ts apps/kiosk/src/renderer/src/compose/session-sheet.ts apps/kiosk/src/renderer/src/output/run-output.ts apps/kiosk/test/compose.test.ts apps/kiosk/test/output.test.ts
git commit -m "feat(kiosk): hold the first strip and print two guests on one sheet"
```

### Task 4: Attract timer, Output and Delivery wiring, e2e

**Files:**
- Create: `apps/kiosk/src/renderer/src/output/held-strip-timer.ts`
- Modify: `apps/kiosk/src/renderer/src/screens/Output.tsx:41-84`
- Modify: `apps/kiosk/src/renderer/src/App.tsx:22,112-125` (`pairTiming` prop and the KioskFlow timer effect)
- Modify: `apps/kiosk/src/renderer/src/main.tsx:23-30,46-50`
- Modify: `apps/kiosk/src/renderer/src/api/fake-api.ts:5-23` (`FakeConfig`) and the `FakeKioskApi` class
- Modify: `apps/kiosk/src/renderer/src/screens/Delivery.tsx:74-80`, `apps/kiosk/src/renderer/src/styles.css:600` (a `.delivery__print-held` rule beside `.delivery__print-error`, `background: var(--lime)`)
- Test: `apps/kiosk/test/held-strip-timer.test.ts` (new), `apps/kiosk/test/fake-api.test.ts`, `apps/kiosk/e2e/paired.spec.ts` (new)

**Interfaces:**
- Consumes:
  - From Task 1: `heldStripDue`, `isPairedMode`, `PAIR_WAIT_MS` and `KioskState`.
  - From Task 2: the bridge methods `getHeldStrip` and `claimHeldStrip`.
  - From Task 3: `composePairSheet`, `buildSessionStrip`, `runOutput` with `paired: PairedDeps`, and `PairedOutcome`.
- Produces:
  - `held-strip-timer.ts`:
    - `HELD_STRIP_POLL_MS = 30_000`.
    - `interface PairTiming { waitMs: number; pollMs: number }` and `DEFAULT_PAIR_TIMING: PairTiming = { waitMs: PAIR_WAIT_MS, pollMs: HELD_STRIP_POLL_MS }`.
    - `heldStripTimerActive(settings: Pick<KioskSettings, 'pairedPrint'>, stateName: KioskState['name']): boolean` returns `settings.pairedPrint === true && stateName === 'attract'`.
    - `interface HeldStripTimerDeps { bridge: Pick<KioskBridge, 'getHeldStrip' | 'claimHeldStrip' | 'readPhoto' | 'print'>; decode(jpeg: Blob): Promise<ImageBitmap>; composePair(left: ImageBitmap, right: ImageBitmap | null): Promise<Blob>; now(): number; waitMs: number }`.
    - `flushDueHeldStrip(d: HeldStripTimerDeps): Promise<'none' | 'waiting' | 'printed' | 'failed'>`. It never rejects.
    - `HELD_PRINT_FAILED_LOG = 'paired print: the held strip could not be printed alone'`.
  - `FakeConfig` gets `pairWaitMs?: number` and `pairPollMs?: number`. `FakeKioskApi.pairTiming(): PairTiming` reads them from `this.config()`, falling back to the `DEFAULT_PAIR_TIMING` values.
  - `App` gets the prop `pairTiming?: PairTiming` (default `DEFAULT_PAIR_TIMING`) and passes it to `KioskFlow`.
  - Delivery's exact guest copy is `Your print comes out when the next guest finishes, or in about 10 minutes. Ask the owner for your print.` (The timer polls every 30 s, so a held strip can print up to about 10.5 minutes after it was held; the copy says "about" on purpose. The design's wording was "such as", so this is within it.)

- [ ] **Step 1: Write the failing unit tests.**
  - `held-strip-timer.test.ts`: the deps use the Task 3 test doubles (`decode`, `composePair`), with `now = () => 10_000_000`, `waitMs: PAIR_WAIT_MS` and `print: vi.fn(async () => ({ ok: true }))`. The `held` record is `{ sessionId: 'a', filePath: '/photos/a.jpg', heldAt }`.
    - When `getHeldStrip` resolves `null`, the result is `'none'` and `claimHeldStrip` is not called.
    - When `heldAt = 10_000_000 - PAIR_WAIT_MS + 1`, the result is `'waiting'` and `claimHeldStrip` is not called.
    - When `heldAt = 10_000_000 - PAIR_WAIT_MS`:
      - The result is `'printed'` and `readPhoto` is called with `'/photos/a.jpg'`.
      - `composePair` is called with `(bitmap, null)` and `print` with `(expect.any(ArrayBuffer), 1)`.
      - The bitmap was closed.
    - **Review Focus 3:** `heldAt = 10_000_000 - 3 * 24 * 3600_000` (left over from before a restart) gives `'printed'` on the first call.
    - **Review Focus 2:** when the strip is due but `claimHeldStrip` resolves `null` (a guest took it), the result is `'none'` and `print` is not called.
    - **Review Focus 4:** when the strip is due and `readPhoto` rejects `ENOENT`:
      - The result is `'failed'`.
      - `console.error` is called once, with `HELD_PRINT_FAILED_LOG` as its only argument.
      - `print` is not called.
      - The deps have no `holdStrip`, so nothing is re-held.
    - `print` resolving `{ ok: false, reason: 'jam' }` gives `'failed'` with one log line. So does `print` rejecting.
    - `getHeldStrip` rejecting gives `'failed'`, and `await` never throws.
    - **Review Focus 2 and 5:** `heldStripTimerActive({ pairedPrint: true }, 'attract')` is `true`. It is `false` in two cases:
      - `{ pairedPrint: true }` with each of `'payment'`, `'capture'`, `'review'`, `'output'` and `'delivery'`.
      - `{}` and `{ pairedPrint: false }` with `'attract'`.
  - `fake-api.test.ts`: `setup().api.pairTiming()` equals `{ waitMs: 600_000, pollMs: 30_000 }`, and `setup({ pairWaitMs: 2000, pairPollMs: 500 }).api.pairTiming()` equals `{ waitMs: 2000, pollMs: 500 }`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/held-strip-timer.test.ts test/fake-api.test.ts`
Expected: FAIL. `held-strip-timer.test.ts` cannot resolve `../src/renderer/src/output/held-strip-timer`, and `pairTiming` is not a function.

- [ ] **Step 3: Implement the timer module and the fake timing.**
  - `flushDueHeldStrip` does `get`, then `heldStripDue(held, now(), waitMs)`, then `claim`. It then reads, decodes and runs `composePair(bmp, null)`, then prints 1 copy. Any failure, or a non-ok print, logs `HELD_PRINT_FAILED_LOG` once and returns `'failed'`. The bitmap closes in `finally`. The claimed strip is never re-held.
  - `FakeKioskApi.pairTiming()` as specified. Add no `window` access.

- [ ] **Step 4: Run to verify the unit tests pass**

Run: `pnpm --filter kiosk exec vitest run test/held-strip-timer.test.ts test/fake-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the screens.**
  - `Output.tsx`:
    - Set `const paired = template !== null && isPairedMode(settings, template.layout)`.
    - `compose` uses `buildSessionStrip` when `paired`, and `buildSessionSheet` otherwise (keep the `fakeComposeFailure` call in front of both).
    - Add a ref `pairedOutcome = useRef<{ sessionId: string; outcome: PairedOutcome } | null>(null)`.
    - When `paired`, pass `paired: { bridge: window.kiosk, decode: (b) => createImageBitmap(b), composePair: composePairSheet, prior, onOutcome }`. `prior` is the ref's outcome when its `sessionId === state.sessionId`, and `onOutcome` stores `{ sessionId, outcome }`. Otherwise pass `undefined`.
    - Dispatch `{ type: 'OUTPUT_DONE', printError, held, now: Date.now() }`.
    - Add `settings.pairedPrint` to the `useCallback` deps.
  - `App.tsx` `KioskFlow`, before the `switch`: add a `useEffect` keyed on `heldStripTimerActive(settings, state.name)`, `pairTiming.waitMs` and `pairTiming.pollMs`.
    - When the gate is active, it runs `setInterval(…, pairTiming.pollMs)`. Each tick calls `flushDueHeldStrip({ bridge: window.kiosk, decode: (b) => createImageBitmap(b), composePair: composePairSheet, now: Date.now, waitMs: pairTiming.waitMs })`.
    - A local `busy` flag skips a tick while the previous one is still running.
    - The cleanup clears the interval.
  - `main.tsx`: in the `VITE_FAKE_API === '1'` branch of `createApi()`, also return `pairTiming: fake.pairTiming()`, and render `<App … pairTiming={pairTiming} />`. Leave the trial and Supabase branches as they are; `pairTiming` stays `undefined` there.
  - `Delivery.tsx`: when `state.printHeld`, render `<p className="delivery__print-held" role="status">` with the exact copy above, before the print-error line. The print-error line does not change.

- [ ] **Step 6: Write the e2e spec** `e2e/paired.spec.ts`. Copy the `launch`, `finishSession`, `debug` and `deliveryHeading` helpers and the pre-seeded `config.json` from `e2e/delivery.spec.ts`. Add `lastSheet` (as in `e2e/review.spec.ts`) and `heldFile = () => join(userData, 'held-strip.json')`. In the specs below, `PAIRED` means `{ settings: { freeMode: true, countdownSeconds: 3, shotsPerSession: 2, pairedPrint: true } }` merged into the fake config, and `HELD_MSG` is the exact Delivery copy.
  - `two guests in a row print one sheet: 0 prints, then 1`:
    - Run `launch(PAIRED)`, then guest 1 with `finishSession`.
    - Delivery is visible, `HELD_MSG` is visible and `printCalls()` is `0`.
    - `lastSheet()` equals `{ width: 600, height: 1800, type: 'image/jpeg' }`.
    - `held-strip.json` `.held.filePath` equals `join(userData, 'photos', held.sessionId + '.jpg')`.
    - Click Done, then run guest 2. Delivery shows, `printCalls()` is `1`, `HELD_MSG` has count `0`, and `held-strip.json` `.held` is `null`.
    - `photos/` holds 2 `.jpg` files.
  - `a held strip past the wait prints alone from the attract screen`:
    - Run `launch({ ...PAIRED, pairWaitMs: 2000, pairPollMs: 500 })`, then one guest: `printCalls()` is `0`.
    - Click Done, then `expect.poll(printCalls, { timeout: 15_000 }).toBe(1)`. After that, `.held` is `null`.
  - **Review Focus 3:** `an old held strip prints after a restart`:
    - Run `launch(PAIRED)` and one guest: `printCalls()` is `0` and `.held` is not `null`.
    - Close the app, then run `launch({ ...PAIRED, pairWaitMs: 1000, pairPollMs: 500 })`.
    - "Tap to start" is visible, `expect.poll(printCalls, { timeout: 15_000 }).toBe(1)`, and `.held` is `null`.
  - **Review Focus 5:** `without pairedPrint nothing is held and the sheet prints as today`:
    - Run `launch()` and one guest.
    - `printCalls()` is `1`, `lastSheet()` equals `{ width: 1200, height: 1800, type: 'image/jpeg' }` and `HELD_MSG` has count `0`.
    - `existsSync(heldFile())` is `false`.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter kiosk test && pnpm --filter kiosk typecheck && pnpm --filter kiosk e2e && pnpm --filter kiosk build`
Expected: all unit tests PASS and there are no type errors. Every e2e spec passes: the 4 new ones and all existing ones, unchanged. `pnpm --filter kiosk build` prints `check-prod-bundle: out is complete and has no test-only hooks`.

- [ ] **Step 8: Commit**

```bash
git add apps/kiosk/src/renderer/src/output/held-strip-timer.ts apps/kiosk/src/renderer/src/screens/Output.tsx apps/kiosk/src/renderer/src/screens/Delivery.tsx apps/kiosk/src/renderer/src/styles.css apps/kiosk/src/renderer/src/App.tsx apps/kiosk/src/renderer/src/main.tsx apps/kiosk/src/renderer/src/api/fake-api.ts apps/kiosk/test/held-strip-timer.test.ts apps/kiosk/test/fake-api.test.ts apps/kiosk/e2e/paired.spec.ts
git commit -m "feat(kiosk): wire paired print into output, the attract timer and delivery"
```

### Task 5: Trial build with paired print (0.2.0), docs, full verification

**Files:**
- Modify: `apps/kiosk/src/renderer/src/api/demo-api.ts:32-34` (`getSettings`)
- Modify: `apps/kiosk/package.json:3` (`"version": "0.2.0"`)
- Modify: `apps/kiosk/electron-builder.trial.yml:43` (`artifactName: Photobooth-Trial-Paired-Setup-${version}.${ext}`)
- Modify: `docs/DEPLOY.md:254` (real installer name `Photobooth-Kiosk-Setup-0.2.0.exe`) and E.9 (`docs/DEPLOY.md:277-308`)
- Modify: `README.md:91-93`
- Test: `apps/kiosk/test/demo-api.test.ts`

**Interfaces:**
- Consumes: everything above. No new code interfaces.
- Produces: `DemoKioskApi.getSettings()` returns `{ ...DEFAULT_SETTINGS, activeTemplateId: DEMO_ACTIVE_TEMPLATE_ID, pairedPrint: true }`. Running `pnpm --filter kiosk build:trial` writes `apps/kiosk/dist-trial/Photobooth-Trial-Paired-Setup-0.2.0.exe`. The `appId` (`com.photobooth.kiosk.trial`), `productName` (`Photobooth Kiosk Trial`) and data folder stay the same, so the new installer installs over the old trial and keeps its data and 3-day clock.

- [ ] **Step 1: Write the failing test.** In `demo-api.test.ts`, the first test expects `getSettings()` to equal `{ ...DEFAULT_SETTINGS, activeTemplateId: 'demo-strip', pairedPrint: true }`, with `freeMode` still `false`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter kiosk exec vitest run test/demo-api.test.ts`
Expected: FAIL (`pairedPrint` missing).

- [ ] **Step 3: Implement and document.**
  - `demo-api.ts`, `package.json` and `electron-builder.trial.yml` as listed under Files.
  - `DEPLOY.md` E step 5 (line 254): `Photobooth-Kiosk-Setup-0.2.0.exe`.
  - `DEPLOY.md` E.9:
    - The output line becomes `apps\kiosk\dist-trial\Photobooth-Trial-Paired-Setup-<version>.exe` (currently `0.2.0`). The "Paired" in the name marks this behaviour. It replaces the older `Photobooth-Trial-Setup-0.1.0.exe` and installs over it, keeping the same data folder and trial clock.
    - The settings bullet adds "paired print on".
    - Add a **Paired print** bullet covering five points:
      - Two guests in a row share one 4x6 sheet: the first guest's strip on the left, the next guest's on the right. The owner cuts the sheet down the middle.
      - The first strip waits, saved as `held-strip.json` in the data folder, so it survives a restart. If no second guest finishes after about 10 minutes (the start screen checks every 30 seconds, so up to about 10.5 minutes), it prints alone from the start screen with the right half blank.
      - At most one strip is held at a time.
      - The waiting guest sees the message, and each guest's download QR shows only their own strip.
      - The print copies setting does not apply.
  - `README.md` trial paragraph: one sentence saying the trial runs paired print (two guests per 4x6 sheet, cut down the middle, 10-minute wait, one held strip at most), with a link to E.9.

- [ ] **Step 4: Run the full suites**

Run: `pnpm test && pnpm typecheck`
Expected: core and kiosk unit suites PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/renderer/src/api/demo-api.ts apps/kiosk/test/demo-api.test.ts apps/kiosk/package.json apps/kiosk/electron-builder.trial.yml docs/DEPLOY.md README.md
git commit -m "feat(kiosk): turn on paired print in the trial installer (0.2.0)"
```

- [ ] **Step 6: Build and verify the real bundle, e2e and the installer** (after the commit, so the installer is newer than every source change)

Run: `pnpm --filter kiosk build && pnpm --filter kiosk e2e && pnpm --filter kiosk build:trial`
Expected:
- `pnpm --filter kiosk build` prints `check-prod-bundle: out is complete and has no test-only hooks`. Its real-mode check refuses the trial marker `DEMO PAYMENT`, which proves `demo-api.ts` (the only code that sets `pairedPrint`) is absent from `out/`. `supabase-api.ts:62-70` still builds settings field by field, with no `pairedPrint`.
- All e2e specs pass. That includes `without pairedPrint nothing is held and the sheet prints as today`.
- `pnpm --filter kiosk build:trial` prints `check-prod-bundle: out-trial is complete and has no test-only hooks`, then builds the installer.
- `ls -la apps/kiosk/dist-trial/Photobooth-Trial-Paired-Setup-0.2.0.exe` shows a file of roughly 120 MB.
- `ls -t apps/kiosk/dist-trial/Photobooth-Trial-Paired-Setup-0.2.0.exe $(git ls-files apps/kiosk/src packages/core/src apps/kiosk/package.json apps/kiosk/electron-builder.trial.yml) | head -1` prints the installer path, so it is newer than the last source change.
- `grep -rl "__pbFake\|PB_FAKE" apps/kiosk/out apps/kiosk/out-trial` prints nothing.
- `git status --short` shows only the pre-existing untracked docs.

State plainly what could not be verified here: printing on a real printer, cutting the paper, and installing on Windows.
