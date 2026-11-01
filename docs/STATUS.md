# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after #61 (CI green again) — D-064 palette merged;
D-065 service chains and D-066 dev start state / snapshots next.

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–4 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary, seeded archipelago generator with reroll and rename, batch field placement, terrain table, ship names, weighted need shares with cumulative tiers and a services category, building levels (`upgrade_building`), recipe input alternatives, upgrade gate ≥ 0.6, founding cargo exempt from slots, berths spaced by ship length, tier 3–4 deposits (one gold slot per archipelago), shared fields (`farm` list), `ship_count.type` quests, D-058 skeleton islands with terrace levels, rivers, islets, cliffs and skerries, sea routing on a 4-tile grid (`path` per leg, routed founding voyage); schema 12 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.16.0: D-054 footprints/costs/fields, D-056 need model (shares 1.0 lone / 0.6, cumulative lower-tier rates, `services`), tiers 1–4 complete with two alternatives per category from tier 2 (Citizens bread/cheese, cider/mead, linen/leather_jerkins; Merchants sausages/pies, beer/brandy, coats/dyed_garments, books/soap; Patricians roast_beef/oysters, wine/grain_spirit, fine_garments/lace, candles/spectacles, jewellery/instruments), salt / bricks / coal / glass, 100 buildings, services ladder market → chapel → tavern → school → church → theatre → university → cathedral, civic needs safety/fire protection (Merchants) and health (Patricians), lumberjack with tree plots, quay / trading pier 6×9 / depot, playhouse (theatre retired), Anno-sized footprints with per-column `water_rows` (D-062/D-063), islands 192/112/64/16 + `scenic` skerries (spacing 50/120, straits ≥ 24, void ≤ 150) with iron/clay/salt/coal/quartz/copper/gold deposits, `smoke`/`boat` flags, sloop 1.2 (2 slots) / brig 1.0 / galleon 0.85, 12 intro + 5 + 6 + 6 tier quests; reference games 53/33/91/134 · 229/264/297 · 855/887/1437 | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store and `POST /api/v1/dev/reset` | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA; `make shots` / `make model-sheet` for looking at the result (no e2e/visual/perf suites, D-052); **Almanac** — public reference at `/almanac` (tiers, buildings, goods with chain trees, needs, ships, quests, islands) generated from the served content, UI.md §9; terraced voxel terrain with rivers, bridges, cliffs, crags and skerries, route ribbons and ship legs along the routed paths (D-058) | `client/`, UI.md |
| Art | **Procedural voxels (D-057; V1–V5 merged):** Python voxel recipes at 8 voxels/tile on the parts library v2 (`assets/voxel`, standard library only), greedy quads + baked AO/sun, lite = 2 voxels/tile, shader colour jitter; lively world — blended ground, stepped pixel coast with foam, rock bands, voxel roads, dense swaying decor, voxel smoke, sized construction stages, wakes, fixed warm daylight (D-064 palette v2: mid-green grass, neutral grey rock, teal sea, grey-blue shadows), voxel minimap; **all 93 buildings, fields and modules of tiers 1–4 and the three ships at target detail** (3 house variants per tier, flat colours + shader jitter, cloth sway groups, no placeholders); quantised GLBs (KHR_mesh_quantization); far at the cap 154 k tris (D-048 holds), dense mid 1.41 M, no pan frame > 50 ms; models folder 18.5 MB of 24 MiB | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`): server (fmt/vet/lint/test, 30 m timeout, full suite), client (lint/typecheck/Vitest/build/assets-check), integration (Postgres + Redis); locally `make check` runs the server tests with `-short` (the tier-4 replays are skipped), `make server-test-full` the CI suite | `.github/workflows/ci.yaml` |

## Binding rules in one breath

Server owns the truth; `internal/sim` is pure (no clock, no I/O); no tick
loop — lazy advance + scheduled events applied at `due_at`; content is
data; no game rules in the client (it extrapolates from rates); every
commit type-checks, lints, builds and passes its tests; docs change only
in the sync after a task unless the task says otherwise; nobody adds the
`ci` label but the owner.

## Decisions most relevant right now

- **D-065** (accepted, not built) ranked service chains faith / education /
  culture with a minimum rank per tier, security display group, market and
  warehouse with four tier-gated levels, guard and fire station without
  levels; **D-066** (accepted, not built) dev start state and snapshots via
  `make dev FIXTURE= | SNAPSHOT=` and dev routes — no client dev-state
  handling
- **D-064** palette re-tune to Anno 1404 daylight (built, #60): grade
  `#FFEBD4`, fill 0.42, `SKY_WARMTH` 0.25, teal sea, mid-green grass,
  neutral rock; names the V7 roof-per-tier and `brick` / `tile-dark` roles
- **D-062** Anno-sized footprints (Trading Post 6×6, chapel 3×5,
  civic 4×4/4×5/4×6, pier 6×9, depot 4×11 into the water), per-column `water_rows`,
  depots without levels, surgery at Patricians; **D-063** Old Coast =
  temperate Europe, theatre → playhouse, region-scoped palette roles
- **D-059** lumberjack plants tree plots, ship speeds 1.2/1.0/0.85,
  one fixture list + `played`; **D-060** civic services as needs
  (guard/fire/surgery), quay/pier/depot (crane deferred); **D-061**
  translation en/de (content locale files + client catalogue; UI.md §10)
- **D-058** island shapes: skeleton coasts, ridge mountains, rivers with
  bridges, visual-only terraces (no buildability lost), sea routing
- **D-057** procedural voxel art (supersedes D-050's kit-bash); Anno 1404
  daylight palette (D-064), real models at every zoom, device-validated perf stay.
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
   - **D-057 voxel restyle:** ~~V1 clean cut~~ (#38), ~~V3 tier 1–2
     recipes~~ (#40), ~~V2 lively world~~ (#41), ~~V3b/c flat export,
     shader jitter, cloth sway, quantised GLBs~~ (#42), ~~V4 tier 3~~
     (#43), ~~V5 tier 4 + ships~~ (#44) merged — the restyle is
     complete.
   - ~~**D-058 islands**~~ merged (#46: generator, atlas, terraces,
     rivers, bridges, sea routing, skerries); ~~Almanac~~ merged
     (#45); ~~D-059/D-060 content + sim~~ (#49), ~~D-060 models~~
     (#47) and ~~render polish part 1~~ (#48: massif noise, moorings
     incl. flank berths, one smoke draw, jitter on scaled decor, wake
     from the anchor, 90 k far mask cap) merged; ~~D-061
     translation pass~~ (#51) and ~~server tidy~~ (#50: idle-ship sea
     position, harvester rule removed) and ~~V6 part 1~~ (#52: work_area
     reads and tree thinning gone, idle ship after a Trading Post
     demolition, phone top bar wraps, stepped ghost plinth, villager/
     cart draw merges) merged; ~~D-062/D-063~~ merged (#53
     models, #54 content); depot 4×11 (#55) and the far budget
     by headroom with `farbudget.test.ts` (#56), the per-cell far outline and `desktop-xl` (#57), tile cache keyed on `GeneratorVersion` (#58) and the removal of the client-only fixtures (#59), the D-064
     palette (#60) and the CI fix (#61: tile-key test, `serviceIndex`
     3× faster `computeHouses`, 30 m timeout, `-short` in `make check`)
     merged; **next, in order: D-065** service chains + four-level market/
     warehouse + guard/fire without levels (level-4 market/warehouse reuse
     the level-3 models until V7), **D-066** `--fixture` / `--snapshot` dev
     start state with `make snapshot` export/load (client `?fixture=`
     removed), then the owner's **tier 2–4 playtest** and **V6 part 2**
     from its findings (second chains, market levels, services ladder, unlock
     toasts, quest chains, long house cards, brig/galleon at the piers)
     plus the open items: wheat / beach still a touch loud on the new grass, lite ship models (sloop/brig/galleon ≈ 300/600/800 tris; ships are 16 k at far on `played`), a tiles fixture for the far-budget guard, desktop top bar wrapping at 1280 px with six badges, chapel / Trading Post l2 back faces reading blue-grey, university re-fit (arcades, pilasters), per-model voxels-per-tile in the manifest,
     `wake_width` anchor, terracotta roof share in tier 3–4 quarters (D-063 §3), German
     read-through of island names and quest texts.
   - ~~Quantised GLB export~~ done (V3b/c, #42): 12.9 MB, ≈ 32
     bytes/triangle, limit 24 MiB unchanged.

## Known follow-ups

- **Decision candidates** (owner + design lead): unload amounts per
  route stop (touches D-015); a meaning for fields above `required`
  (D-051 part 4); ship and fisher-boat routing around islands.
- **Server tasks:** ~~snapshot interval, in-transit rate, unlock while
  away, upgrade availability~~ done (#39); the tier-4 replays take ~43 s
  each after #61's `serviceIndex` (skipped under `-short`; further wins:
  rates recomputed on every `settleRegimes` step, `BuildingByID` lookups
  in hot loops; `Generate` is the archipelago package's remaining
  ~120 s and is not to be touched without a `GeneratorVersion` bump);
  `preview_variant` hint for
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
  VOLUMES=1 && make up`); 7→8 migrates (ship names). D-061 added
  `players.language` to `0001_init.sql` (no migration): recreate the same way.
- **First frame** ≈ 200 ms cold / 115 ms warm on desktop (PR #30 notes):
  the world and content requests start only after the engine is set up
  (~117 ms); fetching them in parallel saves ≈ 35–40 ms — client
  follow-up. The unused `unsettled` palette role can be removed.

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge, `?fixture=<name>` dev fixtures: default, seafaring, town, settled, citizens, merchants, patricians, played — D-066 moves this to `make dev FIXTURE=`),
`make up` (Compose stack), `make check` (server `-short`; `make
server-test-full` for the tier-4 replays), `make assets` /
`make assets-check` (Python 3, no other tools), `make model-sheet RECIPE=`.

**Looking at the result:** `make shots` (12 PNGs: settled / played ×
near / mid / far × desktop / phone, fixed camera and clock, ≈ 4 min;
every server fixture via `FIXTURE=`, `DEVICE=desktop-xl` for a
2992×1700 window; `VIEW= ROTATION= ISLAND= ZOOM= HUD=0`,
`PRESET=<name>|all`; `HUD=0` also hides the grade and vignette overlays; the names are in `client/e2e/tools/shots-args.ts`,
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
  API or store code changed; `make server-test-full` before a PR that
  touches rates, needs or the scenario fixtures.
