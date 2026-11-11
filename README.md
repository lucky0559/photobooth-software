# Photobooth Software

Self-service photobooth kiosk for the Philippine market: GCash/Maya QR payment, 1–4 shots, printed copy, and QR download. Software only.

No code yet. This folder holds the spec and two implementation plans. The code will be built here, following whichever plan is chosen.

| Document | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Agreed scope for both tiers, outputs, PC requirements, budget |
| [docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md](docs/plans/lean-mvp/IMPLEMENTATION_PLAN.md) | Lean MVP: 14 tasks, ~172h, ~₱77,400, 4–5 weeks |
| [docs/plans/full-scope/IMPLEMENTATION_PLAN.md](docs/plans/full-scope/IMPLEMENTATION_PLAN.md) | Full scope: lean MVP + 11 extension tasks, ~299h, ~₱134,550, 8–9 weeks |

The full-scope plan runs the lean MVP plan first, unchanged, and then adds features. A client can start with the lean MVP and upgrade later without a rewrite.

Stack: pnpm monorepo, Electron + React kiosk (Windows), Next.js admin and download page, Supabase (Postgres, Auth, Storage, Edge Functions), PayMongo QR Ph.
