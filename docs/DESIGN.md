# Kiosk visual design

Direction taken from the client's reference image (three screens: result, capture, welcome): a playful retro "sticker" look. We take the ideas, not the artwork. All shapes, stickers and fonts here are drawn or licensed by us (SVG + CSS + open-license fonts); nothing is traced or copied from the reference.

## Look

- **Outlines and shadows:** every card, button, banner and pill has a thick dark outline (3–4 px at 1080 px width) and a hard offset shadow (`4px 6px 0` in the outline color, no blur). No gradients, no soft shadows.
- **Flat saturated colors on a warm cream base.** Tokens (CSS custom properties in `theme/tokens.css`):

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#2A2340` | outlines, text on light |
| `--cream` | `#FBF4E4` | base background, cards |
| `--pink` / `--pink-2` | `#F6A8C4` / `#FBD3E1` | checker backdrop (welcome) |
| `--sky` | `#4C9BC0` | result/payment backdrop (with faint grid lines) |
| `--sun` | `#FFD84D` | capture backdrop, secondary buttons |
| `--coral` | `#F2703F` | banners, primary action on warm screens |
| `--grape` | `#6A3FD0` | primary "start" button |
| `--mint` | `#1FA37A` | title banners (capture) |
| `--cherry` | `#E8505B` | timer pill |

- **Type:** display font **Lilita One** for banners, buttons and the countdown numeral; body font **Nunito** (700/800) for sentences. Both bundled locally (`@fontsource/lilita-one`, `@fontsource/nunito`) because the kiosk may be offline. Titles sit on tilted banners (−3° to +3°) with the outline and shadow.
- **Backgrounds:** per-screen pattern drawn in CSS/SVG: wavy pink checker (welcome), blue with grid lines and a checker border strip (payment, result), yellow with a faint checker (capture).
- **Stickers (own SVG set in `theme/decor/`):** star-burst, daisy with sunglasses, smiley, cloud with rainbow, "good vibes" tag. Decorative only: `aria-hidden`, never overlap a button or the camera frame, `pointer-events: none`.
- **Timer pill:** top-left `m:ss` in a cherry pill, shown on screens that have a countdown (payment 3:00, review 1:00, delivery 0:45). It reads the same deadline the state machine uses; it never owns a timeout.
- **Buttons:** pill shape, minimum 96 px tall, 40 px type, pressed state moves the button 3 px down-right and shrinks the shadow. Focus ring 4 px `--grape`.
- **Camera frame:** the live preview sits in a thick sky-blue frame with the outline and offset shadow; the big countdown numeral overlays the preview in Lilita One with a cream outline for contrast on any image.
- **Filter tray (Review):** a bottom strip of square tiles (like the reference's prop tray) showing each filter applied to a thumbnail of shot 1; selected tile gets a grape border and a check badge.

## Screens (lean MVP) and pinned copy

Pinned strings from the plan stay exactly as written, because tests and staff training depend on them. Decorative extras may be added around them.

| Screen | Pinned copy (exact) | Design notes |
|---|---|---|
| Attract / welcome | `Tap to start`, `Free today!`, price, `Offline — payments unavailable`, `Setup needed: no active template` | Extra decorative banner `Welcome!` above; big grape button labeled `Tap to start`; daisies and "good vibes" tag in corners; price shown as a sticker tag |
| Payment | `Scan with GCash, Maya, or your bank app`, amount, `Cancel`, `Checking your payment…`, `Payments are unavailable right now. Please call staff.` | Blue grid backdrop, QR on a cream card with outline, timer pill 3:00 |
| Capture | `Shot N of M`, `Camera not available. Please call staff.`, `Try again` | Mint banner `Capture Time!`, framed preview, giant countdown numeral, yellow backdrop |
| Review | `Pick a look`, `Original`, `Black & White`, `Warm`, `Print` | Result-style layout: coral banner, strip/4R preview card, filter tray, `Print` as the primary button; **no Retake button in lean MVP** (it is Task 15 in the full scope) |
| Output | `Printing your photo…` | Simple animated sticker (CSS only) |
| Delivery | `Scan to download your photo`, print-failure sentence, `Done` | Blue backdrop, QR on cream card, timer pill 0:45 |
| Setup / PIN | staff-only | Plain, high-contrast, no stickers |

## Rules

- Works at 1080 × 1920 (portrait, the reference) and 1920 × 1080 (landscape monitor): layout uses `vh`/`vw` and flex, no fixed pixel page sizes; nothing clipped, primary button always fully inside the viewport.
- Contrast: text on color fills ≥ 4.5:1 (ink on sun/cream/pink; cream on grape/mint/coral/cherry). Check with the token pairs, not by eye.
- Touch targets ≥ 88 px. No hover-only affordances. `prefers-reduced-motion` turns off sticker wobble and button bounce.
- Animation budget: CSS transforms/opacity only; the camera preview and countdown must stay at the frame rate they have without the theme.
- No external requests at runtime (fonts and SVGs bundled).

## Print templates

The strip/4R frames in the reference (pink checker frame, star bursts, scalloped photo slots) are **template overlays**, not app UI. The admin uploads them as PNGs (600 × 1800 strip, 1200 × 1800 4R). Optional later work: ship two starter overlays in this style so a new client has something to pick on day one.

## Admin panel

Same tokens and fonts, calmer: cream background, ink outlines, no stickers, standard form controls. Treat as a later polish pass, not part of the kiosk theme task.
