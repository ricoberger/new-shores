# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after PR #24
(polish round 2).

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–2 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary; schema 5 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.8.0: tier 1 + 2 goods, buildings incl. Trading Post / Warehouse / water-edge fisher + shipyard, fields (1×1 crops, 2×2 pastures), sloop (4 slots), need names, 13 intro quests | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA; `make shots` / `make model-sheet` for looking at the result (no e2e/visual/perf suites, D-052) | `client/`, UI.md |
| Art | KayKit SOURCE kits only; recipe-driven Blender build (`npm run assets`), AO/two-tone vertex colours, diorama islands; recipes + decor; thumbnails; life layer (carts, walkers, smoke, sails, boats, gulls, strollers, sheep, construction stages) with device budgets | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`): server (fmt/vet/lint/test), client (lint/typecheck/Vitest/build/assets-check), integration (Postgres + Redis) | `.github/workflows/ci.yaml` |

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
- **D-052** flows and perf validated by playtest on the device; no
  e2e/visual/perf suites; `make shots` PNGs in every look-changing PR.
- **D-051**: complete — start at sea, Trading Post (capacity, berths) vs
  Warehouse (collector), water-edge footprints, fields v2 (edge-adjacent
  chains from the farm panel, bound to a farm instance), berths with
  per-unit handling, free camera, per-house satisfaction.

## Next tasks (in order)

1. **Island generator** (design interview first, then Opus): seeded
   6–8 island archipelagos replacing the fixed two-island `devworld`.
2. **Polish round 3** (interactive, after the generator): archipelago
   scale items — ship size at far, minimap, camera fit, far LOD, legs
   through islands.
3. **Content depth** (design interview first): tier-2 alternatives
   (dairy, pigs, apiary with their reserved field types), tier 3.

## Known follow-ups

- **Decision candidates** (owner + design lead): unload amounts per
  route stop (touches D-015); a meaning for fields above `required`
  (D-051 part 4); ship and fisher-boat routing around islands.
- **Server tasks:** `upgrade_available` (or the blocking reason) on the
  house display so the Upgrade button shows only when it would succeed
  (D-027 forbids computing it in the client); `preview_variant` hint for
  the house ghost; content validation that a building need's
  `needs.json: radius` equals the building's `service.radius`.
- **Client tasks:** `client/src/api/sync.test.ts` fails intermittently on
  real timers (rewrite with fake timers end to end); landscape phone —
  dock vs. half-open sheet and expanded minimap overlap; details-in-place
  for the dock lists; life budget per *visible* island; stage models for
  fields; comfort/luxury need icons (with tier 3); progressive island
  loading if first load bothers on phones.
- Local dev databases older than schema 5 must be recreated (`make down
  VOLUMES=1 && make up`).

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures),
`make up` (Compose stack), `make check`, `make assets` /
`make assets-check` (needs Blender 5.2 and `NEW_SHORES_KITS_DIR`).

**Looking at the result:** `make shots` (18 PNGs: showcase / settled /
dense-2x400 × near / mid / far × desktop / phone, fixed camera and
clock, ≈ 30 s; `FIXTURE= VIEW= DEVICE= ROTATION= ISLAND= ZOOM= HUD=0`,
`PRESET=<name>|all`; the names are in `client/e2e/tools/shots-args.ts`,
e.g. `info-panel`, `house-card`, `ship-panel`, `route-editor`, `build-menu`,
`island-card`, `top-bar-popups`, `farm-selected`) and `make model-sheet
RECIPE=sawmill` (contact sheet, 3 s). Attach these to reports instead
of writing ad-hoc screenshot scripts.

**Check loop by change type** (CI runs everything on the `ci` label):
- client UI / art / render: `cd client && npm run lint && npm run
  typecheck && npm test`, then `make shots` for the affected view
  (attach the PNGs to the report). There are no e2e, visual or perf
  suites (D-052); flows and fps are the owner's playtest.
- content / sim / server: `make check`; `make server-integration` when
  API or store code changed.
