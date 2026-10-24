# Settling and harbours (D-051 parts 1, 2, 3, 5) — working notes

Interpretations, deviations and gaps of the direct implementation session.
The rules are in docs/DECISIONS.md D-051 and docs/MECHANICS.md §2, §5, §8,
§9.2–9.3, §10; where this file deviates, it says so.

## Operations

- **Fresh database required:** the world schema is now 4 and there is no
  migration from schema 1–3 (the game is not deployed). A stored world of an
  older schema fails to load with `schema_version` (logged, never reset).
  Run `make down VOLUMES=1 && make up` (i.e. `make up` on a fresh volume)
  after pulling this branch.

## Step 1 — content

- `trading_post` (renamed from the old `warehouse`, 4×4, `water_tiles: 2`)
  and the new inland `warehouse` (2×2, throughput only) are two capability
  blocks (`trading_post`, `warehouse`); both are *collectors* (`Collector()`
  in the catalogue). The content requires at least one building with a
  `trading_post` block.
- `water_tiles` rows are the **front rows**: at rotation 0 the top rows
  (smallest y), at 90 the rightmost columns, at 180 the bottom rows, at 270
  the leftmost columns — the side the models' jetties already faced (recipe
  −y). The water tiles must be terrain `water` and free; the other rows
  buildable land (`terrain` error). New error `not_on_water` (409).
  A water-edge building is not also `coastal` (content check); no shipped
  building is `coastal` any more, the rule stays for later coastal buildings.
- `islands.json: unlock`: there is no `islands.json` and no island gating in
  code or content on main (only the D-039 text); nothing to remove.
- Step boundaries: the content step had to carry the code that reads the new
  blocks (catalogue, loader, validation, API content payload, openapi,
  schema.d.ts), the water-edge placement rule, capacity from the Trading
  Post only, collectors (TP + Warehouses) and per-unit handling (the region
  constant was replaced in content), otherwise the commit would not build.
  Berths, the Trading Post command split, `last_trading_post` and the
  display additions follow in step 2.
- Schema 4 and the removal of the 1→2 and 2→3 migrations happen in step 1:
  the content rename makes stored worlds meaningless. The migration
  framework (`DecodeWith`, `Migrations`) stays with an empty registry; the
  old schema fixtures and the fields-shortfall logging are removed; new
  schema-4 fixtures come with the tests step.
- Test islands and scenarios were reshaped mechanically so that every
  Trading Post, fisher and shipyard keeps its position with its front rows
  on water (the 4×3 warehouse became the 4×4 Trading Post one row further
  toward the sea). Golden reports were regenerated; timings changed by the
  per-unit handling. The dev island got water notches for its seeded
  Trading Post, the north-coast fisher row, island 2's Trading Post and
  fisher, and two south-coast shipyard bays (shipyards there now face
  south, rotation 180).
- `bootstrap_citizens_quests`: two step-order tweaks to keep it running
  with per-unit handling (a house placed after the 5 min advance instead of
  before; a 2 min advance before the toolmaker, the final advance 2 min
  longer). The reference games are re-done in step 3.
- `route_loop` scenario: start wood 60 → 280 and loop steps 2:40 → 3:16 so
  the three loops keep a constant period with per-unit handling.
- Recipes: `trading_post` = KayKit `building_docks` pier over the water rows
  (on piles), a plank gangway, a stone quay and the old warehouse barn on the
  land rows, one mooring pile per berth; level 1 thatch, level 2
  stone/terracotta with lean-to and crane (visibly different), level 3 a
  pier crane, level 4 a flag mast. `warehouse` = the old barn recipe scaled
  onto 2×2 (levels 1–2 as before, level 3 adds a lean-to and a flag).
  Fisher and shipyard: yards cut to the land rows, jetties/slipway over the
  water rows. Water-edge buildings may reach below the ground band
  (`GROUND_RANGE_WATER_EDGE`, piles into the sea); `building_docks` pinned in
  `assets/kits/MANIFEST.json`.
- CONTENT.md: only table/balance rows changed (§7 building rows and level
  paragraph, §11 region constant rows); the `region.json` sample block of
  §11 still shows `ship_handling_seconds` (not a table row; docs sync).
- E2E specs are verified at the end of the session (step 6); the commits of
  steps 1–5 keep `make check` green but do not re-run Playwright.

## Step 2 — simulation

- **Berths** (`server/internal/sim/berths.go`): an arriving ship that
  handles cargo (a route ship at a matching stop, every ship ending a
  manual leg) joins the island's berth queue (`waiting_for_berth`); the
  queue head's grant is its `ship_arrived` due moment (no new event kind):
  at its arrival when a berth is free, else when the earliest held berth
  frees. FIFO by arrival time, then ship ID. The arrival effects
  (unload/load) apply at the grant; the berth is held for the handling time
  (base + per unit moved): a route ship until its departure, a ship ending
  a manual leg for its unloading (state `manual_leg` without a leg, then
  `idle`).
- Smallest consistent readings logged here: loading for a manual shipment
  happens at the ship's mooring when commanded and holds no berth (berths
  gate *arrivals*); an island without a Trading Post has no pier, so ships
  handle there at once (founding voyages, a route stop whose Trading Post
  was demolished); a route ship without a matching stop departs at once and
  never queues; a paused ship anchors at its grant and loses its place
  (resuming queues it again); `assign_ship` and the resume of an anchored
  route ship queue like an arrival.
- The berth count is stored on the Trading Post (`Building.Berths`, set at
  placement and upgrade from the content) so that `sim.DueEvents` and the
  scheduled-event plumbing need no catalogue.
- Commands now apply the due moments they create at the same instant
  (a berth granted to an assigned ship, a queue served after an upgrade).
- `upgrade_trading_post` (new command) upgrades the Trading Post;
  `upgrade_warehouse` only Warehouses. Placing a building with a
  `trading_post` block is rejected (`invalid_command`: founding only;
  `island_already_settled` when the island has one); seeding (`PlaceFree`)
  may place one per island. `last_warehouse` became `last_trading_post`.
- Route loop times (display) use the base handling per stop; the per-unit
  part depends on the goods moved and is not estimated.
- Display: Trading Post `berths {total, busy, ships[], queue[]}` (`ships`
  added: the holders, for the panel), ships `queued_at` and `berth_until`,
  islands `capacity_source {building_id, type, level, capacity}`; a ship's
  end of unloading is a `next_change_at`.
- The API command and the display/openapi additions needed by these sim
  changes went into this commit (the openapi tests require it); step 5
  adds the rest of the API (start at sea).
- `manual_shipment_excess` gained a final 20 s step (the unloading at the
  berth) and a 10 s longer return leg.

## Step 3 — start at sea

- A ship can be idle **at sea** (`Ship.AtSea`, archipelago tiles; display
  `position`). `sail_ship {ship_id, to_island_id}` (new sim and API
  command) sends an idle ship with its cargo from its island or its sea
  position to an island, departing at once (legs from the sea carry
  `from_position`). The arrival is a manual arrival: unloading at a berth on
  a settled island, everything stays aboard at an unsettled one. An at-sea
  ship can be assigned to a route (positioning leg from the sea).
- New worlds (`devworld.New`/`NewDev`, every player world) start with the
  start sloop at sea at (30, 48) — about a minute from both dev islands —
  carrying the starting planks/sails, the gold on the balance, nothing
  settled. Founding is the client's two-step flow (`sail_ship`, then
  `found_island` on arrival; step 6).
- **Content (balance) changes, before → after:** `start.json` gold
  800 → 1 000 and planks 130 → 150 (the starting stock now pays the Trading
  Post that used to be free: 1 000 − 200 = 800 gold and 150 − 15 = 135
  planks after founding); sloop slots 2 → 4 (the start ship must carry 150
  planks + 10 sails = 4 slots; a 2-slot sloop holds at most 100 units of
  two goods); Trading Post planks 20 → 15 (the bootstrap reference game
  needs ~0.5 planks more because founding now happens after the opening
  voyage, see below). The sails stay in the starting stock: the intro quest
  `intro_shipyard` now asks for a second sloop (`ship_count` 2), which they
  pay for.
- Quests: new first quest `intro_home_island` ("Choose your home island",
  `island_settled` 1, 25 gold); the rest of the chain follows unchanged
  except texts (Trading Post instead of warehouse), `intro_shipyard`
  (ship_count 1 → 2) and `intro_tools` (the `island: start` restriction is
  dropped — the home island is the player's choice; ten tools in any
  Trading Post).
- Scenario runner: `seed.ship {type?, x, y}` launches the start ship at
  sea; `seed.start` puts the starting goods aboard it, or — without a seed
  ship but with a seeded Trading Post — grants the starting stock minus the
  Trading Post's cost (the state right after founding, without the ship),
  which keeps the non-reference scenarios on their previous numbers. New
  step `sail_ship`.
- Reference games get the sail-and-found opening (`sail_ship`, a 1 min
  advance — the tests require advances of at least a minute — and
  `found_island` at the old seed site; the quest game also claims
  `intro_home_island`); the shipyard-built sloop is now ship 2. In
  `bootstrap_citizens` the first wait after founding is 1 min shorter
  (4 → 3 min) to absorb the voyage minute; with the Trading Post at 15
  planks the plan holds. The quest game keeps its 4 min (it has slack).
- **Timings, before (main) → after:**

  | Game | Island 2 | Citizens unlocked | First Citizen house | Tools home |
  |---|---|---|---|---|
  | `bootstrap_citizens` | 60 → 60 | 80 → 80 | 100 → 100 | 139 → 139 |
  | `bootstrap_citizens_quests` | 42 → 43 | 63 → 64 | 72 → 73 | 120 → 125 |
  | `bootstrap_settlers` | — | 110 → 111 | — | — |

  Trading Post load on the reference start island 772 ‰ (unchanged),
  `citizens_island_load` level 2 821 ‰ (unchanged).
- Dev fixtures: `seafaring` = the start state (at sea); `default` = the start
  island founded from the start ship at the standard site (Trading Post at
  (2, 0); history 1 min for the voyage); `town`/`settled` build on
  `default` (+1 min history). In `settled` the shipyard-built sloop is ship
  2 and the start sloop idles at the start island.
- Tests that build on a settled start island (API, integration, events)
  start from the `default` fixture; the multi-instance test founds its
  guests' worlds by replacing them with the fixture before the credits, and
  sends `sail_ship` as its push command.

## Step 4 — tests

- New goldens: `berth_queue` (two ships, one berth, per-unit handling; ends
  1 ms before the grant, so its display fixture shows the queue to the
  client), `berth_queue_served` (the grant and both unloadings),
  `collector_warehouse` (nearest collector by road with a Warehouse, its
  throttling and level-2 upgrade, capacity from the Trading Post only),
  `water_edge_placement` (all four rotations; `not_on_water`, `terrain`,
  `island_already_settled` failures leave the world unchanged),
  `start_at_sea` and `start_voyage` (start-at-sea founding; the voyage
  fixture is for the client). Each has Go assertions in
  `scenario/harbours_test.go`; `sim/berths_test.go` covers FIFO by ship ID,
  an upgrade granting at once, composition across the grant, a paused ship
  at its grant, the pier-less unsettled island and `sail_ship`.
- Scenario seed `ships: [{x, y, cargo}]` (test-only ships at sea with
  cargo) next to the start `ship`.
- Property tests: the ship worlds may hold a ship at sea with cargo and use
  `sail_ship`; new invariants (at-sea ships idle/anchored at no island,
  waiting ships without leg or berth, never more berth holders than berths,
  a queue only while every berth is busy, a held berth equals a route
  ship's departure) and a check that berth waits and ships at sea occur
  (berth waits are observed at the property checkpoints only, so the floor
  is propertyCases/20).
- Schema fixtures: `internal/sim/testdata/schema4_{bootstrap_citizens,
  berth_queue,start_voyage}.json`, written and compared by the scenario
  package's `TestSchemaFixtures` (`-update`), decoded/round-tripped/advanced
  by `sim.TestSchemaFixturesDecode` (the template for the next migration).
- The client's extrapolation test accepts a display fixture without samples
  (one that ends right before its next change).
