# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after PR #22
(polish tooling).

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–2 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary; schema 5 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.8.0: tier 1 + 2 goods, buildings incl. Trading Post / Warehouse / water-edge fisher + shipyard, fields (1×1 crops, 2×2 pastures), sloop (4 slots), need names, 13 intro quests | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA, perf guard, three HUD visual guards; `make shots` / `make model-sheet` for looking at the result | `client/`, UI.md |
| Art | KayKit SOURCE kits only; recipe-driven Blender build (`npm run assets`), AO/two-tone vertex colours, diorama islands; recipes + decor; thumbnails; life layer (carts, walkers, smoke, sails, boats, gulls, strollers, sheep, construction stages) with device budgets | `assets/`, ART_DIRECTION.md |
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
- **D-051**: complete — start at sea, Trading Post (capacity, berths) vs
  Warehouse (collector), water-edge footprints, fields v2 (edge-adjacent
  chains from the farm panel, bound to a farm instance), berths with
  per-unit handling, free camera, per-house satisfaction.

## Next tasks (in order)

1. **Owner playtest** on desktop and phone (start loop, dense fixture,
   fps/heat with the life layer), then **polish round 2** (direct) from
   the findings.
2. **Content depth** (needs a design interview first): tier-2 alternatives (dairy, pigs, apiary with
   their reserved field types), tier 3, island generation.

## Known follow-ups

Ghost variant hint from the server; ship legs are straight lines and may
cross islands (routing around land); comfort/luxury need icons (with tier
3); fisher-boat loops cross land like ship legs (one routing task);
life budget counts the whole island, not the visible part; stage models
for fields; progressive island loading if first load bothers on phones.
Local dev databases older than schema 5 must be recreated (`make down VOLUMES=1 &&
make up`).

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures),
`make up` (Compose stack), `make check`, `make assets` /
`make assets-check` (needs Blender 5.2 and `NEW_SHORES_KITS_DIR`).

**Looking at the result:** `make shots` (18 PNGs: showcase / settled /
dense-2x400 × near / mid / far × desktop / phone, fixed camera and
clock, ≈ 30 s; `FIXTURE= VIEW= DEVICE= ROTATION= ISLAND= ZOOM= HUD=0`,
`PRESET=info-panel|sheet|ghost|sloop|all`) and `make model-sheet
RECIPE=sawmill` (contact sheet, 3 s). Attach these to reports instead
of writing ad-hoc screenshot scripts.

**Check loop by change type** (CI runs everything on the `ci` label):
- client UI / art / render: `cd client && npm run lint && npm run
  typecheck && npm test`, then `make shots` for the affected view; run
  only the Playwright spec whose flow changed; re-record the three HUD
  guards when the HUD changed (`make e2e-fast` once before a PR that
  changed a flow).
- content / sim / server: `make check`; `make server-integration` when
  API or store code changed.
- never locally: the `perf`, `lighthouse`, `ttfi`, `touch-webkit`
  projects.
