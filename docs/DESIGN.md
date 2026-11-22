# Kiosk visual design: "Pop Film Lab"

The client liked the *idea* of their reference (playful and confident, bold outlined shapes, a distinct backdrop per screen, big tilted banner titles, chunky buttons with a physical press, a tray of filter tiles, a countdown pill, a big friendly countdown numeral, a result shown like a keepsake) but asked us not to copy the design. "Pop Film Lab" is our own identity built around analog photography: film strips, polaroids, tape, the shutter iris, the flash and print halftone. All shapes are drawn by us as inline SVG/CSS; fonts are open-license. The reference image is not needed to build or review this theme.

## Look

- **Outlines and shadows:** cards, buttons, banners and tiles have a thick ink outline (3–4 px at 1080 px width) and a hard **slab shadow** pushed purely down-right (`6px 6px 0`, no blur). The slab is ink on light screens and aqua on dark ones (an ink shadow would vanish on the navy backdrop); controls inside a paper card keep the ink slab. No soft shadows, no gradients.
- **Shape language:** squarer than a sticker look. Corners 14–20 px (`--radius`); only the timer is a full pill. Cards are tickets and polaroids (deep bottom margin, slight tilt, a strip of tape). Buttons are rounded rectangles on a slab with a dashed perforation line near the end, like a tear-off ticket stub.
- **Flat, high-energy colors on midnight navy and paper.** Tokens (CSS custom properties in `theme/tokens.css`, mirrored in `theme/contrast.ts`):

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#0F1B3D` | midnight navy: outlines, text on light fills, dark backdrops, timer pill |
| `--ink-2` | `#1F2E5C` | the one neutral: film-strip body, iris blades, faint halftone on dark screens (never text) |
| `--paper` | `#FAF7F0` | cards, polaroids, price ticket, Review backdrop, text on ink |
| `--lime` | `#C6F432` | primary action, timer digits, countdown numeral, crop marks, tape |
| `--tangerine` | `#FF6B2C` | banners, danger/urgent action, status banner, stripes |
| `--aqua` | `#2EE6D6` | secondary action, viewfinder outline, slab shadow on dark screens, sparkles |

- **Contrast decisions:** text on tangerine is **ink**, not paper (paper on tangerine is 2.66:1 and fails). Checked pairs (`TOKEN_PAIRS`): ink on paper/lime/aqua/tangerine, paper on ink, lime on ink. All ≥ 4.5:1.
- **Type:** display font **Bungee** (banners, buttons, countdown numeral, timer, shot label); body font **Outfit** 600/700 (sentences, tile labels). Both bundled locally (`@fontsource/bungee`, `@fontsource/outfit`) because the kiosk may be offline. Bungee renders in capitals by design; the DOM text stays exactly as pinned.
- **Banners:** `BannerTitle` tilted −3° to +3°, tones tangerine / lime / aqua (ink text) or ink (paper text).
- **Backdrops (`Backdrop kind`):**
  - `film` (Attract): navy, a large film strip band tilted −7° drifting slowly sideways, tangerine and lime halftone fields in opposite corners.
  - `darkroom` (Capture, Output, camera error): navy with a faint `ink-2` halftone corner.
  - `paper` (Review): paper with soft aqua and tangerine halftone corners.
  - `stripes` (Payment, Delivery): flat tangerine/paper diagonal stripes over the top, split from a paper bottom by a slanted ink edge.
- **Decor set (`theme/decor/`, own SVG):** `FilmStrip`, `Sprocket`, `ShutterIris`, `FlashBolt`, `Sparkle`, `TapeStrip`, `HalftoneField` (shared wrapper `DecorSvg`). Decorative only: `aria-hidden`, `pointer-events: none`, placed in flow rows (`.decor-row`, `.title-row`, `.topbar`) so they can never overlap a button or the camera frame. The backdrop and the countdown iris sit behind content by design.
- **Timer pill:** top-left `m:ss`, lime digits on an ink pill with a tiny aperture icon. Shown where a countdown exists (payment 3:00, review 1:00, delivery 0:45). It derives the remaining time from the state's own timestamps and re-renders once a second; it never owns a timeout.
- **Buttons (`ActionButton`):** primary lime, secondary aqua, danger tangerine, all ink text; min 96 px tall; Bungee ~40 px; pressing moves the button 4 px down-right onto its slab. Focus ring 4 px tangerine (lime on dark screens). The start button has a lime frame that pulses outward behind it; the button itself never moves (a moving target is harder to tap).
- **Camera viewfinder:** the live preview sits in an aqua-outlined window (no glow) with four lime crop-mark brackets at the corners. During the countdown a translucent `ShutterIris` sits behind the numeral and turns a step each second; the numeral is Bungee in lime with an ink stroke so it reads on any image.
- **Filter tray (Review):** a row of film-frame tiles (ink film stock with sprocket holes on the top and bottom edges), each showing shot 1 with that filter and the filter name in paper text. The selected tile gets a lime ring and a lime check badge.
- **Result (Review):** the strip/4R preview sits on a taped polaroid card, rotated about −1.5°, sized to the layout's aspect ratio.

## Screens (lean MVP) and pinned copy

Pinned strings from the plan stay exactly as written, because tests and staff training depend on them. Decorative extras may be added around them.

| Screen | Pinned copy (exact) | Design notes |
|---|---|---|
| Attract | `Tap to start`, `Free today!`, price, `Offline — payments unavailable`, `Setup needed: no active template` | `film` backdrop; decorative tangerine banner `Smile!` with a flash bolt and sparkle; big lime `Tap to start`; price on a paper admission ticket; status message on a tangerine banner |
| Payment | `Scan with GCash, Maya, or your bank app`, amount, `Cancel`, `Checking your payment…`, `Payments are unavailable right now. Please call staff.` | `stripes` backdrop, timer pill 3:00, ink banner, QR in a taped polaroid card (`.qr-slot`); amount, status and Cancel go under the card |
| Capture | `Shot N of M`, `Camera not available. Please call staff.`, `Try again` | `darkroom` backdrop; decorative lime banner `Say cheese!`; shot label on a paper tab; viewfinder with crop marks; iris + giant numeral countdown. Camera error: paper card with the sentence and a lime `Try again` |
| Review | `Pick a look`, `Original`, `Black & White`, `Warm`, `Print` | `paper` backdrop, timer pill 1:00, tangerine banner, taped polaroid preview, film-frame filter tray, lime `Print`. Landscape puts the polaroid beside the controls. **No Retake button in lean MVP** (it is Task 15 in the full scope) |
| Output | `Printing your photo…` | `darkroom` backdrop, slowly spinning shutter iris, lime banner |
| Delivery | `Scan to download your photo`, print-failure sentence, `Done` | `stripes` backdrop, timer pill 0:45, QR in a taped polaroid card |
| Setup / PIN | staff-only | Plain, high-contrast, no decor |

## Rules

- Works at 1080 × 1920 (portrait) and 1920 × 1080 (landscape): layout uses `vh`/`vw`/`vmin`, flex and grid, no fixed pixel page sizes; nothing clipped, no page scroll, primary button always fully inside the viewport.
- Contrast: every text-on-fill pair ≥ 4.5:1, checked by `contrast.test.ts` against `TOKEN_PAIRS`, not by eye. If a pair fails, change the token or the text color, never the threshold.
- Touch targets ≥ 88 px. No hover-only affordances. `prefers-reduced-motion` turns off decor wobble/spin, the film-band drift, the countdown pop and the start-button pulse.
- Animation budget: CSS transforms/opacity only; nothing filters or blurs the camera preview, so the preview and countdown keep their frame rate.
- No external requests at runtime (fonts and SVGs bundled).

## Print templates

Strip and 4R frames are **template overlays**, not app UI. The admin uploads them as PNGs (600 × 1800 strip, 1200 × 1800 4R). Optional later work: ship two starter overlays in the Pop Film Lab style (film-strip edge with sprocket holes, polaroid-style 4R) so a new client has something to pick on day one.

## Admin panel

Same tokens and fonts, calmer: paper background, ink outlines, no decor, standard form controls. Treat as a later polish pass, not part of the kiosk theme task.
