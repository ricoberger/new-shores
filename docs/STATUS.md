# New Shores — Status (read this first)

One page for anyone (human or agent) starting work. Updated with every
docs sync; details live in the linked documents. Last update: after #67 and the owner's playtest — D-069 (collector
reach, hub upkeep, population-only unlocks, pier / depot at Merchants)
and D-070 (route unload limits and keep-minimum) recorded; polish 5
(#68) and the D-069 / D-070 implementation (#69: collector reach,
hub upkeep, population-only unlocks, pier / depot at Merchants,
tier-gated Trading Post levels, route unload limits and keep, deposit
markers, move tool) and #70 (D-071 planning mode: planned buildings,
roads and fields built by hand, gold radius rings, Demolish rectangle
for roads), #71 and #72 (D-072: Anno 117 island sizes, rim massifs,
2-tile rivers with raised bridges, Anno 117 service radii and reach,
content 0.19.0, camera cap 80, usable deposit slots), #73 (polish 6,
D-073 no resource rocks) and #74 (D-074: houses fill with
satisfaction, residents stay on upgrade, smaller collectors, start
2 000 gold / 100 planks, 48 tree plots, lone windmill, content 0.20.0;
polish 7) and #75 (D-075: ships never cross land, low shore for
piers, collectors 10/20/40/80 · 8/16/32/64, `look` field, cog / hulk /
carrack, supply chains pause last, content 0.21.0; polish 8) merged;
next the `look` re-dress art session and the owner's third playtest.

## What exists

| Area | State | Where |
|---|---|---|
| Simulation (pure Go, lazy, deterministic) | tiers 1–4 complete: production, logistics via collectors (Trading Post + Warehouses), needs/categories, workforce, taxes, insolvency with trial resume, fields by adjacency chains, ships/routes, start at sea + founding, berth queues, quests, away summary, seeded archipelago generator with reroll and rename, batch field placement, terrain table, ship names, weighted need shares with cumulative tiers and a services category, building levels (`upgrade_building`), recipe input alternatives, upgrade gate ≥ 0.6, founding cargo exempt from slots, berths spaced by ship length, tier 3–4 deposits (one gold slot per archipelago), shared fields (`farm` list), `ship_count.type` quests, D-058 skeleton islands with terrace levels, islets, cliffs and skerries, sea routing on a 4-tile grid (`path` per leg, routed founding voyage); D-072 Anno 117 sizes (large 250 / medium 165 / small 110 extents, buildable ≈ 32 k / 14 k / 6 k, archipelago ≈ 185 k), 2–4 rim massifs with heights to 6 (`shape.massifs`), rivers 2 tiles wide (3 at the mouth); D-069 collector reach (Euclidean per level, building footprint only, `no_collector_in_reach` stall), per-level hub upkeep, population-only unlocks, tier-gated Trading Post and warehouse levels; D-070 route `unload[].max_amount` / `load[].keep`; D-071 plans (planned buildings, roads and fields reserved but invisible to the sim, `build_plan`, `demolish_roads`); schema 15 | `server/internal/sim`, MECHANICS.md |
| Content | `old_coast` 0.21.0: D-054 footprints/costs/fields, D-056 need model (shares 1.0 lone / 0.6, cumulative lower-tier rates; D-074 house target = floor + (max − floor) × satisfaction, no growth threshold, residents kept on upgrade, upgrade at the target), D-065 ranked service chains (faith chapel/church/cathedral, education school/university, culture tavern/playhouse; minimum rank per tier) with `goods` / `public` display groups, tiers 1–4 complete with two alternatives per category from tier 2 (Citizens bread/cheese, cider/mead, linen/leather_jerkins; Merchants sausages/pies, beer/brandy, coats/dyed_garments, books/soap; Patricians roast_beef/oysters, wine/grain_spirit, fine_garments/lace, candles/spectacles, jewellery/instruments), salt / bricks / coal / glass, 100 buildings, market and warehouse with four tier-gated levels (own models per level since #66), civic needs safety/fire protection (Merchants) and health (Patricians) with one radius each, lumberjack with tree plots, quay (Citizens) / trading pier 6×9 and depot (Merchants, D-069), playhouse (theatre retired), Anno-sized footprints with per-column `water_rows` (D-062/D-063), islands 192/112/64/16 + `scenic` skerries (spacing 50/120, straits ≥ 24, void ≤ 150) with iron/clay/salt/coal/quartz/copper/gold deposits, `smoke`/`boat` flags, sloop 1.2 (2 slots) / brig 1.0 / galleon 0.85, 12 intro + 5 + 6 + 6 tier quests; reference games generated from plans (D-067, `server/testdata/plans`, `replay-plan`): 50/25/71/124 · 21/38 · 215/250/387 · 721/868/1180 on the D-072 archipelago with D-074/D-075 (TP throughput 10/20/40/80, reach 24/28/32/36, upkeep 0/6/12/24; warehouse 8/16/32/64, reach 18/21/24/27, upkeep 1/5/10/20; start 2 000 gold + 100 planks; lumberjack 48 plots; mill 3×3; water-edge buildings need level-0 land; ships cog / hulk / carrack; auto-pause guards the last producer of every good houses consume and its input chain, dropped for cut-off inputs; market radius 20/24/28/32, upkeep 0/10/20/30; D-072 service radii chapel 16, church 28, cathedral 50, tavern 20, playhouse 38, school 20, university 46, guard 26, fire 22, surgery 28; unlocks 120 Settlers / 360 Citizens / 1 200 Merchants; camera cap 80) | `content/old_coast`, CONTENT.md |
| Server | Go + PostgreSQL + Redis; accounts (guest/email), sessions, CSRF, scheduled-events worker, WebSocket push, dev mode with in-memory store, `--fixture` / `--snapshot` start state, `GET/POST /api/v1/dev/snapshot` and `POST /api/v1/dev/reset` (tooling routes, D-066) | `server/internal/*`, ARCHITECTURE.md |
| Client | Vite/React/Babylon; one continuous world with LOD (full models near/mid, lite far), free camera + compass, HUD with island resources and workforce, start-at-sea flow, harbour panels, touch layouts, PWA; `make shots` / `make model-sheet` for looking at the result (no e2e/visual/perf suites, D-052); **Almanac** — public reference at `/almanac` (tiers, buildings, goods with chain trees, needs, ships, quests, islands) generated from the served content, UI.md §9; terraced voxel terrain with rivers, bridges, cliffs, crags and skerries, route ribbons and ship legs along the routed paths (D-058); goods shown in tonnes (`t`, `t/min`), currency as the word gold; build menu with tier tabs (locked tiers show their unlock conditions) and cards grouped General / Production (chain order) / Public / Harbour with icon costs (unaffordable parts red) and in → out lines; placement ghosts tint the buildings they would link with (display hint, server `served_by` / `assigned_warehouse_id` once built); producers ↔ collector selection tint (#65); polish 5 (#68): market under Public, road drag ghost, plain road surfaces, paved roads replace dirt roads in place (sim rule, 50 % refund), deposit tiles tinted + far-label icon while a mine / quarry tool is active, house and hub upgrade cost lines in build-menu format, one cart with a driver per producer, cows / pigs in pastures and pens (`life_cow`, `life_pig`), terrace fill in the footprint's ground colour, **US English** source with a spelling test (`i18n/spelling.test.ts`; keys and content IDs keep their spelling); D-069 / D-070 (#69): exact ghost tint by reach, gold reach ring on the selected collector and its ghost, reach / upkeep on cards and in the almanac, lock reason on hub upgrades, route editor `keep` / `max` fields, almanac Routes chapter, deposit marker badges, **move tool** in the build bar, terrace fill walls in earth tone | `client/`, UI.md |
| Art | **Procedural voxels (D-057; V1–V5 merged):** Python voxel recipes at 8 voxels/tile on the parts library v2 (`assets/voxel`, standard library only), greedy quads + baked AO/sun, lite = 2 voxels/tile, shader colour jitter; lively world — blended ground, stepped pixel coast with foam, rock bands, voxel roads, dense swaying decor, voxel smoke, sized construction stages, wakes, fixed warm daylight (D-064 palette v2: mid-green grass, neutral grey rock, teal sea, grey-blue shadows), voxel minimap; **all 93 buildings, fields and modules of tiers 1–4 and the three ships at target detail** (3 house variants per tier, flat colours + shader jitter, cloth sway groups, no placeholders); quantised GLBs (KHR_mesh_quantization); far at the cap 154 k tris (D-048 holds), dense mid 1.41 M, no pan frame > 50 ms; palette v3 (`brick` `#7E4A3C` as an accent, `tile-dark`, orange terracotta), per-model voxels per tile (8 / 12 / 16), lite ships, `wake_width`; **V7 rework (#66, D-068):** ground cover is texture — yards declared by the recipe (`ground` map in the manifest) and painted into the ground texture with fields, roads flush, no plates or proud plinths; every building rebuilt at 12 voxels/tile after the Anno 1404 renders in the tier vocabulary (T1 dark boards + weathered thatch, T2 rubble + half-timber + terracotta, T3 tile-dark, T4 ashlar + slate), market and warehouse with four real levels, Trading Post four levels with timber → stone pier, tree plots are forest trees, shared tier kit (`parts_v7`, `parts_kit`: `K.workshop` with five massings a–e, mine strip, signature props a tile in size); still 8 voxels/tile: playhouse, university, cathedral, shipyard, depot, trading pier, oyster beds, fields; models folder 23.53 MiB of 24 MiB; far played 16 / 223 k at cap 80 | `assets/`, ART_DIRECTION.md |
| CI | label-gated (`ci`): server (fmt/vet/lint/test, 30 m timeout, full suite), client (lint/typecheck/Vitest/build/assets-check), integration (Postgres + Redis); locally `make check` runs the server tests with `-short` (the tier-4 replays are skipped), `make server-test-full` the CI suite | `.github/workflows/ci.yaml` |

## Binding rules in one breath

Server owns the truth; `internal/sim` is pure (no clock, no I/O); no tick
loop — lazy advance + scheduled events applied at `due_at`; content is
data; no game rules in the client (it extrapolates from rates); every
commit type-checks, lints, builds and passes its tests; docs change only
in the sync after a task unless the task says otherwise; nobody adds the
`ci` label but the owner.

## Decisions most relevant right now

- **D-065** (built, #63) ranked service chains faith / education /
  culture with a minimum rank per tier, needs shown under Goods / Public
  buildings, market and warehouse with four tier-gated levels, guard and
  fire station without levels; **D-067** (built, #63) reference games are
  generated from plans — edit `server/testdata/plans/*.plan.json`, run
  `go run ./cmd/replay-plan`, never the scenario JSON; **D-066** (built,
  #62) dev start state and snapshots via `make dev FIXTURE= | SNAPSHOT=`,
  `make snapshot` / `snapshot-load` — the client has no dev-state handling
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
     merged; ~~D-066 dev snapshots~~ (#62) and ~~D-065 service chains +
     D-067 plan-generated replays~~ (#63: `server/internal/sim/scenario/plan`,
     `cmd/replay-plan`, `internal/layout`, pig farms 11–14 moved to island 6)
     merged; ~~V7.0 pipeline + known render/UI items~~ (#64: per-model
     `voxels_per_tile`, palette v3 with `brick` / `tile-dark` and the
     orange terracotta, lite ships 236/448/544 tris, `wake_width`,
     largest-island far-budget fixture (seed 16, 23 691 land tiles; the
     home island of seed 31 since #72),
     `InitialCamera` removed, one-line top bar ≥ 1200 px, unlock toasts,
     quest chains, almanac presets, dashed draft route, German
     proofreading) merged; ~~polish 4~~ (#65: tonnes, "gold", tier-tab
     build menu, ghost link tint) merged; ~~V7 model rework~~ (#66:
     D-068 ground paint, flush roads, 83 models after the Anno 1404
     references, tier kit, workshop massings, wheat field toned down)
     merged; ~~art leftovers~~ (#67: smelter outbuildings, cattle farm,
     lace / optician props, mill sails, standing crops, grove jitter
     ±1, `woad` role; folder 23.53 MiB) merged; playtest done →
     ~~polish 5~~ (#68: market under Public, road ghost, plain road
     surfaces, paved replaces dirt, deposit highlight, upgrade cost
     lines, cart with driver, animals in pens, terrace fill, US
     English) merged; ~~D-069 / D-070~~ (#69) merged; ~~D-071 planning
     mode~~ (#70: plans via `planned: true`, `build_plan`,
     `demolish_roads`, gold radius rings, move picks the farm from a
     field, schema 15) merged; ~~D-072 part 1~~ (#71: Anno 117 island
     areas, rim massifs, 2-tile rivers, radii / reach / costs, content
     0.19.0, cap 80, plans replayed, far 13 / 198 k) and ~~D-072 part
     2~~ (#72: deposit slots reserve a usable footprint, cap-80
     framing, `/world` + `/content` before the engine, raised bridges,
     almanac massifs; far 14 / 205 k) and ~~polish 6~~ (#73: sea-route
     grid cached — `GET /world` p50 10.1 → 7.5 ms, resource rocks
     removed and skerries 5–18 tiles × 6–12 (D-073), river banks never
     below the river, Coast input chip, Market "Supplies goods" line,
     solid routed draft legs, toast click → build menu, `?stats=1`
     model density, far road line across rivers, no plate under a
     selected plan) merged → **next: owner playtest on the D-072 world
     → polish 7** (balance pass on radii / upkeep / thin tier-1/2 gold
     margin — hub level-1 upkeep had to stay 0 / 1 for the plans to
     pass — plus the playtest findings); playtest 1 (Citizens) →
     ~~D-074 + polish 7~~ (#74: houses fill with satisfaction, residents
     stay on upgrade, upgrade at the target, collectors 8/16/32/64 ·
     6/12/24/48, start 2 000 gold / 100 planks, 48 tree plots, lone 3×3
     windmill, one deposit marker per slot, stale selection frame after
     upgrade fixed, mesh-first picking, gold outline on the placing
     ghost, two-line phone top bar; content 0.20.0) merged; playtest 2
     (Merchants) → **D-075** (low shore for piers, collectors
     10/20/40/80 · 8/16/32/64 with upkeep 0/6/12/24 · 1/5/10/20, `look`
     follows the workers, ships cog / hulk / carrack with new models,
     supply chains pause last) → ~~D-075 + polish 8~~ (#75: lagoon
     harbours beyond `approachReach` routed, property test over seeds
     1–50; `needs_low_shore`; content 0.21.0 with `look` and cog /
     hulk / carrack + new models; transitive supply guard, dropped and
     skipped for cut-off inputs; TP card scrolls in its box; empty
     ships may sail; "Maintenance" / "Betriebskosten" wording) merged →
     **D-076** (regions in one world: separate archipelagos, passages,
     global goods, Kontor at Patricians as the gate; shape built now
     with one region) and **D-077** (gold ornaments, military with a
     dormant `defence`, repair crane, shore placement, three Patrician
     warships + patrol, supporter subscription instead of Doubloons,
     models 32 MiB, harbour basins: shallows 8 + connected quays) → **next: D-076 structural session**, then the
     D-077 content + sim + client session and its model session, the `look` re-dress art session (12–15
     tier-3/4 production models, D-075 §3), then playtest 3 with
     screenshots;
     later group move (D-074 §5), forest 48 → 64 if woods still feel
     thin; tooling: shot presets `info-panel` and `service-card` time
     out on the played fixture;
     the Patricians plan regenerates in ≈ 22 min (test timeout 30 min —
     speed up the generator or split the test). Open small items — art:
     playhouse / university / cathedral / shipyard / depot / trading
     pier still at 8 voxels/tile (folder room: 0.47 MiB — needs a
     variant dropped or harder quantisation), beach a touch loud,
     terracotta share check in tier 3–4 quarters (D-063 §3), field
     crops vary per voxel only; generator: one dead rock draw kept in
     the island plan so seeds stay byte-identical (remove with the next
     plan replay).
     ~~Long house cards, size row, population popup wrap, berth queue,
     producer list cap, top-tier upgrade button~~ fixed in #65.
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
- **First frame**: the world and content requests start before the
  engine is set up since #72 (+5–9 % against pre-D-072 on the larger
  islands). The unused `unsettled` palette role can be removed.

## How to run

`make dev` (local), `make dev HOST=<lan-ip>` / `make preview HOST=<lan-ip>`
(phone over LAN, `?stats=1` fps badge), `make dev FIXTURE=<name>` (default, seafaring, town, settled, citizens, merchants, patricians, played) or `SNAPSHOT=<file> [RESUME=now]`, `make snapshot [OUT=]` / `make snapshot-load FILE=` against the running dev server,
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
