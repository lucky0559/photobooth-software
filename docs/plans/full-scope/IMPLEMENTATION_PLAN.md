# Photobooth Full Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything in the lean MVP, plus retake, 10 filters, props, green screen, custom slot layouts, email delivery, paid extra prints with remote reprint, event mode with per-event gallery, sales reports with CSV, auto-delete of old photos, auto-start, and crash/power-loss resume.

**Architecture:** Same as the lean MVP. **Part A is the lean MVP plan, executed unchanged.** Part B (Tasks 15–25) extends it. Every new rule that decides money or flow goes into `packages/core` first (pure, Vitest-tested), and the Edge Functions import the same core functions so the kiosk and server can never disagree on a price. New DB changes are additive migrations.

**Tech Stack:** Lean MVP stack, plus WebGL2 (chroma key), `react-simple-keyboard` (on-screen keyboard), Resend (email), `pg_cron` (scheduled purge).

**Spec:** `docs/SPEC.md` (Full scope column).

**Estimate:** Part A ~172h + Part B ~127h = **~299h at ₱450/hr ≈ ₱134,550**; 8–9 weeks.

## Global Constraints

All Global Constraints of `docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md` apply. Additions:

- Prices for a session are computed only by `sessionAmountCentavos` in `@pb/core`; `create-payment` calls the same function server-side.
- Green screen live preview must hold ≥ 24 fps at 1280 × 720 on the recommended PC spec.
- Props: PNG, ≤ 2 MB, longest side ≤ 1200 px. Backgrounds: JPEG or PNG, ≤ 8 MB, at least 1920 × 1080.
- Max 3 extra prints per session. Max 3 emails per session.
- Photos are purged from storage `linkExpiryDays` after the session; the DB row stays for sales history.
- A resumed session must be younger than 30 minutes.

## Review Focus

1. **Power cut or app crash after a guest paid.** Expected: on restart the kiosk resumes that session at the capture screen with `"Welcome back! Let's continue your session."`. Test: Task 24 (`resumeState`).
2. **Two events overlap in the schedule.** Expected: the event with the latest `startsAt` wins, deterministically, and the kiosk and server agree on the price. Test: Task 21 (`activeEvent`).
3. **A monthly report where payments sit near midnight on the last day of the month.** Expected: `2026-11-30T16:30:00Z` counts in December 2026 (Manila). Test: Task 22 (`groupSales`).
4. **Green screen background whose aspect ratio differs from the camera.** Expected: background is cover-cropped, never stretched. Test: Task 17 (`coverFit` reuse asserted on the background draw rect).
5. **Template with custom slots whose count differs from the shots setting.** Expected: the template wins; the kiosk takes as many shots as the template has slots. Test: Task 18 (`effectiveShotCount`).

---

## Part A — Lean MVP (Tasks 1–14)

Execute `docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md` Tasks 1–14 exactly as written, including its acceptance run. Do not start Part B until `pnpm test && supabase test db && pnpm --filter kiosk e2e && pnpm --filter web e2e` passes.

---

## Part B — Extensions

### File additions

```
packages/core/src/
  filters.ts         # FILTER_IDS, FilterId (moved from types.ts), FILTER_CSS
  props.ts           # PropPlacement, clampPlacement
  chroma.ts          # ChromaSettings, keyAlpha
  slots.ts           # validateSlots, effectiveShotCount
  events.ts          # EventConfig, activeEvent, effectiveSettings
  resume.ts          # resumeState
  reports.ts         # + groupSales, toCsv, selectExpired
  email.ts           # isValidEmail
supabase/migrations/
  20261201000001_capture_options.sql
  20261201000002_props_backgrounds.sql
  20261201000003_template_slots.sql
  20261201000004_extra_prints_commands.sql
  20261201000005_events.sql
  20261201000006_purge.sql
supabase/functions/
  send-photo-email/index.ts
  purge-expired/index.ts
apps/kiosk/src/renderer/src/
  compose/chroma-gl.ts      # WebGL2 chroma key renderer
  compose/props-layer.tsx   # drag/pinch/rotate stickers
  screens/{Prints,Background,EmailEntry}.tsx
  commands/poll-commands.ts
apps/kiosk/src/main/autostart.ts
apps/web/app/admin/
  templates/[id]/slots/page.tsx
  props/page.tsx  backgrounds/page.tsx
  events/page.tsx  events/[id]/page.tsx  events/[id]/gallery/page.tsx
  reports/page.tsx  reports/export/route.ts
  sessions/page.tsx
docs/USER_MANUAL.md
```

---

### Task 15: Retake and mirror option

**Estimate:** 8h

**Files:**
- Modify: `packages/core/src/{types,settings,session-machine}.ts`, `apps/kiosk/src/renderer/src/{camera/camera.ts,screens/Review.tsx}`
- Create: `supabase/migrations/20261201000001_capture_options.sql` (`settings.mirror_output bool not null default false`)
- Test: `packages/core/test/session-machine.test.ts`, `packages/core/test/settings.test.ts`

**Interfaces:**
- Consumes: `transition`, `KioskSettings` (Task 3)
- Produces:
  - `KioskSettings.mirrorOutput: boolean` (default `false`)
  - `review` and `capture` states gain `retakesUsed: 0 | 1`
  - Event `{ type: 'RETAKE' }`: in `review` with `retakesUsed === 0` ⇒ `capture` with `shots: []`, `retakesUsed: 1`; otherwise same reference
  - `captureFrame(video: HTMLVideoElement, mirror: boolean): Promise<Blob>`

- [ ] **Step 1: Write the failing tests** — `RETAKE` once works and keeps `sessionId`/`amountCentavos`; second `RETAKE` returns the same reference; `validateSettings` rejects `mirrorOutput: 'yes'` with `"Mirror output must be on or off"`.
- [ ] **Step 2: Run** `pnpm --filter @pb/core test` — Expected: FAIL.
- [ ] **Step 3: Implement** core changes, migration, Review `"Retake"` button (hidden after use), admin settings toggle `"Mirror saved photos"`.
- [ ] **Step 4: Run** `pnpm --filter @pb/core test && supabase test db && pnpm --filter kiosk e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add one-time retake and mirror output option"`

---

### Task 16: 10 filters and props

**Estimate:** 20h

**Files:**
- Create: `packages/core/src/{filters,props}.ts`, `apps/kiosk/src/renderer/src/compose/props-layer.tsx`, `apps/web/app/admin/props/page.tsx`
- Create: `supabase/migrations/20261201000002_props_backgrounds.sql` (table `props(id uuid pk, name text, path text, archived bool default false)`; bucket `props`; table `backgrounds(id uuid pk, name text, path text, width int, height int, archived bool default false)`; bucket `backgrounds`; same RLS pattern as `templates`)
- Modify: `apps/kiosk/src/renderer/src/compose/{filters,compose}.ts`, `screens/Review.tsx`
- Test: `packages/core/test/{filters,props}.test.ts`, `apps/kiosk/e2e/props.spec.ts`

**Interfaces:**
- Produces:
  - `FILTER_IDS = ['none','bw','warm','cool','vintage','vivid','fade','noir','rosy','film'] as const`; `type FilterId = typeof FILTER_IDS[number]`
  - `FILTER_CSS: Record<FilterId, string>`: `none 'none'`, `bw 'grayscale(1) contrast(1.1)'`, `warm 'sepia(0.25) saturate(1.2) brightness(1.03)'`, `cool 'saturate(1.1) hue-rotate(-12deg) brightness(1.02)'`, `vintage 'sepia(0.45) contrast(0.9) brightness(1.05)'`, `vivid 'saturate(1.5) contrast(1.1)'`, `fade 'contrast(0.85) brightness(1.1) saturate(0.8)'`, `noir 'grayscale(1) contrast(1.4) brightness(0.9)'`, `rosy 'sepia(0.2) saturate(1.3) hue-rotate(-10deg)'`, `film 'contrast(1.05) saturate(0.9) sepia(0.15)'`
  - `interface PropPlacement { propId: string; cx: number; cy: number; scale: number; rotationDeg: number }` (layout-canvas coordinates)
  - `clampPlacement(p: PropPlacement, layout: { w: number; h: number }): PropPlacement` — center inside the canvas, `scale` in [0.25, 3], rotation normalized to (−180, 180]
  - `review` and `output` states gain `props: PropPlacement[]`; event `{ type: 'PROPS_CHANGED'; props: PropPlacement[] }`
  - `composeLayout` input gains `props: { placement: PropPlacement; image: ImageBitmap }[]`; draw order: photos → overlay → props
  - Kiosk renderer `FILTERS` now derives labels from a `FILTER_LABELS` map and `FILTER_CSS`

- [ ] **Step 1: Write the failing tests** — `FILTER_IDS.length === 10`; every `FILTER_CSS` value equals the pinned string; `clampPlacement({cx:-50, cy:2000, scale:9, rotationDeg:270}, {w:600,h:1800})` ⇒ `{cx:0, cy:1800, scale:3, rotationDeg:-90}`. E2E: add a prop, drag it, Print ⇒ `__pbDebug.lastSheetPixel` at the prop's center differs from a no-prop render.
- [ ] **Step 2: Run** `pnpm --filter @pb/core test && pnpm --filter kiosk e2e props` — Expected: FAIL.
- [ ] **Step 3: Implement** filters/props core, Review filter grid (10 thumbnails), props tray + `props-layer.tsx` (pointer events: one finger drags, two fingers pinch-scale and rotate), admin props upload (validate PNG ≤ 2 MB, longest side ≤ 1200 px with messages `"Props must be PNG"`, `"Props must be 2 MB or smaller"`, `"Props must be at most 1200 px on the longest side"`). Kiosk caches props like templates.
- [ ] **Step 4: Run** same as Step 2 — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add 10 filters and draggable props"`

---

### Task 17: Green screen

**Estimate:** 22h

**Files:**
- Create: `packages/core/src/chroma.ts`, `apps/kiosk/src/renderer/src/compose/chroma-gl.ts`, `screens/Background.tsx`, `apps/web/app/admin/backgrounds/page.tsx`
- Modify: `packages/core/src/{types,settings,session-machine}.ts`, `screens/Capture.tsx`, `compose/compose.ts`, migration adds `settings.green_screen jsonb not null default '{"enabled":false,"keyColor":"#00b140","similarity":0.4,"smoothness":0.08,"spill":0.1}'`
- Test: `packages/core/test/{chroma,session-machine}.test.ts`, `apps/kiosk/e2e/green-screen.spec.ts`

**Interfaces:**
- Produces:
  - `interface ChromaSettings { enabled: boolean; keyColor: string; similarity: number; smoothness: number; spill: number }` on `KioskSettings.greenScreen`
  - `keyAlpha(rgb: [number, number, number], key: [number, number, number], similarity: number, smoothness: number): number` — 0 = fully keyed, 1 = opaque. Distance is Euclidean in CbCr (BT.601) normalized to 0–1; `alpha = smoothstep(similarity, similarity + smoothness, distance)`. The shader in `chroma-gl.ts` implements the same formula.
  - State `{ name: 'background'; sessionId: string; amountCentavos: number; retakesUsed: 0 | 1; enteredAt: number }`; event `{ type: 'BACKGROUND_SELECTED'; backgroundId: string }`; after payment (or START in free mode) go to `background` when `greenScreen.enabled`, else `capture`. `capture`/`review`/`output` gain `backgroundId: string | null`. Background screen auto-picks the first background after 30 s.
  - `createChromaRenderer(canvas: HTMLCanvasElement, settings: ChromaSettings): { drawFrame(video: HTMLVideoElement, background: ImageBitmap): void; snapshot(video: HTMLVideoElement, background: ImageBitmap): Promise<Blob>; dispose(): void }` — background drawn with `coverFit` against the video frame size

- [ ] **Step 1: Write the failing tests** — `keyAlpha([0,177,64],[0,177,64],0.4,0.08) === 0`; `keyAlpha([224,172,105],[0,177,64],0.4,0.08) === 1` (skin tone); a half-green pixel returns a value strictly between 0 and 1; state machine: paid + `greenScreen.enabled` ⇒ `PAYMENT_PAID` goes to `background`, then `BACKGROUND_SELECTED` ⇒ `capture` with `backgroundId`. E2E with a fake green video (`--use-file-for-fake-video-capture=e2e/fixtures/green.y4m`): composite's center pixel equals the background's center pixel within ±8 per channel; with a 4:3 background the draw rect from `__pbDebug.lastBackgroundRect()` equals `coverFit({w:1600,h:1200},{w:1920,h:1080})`.
- [ ] **Step 2: Run** `pnpm --filter @pb/core test chroma && pnpm --filter kiosk e2e green-screen` — Expected: FAIL.
- [ ] **Step 3: Implement** core, WebGL2 renderer (fragment shader: CbCr distance, smoothstep alpha, spill = desaturate toward luma by `spill × (1 − alpha)`), Background picker screen (grid of thumbnails, `"Pick your background"`), Capture uses the renderer for preview and snapshot when enabled, admin backgrounds upload (validate per Global Constraints) and green screen settings with a live sample preview.
- [ ] **Step 4: Run** same as Step 2, then on the recommended PC open Capture with green screen on and read `__pbDebug.fps()`. Expected: tests PASS; fps ≥ 24.
- [ ] **Step 5: Commit** `git commit -am "feat: add green screen with background library"`

---

### Task 18: Custom slot editor

**Estimate:** 12h

**Files:**
- Create: `packages/core/src/slots.ts`, `apps/web/app/admin/templates/[id]/slots/page.tsx`, migration `20261201000003_template_slots.sql` (`templates.slots jsonb null`)
- Modify: `Template` type (`slots: Rect[] | null`), kiosk `compose.ts` (use `template.slots ?? slotsFor(...)`), `useKiosk` shot count
- Test: `packages/core/test/slots.test.ts`

**Interfaces:**
- Produces:
  - `validateSlots(slots: Rect[], layout: LayoutId): Result<Rect[]>` — 1–4 slots; each inside the layout canvas; each side ≥ 200 px; integers. Messages: `"Add 1 to 4 photo areas"`, `"Photo area 2 is outside the template"`, `"Photo area 3 must be at least 200 × 200 px"`
  - `effectiveShotCount(settings: KioskSettings, template: Template): ShotCount` — `template.slots?.length ?? settings.shotsPerSession`
  - Admin editor: overlay image shown scaled; draw a rectangle by dragging, move/resize with handles, delete, "Reset to preset"; saves layout-pixel integers

- [ ] **Step 1: Write the failing tests** — valid preset slots pass; 5 slots fail; a slot at `x: 590, w: 100` on a strip fails "outside"; 150 × 300 fails min size; `effectiveShotCount({...DEFAULT_SETTINGS, shotsPerSession:4}, {...t, slots:[a,b]}) === 2`; with `slots: null` ⇒ 4.
- [ ] **Step 2: Run** `pnpm --filter @pb/core test slots` — Expected: FAIL.
- [ ] **Step 3: Implement** core, migration, editor page, kiosk changes. The state machine's shot-count check uses `effectiveShotCount`, so `transition` takes `{ settings, template }` as its third argument from here on; update existing tests' call sites.
- [ ] **Step 4: Run** `pnpm --filter @pb/core test && pnpm --filter web e2e && pnpm --filter kiosk e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add custom photo-slot editor for templates"`

---

### Task 19: Email delivery

**Estimate:** 8h

**Files:**
- Create: `packages/core/src/email.ts`, `supabase/functions/send-photo-email/index.ts`, `apps/kiosk/src/renderer/src/screens/EmailEntry.tsx`
- Modify: `QueueJob` (add `{ kind: 'send_email'; sessionId: string; email: string }`), `processQueue`, `screens/Delivery.tsx`
- Test: `packages/core/test/email.test.ts`, `apps/kiosk/test/queue.test.ts`, `supabase/functions/send-photo-email/index.test.ts`

**Interfaces:**
- Produces:
  - `isValidEmail(s: string): boolean` — trimmed, ≤ 254 chars, `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`
  - `POST /functions/v1/send-photo-email` `{ sessionId, email }` (kiosk JWT) → sends via Resend a message with subject `"Your photobooth photo"` and the `/d/<token>` link (no attachment); `429 { error: 'limit' }` after 3 per session; `409 { error: 'not_uploaded' }` when `photo_path` is null
  - Queue rule: `send_email` waits until the same session's `upload_photo` job is done; a `409 not_uploaded` reply retries with backoff, `429` drops the job
  - Delivery screen: `"Email me a copy"` → on-screen keyboard (`react-simple-keyboard`, layout with `@` and `.com` keys) → `"Send"` disabled until `isValidEmail`; after send shows `"We'll email your photo shortly."`

- [ ] **Step 1: Write the failing tests** — email validator cases (`a@b.co` true, `a@b` false, `a b@c.com` false); queue holds `send_email` until upload done; edge function returns 429 on the 4th call (fake Resend via injected fetch).
- [ ] **Step 2: Run** the three test commands — Expected: FAIL.
- [ ] **Step 3: Implement**; set `RESEND_API_KEY` and `EMAIL_FROM` with `supabase secrets set`; add both to `docs/DEPLOY.md`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add email delivery of download link"`

---

### Task 20: Paid extra prints and remote reprint

**Estimate:** 8h

**Files:**
- Create: `apps/kiosk/src/renderer/src/screens/Prints.tsx`, `apps/kiosk/src/renderer/src/commands/poll-commands.ts`, migration `20261201000004_extra_prints_commands.sql`
- Modify: `packages/core/src/{types,settings,pricing,session-machine}.ts`, `supabase/functions/create-payment/index.ts`, `apps/web/app/admin/page.tsx`
- Test: `packages/core/test/{pricing,session-machine}.test.ts`, `apps/kiosk/e2e/reprint.spec.ts`

**Interfaces:**
- Produces:
  - `KioskSettings.extraPrintCentavos: number` (default 5000, range 0–50000), `KioskSettings.maxExtraPrints: 0 | 1 | 2 | 3` (default 3)
  - `sessionAmountCentavos(settings: KioskSettings, copies: number): number` = `freeMode ? 0 : priceCentavos + extraPrintCentavos * (copies - copiesPerSession)`; `copies` clamped to `[copiesPerSession, copiesPerSession + maxExtraPrints]`
  - State `{ name: 'prints'; sessionId; enteredAt }` entered on START when not free and `maxExtraPrints > 0`; event `{ type: 'PRINTS_SELECTED'; copies: number; now: number }` ⇒ `payment` with `copies` and the computed amount. All later states carry `copies`. `prints` auto-selects the base copies after 30 s.
  - `create-payment` body gains `copies`; server recomputes the amount with the same function
  - Table `kiosk_commands(id uuid pk, kiosk_id uuid, kind text check (kind = 'reprint'), session_id uuid, created_at, done_at timestamptz null)`; admin inserts, kiosk selects/updates its own
  - `pollCommands(api, bridge): Promise<void>` — every 30 s while on attract; reprint reads `userData/photos/<sessionId>.jpg` and prints 1 copy; missing file ⇒ mark done with `print_error = 'photo not on this kiosk'`
  - Dashboard: "Reprint" button on rows with `print_error`

- [ ] **Step 1: Write the failing tests** — price 15000, extra 5000, base copies 1, copies 3 ⇒ 25000; copies 9 ⇒ clamped to 4 ⇒ 30000; free ⇒ 0; machine: START (paid) ⇒ `prints`, `PRINTS_SELECTED 2` ⇒ `payment` amount 20000. E2E: insert a reprint command via fake API ⇒ `__pbDebug.printCalls()` increments within 35 s.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** core, migration, Prints screen (`"How many prints?"`, buttons show `"2 prints — ₱200.00"`), edge function change, command polling, dashboard button.
- [ ] **Step 4: Run** `pnpm --filter @pb/core test && deno test supabase/functions && pnpm --filter kiosk e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add paid extra prints and remote reprint"`

---

### Task 21: Event mode and per-event gallery

**Estimate:** 14h

**Files:**
- Create: `packages/core/src/events.ts`, migration `20261201000005_events.sql`, `apps/web/app/admin/events/{page.tsx,[id]/page.tsx,[id]/gallery/page.tsx}`
- Modify: `KioskApi` (`getEvents(): Promise<EventConfig[]>`), `useKiosk`, `create-payment`, `SessionSync` (`eventId: string | null`)
- Test: `packages/core/test/events.test.ts`, `apps/web/e2e/events.spec.ts`

**Interfaces:**
- Produces:
  - `interface EventConfig { id: string; name: string; startsAt: string; endsAt: string; mode: 'paid' | 'free'; priceCentavos: number | null; templateId: string | null; greenScreenEnabled: boolean | null; backgroundIds: string[] }`
  - `activeEvent(events: EventConfig[], now: Date): EventConfig | null` — `startsAt <= now < endsAt`; ties ⇒ latest `startsAt`, then `id` ascending
  - `effectiveSettings(base: KioskSettings, ev: EventConfig | null): KioskSettings` — overrides `freeMode` (`mode === 'free'`), `priceCentavos` (when non-null), `activeTemplateId` (when non-null), `greenScreen.enabled` (when non-null)
  - Table `events` mirroring `EventConfig` (snake_case), `sessions.event_id uuid null → events`
  - `create-payment` computes `effectiveSettings(settings, activeEvent(events, now))` before `sessionAmountCentavos`
  - Event form validates `endsAt > startsAt` (`"End must be after start"`); times entered and shown in Manila time
  - Gallery: grid of signed thumbnails (`createSignedUrl` with `transform: { width: 400 }`), 60 per page, per-photo download

- [ ] **Step 1: Write the failing tests** — no events ⇒ null; event Nov 11 18:00–23:00 Manila active at 20:00 Manila, not at 23:00; two overlapping ⇒ later `startsAt`; `effectiveSettings` free event ⇒ `freeMode: true`, price override ⇒ that price. Web e2e: create a free event covering now ⇒ fake-API kiosk shows `"Free today!"`; gallery lists a seeded session photo.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** core, migration, admin pages, kiosk fetch + cache, server-side effective settings, `eventId` on sessions.
- [ ] **Step 4: Run** `pnpm --filter @pb/core test && supabase test db && deno test supabase/functions && pnpm --filter web e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add scheduled event mode and per-event gallery"`

---

### Task 22: Sales reports, CSV, session logs

**Estimate:** 12h

**Files:**
- Modify: `packages/core/src/reports.ts`
- Create: `apps/web/app/admin/reports/{page.tsx,export/route.ts}`, `apps/web/app/admin/sessions/page.tsx`
- Test: `packages/core/test/reports.test.ts`, `apps/web/e2e/reports.spec.ts`

**Interfaces:**
- Produces:
  - `groupSales(payments: { amountCentavos: number; paidAt: string; eventId: string | null }[], by: 'day' | 'month'): { key: string; count: number; totalCentavos: number }[]` — Manila keys `YYYY-MM-DD` / `YYYY-MM`, sorted ascending, empty periods omitted
  - `toCsv(rows: { key: string; count: number; totalCentavos: number }[]): string` — header `period,sessions,total_php`, amounts as `150.00` (no peso sign, no thousands separator), `\r\n` line endings
  - `GET /admin/reports/export?from=YYYY-MM-DD&to=YYYY-MM-DD&by=day|month[&event=<id>]` ⇒ `text/csv`, filename `sales-<from>-to-<to>.csv`; admin only
  - Reports page: date range (Manila), day/month toggle, event filter, totals row, bar chart of totals
  - Sessions page: filter by status and event, 50 per page, columns time / event / amount / status / print error / copies

- [ ] **Step 1: Write the failing tests** — `groupSales` month: `2026-11-30T16:30:00Z` ⇒ `2026-12`, `2026-11-30T15:59:00Z` ⇒ `2026-11`; `toCsv` of `[{key:'2026-11-11',count:3,totalCentavos:123450}]` equals `'period,sessions,total_php\r\n2026-11-11,3,1234.50\r\n'`. Web e2e: export link downloads a file whose first line is the header.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**. Query `payments` with `status = 'paid'` and `paid_at` between the Manila range converted to UTC (`from 00:00 +08:00` to `to + 1 day 00:00 +08:00`, exclusive end).
- [ ] **Step 4: Run** `pnpm --filter @pb/core test reports && pnpm --filter web e2e reports` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add sales reports, CSV export, and session logs"`

---

### Task 23: Auto-delete expired photos

**Estimate:** 5h

**Files:**
- Create: `supabase/functions/purge-expired/index.ts`, migration `20261201000006_purge.sql`
- Modify: `packages/core/src/reports.ts`
- Test: `packages/core/test/reports.test.ts`

**Interfaces:**
- Produces:
  - `selectExpired(sessions: { id: string; createdAt: string; photoPath: string | null }[], linkExpiryDays: number, now: Date): string[]` — ids with a photo whose `createdAt + days <= now`
  - `sessions.purged_at timestamptz null`
  - `purge-expired` (service role, `--no-verify-jwt`, requires header `x-cron-secret` = `CRON_SECRET`): deletes storage objects in batches of 100, sets `photo_path = null, purged_at = now()`; returns `{ purged: number }`
  - `pg_cron` job `purge-expired-daily` at `0 19 * * *` UTC (03:00 Manila) calling the function via `net.http_post`
  - Download page: a purged session shows `"This link has expired."` (not "uploading"): `downloadLinkState` checks expiry before `photoPath`

- [ ] **Step 1: Write the failing tests** — 7-day expiry boundary at exactly `+7d` ⇒ selected; `+7d − 1s` ⇒ not; `photoPath: null` ⇒ not; `downloadLinkState` for an expired session with `photoPath: null` ⇒ `'expired'`.
- [ ] **Step 2: Run** `pnpm --filter @pb/core test reports` — Expected: FAIL.
- [ ] **Step 3: Implement**; add `CRON_SECRET` to `docs/DEPLOY.md`.
- [ ] **Step 4: Run** tests, then locally `curl -H "x-cron-secret: $CRON_SECRET" …/purge-expired` against a seeded expired session. Expected: PASS; `{ "purged": 1 }`; object gone from the bucket.
- [ ] **Step 5: Commit** `git commit -am "feat: purge expired photos daily"`

---

### Task 24: Auto-start, crash resume, user manual

**Estimate:** 8h

**Files:**
- Create: `packages/core/src/resume.ts`, `apps/kiosk/src/main/autostart.ts`, `docs/USER_MANUAL.md`
- Modify: `LocalConfig` (`activeSession: { state: KioskState; savedAt: number; paymentId: string | null } | null`, `autoStart: boolean`), `useKiosk`, `src/main/index.ts`, `screens/Setup.tsx`
- Test: `packages/core/test/resume.test.ts`, `apps/kiosk/e2e/resume.spec.ts`

**Interfaces:**
- Produces:
  - `resumeState(saved: { state: KioskState; savedAt: number } | null, now: number): KioskState | { name: 'resume_payment' }` — `capture`/`background`/`review`/`output` younger than 30 min ⇒ `capture` with the same `sessionId`, `amountCentavos`, `copies`, `backgroundId`, `shots: []`, `retakesUsed: 0`; `payment` younger than 30 min ⇒ `{ name: 'resume_payment' }` (the app then calls `cancelPayment(paymentId)`: `paid` ⇒ capture, else attract); anything else or older ⇒ `attract`
  - `useKiosk` saves `activeSession` on every transition out of `attract` and clears it on entering `delivery` or `attract`
  - `setAutoStart(enabled: boolean): void` using `app.setLoginItemSettings({ openAtLogin: enabled })`; Setup toggle `"Start automatically when Windows starts"` (default on)
  - Main process: on `render-process-gone`, reload the window; on resume to capture the screen shows `"Welcome back! Let's continue your session."` for 3 s
  - `docs/USER_MANUAL.md`: daily start-up, changing price/templates/events, reading reports, reprinting, what each error message means, who to call; exported to PDF for the printed copy

- [ ] **Step 1: Write the failing tests** — review saved 10 min ago ⇒ capture, same `sessionId`, empty shots; saved 31 min ago ⇒ attract; delivery ⇒ attract; payment 2 min ago ⇒ `resume_payment`. E2E: reach capture in a paid fake session, `electronApp.close()`, relaunch ⇒ the welcome-back text and capture screen.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** core, persistence, auto-start, crash reload, manual.
- [ ] **Step 4: Run** `pnpm --filter @pb/core test resume && pnpm --filter kiosk e2e resume` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: add auto-start, crash resume, and user manual"`

---

### Task 25: Full acceptance and event dry run

**Estimate:** 10h

**Files:**
- Modify: `docs/ACCEPTANCE.md`, `docs/DEPLOY.md`

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm test && pnpm typecheck && supabase test db && deno test supabase/functions && pnpm --filter kiosk e2e && pnpm --filter web e2e`
Expected: all PASS.

- [ ] **Step 2: Deploy the new migrations, functions, and secrets** per `docs/DEPLOY.md`; rebuild the installer on Windows.

- [ ] **Step 3: Add and run these acceptance rows on real hardware** (in addition to the lean MVP rows):
10. Retake once; second retake button is gone.
11. Each of the 10 filters prints with a visible difference.
12. Add, drag, pinch, and rotate a prop; it prints where it was placed.
13. Green screen under the venue's lighting; tune similarity in admin until hair edges are clean; preview ≥ 24 fps.
14. Custom-slot template with 3 slots takes 3 shots.
15. Email arrives with a working link.
16. 3 prints paid ⇒ 3 sheets; amount matches the screen and the PayMongo dashboard.
17. Out-of-paper failure ⇒ "Reprint" from admin on a phone prints at the kiosk.
18. Scheduled free event switches the kiosk to free at its start time and back after.
19. Monthly CSV totals match the PayMongo dashboard for the test period.
20. Pull the power plug during capture after paying ⇒ kiosk auto-starts and resumes the session.
21. A link older than the expiry shows "This link has expired." and the photo is gone from storage after the 03:00 purge.

- [ ] **Step 4: Dry-run a mock event for 1 hour** with at least 20 sessions (mix of paid, free, extra prints, green screen). Record any failure as a task in the project's issue list before handover.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: full-scope acceptance results and deploy updates"
```
