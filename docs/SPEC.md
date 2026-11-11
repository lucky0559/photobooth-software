# Photobooth Software — Spec

Status: agreed scope, 2026-11-11. Software only; the client supplies the PC, camera, and printer.

## What it is

A self-service photobooth kiosk for the Philippine market. A guest pays with GCash or Maya (QR Ph), takes 1–4 photos, gets a printed copy (hard copy) on the spot, and scans a QR code to download the photo (soft copy). The owner manages prices, templates, events, and sales from a web admin panel.

No cash, coin, or bill acceptor. No hardware is sold with the software.

## Tiers

| | Lean MVP | Full scope |
|---|---|---|
| Live preview, countdown, 1–4 shots | Yes | Yes, plus retake and mirror option |
| Layouts | 2×6 strip and 4R, preset photo slots | Plus custom slot editor per template |
| Templates | Admin uploads PNG overlays | Same |
| Filters | 3 (none, B&W, warm) | 10 |
| Props / stickers | No | Yes |
| Green screen | No | Yes, with background library |
| Hard copy | Silent print, copies per session | Plus paid extra prints, reprint from admin |
| Soft copy | QR → download page | Plus email |
| Payment | GCash / Maya via PayMongo QR Ph | Same |
| Admin | Login, price, free mode, templates, today's sales, needs-attention list | Plus events, gallery per event, reports with CSV, session logs |
| Cloud | Photos stored, links expire | Plus auto-delete after N days |
| Offline | Free mode works offline; uploads queue and retry | Plus crash/power-loss resume |
| Installer | Windows installer | Plus auto-start on boot, user manual |

## Outputs

- Print sheet: 4×6 in at 300 DPI = 1200 × 1800 px, portrait, JPEG quality 0.92.
- 2×6 strip: 600 × 1800 px, printed twice side by side on one 4×6 sheet (printer cuts at 2 in, or staff cuts).
- 4R: 1200 × 1800 px, printed once.

## Money

- All amounts stored as integer centavos.
- Session price range: ₱20.00–₱1,000.00 (PayMongo minimum is ₱20; confirm in PayMongo docs at build time).
- Default price ₱150.00.

## Client PC requirements

| Item | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 64-bit | Windows 11 64-bit |
| CPU | Intel i5 8th gen / Ryzen 5 | Intel i5 12th gen / Ryzen 5 5600 |
| RAM | 8 GB | 16 GB |
| Storage | 256 GB SSD | 512 GB SSD |
| Display | 1080p touchscreen | 1080p touchscreen, 21"+ |
| Camera | 1080p USB webcam | DSLR/mirrorless via HDMI capture card |
| Printer | Any printer with a 4×6 Windows driver | Dye-sub printer with 2-inch cut |
| Internet | 5 Mbps | 10 Mbps+ |

## Out of scope (both tiers)

Cash/coin/bill acceptors, native DSLR SDK control, AI background removal, GIF/boomerang, mobile app, hosting fees, PayMongo fees, on-site setup.

## Budget (solo developer, AI-assisted, ₱450/hour)

| Tier | Hours | Cost | Calendar time |
|---|---|---|---|
| Lean MVP | ~172 | ~₱77,400 | 4–5 weeks |
| Full scope (lean MVP + extensions) | ~299 | ~₱134,550 | 8–9 weeks |
