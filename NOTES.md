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
