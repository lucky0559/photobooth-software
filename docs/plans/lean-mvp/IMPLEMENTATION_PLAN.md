# Photobooth Lean MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows kiosk app where a guest pays via GCash/Maya QR, takes 1–4 photos, gets a print, and scans a QR to download the photo, plus a web admin for price, templates, free mode, and today's sales.

**Architecture:** pnpm monorepo. `packages/core` holds all pure domain logic (layouts, kiosk state machine, money, validation, reports) and is tested with Vitest. `apps/kiosk` is Electron + React: the renderer runs the guest flow and talks to Supabase through a `KioskApi` interface (swappable with a fake for e2e tests); the main process owns printing and the on-disk queue. `apps/web` is Next.js for the admin panel and the public download page. Supabase provides Postgres, Auth, Storage, and Edge Functions; the Edge Functions hold the PayMongo secret and process webhooks. The kiosk never sees the PayMongo secret and never decides the price.

**Tech Stack:** Node 22 LTS, pnpm 9, TypeScript 5 (strict), Electron ≥ 33 via electron-vite, React 19, Next.js 15 (App Router) with `@supabase/ssr`, Supabase (Postgres 15, Storage, Edge Functions on Deno), PayMongo QR Ph, `qrcode`, `image-size`, Vitest 3, Playwright (web + `_electron`), electron-builder (NSIS).

**Spec:** `docs/SPEC.md` (Lean MVP column).

**Estimate:** ~172 hours at ₱450/hr ≈ ₱77,400; 4–5 weeks.

## Global Constraints

- Kiosk target: Windows 10/11 x64. Dev machine can be macOS; build the installer on Windows.
- TypeScript `strict: true` everywhere. No `any` in exported signatures.
- Money is integer centavos in code and DB. Display with `formatPeso` only.
- Session price must be 2000–100000 centavos (₱20.00–₱1,000.00). Default 15000.
- Print sheet is 1200 × 1800 px (4×6 in, 300 DPI), portrait, JPEG quality 0.92.
- Strip layout canvas 600 × 1800 px; 4R layout canvas 1200 × 1800 px.
- Template overlays are PNG, exact layout canvas size, ≤ 10 MB.
- Timeouts: payment 180 s, review 60 s, delivery 45 s. Payment status poll every 2 s.
- Download links expire after `linkExpiryDays` (default 7, range 1–30). Download tokens are 16 random bytes, base64url (22 chars).
- All "today" and date grouping uses Asia/Manila (UTC+8, no DST).
- PayMongo secret key and webhook secret live only in Supabase Edge Function secrets.
- Guest-facing copy is English and must match the strings quoted in this plan.
- Commits: conventional commit subjects, no AI attribution trailers.
- Testing phase uses free tiers only (see `docs/ENVIRONMENTS.md`): local Supabase via Docker for development and tests, Supabase Free + Vercel Hobby for the shared test deployment, PayMongo test keys. No task may require a paid service.

## Review Focus

1. **Guest pays just as the payment screen times out or they press Cancel.** Expected: they still get their session. Cancel is an atomic server call that returns `paid` if the payment already landed; a webhook that lands after a real cancel marks the session `paid_after_cancel` and it shows in the admin "Needs attention" list. Tests: Task 5 (`cancelPayment` and `applyPaidEvent` cases), Task 11 (e2e race).
2. **PayMongo sends the same webhook twice, or a webhook for an unknown intent.** Expected: processed once, `200` returned, no double status change. Test: Task 5.
3. **Internet drops after payment.** Expected: capture and print still work, QR is still shown, upload retries with backoff, and the download page says the photo is still uploading. Tests: Task 10 (queue backoff), Task 13 (`downloadLinkState` → `uploading`).
4. **Camera unplugged or permission denied mid-session.** Expected: an error with a "Try again" button; the paid session and already-taken shots are kept. Test: Task 3 (`CAMERA_ERROR` keeps session).
5. **A sale just after midnight Manila time.** Expected: it counts for the new Manila day, not the UTC day. Test: Task 13 (`manilaDayKey`).

---

## File Structure

```
photobooth-software/
  package.json                     # workspace scripts: test, lint, typecheck
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/core/
    src/index.ts                   # re-exports
    src/types.ts                   # LayoutId, ShotCount, FilterId, Rect, KioskSettings, Template, SessionSync
    src/money.ts                   # formatPeso, pesosToCentavos
    src/result.ts                  # Result<T>
    src/layouts.ts                 # layoutSize, slotsFor, printSheetPlacements, coverFit
    src/settings.ts                # DEFAULT_SETTINGS, validateSettings
    src/session-machine.ts         # KioskState, KioskEvent, transition, timeouts
    src/pricing.ts                 # sessionAmountCentavos
    src/tokens.ts                  # newDownloadToken
    src/templates.ts               # validateTemplateImage
    src/reports.ts                 # manilaDayKey, summarizeDay, downloadLinkState
    test/*.test.ts
  supabase/
    config.toml
    migrations/20261111000001_init.sql
    seed.sql                       # local-only admin + kiosk users
    tests/rls.test.sql             # pgTAP
    functions/_shared/paymongo.ts  # createQrPhPayment, verifyWebhookSignature, parsePaidEvent
    functions/_shared/payments.ts  # PaymentStore, applyPaidEvent, cancelPayment
    functions/_shared/payments.test.ts
    functions/_shared/paymongo.test.ts
    functions/create-payment/index.ts
    functions/cancel-payment/index.ts
    functions/paymongo-webhook/index.ts
  apps/kiosk/
    electron.vite.config.ts
    electron-builder.yml
    src/shared/bridge.ts           # KioskBridge type (IPC contract)
    src/main/index.ts              # window, kiosk mode, fake-camera switches
    src/main/json-store.ts         # createJsonStore (atomic writes)
    src/main/pin.ts                # hashPin, verifyPin
    src/main/print.ts              # printOptions, buildPrintHtml, printSheet, listPrinters
    src/main/photos.ts             # savePhoto, readPhoto
    src/main/ipc.ts                # registers all IPC handlers
    src/preload/index.ts           # exposes window.kiosk: KioskBridge
    src/renderer/src/App.tsx       # renders screen for current KioskState
    src/renderer/src/api/kiosk-api.ts      # KioskApi interface
    src/renderer/src/api/supabase-api.ts   # SupabaseKioskApi
    src/renderer/src/api/fake-api.ts       # FakeKioskApi (VITE_FAKE_API=1)
    src/renderer/src/state/useKiosk.ts     # reducer wrapper around core transition + TICK timer
    src/renderer/src/setup/secret-tap.ts   # registerTap
    src/renderer/src/camera/camera.ts      # openCamera, captureFrame
    src/renderer/src/camera/shot-store.ts  # in-memory Blob store
    src/renderer/src/compose/filters.ts    # FILTERS
    src/renderer/src/compose/compose.ts    # composeSheet
    src/renderer/src/sync/queue.ts         # processQueue, nextAttemptAt
    src/renderer/src/screens/{Attract,Payment,Capture,Review,Output,Delivery,Setup}.tsx
    test/*.test.ts                 # Vitest (node) for main + pure renderer modules
    e2e/*.spec.ts                  # Playwright _electron with fake API + fake camera
  apps/web/
    middleware.ts                  # session refresh + /admin guard
    lib/supabase/{server,client,admin}.ts
    app/admin/login/{page.tsx,actions.ts}
    app/admin/page.tsx             # dashboard
    app/admin/settings/{page.tsx,actions.ts}
    app/admin/templates/{page.tsx,actions.ts}
    app/d/[token]/page.tsx         # public download page
    e2e/*.spec.ts                  # Playwright against local Supabase
  docs/ACCEPTANCE.md               # manual checklist on real hardware
```

---

### Task 1: Monorepo scaffold, core types, money

**Estimate:** 8h

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/{index,types,money,result}.ts`
- Test: `packages/core/test/money.test.ts`

**Interfaces:**
- Produces:
  - `type LayoutId = 'strip_2x6' | 'print_4r'`
  - `type ShotCount = 1 | 2 | 3 | 4`
  - `type FilterId = 'none' | 'bw' | 'warm'`
  - `interface Rect { x: number; y: number; w: number; h: number }`
  - `interface KioskSettings { priceCentavos: number; freeMode: boolean; shotsPerSession: ShotCount; countdownSeconds: 3 | 5 | 10; copiesPerSession: 1 | 2 | 3 | 4; linkExpiryDays: number; activeTemplateId: string | null }`
  - `interface Template { id: string; name: string; layout: LayoutId; overlayPath: string }`
  - `interface SessionSync { id: string; downloadToken: string; templateId: string; amountCentavos: number; status: 'free' | 'completed'; printError: string | null; createdAt: string; completedAt: string | null }`
  - `type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> }`
  - `formatPeso(centavos: number): string`
  - `pesosToCentavos(input: string): number | null`

- [ ] **Step 1: Initialize the repo**

Run: `cd /Users/luckyangelo/Dev/photobooth-software && git init && pnpm init`
Create `pnpm-workspace.yaml` with `packages: ['apps/*', 'packages/*']`. Package names are fixed: `@pb/core` (packages/core), `kiosk` (apps/kiosk), `web` (apps/web); every `pnpm --filter` command in this plan uses them. Root scripts: `"test": "pnpm -r test"`, `"typecheck": "pnpm -r typecheck"`.
Expected: `pnpm -r exec pwd` lists no errors.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/test/money.test.ts
import { describe, it, expect } from 'vitest';
import { formatPeso, pesosToCentavos } from '../src/money';

describe('formatPeso', () => {
  it('formats centavos with peso sign, thousands separator, 2 decimals', () => {
    expect(formatPeso(15000)).toBe('₱150.00');
    expect(formatPeso(0)).toBe('₱0.00');
    expect(formatPeso(123456)).toBe('₱1,234.56');
  });
});

describe('pesosToCentavos', () => {
  it('parses whole and decimal pesos', () => {
    expect(pesosToCentavos('150')).toBe(15000);
    expect(pesosToCentavos('150.5')).toBe(15050);
    expect(pesosToCentavos(' 1,234.56 ')).toBe(123456);
  });
  it('rejects junk, negatives, and more than 2 decimals', () => {
    expect(pesosToCentavos('abc')).toBeNull();
    expect(pesosToCentavos('-5')).toBeNull();
    expect(pesosToCentavos('1.234')).toBeNull();
    expect(pesosToCentavos('')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @pb/core test`
Expected: FAIL, cannot resolve `../src/money`.

- [ ] **Step 4: Implement `money.ts`, `types.ts`, `result.ts`, `index.ts`**

`formatPeso` uses integer math (`Math.floor(c/100)`, `c % 100`) and `toLocaleString('en-PH')` for the whole part; never floating-point division for the decimals. `pesosToCentavos` strips commas and whitespace, matches `/^\d+(\.\d{1,2})?$/`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pb/core test && pnpm --filter @pb/core typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and core money helpers"
```

---

### Task 2: Layout geometry

**Estimate:** 8h

**Files:**
- Create: `packages/core/src/layouts.ts`
- Test: `packages/core/test/layouts.test.ts`

**Interfaces:**
- Consumes: `LayoutId`, `ShotCount`, `Rect` (Task 1)
- Produces:
  - `layoutSize(layout: LayoutId): { w: number; h: number }`
  - `slotsFor(layout: LayoutId, shots: ShotCount): Rect[]`
  - `printSheetPlacements(layout: LayoutId): Rect[]` — where the layout canvas is drawn on the 1200×1800 sheet
  - `coverFit(src: { w: number; h: number }, dst: { w: number; h: number }): { sx: number; sy: number; sw: number; sh: number }` — centered crop of the source that fills dst
  - `const SHEET = { w: 1200, h: 1800 }`

**Geometry rules (pinned):**
- Strip: padding 40 on top/left/right, gap 20, footer 260. Slot width 520. Usable height 1500.
- 4R: padding 40 on top/left/right, gap 20, footer 360. Usable height 1400. Shots 1–3 stack vertically at width 1120; 4 shots form a 2×2 grid of 550 × 690.
- Stacked slot height = `Math.floor((usable - gap * (n - 1)) / n)`; slot i has `y = 40 + i * (slotH + gap)`.

- [ ] **Step 1: Write the failing test**

```ts
import { layoutSize, slotsFor, printSheetPlacements, coverFit } from '../src/layouts';

it('layout sizes', () => {
  expect(layoutSize('strip_2x6')).toEqual({ w: 600, h: 1800 });
  expect(layoutSize('print_4r')).toEqual({ w: 1200, h: 1800 });
});

it('strip slots', () => {
  expect(slotsFor('strip_2x6', 1)).toEqual([{ x: 40, y: 40, w: 520, h: 1500 }]);
  expect(slotsFor('strip_2x6', 2).map(s => s.y)).toEqual([40, 800]);
  expect(slotsFor('strip_2x6', 3)).toEqual([
    { x: 40, y: 40, w: 520, h: 486 }, { x: 40, y: 546, w: 520, h: 486 }, { x: 40, y: 1052, w: 520, h: 486 },
  ]);
  expect(slotsFor('strip_2x6', 4).map(s => [s.y, s.h])).toEqual([[40, 360], [420, 360], [800, 360], [1180, 360]]);
});

it('4R slots', () => {
  expect(slotsFor('print_4r', 2)).toEqual([{ x: 40, y: 40, w: 1120, h: 690 }, { x: 40, y: 750, w: 1120, h: 690 }]);
  expect(slotsFor('print_4r', 3).map(s => [s.y, s.h])).toEqual([[40, 453], [513, 453], [986, 453]]);
  expect(slotsFor('print_4r', 4)).toEqual([
    { x: 40, y: 40, w: 550, h: 690 }, { x: 610, y: 40, w: 550, h: 690 },
    { x: 40, y: 750, w: 550, h: 690 }, { x: 610, y: 750, w: 550, h: 690 },
  ]);
});

it('print sheet placements', () => {
  expect(printSheetPlacements('strip_2x6')).toEqual([{ x: 0, y: 0, w: 600, h: 1800 }, { x: 600, y: 0, w: 600, h: 1800 }]);
  expect(printSheetPlacements('print_4r')).toEqual([{ x: 0, y: 0, w: 1200, h: 1800 }]);
});

it('coverFit crops the center', () => {
  expect(coverFit({ w: 1920, h: 1080 }, { w: 520, h: 360 })).toEqual({ sx: 180, sy: 0, sw: 1560, sh: 1080 });
  expect(coverFit({ w: 1920, h: 1080 }, { w: 520, h: 1500 })).toEqual({ sx: 773, sy: 0, sw: 374, sh: 1080 });
  expect(coverFit({ w: 1080, h: 1920 }, { w: 1120, h: 690 })).toEqual({ sx: 0, sy: 628, sw: 1080, sh: 665 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pb/core test layouts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `layouts.ts`**

`coverFit` rounds `sw`/`sh` with `Math.round`, then `sx = Math.round((src.w - sw) / 2)`, same for `sy`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pb/core test layouts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add layout geometry for strip and 4R"
```

---

### Task 3: Kiosk state machine, settings validation, pricing, tokens

**Estimate:** 10h

**Files:**
- Create: `packages/core/src/{session-machine,settings,pricing,tokens}.ts`
- Test: `packages/core/test/{session-machine,settings,pricing,tokens}.test.ts`

**Interfaces:**
- Consumes: `KioskSettings`, `FilterId`, `Result` (Task 1)
- Produces:
  - `PAYMENT_TIMEOUT_MS = 180_000`, `REVIEW_TIMEOUT_MS = 60_000`, `DELIVERY_TIMEOUT_MS = 45_000`
  - `type KioskState =`
    `| { name: 'attract' }`
    `| { name: 'payment'; sessionId: string; amountCentavos: number; startedAt: number }`
    `| { name: 'capture'; sessionId: string; amountCentavos: number; shots: string[]; error?: 'camera_unavailable' }`
    `| { name: 'review'; sessionId: string; amountCentavos: number; shots: string[]; filter: FilterId; enteredAt: number }`
    `| { name: 'output'; sessionId: string; amountCentavos: number; shots: string[]; filter: FilterId }`
    `| { name: 'delivery'; sessionId: string; printError: string | null; enteredAt: number }`
  - `type KioskEvent =`
    `| { type: 'START'; sessionId: string; now: number }`
    `| { type: 'PAYMENT_PAID' } | { type: 'PAYMENT_CANCELLED' }`
    `| { type: 'SHOT_TAKEN'; shotId: string }`
    `| { type: 'CAMERA_ERROR' } | { type: 'CAMERA_RETRY' }`
    `| { type: 'FILTER_SELECTED'; filter: FilterId }`
    `| { type: 'CONFIRM'; now: number }`
    `| { type: 'OUTPUT_DONE'; printError: string | null; now: number }`
    `| { type: 'TICK'; now: number }`
  - `transition(state: KioskState, event: KioskEvent, settings: KioskSettings): KioskState` — returns the same object reference for events that do not apply
  - `DEFAULT_SETTINGS: KioskSettings` = `{ priceCentavos: 15000, freeMode: false, shotsPerSession: 4, countdownSeconds: 5, copiesPerSession: 1, linkExpiryDays: 7, activeTemplateId: null }`
  - `validateSettings(input: unknown): Result<KioskSettings>`
  - `sessionAmountCentavos(settings: KioskSettings): number`
  - `newDownloadToken(): string`

**Validation messages (exact):**
- `priceCentavos`: `"Price must be between ₱20.00 and ₱1,000.00"`
- `shotsPerSession`: `"Shots must be 1 to 4"`
- `countdownSeconds`: `"Countdown must be 3, 5, or 10 seconds"`
- `copiesPerSession`: `"Copies must be 1 to 4"`
- `linkExpiryDays`: `"Link expiry must be 1 to 30 days"`

- [ ] **Step 1: Write the failing tests**

```ts
// session-machine.test.ts
const paid = { ...DEFAULT_SETTINGS, priceCentavos: 15000, freeMode: false, shotsPerSession: 2 as const };
const free = { ...paid, freeMode: true };

it('START goes to payment when not free', () => {
  expect(transition({ name: 'attract' }, { type: 'START', sessionId: 's1', now: 0 }, paid))
    .toEqual({ name: 'payment', sessionId: 's1', amountCentavos: 15000, startedAt: 0 });
});
it('START skips payment in free mode', () => {
  expect(transition({ name: 'attract' }, { type: 'START', sessionId: 's1', now: 0 }, free))
    .toEqual({ name: 'capture', sessionId: 's1', amountCentavos: 0, shots: [] });
});
it('PAYMENT_PAID -> capture, PAYMENT_CANCELLED -> attract', () => {
  const p = { name: 'payment', sessionId: 's1', amountCentavos: 15000, startedAt: 0 } as KioskState;
  expect(transition(p, { type: 'PAYMENT_PAID' }, paid)).toEqual({ name: 'capture', sessionId: 's1', amountCentavos: 15000, shots: [] });
  expect(transition(p, { type: 'PAYMENT_CANCELLED' }, paid)).toEqual({ name: 'attract' });
});
it('collects shots then enters review with filter none', () => {
  let s = { name: 'capture', sessionId: 's1', amountCentavos: 0, shots: [] } as KioskState;
  s = transition(s, { type: 'SHOT_TAKEN', shotId: 'a' }, paid);
  expect(s).toMatchObject({ name: 'capture', shots: ['a'] });
  s = transition(s, { type: 'SHOT_TAKEN', shotId: 'b' }, paid);
  expect(s).toMatchObject({ name: 'review', shots: ['a', 'b'], filter: 'none' });
});
it('CAMERA_ERROR keeps the session and shots; CAMERA_RETRY clears the error', () => {
  const s = { name: 'capture', sessionId: 's1', amountCentavos: 15000, shots: ['a'] } as KioskState;
  const e = transition(s, { type: 'CAMERA_ERROR' }, paid);
  expect(e).toEqual({ ...s, error: 'camera_unavailable' });
  expect(transition(e, { type: 'CAMERA_RETRY' }, paid)).toEqual(s);
});
it('review auto-confirms after 60s', () => {
  const r = { name: 'review', sessionId: 's1', amountCentavos: 0, shots: ['a'], filter: 'bw', enteredAt: 1000 } as KioskState;
  expect(transition(r, { type: 'TICK', now: 60_999 }, paid)).toBe(r);
  expect(transition(r, { type: 'TICK', now: 61_000 }, paid)).toMatchObject({ name: 'output', filter: 'bw' });
});
it('delivery returns to attract after 45s', () => { /* enteredAt 0, TICK 45_000 -> attract */ });
it('ignores events that do not apply (same reference)', () => {
  const a = { name: 'attract' } as KioskState;
  expect(transition(a, { type: 'SHOT_TAKEN', shotId: 'x' }, paid)).toBe(a);
});

// settings.test.ts
it('accepts defaults', () => expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ ok: true, value: DEFAULT_SETTINGS }));
it('rejects price below ₱20 and above ₱1,000 with exact message', () => {
  for (const p of [1999, 100001, 150.5]) {
    const r = validateSettings({ ...DEFAULT_SETTINGS, priceCentavos: p });
    expect(r).toEqual({ ok: false, errors: { priceCentavos: 'Price must be between ₱20.00 and ₱1,000.00' } });
  }
});
it('reports every invalid field at once', () => {
  const r = validateSettings({ ...DEFAULT_SETTINGS, shotsPerSession: 5, countdownSeconds: 4, linkExpiryDays: 0 });
  expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(['countdownSeconds', 'linkExpiryDays', 'shotsPerSession']);
});

// pricing.test.ts
it('free mode is 0, otherwise the price', () => {
  expect(sessionAmountCentavos({ ...DEFAULT_SETTINGS, freeMode: true })).toBe(0);
  expect(sessionAmountCentavos(DEFAULT_SETTINGS)).toBe(15000);
});

// tokens.test.ts
it('22-char base64url and unique', () => {
  const a = newDownloadToken(), b = newDownloadToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(a).not.toBe(b);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pb/core test`
Expected: FAIL on the four new files.

- [ ] **Step 3: Implement the four modules**

`newDownloadToken` uses `crypto.getRandomValues(new Uint8Array(16))` (works in Node 22, Electron renderer, and Deno) and base64url without padding.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pb/core test && pnpm --filter @pb/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add kiosk state machine, settings validation, pricing, tokens"
```

---

### Task 4: Supabase schema, RLS, storage

**Estimate:** 10h

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Create: `supabase/migrations/20261111000001_init.sql`
- Create: `supabase/seed.sql`
- Test: `supabase/tests/rls.test.sql`

**Interfaces:**
- Produces (tables, all `public`):
  - `profiles(user_id uuid pk → auth.users, role text check (role in ('admin','kiosk')))`
  - `settings(id int pk default 1 check (id = 1), price_centavos int not null default 15000, free_mode bool not null default false, shots_per_session int not null default 4, countdown_seconds int not null default 5, copies_per_session int not null default 1, link_expiry_days int not null default 7, active_template_id uuid null → templates, updated_at timestamptz not null default now())` with one seeded row
  - `templates(id uuid pk default gen_random_uuid(), name text not null, layout text not null check (layout in ('strip_2x6','print_4r')), overlay_path text not null, archived bool not null default false, created_at timestamptz not null default now())`
  - `sessions(id uuid pk, kiosk_id uuid not null default auth.uid() → auth.users, template_id uuid not null → templates, download_token text not null unique, amount_centavos int not null, status text not null check (status in ('awaiting_payment','paid','free','cancelled','paid_after_cancel','completed')), photo_path text null, print_error text null, created_at timestamptz not null default now(), completed_at timestamptz null)`
  - `payments(id uuid pk default gen_random_uuid(), session_id uuid not null unique → sessions, provider_intent_id text not null unique, amount_centavos int not null, status text not null check (status in ('pending','paid','failed','cancelled')), created_at timestamptz not null default now(), paid_at timestamptz null, last_event jsonb null)`
  - SQL helpers `is_admin() returns bool`, `is_kiosk() returns bool` (`security definer`, read `profiles` for `auth.uid()`)
  - Storage buckets, both private: `templates` (admin write, admin + kiosk read), `photos` (kiosk insert/update object named `<session id>.jpg` for its own session, admin read; the web download page reads with the service role)

**RLS rules (pinned):**
- `settings`: select for admin and kiosk; update for admin only.
- `templates`: select for admin and kiosk; insert/update for admin.
- `sessions`: admin select all; kiosk select/insert/update rows where `kiosk_id = auth.uid()`; kiosk may only set `status` to `free` or `completed`; anon nothing.
- `payments`: admin select all; kiosk select rows whose session belongs to it; no client writes (Edge Functions use the service role).

- [ ] **Step 1: Write the failing pgTAP test**

`supabase/tests/rls.test.sql` with `plan(7)` and these checks, switching role with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'`:
1. kiosk can `select price_centavos from settings` → 1 row
2. kiosk `update settings set price_centavos = 1` affects 0 rows
3. admin `update settings set price_centavos = 20000` affects 1 row
4. kiosk A cannot see kiosk B's session
5. kiosk cannot see payments of kiosk B's session
6. kiosk `update sessions set status = 'paid'` on its own row raises an error
7. anon `select * from sessions` returns 0 rows

Seed two kiosk users and one admin in the test itself (not `seed.sql`).

- [ ] **Step 2: Run to verify it fails**

Run: `supabase start && supabase test db`
Expected: FAIL, relations do not exist.

- [ ] **Step 3: Write the migration**

Kiosk status restriction: a `before update` trigger on `sessions` that raises `'kiosk may only set status free or completed'` when `is_kiosk()` and `new.status not in ('free','completed')`.

- [ ] **Step 4: Write `seed.sql`**

Local-only users `admin@local.test` / `kiosk@local.test`, password `localpass123`, with matching `profiles` rows, and one strip template row pointing at `templates/sample-strip.png`. Never used in production.

- [ ] **Step 5: Run to verify it passes**

Run: `supabase db reset && supabase test db`
Expected: `ok 1..7`, all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase
git commit -m "feat(db): add schema, RLS, and storage buckets"
```

---

### Task 5: PayMongo Edge Functions (create, cancel, webhook)

**Estimate:** 18h

**Files:**
- Create: `supabase/functions/_shared/paymongo.ts`, `supabase/functions/_shared/payments.ts`
- Create: `supabase/functions/_shared/__fixtures__/attach-qrph.json`, `__fixtures__/webhook-payment-paid.json`
- Create: `supabase/functions/{create-payment,cancel-payment,paymongo-webhook}/index.ts`
- Test: `supabase/functions/_shared/paymongo.test.ts`, `supabase/functions/_shared/payments.test.ts`

**Interfaces:**
- Consumes: tables from Task 4; `sessionAmountCentavos`, `KioskSettings` from `@pb/core` (import via relative path or an import map entry in `supabase/functions/deno.json`)
- Produces:
  - `createQrPhPayment(args: { secretKey: string; amountCentavos: number; description: string; metadata: Record<string, string> }): Promise<{ intentId: string; qrImageDataUrl: string }>`
  - `verifyWebhookSignature(header: string, rawBody: string, secret: string, mode: 'test' | 'live'): Promise<boolean>`
  - `parsePaidEvent(body: unknown): { intentId: string; amountCentavos: number } | null`
  - `interface PaymentStore { markPaidIfPending(intentId: string, paidAt: string): Promise<'updated' | 'not_pending' | 'not_found'>; getStatusByIntent(intentId: string): Promise<PaymentStatus | null>; markPaidAfterCancel(intentId: string, paidAt: string): Promise<void>; cancelIfPending(paymentId: string): Promise<'cancelled' | 'not_pending'>; getStatus(paymentId: string): Promise<PaymentStatus | null> }`
  - `type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'`
  - `applyPaidEvent(store: PaymentStore, intentId: string, paidAt: string): Promise<'marked_paid' | 'paid_after_cancel' | 'duplicate' | 'unknown_intent'>`
  - `cancelPayment(store: PaymentStore, paymentId: string): Promise<'cancelled' | 'paid'>`
  - HTTP:
    - `POST /functions/v1/create-payment` body `{ sessionId, downloadToken, templateId }` (kiosk JWT) → `200 { paymentId, qrImageDataUrl, amountCentavos }`; `409 { error: 'free_mode' }` when free mode is on
    - `POST /functions/v1/cancel-payment` body `{ paymentId }` (kiosk JWT) → `200 { status: 'cancelled' | 'paid' }`
    - `POST /functions/v1/paymongo-webhook` (no JWT, deploy with `--no-verify-jwt`) → `401` bad signature, otherwise `200`

**PayMongo flow (pinned):** create Payment Intent with `currency: 'PHP'`, `payment_method_allowed: ['qrph']`, amount from **server-side settings** (never from the request) → create Payment Method `type: 'qrph'` → attach to the intent → QR image from the attach response's `next_action`. Webhook events: `payment.paid` (and log `payment.failed`). Signature header `Paymongo-Signature: t=<ts>,te=<hex>,li=<hex>`; expected = hex HMAC-SHA256 of `` `${t}.${rawBody}` `` with the webhook secret; compare to `te` in test mode, `li` in live mode, constant-time.

- [ ] **Step 1: Capture real PayMongo responses as fixtures**

With a PayMongo **test** secret key, run the three calls once with `curl` and save the attach response to `__fixtures__/attach-qrph.json`. Trigger a test payment and save the webhook body to `__fixtures__/webhook-payment-paid.json`. Confirm the minimum amount (expect ₱20). Write the exact JSON paths for the QR image and the intent id as a comment at the top of `paymongo.ts`.
Expected: both fixture files exist and contain no secret keys.

- [ ] **Step 2: Write the failing tests**

```ts
// paymongo.test.ts
Deno.test('valid test-mode signature passes; tampered body fails; live uses li', async () => {
  const body = '{"a":1}', t = '1700000000', secret = 'whsk_test';
  const sig = await hmacHex(secret, `${t}.${body}`); // helper inside the test file
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body, secret, 'test'), true);
  assertEquals(await verifyWebhookSignature(`t=${t},te=${sig},li=`, body + ' ', secret, 'test'), false);
  assertEquals(await verifyWebhookSignature(`t=${t},te=,li=${sig}`, body, secret, 'live'), true);
  assertEquals(await verifyWebhookSignature('garbage', body, secret, 'test'), false);
});
Deno.test('parsePaidEvent reads the fixture; returns null for other events', () => {
  const ev = JSON.parse(Deno.readTextFileSync(new URL('./__fixtures__/webhook-payment-paid.json', import.meta.url)));
  assertEquals(typeof parsePaidEvent(ev)?.intentId, 'string');
  assertEquals(parsePaidEvent({ data: { attributes: { type: 'payment.failed' } } }), null);
});

// payments.test.ts — uses an in-memory FakeStore implementing PaymentStore
Deno.test('pending -> marked_paid', ...);                 // status becomes 'paid'
Deno.test('second delivery -> duplicate, no change', ...); // still 'paid'
Deno.test('cancelled then paid -> paid_after_cancel', ...);// session status 'paid_after_cancel'
Deno.test('unknown intent -> unknown_intent', ...);
Deno.test('cancelPayment on pending -> cancelled', ...);
Deno.test('cancelPayment when already paid -> paid', ...); // the race in Review Focus #1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement `paymongo.ts` and `payments.ts`**

`applyPaidEvent`: `markPaidIfPending` → `'updated'` ⇒ `'marked_paid'`; `'not_found'` ⇒ `'unknown_intent'`; `'not_pending'` ⇒ read status: `'cancelled'` ⇒ `markPaidAfterCancel` and return `'paid_after_cancel'`, `'paid'` ⇒ `'duplicate'`. The Postgres store implementation does each change in one conditional `update … where status = 'pending' returning id` so concurrent deliveries cannot double-apply. Marking paid also sets `sessions.status = 'paid'`.

- [ ] **Step 5: Implement the three HTTP handlers**

`create-payment` reads `settings`, returns `409` in free mode, inserts the `sessions` row (`status 'awaiting_payment'`, `kiosk_id` from the JWT) and the `payments` row (`'pending'`) after the PayMongo call succeeds. `paymongo-webhook` returns `200` for every verified event, including unknown intents, so PayMongo stops retrying, and stores the raw event in `payments.last_event`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared`
Expected: PASS, 8 tests.

- [ ] **Step 7: Smoke test end to end locally**

Run: `supabase functions serve --env-file supabase/.env.local` and in another shell `curl` `create-payment` with the kiosk user's JWT.
Expected: `200` with a `data:image/png;base64,…` QR. Paying it with the PayMongo test flow and forwarding the webhook (PayMongo dashboard → webhook to an ngrok URL) flips the `payments` row to `paid`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions
git commit -m "feat(payments): add PayMongo QR Ph create, cancel, and webhook functions"
```

---

### Task 6: Kiosk shell, local store, setup screen, API boundary

**Estimate:** 14h

**Files:**
- Create: `apps/kiosk/` via `pnpm create @quick-start/electron apps/kiosk --template react-ts`
- Create: `apps/kiosk/src/shared/bridge.ts`, `src/main/{json-store,pin,ipc}.ts`, `src/preload/index.ts`
- Create: `src/renderer/src/api/{kiosk-api,supabase-api,fake-api}.ts`, `src/renderer/src/setup/secret-tap.ts`, `src/renderer/src/screens/Setup.tsx`
- Modify: `src/main/index.ts`
- Test: `apps/kiosk/test/{json-store,pin,secret-tap}.test.ts`, `apps/kiosk/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `KioskSettings`, `Template`, `SessionSync` from `@pb/core`; Edge Function contracts from Task 5
- Produces:
  - `createJsonStore<T>(filePath: string, defaults: T): { get(): T; update(fn: (t: T) => T): T }` — writes to `<file>.tmp` then renames
  - `interface LocalConfig { pinHash: string | null; printerName: string | null; cameraDeviceId: string | null; cachedSettings: KioskSettings | null; cachedTemplate: Template | null }`
  - `hashPin(pin: string): string` → `scrypt$<saltB64>$<hashB64>`; `verifyPin(pin: string, stored: string): boolean`
  - `registerTap(taps: number[], now: number, count = 5, windowMs = 3000): { taps: number[]; triggered: boolean }`
  - `interface KioskBridge` (exposed as `window.kiosk`): `getConfig(): Promise<LocalConfig>`, `setConfig(patch: Partial<LocalConfig>): Promise<LocalConfig>`, `setPin(pin: string): Promise<void>`, `checkPin(pin: string): Promise<boolean>`, `saveOverlay(templateId: string, png: ArrayBuffer): Promise<void>`, `readOverlay(templateId: string): Promise<ArrayBuffer | null>`, plus the members added in Tasks 9 and 10
  - `interface KioskApi { getSettings(): Promise<KioskSettings>; getTemplate(id: string): Promise<{ template: Template; overlayPng: ArrayBuffer }>; createPayment(i: { sessionId: string; downloadToken: string; templateId: string }): Promise<{ paymentId: string; qrImageDataUrl: string; amountCentavos: number }>; getPaymentStatus(paymentId: string): Promise<'pending' | 'paid' | 'failed' | 'cancelled'>; cancelPayment(paymentId: string): Promise<'cancelled' | 'paid'>; upsertSession(row: SessionSync): Promise<void>; uploadPhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string> }`
  - `FakeKioskApi` controlled by `window.__pbFake: { freeMode: boolean; payAfterMs: number | null; cancelReturns: 'cancelled' | 'paid'; failUploads: number }`
  - Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_BASE_URL`, `VITE_FAKE_API`

**Pinned behavior:**
- Packaged app: `kiosk: true`, no menu, no devtools. Dev: 1080 × 1920 window.
- `PB_FAKE_CAMERA=1` adds Chromium switches `use-fake-device-for-media-stream` and `use-fake-ui-for-media-stream`.
- First run (`pinHash === null`) opens Setup. Setup: set PIN (4–8 digits), sign in with the kiosk Supabase account (supabase-js session persists in the renderer's localStorage), pick camera and printer. Later, 5 taps within 3 s on the top-left 80 × 80 px area opens a PIN prompt, then Setup.

- [ ] **Step 1: Write the failing unit tests**

```ts
// json-store.test.ts
it('returns defaults, persists updates, survives reopen', () => { /* tmp dir; update -> reopen -> get */ });
it('ignores a leftover .tmp file and keeps last good data', () => { /* write garbage to .tmp; get() returns last good */ });

// pin.test.ts
it('verifies the right PIN only', () => {
  const h = hashPin('2468');
  expect(h).toMatch(/^scrypt\$/);
  expect(verifyPin('2468', h)).toBe(true);
  expect(verifyPin('2469', h)).toBe(false);
  expect(hashPin('2468')).not.toBe(h); // random salt
});

// secret-tap.test.ts
it('triggers on the 5th tap within 3s and resets', () => {
  let t: number[] = [];
  for (const now of [0, 500, 1000, 1500]) ({ taps: t } = registerTap(t, now));
  const r = registerTap(t, 2999);
  expect(r).toEqual({ taps: [], triggered: true });
});
it('drops taps older than 3s', () => {
  expect(registerTap([0, 100, 200, 300], 3200).triggered).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter kiosk test`
Expected: FAIL.

- [ ] **Step 3: Implement `json-store.ts`, `pin.ts`, `secret-tap.ts`, `bridge.ts`, preload, IPC, `KioskApi` + both implementations, `Setup.tsx`**

`pin.ts` uses `node:crypto` `scryptSync(pin, salt, 32)` and `timingSafeEqual`. `SupabaseKioskApi` calls Edge Functions with `supabase.functions.invoke` and reads `payments` / `settings` / `templates` with the kiosk session.

- [ ] **Step 4: Write the e2e test**

`e2e/setup.spec.ts`: launch with `_electron.launch({ args: ['.'], env: { PB_FAKE_CAMERA: '1', VITE_FAKE_API: '1', PB_USER_DATA: <tmpdir> } })` → Setup is shown → set PIN `2468` → pick the fake camera → "Done" → Attract screen shows `"Tap to start"`.

- [ ] **Step 5: Run all kiosk tests**

Run: `pnpm --filter kiosk test && pnpm --filter kiosk build && pnpm --filter kiosk e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): add Electron shell, local config, PIN-protected setup"
```

---

### Task 7: Camera capture screen

**Estimate:** 16h

**Files:**
- Create: `src/renderer/src/camera/{camera,shot-store}.ts`, `src/renderer/src/state/useKiosk.ts`
- Create: `src/renderer/src/screens/{Attract,Capture}.tsx`
- Test: `apps/kiosk/e2e/capture.spec.ts`

**Interfaces:**
- Consumes: `transition`, `KioskState`, `DEFAULT_SETTINGS`, `newDownloadToken` (Task 3); `KioskApi`, `KioskBridge` (Task 6)
- Produces:
  - `openCamera(deviceId: string | null): Promise<MediaStream>` — constraints `{ width: { ideal: 1920 }, height: { ideal: 1080 } }`
  - `captureFrame(video: HTMLVideoElement): Promise<Blob>` — full video resolution, **not** mirrored, `image/jpeg` quality 0.95
  - `shotStore: { put(blob: Blob): string; get(id: string): Blob | undefined; clear(): void }`
  - `useKiosk(): { state: KioskState; settings: KioskSettings; dispatch(e: KioskEvent): void; downloadToken: string | null }` — runs `TICK` every 500 ms; generates `sessionId` (`crypto.randomUUID()`) and `downloadToken` on START

**Pinned behavior:**
- Attract: refetches settings and the active template every 60 s and caches them in `LocalConfig.cachedSettings` / `cachedTemplate` plus `saveOverlay`; uses the cache when a fetch fails. Shows `"Tap to start"` and the price via `formatPeso` (or `"Free today!"` in free mode). No cached template at all: start disabled with `"Setup needed: no active template"`. Offline (`navigator.onLine === false` or last settings fetch failed) and not free mode: start disabled, banner `"Offline — payments unavailable"`.
- Capture: preview mirrored with CSS `transform: scaleX(-1)`; countdown from `settings.countdownSeconds` in large digits; "Shot 2 of 4" label; 150 ms white flash on capture; 1.5 s pause between shots.
- Camera failure (getUserMedia rejects or the track ends): dispatch `CAMERA_ERROR`; screen shows `"Camera not available. Please call staff."` and a `"Try again"` button that dispatches `CAMERA_RETRY`.

- [ ] **Step 1: Write the failing e2e test**

`capture.spec.ts` (fake API with `freeMode: true`, countdown 3, shots 2): tap `"Tap to start"` → `video` element visible → within 15 s the Review screen heading `"Pick a look"` appears → `shotStore` holds 2 blobs (expose `window.__pbDebug.shotCount()` only when `VITE_FAKE_API=1`).
Second case: stop the fake video track via `__pbDebug.killCamera()` → `"Camera not available. Please call staff."` visible → `"Try again"` → preview returns.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kiosk build && pnpm --filter kiosk e2e capture`
Expected: FAIL, no `"Tap to start"`.

- [ ] **Step 3: Implement camera, shot store, `useKiosk`, Attract, Capture**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter kiosk build && pnpm --filter kiosk e2e capture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): add attract and capture screens with countdown"
```

---

### Task 8: Compositing, filters, review screen

**Estimate:** 14h

**Files:**
- Create: `src/renderer/src/compose/{filters,compose}.ts`, `src/renderer/src/screens/Review.tsx`
- Test: `apps/kiosk/test/filters.test.ts`, `apps/kiosk/e2e/review.spec.ts`

**Interfaces:**
- Consumes: `slotsFor`, `layoutSize`, `printSheetPlacements`, `coverFit`, `SHEET` (Task 2); `shotStore` (Task 7); `KioskBridge.readOverlay` (Task 6)
- Produces:
  - `FILTERS: Record<FilterId, { label: string; css: string }>` = `none: { 'Original', 'none' }`, `bw: { 'Black & White', 'grayscale(1) contrast(1.1)' }`, `warm: { 'Warm', 'sepia(0.25) saturate(1.2) brightness(1.03)' }`
  - `composeLayout(input: { layout: LayoutId; shots: ImageBitmap[]; overlay: ImageBitmap; filter: FilterId }): OffscreenCanvas` — layout-size canvas
  - `composeSheet(input: same): Promise<Blob>` — 1200 × 1800 JPEG q0.92, layout canvas drawn at each `printSheetPlacements` rect

**Draw order:** white background → each shot into its slot with `ctx.filter = FILTERS[f].css` and `coverFit` crop → reset filter → overlay PNG at 0,0 full size.

- [ ] **Step 1: Write the failing tests**

`filters.test.ts`: `Object.keys(FILTERS)` equals `['none','bw','warm']`; each `css` string equals the pinned value.
`review.spec.ts`: after capture, Review shows three filter buttons labelled `Original`, `Black & White`, `Warm` and a preview `<canvas>`; tap `Warm` then `"Print"` → `window.__pbDebug.lastSheet()` resolves to `{ width: 1200, height: 1800, type: 'image/jpeg' }`. For a strip template, `__pbDebug.lastSheetPixel(300, 900)` equals `__pbDebug.lastSheetPixel(900, 900)` (both halves identical).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kiosk test filters && pnpm --filter kiosk e2e review`
Expected: FAIL.

- [ ] **Step 3: Implement filters, compose, Review**

Review dispatches `FILTER_SELECTED` and `CONFIRM`; preview re-renders `composeLayout` at half scale on filter change.

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): compose print sheet with filters and review screen"
```

---

### Task 9: Silent printing

**Estimate:** 14h

**Files:**
- Create: `apps/kiosk/src/main/print.ts`
- Modify: `src/main/ipc.ts`, `src/shared/bridge.ts`, `src/renderer/src/screens/Setup.tsx` (printer list + "Print test page")
- Test: `apps/kiosk/test/print.test.ts`

**Interfaces:**
- Consumes: `LocalConfig.printerName` (Task 6)
- Produces:
  - `printOptions(copies: number, deviceName: string | null): Electron.WebContentsPrintOptions` — exactly `{ silent: true, printBackground: true, copies, margins: { marginType: 'none' }, pageSize: { width: 101600, height: 152400 }, landscape: false }` plus `deviceName` when non-null
  - `buildPrintHtml(jpegDataUrl: string): string` — contains `@page { size: 4in 6in; margin: 0 }` and an `<img>` styled `width:4in;height:6in;display:block`
  - `printSheet(jpeg: Buffer, copies: number, deviceName: string | null): Promise<{ ok: true } | { ok: false; reason: string }>` — hidden `BrowserWindow`, 60 s timeout ⇒ `{ ok: false, reason: 'timeout' }`, always closes the window
  - `listPrinters(): Promise<string[]>`
  - Bridge additions: `print(jpeg: ArrayBuffer, copies: number): Promise<{ ok: true } | { ok: false; reason: string }>`, `listPrinters(): Promise<string[]>`, `printTestPage(): Promise<{ ok: true } | { ok: false; reason: string }>`

- [ ] **Step 1: Write the failing tests**

```ts
it('printOptions is borderless 4x6 with copies and printer', () => {
  expect(printOptions(2, 'DNP DS-RX1')).toEqual({
    silent: true, printBackground: true, copies: 2, deviceName: 'DNP DS-RX1',
    margins: { marginType: 'none' }, pageSize: { width: 101600, height: 152400 }, landscape: false,
  });
  expect(printOptions(1, null)).not.toHaveProperty('deviceName');
});
it('buildPrintHtml sizes the page and image to 4x6', () => {
  const html = buildPrintHtml('data:image/jpeg;base64,AAA');
  expect(html).toContain('@page { size: 4in 6in; margin: 0 }');
  expect(html).toContain('src="data:image/jpeg;base64,AAA"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kiosk test print`
Expected: FAIL.

- [ ] **Step 3: Implement `print.ts`, IPC, Setup printer picker and test page**

The test page is a 1200 × 1800 sheet with a 10 px black border and a centered "4x6 TEST" label, built with `composeSheet`-style canvas code in the renderer.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter kiosk test print`
Expected: PASS.

- [ ] **Step 5: Manual check on the client's printer (Windows)**

Setup → pick the printer → "Print test page".
Expected: border visible on all four edges or bleeding evenly off them (borderless), nothing cropped unevenly, no print dialog. Record printer model and driver settings (paper 4×6, 2-inch cut on/off) in `docs/ACCEPTANCE.md`.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk docs
git commit -m "feat(kiosk): add silent 4x6 printing and printer setup"
```

---

### Task 10: Output, sync queue, delivery QR

**Estimate:** 12h

**Files:**
- Create: `apps/kiosk/src/main/photos.ts`, `src/renderer/src/sync/queue.ts`, `src/renderer/src/screens/{Output,Delivery}.tsx`
- Modify: `src/main/ipc.ts`, `src/shared/bridge.ts`
- Test: `apps/kiosk/test/queue.test.ts`, `apps/kiosk/e2e/delivery.spec.ts`

**Interfaces:**
- Consumes: `composeSheet` (Task 8), `bridge.print` (Task 9), `KioskApi.upsertSession/uploadPhoto` (Task 6), `SessionSync` (Task 1)
- Produces:
  - `type QueueJob = { id: string; kind: 'upsert_session'; row: SessionSync } | { id: string; kind: 'upload_photo'; sessionId: string; filePath: string }` with `attempts: number; nextAttemptAt: number; lastError: string | null`
  - `nextAttemptAt(attempts: number, now: number): number` = `now + Math.min(5000 * 2 ** attempts, 300_000)`
  - `processQueue(jobs: QueueJob[], deps: { api: KioskApi; readPhoto(path: string): Promise<ArrayBuffer>; now: number }): Promise<{ done: string[]; failed: { id: string; error: string; nextAttemptAt: number }[] }>` — runs due jobs in order; an `upload_photo` job is not attempted while an `upsert_session` job for the same session is still pending
  - Bridge additions: `savePhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string>` (path under `userData/photos/<sessionId>.jpg`), `readPhoto(path: string): Promise<ArrayBuffer>`, `queueAdd(jobs: QueueJob[]): Promise<void>`, `queueList(): Promise<QueueJob[]>`, `queueApply(result: Awaited<ReturnType<typeof processQueue>>): Promise<void>`
  - Queue loop: renderer runs `processQueue` every 10 s and right after each enqueue

**Output flow (pinned):** compose → `savePhoto` → in parallel: `print(jpeg, settings.copiesPerSession)` and `queueAdd([upsert_session (status 'free' if amount 0 else 'completed', printError), upload_photo])` → dispatch `OUTPUT_DONE` with the print error reason (or null). Output screen text: `"Printing your photo…"`.

**Delivery copy (pinned):** heading `"Scan to download your photo"`; QR from `qrcode` `toDataURL(`${VITE_WEB_BASE_URL}/d/${downloadToken}`, { width: 480, margin: 1 })`; on print failure also `"Printing failed. Please call staff — your photo is still available through the QR code."`; button `"Done"` returns to attract.

- [ ] **Step 1: Write the failing tests**

```ts
it('backoff doubles from 5s and caps at 5 minutes', () => {
  expect(nextAttemptAt(0, 0)).toBe(5000);
  expect(nextAttemptAt(3, 0)).toBe(40_000);
  expect(nextAttemptAt(10, 0)).toBe(300_000);
});
it('uploads only after the session row synced', async () => { /* fake api: upsert fails -> upload not attempted */ });
it('skips jobs not yet due', async () => { /* nextAttemptAt > now -> untouched */ });
it('reports failures with incremented backoff', async () => { /* upload throws 'offline' -> failed[0].error === 'offline' */ });
```
`delivery.spec.ts`: fake API with `failUploads: 2` → finish a session → Delivery heading visible and a QR `<img>` present immediately → within 40 s `__pbDebug.queueLength()` is 0.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kiosk test queue && pnpm --filter kiosk e2e delivery`
Expected: FAIL.

- [ ] **Step 3: Implement photos, queue, Output, Delivery**

Queue file: `userData/queue.json` via `createJsonStore`. Delete the local photo 7 days after its upload job is done (checked on app start).

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): add output flow, offline sync queue, and QR delivery"
```

---

### Task 11: Payment screen

**Estimate:** 10h

**Files:**
- Create: `apps/kiosk/src/renderer/src/screens/Payment.tsx`
- Test: `apps/kiosk/e2e/payment.spec.ts`

**Interfaces:**
- Consumes: `KioskApi.createPayment/getPaymentStatus/cancelPayment` (Task 6), `PAYMENT_TIMEOUT_MS`, `formatPeso` (Tasks 1, 3)
- Produces: dispatches `PAYMENT_PAID` or `PAYMENT_CANCELLED`

**Pinned behavior:**
- On enter: `createPayment` → show QR image, `"Scan with GCash, Maya, or your bank app"`, amount via `formatPeso`, a `m:ss` countdown from 3:00, and a `"Cancel"` button.
- Poll `getPaymentStatus` every 2 s; `paid` ⇒ `PAYMENT_PAID`.
- On Cancel or timeout: call `cancelPayment`. Result `paid` ⇒ `PAYMENT_PAID` (guest paid at the last second). Result `cancelled` ⇒ `PAYMENT_CANCELLED`. If the call throws, show `"Checking your payment…"` and retry every 2 s up to 15 times, then `PAYMENT_CANCELLED` (the server row stays `awaiting_payment`, the late webhook marks it paid, and it appears in "Needs attention").
- `createPayment` failure: `"Payments are unavailable right now. Please call staff."` and return to attract after 10 s.

- [ ] **Step 1: Write the failing e2e tests**

1. `payAfterMs: 1500` → QR visible with `"₱150.00"` → Capture screen within 5 s.
2. `payAfterMs: null`, `cancelReturns: 'cancelled'` → tap `"Cancel"` → `"Tap to start"`.
3. `payAfterMs: null`, `cancelReturns: 'paid'` → tap `"Cancel"` → Capture screen (Review Focus #1).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter kiosk build && pnpm --filter kiosk e2e payment`
Expected: FAIL.

- [ ] **Step 3: Implement `Payment.tsx`**

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2.
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): add GCash/Maya QR payment screen"
```

---

### Task 12: Web admin — auth, settings, templates

**Estimate:** 16h

**Files:**
- Create: `apps/web/` via `pnpm create next-app apps/web --ts --app --eslint --no-tailwind --src-dir=false --import-alias '@/*'`
- Create: `apps/web/middleware.ts`, `lib/supabase/{server,client,admin}.ts`
- Create: `app/admin/login/{page.tsx,actions.ts}`, `app/admin/settings/{page.tsx,actions.ts}`, `app/admin/templates/{page.tsx,actions.ts}`, `app/admin/layout.tsx`
- Create: `packages/core/src/templates.ts`
- Test: `packages/core/test/templates.test.ts`, `apps/web/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `validateSettings`, `DEFAULT_SETTINGS`, `pesosToCentavos`, `formatPeso`, `layoutSize` (`@pb/core`); tables and buckets from Task 4
- Produces:
  - `validateTemplateImage(meta: { width: number; height: number; mime: string; bytes: number }, layout: LayoutId): Result<true>` with messages: `mime` ⇒ `"Template must be a PNG with transparent photo areas"`; `size` ⇒ `"Strip templates must be exactly 600 × 1800 px (2×6 in at 300 DPI)"` / `"4R templates must be exactly 1200 × 1800 px (4×6 in at 300 DPI)"`; `bytes` ⇒ `"Template must be 10 MB or smaller"`
  - Server actions: `signIn(formData)`, `signOut()`, `saveSettings(formData): Promise<Result<KioskSettings>>`, `uploadTemplate(formData): Promise<Result<Template>>`, `setActiveTemplate(id: string)`, `archiveTemplate(id: string): Promise<Result<true>>` (refuses the active template: `"Choose another active template first"`)
  - `middleware.ts`: every `/admin/**` except `/admin/login` requires a session whose `profiles.role = 'admin'`; others redirect to `/admin/login`

**Pinned UI:** settings form takes price in pesos (text input, parsed with `pesosToCentavos`), free mode toggle, shots 1–4, countdown 3/5/10, copies 1–4, link expiry days. Template page lists templates with a thumbnail, layout, "Active" badge, upload form (name, layout select, PNG file) reading dimensions with `image-size`.

- [ ] **Step 1: Write the failing tests**

`templates.test.ts`: 600×1800 PNG strip ok; 1200×1800 strip fails with the strip message; 1200×1800 4R ok; `image/jpeg` fails with the PNG message; 10_485_761 bytes fails with the size message.
`admin.spec.ts` (local Supabase, seeded admin): visiting `/admin/settings` logged out redirects to `/admin/login` → sign in as `admin@local.test` → set price `175` → save → reload shows `175.00` → set price `10` → error `"Price must be between ₱20.00 and ₱1,000.00"` → upload `e2e/fixtures/strip-600x1800.png` as strip → appears in list → "Set active" → badge moves. Sign in as `kiosk@local.test` → redirected to `/admin/login` with `"This account is not an admin"`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pb/core test templates && supabase db reset && pnpm --filter web e2e`
Expected: FAIL.

- [ ] **Step 3: Implement validator, Supabase clients, middleware, pages, actions**

`lib/supabase/admin.ts` (service role) is imported only from server files; add `import 'server-only'` at its top.

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/core
git commit -m "feat(web): add admin login, settings, and template management"
```

---

### Task 13: Web — sales dashboard and download page

**Estimate:** 10h

**Files:**
- Create: `packages/core/src/reports.ts`
- Create: `apps/web/app/admin/page.tsx`, `apps/web/app/d/[token]/page.tsx`
- Test: `packages/core/test/reports.test.ts`, `apps/web/e2e/download.spec.ts`

**Interfaces:**
- Consumes: tables (Task 4), `formatPeso` (Task 1)
- Produces:
  - `manilaDayKey(iso: string): string` → `'YYYY-MM-DD'` in UTC+8
  - `summarizeDay(payments: { amountCentavos: number; paidAt: string }[], dayKey: string): { count: number; totalCentavos: number }`
  - `downloadLinkState(session: { createdAt: string; photoPath: string | null } | null, linkExpiryDays: number, now: Date): 'not_found' | 'expired' | 'uploading' | 'ready'`
  - `needsAttention(s: { status: string; createdAt: string }, now: Date): boolean` — true for `paid_after_cancel`, or `paid` older than 10 minutes

**Pinned UI:**
- Dashboard: "Today" card (count + `formatPeso(total)`), "Needs attention" list, table of the last 50 sessions (Manila time `MMM d, h:mm a`, amount, status, print error).
- Download page copy: `ready` ⇒ photo + `"Download photo"` button (signed URL, 3600 s, download filename `photobooth-YYYY-MM-DD.jpg`); `uploading` ⇒ `"Your photo is still uploading. Please refresh in a minute."`; `expired` ⇒ `"This link has expired."`; `not_found` ⇒ Next.js `notFound()`.

- [ ] **Step 1: Write the failing tests**

```ts
it('manila day boundary', () => {
  expect(manilaDayKey('2026-11-11T15:59:59Z')).toBe('2026-11-11');
  expect(manilaDayKey('2026-11-11T16:00:00Z')).toBe('2026-11-12');
});
it('summarizes only the given Manila day', () => {
  const p = [{ amountCentavos: 15000, paidAt: '2026-11-11T16:30:00Z' }, { amountCentavos: 15000, paidAt: '2026-11-11T15:00:00Z' }];
  expect(summarizeDay(p, '2026-11-12')).toEqual({ count: 1, totalCentavos: 15000 });
});
it('download link states', () => {
  const s = { createdAt: '2026-11-01T00:00:00Z', photoPath: 'x.jpg' };
  expect(downloadLinkState(s, 7, new Date('2026-11-07T23:59:00Z'))).toBe('ready');
  expect(downloadLinkState(s, 7, new Date('2026-11-08T00:00:01Z'))).toBe('expired');
  expect(downloadLinkState({ ...s, photoPath: null }, 7, new Date('2026-11-02T00:00:00Z'))).toBe('uploading');
  expect(downloadLinkState(null, 7, new Date())).toBe('not_found');
});
it('needs attention', () => { /* paid 11 min old -> true; paid 5 min -> false; paid_after_cancel -> true; completed -> false */ });
```
`download.spec.ts`: seed a session with a photo → `/d/<token>` shows `"Download photo"`; seed one without `photo_path` → uploading message; random token → 404.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pb/core test reports && pnpm --filter web e2e download`
Expected: FAIL.

- [ ] **Step 3: Implement `reports.ts`, dashboard, download page**

The download page uses the service-role client server-side, looks the session up by `download_token`, and never lists other sessions.

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/core
git commit -m "feat(web): add sales dashboard and photo download page"
```

---

### Task 14: Deploy, installer, acceptance

**Estimate:** 12h

**Files:**
- Create: `apps/kiosk/electron-builder.yml`, `docs/ACCEPTANCE.md`, `docs/DEPLOY.md`
- Modify: `apps/kiosk/package.json` (scripts `build:win`)

**Interfaces:**
- Consumes: everything above
- Produces: `Photobooth Kiosk Setup <version>.exe`; deployed Supabase project and Vercel web app

**Pinned:** electron-builder `appId: com.photobooth.kiosk`, `productName: Photobooth Kiosk`, `win.target: nsis`, `arch: x64`, `nsis.oneClick: false`, `nsis.perMachine: true`. Production env baked at build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_BASE_URL`.

- [ ] **Step 1: Write `docs/DEPLOY.md` and deploy**

Testing phase: target a Supabase **Free** project and Vercel **Hobby** with `PAYMONGO_MODE=test`; the production migration is `docs/ENVIRONMENTS.md` → "Migration checklist". Steps it must contain, in order: create Supabase project → `supabase link` → `supabase db push` → create admin and kiosk users in the dashboard and insert their `profiles` rows → `supabase secrets set PAYMONGO_SECRET_KEY=… PAYMONGO_WEBHOOK_SECRET=… PAYMONGO_MODE=test` → `supabase functions deploy create-payment cancel-payment` and `supabase functions deploy paymongo-webhook --no-verify-jwt` → add the PayMongo webhook (`payment.paid`, `payment.failed`) → deploy `apps/web` to Vercel with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Expected: `/admin/login` loads on the Vercel URL.

- [ ] **Step 2: Build the installer on the Windows PC**

Run: `pnpm install && pnpm --filter kiosk build:win`
Expected: `apps/kiosk/dist/Photobooth Kiosk Setup 0.1.0.exe`.

- [ ] **Step 3: Run the full automated suite**

Run: `pnpm test && pnpm typecheck && supabase test db && deno test supabase/functions/_shared && pnpm --filter kiosk e2e && pnpm --filter web e2e`
Expected: all PASS.

- [ ] **Step 4: Run `docs/ACCEPTANCE.md` on real hardware (PayMongo test mode)**

Checklist rows, each with pass/fail and notes:
1. Paid session with a real GCash test payment → print + QR → photo downloads on a phone.
2. Free mode session.
3. Cancel at 2:59 right after paying → session continues (or appears in "Needs attention").
4. Unplug Ethernet after paying → print works, QR shown, photo appears online within 1 minute of reconnecting.
5. Unplug the camera during capture → error, "Try again" works after replugging.
6. Printer out of paper → print error message, photo still downloadable.
7. Strip template prints two identical strips; 4R prints full bleed.
8. Admin: change price → kiosk shows the new price within 1 minute.
9. Link older than the expiry shows "This link has expired."
Then switch `PAYMONGO_MODE=live` with the client's live keys and repeat row 1 with ₱20.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk docs
git commit -m "chore: add installer config, deploy guide, and acceptance checklist"
```
