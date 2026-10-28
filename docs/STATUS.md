# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after C4 (#37, tier 4 Patricians) — all four tiers
playable; D-057 voxel restyle decided, V1 next.

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–4 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary, seeded archipelago generator with reroll and rename, batch field placement, terrain table, ship names, weighted need shares with cumulative tiers and a services category, building levels (`upgrade_building`), recipe input alternatives, upgrade gate ≥ 0.6, founding cargo exempt from slots, berths spaced by ship length, tier 3–4 deposits (one gold slot per archipelago), shared fields (`farm` list), `ship_count.type` quests; schema 11 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.13.0: D-054 footprints/costs/fields, D-056 need model (shares 1.0 lone / 0.6, cumulative lower-tier rates, `services`), tiers 1–4 complete with two alternatives per category from tier 2 (Citizens bread/cheese, cider/mead, linen/leather_jerkins; Merchants sausages/pies, beer/brandy, coats/dyed_garments, books/soap; Patricians roast_beef/oysters, wine/grain_spirit, fine_garments/lace, candles/spectacles, jewellery/instruments), salt / bricks / coal / glass, 93 buildings, services ladder market → chapel → tavern → school → church → theatre → university → cathedral, islands 192/112/64/16 with iron/clay/salt/coal/quartz/copper/gold deposits, `smoke`/`boat` flags, sloop (2 slots) / brig / galleon, 12 intro + 5 + 6 + 6 tier quests; reference games 52/30/88/132 · 225/235/283 · 501/798/843 | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA; `make shots` / `make model-sheet` for looking at the result (no e2e/visual/perf suites, D-052) | `client/`, UI.md |
| Art | **Procedural voxels (D-057, V1 merged):** Python voxel recipes at 8 voxels/tile (`assets/voxel`, standard library only, no Blender/kits), greedy quads + baked AO/sun through the GLB writer, lite = 2 voxels/tile; voxel terrain (stepped plateaus, pixel coast), voxel decor and life props, 28 recipes + 66 automatic placeholders (all tier 3–4 buildings, 15 tier-2 IDs); far at the cap 152 k tris (D-048 holds), pans ≤ 33 ms; models folder 19.1 of 24 MiB | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`): server (fmt/vet/lint/test), client (lint/typecheck/Vitest/build/assets-check), integration (Postgres + Redis) | `.github/workflows/ci.yaml` |

## Binding rules in one breath

Server owns the truth; `internal/sim` is pure (no clock, no I/O); no tick
loop — lazy advance + scheduled events applied at `due_at`; content is
data; no game rules in the client (it extrapolates from rates); every
commit type-checks, lints, builds and passes its tests; docs change only
in the sync after a task unless the task says otherwise; nobody adds the
`ci` label but the owner.

## Decisions most relevant right now

- **D-057** procedural voxel art (supersedes D-050's kit-bash); warm
  palette, real models at every zoom, device-validated perf stay.
- **D-052** flows and perf validated by playtest on the device; no
  e2e/visual/perf suites; `make shots` PNGs in every look-changing PR.
- **D-051**: complete — start at sea, Trading Post (capacity, berths) vs
  Warehouse (collector), water-edge footprints, fields v2 (edge-adjacent
  chains from the farm panel, bound to a farm instance), berths with
  per-unit handling, free camera, per-house satisfaction.

## Next tasks (in order)

1. **Content depth (D-056 decided; CONTENT §2/§5/§7/§8/§12 are the
   spec):**
   - ~~S1 need model + tier-2 completion~~ merged (#34); ~~M2 / M3 /
     M4 models~~ merged (#31–#33).
   - ~~C3 tier 3~~ merged (#35), ~~C4 tier 4~~ merged (#37): all
     D-056 targets hold; `islands.json` unchanged (59 % home use).
   - **D-057 voxel restyle:** ~~V1 clean cut~~ merged (#38). Next, in
     parallel: **V2** lively world (terrain blend, voxel roads, stepped
     foam, far coast, construction stages per footprint, voxel smoke,
     swaying cloth, decor density, lighting) and **V3** tier 1–2 recipes
     at D-057 §3 detail (replace the 28 prototype recipes, the 15 tier-2
     placeholders, 3 variants per house); then **V4** tier 3, **V5**
     tier 4 + ships; **V6** polish round in the new look
     with the tier 2–4 playtest (second chains, market levels, services
     ladder, unlock toasts, quest chains, long house cards, brig/galleon
     at the piers).
   - Before deployment: quantised GLB export (KHR_mesh_quantization) to
     roughly halve the models folder (≈ 63 bytes/triangle today; limit
     24 MiB).

## Known follow-ups

- **Decision candidates** (owner + design lead): unload amounts per
  route stop (touches D-015); a meaning for fields above `required`
  (D-051 part 4); ship and fisher-boat routing around islands.
- **Server tasks:** ~~snapshot interval, in-transit rate, unlock while
  away, upgrade availability~~ done (#39); replay time is still ~58 s
  per long game (shared once per test binary); `preview_variant` hint for
  the house ghost; content validation that a building need's
  `needs.json: radius` equals the building's `service.radius`.
- **Client tasks:** `client/src/api/sync.test.ts` fails intermittently on
  real timers (rewrite with fake timers end to end); landscape phone —
  dock vs. half-open sheet and expanded minimap overlap; details-in-place
  for the dock lists; life budget per *visible* island; stage models for
  fields; comfort/luxury need icons (with tier 3); a `citizens` dev fixture
  (Citizens unlocked, a wheat farm) so presets can paint 140 fields.
- API, store and event tests still run on the old hand-made two-island
  world (fine: they test the store, not the map).
- Dev seed 1053001 (`--seed`); the pre-D-054 content lives in
  `server/testdata/content/old_coast_pre_d054` (hand-made scenarios,
  mechanics tests, two client tests) — see the PR #27 notes.
- Local dev databases older than schema 7 must be recreated (`make down
  VOLUMES=1 && make up`); 7→8 migrates (ship names).
- **First frame** ≈ 200 ms cold / 115 ms warm on desktop (PR #30 notes):
  the world and content requests start only after the engine is set up
  (~117 ms); fetching them in parallel saves ≈ 35–40 ms — client
  follow-up. The unused `unsettled` palette role can be removed.

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures),
`make up` (Compose stack), `make check`, `make assets` /
`make assets-check` (Python 3, no other tools), `make model-sheet RECIPE=`.

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
