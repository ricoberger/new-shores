# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after PR #17
(polish pass).

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–2 complete: production, logistics, needs/categories, workforce, taxes, insolvency with trial resume, fields (radius rule), ships/routes/settling, quests, away summary; schema 3 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.6.0: tier 1 + 2 goods, buildings, fields, sloop, 12 intro quests | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, touch layouts, PWA, perf guard, visual baselines | `client/`, UI.md |
| Art | KayKit SOURCE kits only; recipe-driven Blender build (`npm run assets`), AO/two-tone vertex colours, diorama islands; 31 recipes + decor; thumbnails | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`), server/client/e2e/integration jobs; perf fps floors are device-validated tripwires | `.github/workflows/ci.yaml` |

## Binding rules in one breath

Server owns the truth; `internal/sim` is pure (no clock, no I/O); no tick
loop — lazy advance + scheduled events applied at `due_at`; content is
data; no game rules in the client (it extrapolates from rates); every
commit type-checks, lints, builds and passes its tests; docs change only
in the sync after a task unless the task says otherwise; nobody adds the
`ci` label but the owner.

## Decisions most relevant right now

- **D-050** chunky stylised flat-shaded look, KayKit lead, real models at
  every zoom, device-validated perf.
- **D-051** (target, partly implemented): start at sea with the sloop;
  Trading Post (capacity, berths) vs Warehouse (collector); water-edge
  footprints; fields v2 by adjacency (1×1 crops, 2×2 pens); berths with
  per-unit handling; free camera (done); per-house satisfaction with island
  aggregates (done).
- **D-049** fields exist with the radius rule — to be replaced by D-051
  part 4.

## Next tasks (in order)

1. **Settling and harbours** (full ai-team): D-051 parts 1, 2, 3, 5.
2. **Fields v2** (dev + one review): D-051 part 4.
3. **Polish round 2** (direct): whatever the owner's playtest finds.
4. **Life layer and dressing** (art task 4).
5. **Content depth**: tier-2 alternatives, tier 3, island generation.

## Known follow-ups

Ghost variant hint from the server; sloop berth offset (KayKit hull is
wider); need-category display names (content); progressive island
loading if first load bothers on phones; D-039 unlock ladder removal in
content (`islands.json: unlock`) with the Settling task.

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures),
`make up` (Compose stack), `make check`, `make assets` /
`make assets-check` (needs Blender 5.2 and `NEW_SHORES_KITS_DIR`).
