# New Shores — Mechanics

Status: **Agreed rules.** This document is the authoritative specification for
the simulation (`server/internal/sim`). Every rule must be expressible as rates,
capacities and timed events so that `advance(world, toTime)` is a pure,
deterministic function (D-002). Numbers marked *provisional* are balancing
values that live in content data and will be tuned.

## 1. Time and evaluation model

### 1.1 Lazy advancement

- A world stores `last_evaluated_at`. Any read or command first advances the
  world to the target time; a scheduled event advances it to the event's
  `due_at` (never beyond) before applying the event (D-026).
- `advance` is a **piecewise-constant-rate** simulation:
  1. compute all current rates (production, consumption, transfer, taxes,
     upkeep, growth) from the current state;
  2. find the earliest **boundary** — a buffer becomes empty/full, a stock
     runs empty or reaches capacity, a transfer stream starts or ends, a
     house gains or loses a resident, gold would cross zero or reach a
     resume reserve, a ship is built or arrives (§1.3), a quest's stock
     objective is first met, or `toTime`;
  3. advance all quantities linearly to that boundary; apply the boundary's
     discrete effect; repeat.
- **Cycle completions are not boundaries** (fluid model): a producer's cycle
  only drives the displayed progress bar; goods flow continuously at the
  cycle's average rate.
- **Regimes instead of stop/resume flapping.** A good is in the *full*
  regime when `stock + in_transit` can no longer absorb one millisecond of
  net growth; its producers are then limited to the good's consumption rate
  (zero without consumers). A good is in the *starved* regime when its stock
  can no longer cover one millisecond of net drain; its consumers then share
  the arrival rate in proportion to demand. Regimes are explicit state that
  changes only at boundaries (or is cleared by a command), which is what
  makes `advance` exactly composable. Rounding limited rates down lets the
  committed stock drift a few milli-units below capacity, never above.
- Iteration cap: if more than `iteration_cap` boundaries (content, provisional
  10 000) occur in one advancement, the rest runs in coarse steps
  (`coarse_step_seconds`, provisional 60 s) with rates recomputed per step;
  consumption is scaled to what is available and arrivals above capacity
  are clamped and counted as `lost`. Composition is not guaranteed in coarse
  mode. Warehouse caps make this path rare (a 12 h gap of a full economy is
  a handful of boundaries).
- **Units.** Stored quantities are fixed-point integers: goods in
  milli-units, gold in milli-gold, durations in milliseconds, timestamps in
  UTC truncated to milliseconds. Internally goods are accounted in
  sub-milli units (`SubPerMilli = 360 000 000`, chosen so every cycle that
  divides 360 s and every collector throughput is an exact integer flow per
  millisecond); conservation holds exactly at that scale. Display rounds
  half-up to milli-units; rates are shown per minute (floor). Content
  decimals allow at most 3 places (weights 6) and no exponent notation.

### 1.2 Determinism

- No wall-clock access, no randomness inside `advance`. Randomness (expedition
  results, island generation) happens in event handlers with a seeded RNG
  whose state is stored in the world.
- Identical `(state, toTime)` must yield identical results on every instance.
  Golden fixtures enforce this in CI.

### 1.3 Scheduled events

Events with a due time that must fire even if no one looks at the world:

| Event | Worlds touched | Effect |
|---|---|---|
| `ship_arrived` | 1 | load/unload at stop, schedule next leg |
| `ship_built` | 1 | ship appears at shipyard |
| `expedition_done` | 1 | roll result, add neighbour/bonus |
| `trade_shipment_arrived` | 2 | transfer escrowed goods, schedule return |
| `gift_arrived` | 2 | credit goods |
| `contract_expired` | 1 | close contract |
| `raid_arrived` (future) | 2 | resolve formula |

An event handler locks all involved worlds (ascending ID), advances each to
`due_at`, applies, schedules follow-ups and marks the event done in the same
transaction.

**Due moments are boundaries (D-045).** For effects that belong to a
single world (ship built, ship arrived), the simulation itself knows the
due moment and applies the effect as a boundary of `advance` at exactly
that millisecond. The scheduled event exists to make the world advance on
time while its player is offline, to push, and to schedule follow-ups; its
handler is a no-op when the effect has already been applied. A request
capped at a pending event's `due_at` (D-043) therefore applies the effect
itself and the worker only reconciles follow-ups. Invariant: after every
committed update or processed event, each due moment the simulation
reports has exactly one pending event (reconciled inside the same
transaction). Cross-world effects (trades, gifts, raids) are applied by
handlers only.

## 2. Map and placement

- Islands are flat tile grids (provisional 64×64 to 128×128). Tiles have a
  terrain type (water, coast, grass, meadow, forest, mountain). An island has
  island-wide **fertility** tags (e.g. `wheat`, `hemp`, `grapes`) and a fixed
  set of typed **deposit slots** (stone, iron, clay, salt, quartz, copper,
  gold, coal) placed on mountain tiles. Deposits are infinite; scarcity comes
  from the number of slots (D-036). Mines and quarries occupy exactly one slot
  of their type.
- **Harbour area**: coast tiles are a finite slot resource; coastal buildings
  (warehouse, fisher, shipyard, salt pans, oyster beds, harbourmaster) compete
  for them (D-036).
- Buildings have a rectangular footprint `[width, height]` at rotation 0 and
  a rotation (0/90/180/270; 90/270 swap width and height). Placement anchor
  `(X, Y)` is the top-left tile of the rotated footprint. There is **no
  entrance tile** (D-042): a building is *road-adjacent* when any road tile
  is 4-adjacent to any of its footprint tiles. Rotation is visual only.
- **Placement never requires a road** (D-042). A building placed without a
  road is simply unconnected (status `not_connected`, §3) until a road
  path to a warehouse reaches it. An unconnected house keeps its residents
  (they still count for population and the island's workforce pool) but
  receives no goods and no public-building fulfilment, pays no tax and
  declines to its floor (§6).
- Buildable terrain: `coast`, `grass`, `forest`; `water` and `mountain`
  never — except that a building with `requires_deposit` may cover
  mountain tiles, since deposits sit on mountains (D-036). Its footprint
  must cover at least one tile with that deposit (`no_deposit`). Roads
  never go on mountains, so the generator places deposits such that every
  possible mine footprint touches buildable ground (tested for the dev
  archipelago); a mine with no buildable neighbour would be placeable but
  never connectable. Every slot admits its building next to every other:
  the generator reserves per slot a footprint of its largest deposit
  building on mountain tiles with a buildable neighbour, pairwise
  disjoint, slots ≥ 16 tiles apart (D-072 part 2; `Verify` checks it).
- **Fertility** is an island-wide tag list (`Island.Fertilities`). A farm
  whose `work_area.fertility` is set can only be placed on an island
  carrying that tag (`no_fertility`; the error lists the island's tags).
- **Water-edge buildings** (D-062, superseding D-051's fixed rows)
  declare `water_rows: {min, max}`. Independently in **each footprint
  column**, the first k tiles from the front are sea water, with
  `min ≤ k ≤ max`; every remaining tile is buildable land. Water after
  an intervening land tile is invalid. The front is the top row at 0°,
  right at 90°, bottom at 180°, left at 270°; rotation swaps the footprint
  but never the authored width/depth or bounds. Both bounds are required,
  `0 ≤ min ≤ max < depth`. River tiles never count as sea water.
  Quays count as land, terminate the water prefix, and are replaced without
  refund when covered by a valid land part (§3); required water cannot
  carry quay. Values: Trading Post 1–2, fisher/salt pans 2–3,
  oyster beds 3–4 rows (shipyard, trading pier and depot have the shore
  placement since D-077, below).
  A zero minimum permits an all-land footprint. Other coastal buildings
  still need a coast tile (quay counts). Harbour points remain two tiles
  off the **front row**, not the variable water/land boundary (§9).
  Error codes stay `not_on_water`, `terrain` and `occupied`.
- **Shore placement** (D-077 §5, `placement: shore`: trading pier,
  depot, shipyard, repair crane, harbour tower, harbour statue, Kontor).
  Every footprint tile is free sea water (shallows included, never
  river) or free buildable land at terrace level 0 or a quay (replaced
  without refund, as for water-edge buildings); `terrain`, `occupied`
  and `needs_low_shore` as above. At least one tile is water
  (`shore_needs_water`). The **back edge** — the side opposite the
  front (bottom row at 0°, left column at 90°, top row at 180°, right
  column at 270°) — touches land or quay along its full length: for
  every back-row tile, the tile itself or the tile behind it is the
  island's own land or a quay (`shore_back_edge`). So a shore building
  stands on the beach (straddling the water line, any mix of water and
  land per column) or fully on the water against a quay. No footprint
  tile may lie on a **harbour lane** (below, `harbour_lane`), on a
  trading pier's **berth tiles** (the water tiles of the columns beside
  its two flanks) or on a harbour point (`harbour_blocked`). For ships
  the whole footprint is **land** (sea grid, harbour points, open-sea
  checks; the API's cached sea grid is keyed on the shore buildings);
  plans are not. The rule holds for `place_building`, plans (placing,
  moving, building) and `move_building`. The archipelago generator
  keeps verifying the stricter D-062 shipyard site (8 × 12 with 3–4
  water rows), which is always a valid shore site on a fresh island,
  so seeds are unchanged.
- **Harbour lane** (D-078 §1, `lane.go`): every **berth holder** —
  a building with `harbour_lane` in the content: the Trading Post,
  trading pier, depot, shipyard, repair crane and Kontor — built or
  planned owns a lane in front of its water edge (the front row of its
  water rows or of its shore placement, rotation-aware): its
  footprint's width **plus one tile on each side**, **four rows** deep,
  every tile of that rectangle on the island (water or land). Neither
  a **quay** tile (§3), nor a footprint tile of a **shore building**,
  nor a **paint-family** tile (§3) may lie on another building's lane
  (`harbour_lane`); symmetrically a berth holder may not be placed,
  planned or moved so that its own lane covers a quay (built or
  planned), a shore building or a paint tile. A building never blocks
  itself (a moved holder ignores its old lane). Other buildings (land
  buildings, fishers, salt pans) are not bound by lanes. The check runs
  after the site rules (`terrain`, `occupied`, water rows, shore rules)
  and before the open-harbour check (`harbour_blocked`, §3), which stays
  in addition; for quays after the shallows and occupancy checks. It
  holds for `place_building`, `place_road` (quays), `place_paint`, plans
  (placing, moving, building) and `move_building`; `found_island` is
  unaffected (an unsettled island has no quays). The archipelago
  generator and the reference plans are unaffected; the dev fixtures
  choose their quay and shore sites through the same rule.
- **Low shore** (D-075 §1): every land tile of a water-edge building
  (any `water_rows`) or a shore building is at
  terrace level 0 (§10), else `needs_low_shore`; cliffs are not pier
  coasts. Quay tiles are shallows and need no level. The rule holds for
  `place_building`, plans (placing, moving and building them), `move_building`,
  `found_island` and the site of `sail_ship`; it is checked after the
  water rows (`not_on_water`, `terrain`, `occupied` come first) and
  before the coast and deposit rules. The archipelago generator is
  unchanged: its island check (two disjoint Trading Post sites, a
  shipyard site) runs the same placement check, so every generated
  island still has low-shore sites.
- **Work area** = a fertility tag only (`work_area.fertility`, above); there
  is no work radius or terrain rule. The efficiency of a building comes
  from its fields:
  - **Farms** (D-049, D-051) have **fields**: placeables of the farm's
    `fields.type` — crops (`wheat_field`, `hemp_field`, `orchard_plot`,
    `meadow`, later hop/woad/vineyard) and the lumberjack's
    **`tree_plot`** (D-059) are **1×1**, animal **pastures**
    (sheep, dairy, cattle) and **pig pens** are **2×2**. Exactly one
    field type per farm type (`field.farm`), never shared. A field costs
    a little (D-054: wheat 3, hemp 2, orchard 1 gold per tile; a 3×3
    pasture 15 gold + 1 plank), has no upkeep, needs no road, is never
    auto-paused and is placed **from the farm's panel only**
    (`place_fields {farm_id, tiles[]}` — ≤ 512 tiles, every tile
    validated with the rules below, the valid ones applied atomically in
    one state change, per-tile `{x, y, ok, reason}` in the response, 200
    with every tile `ok: false` and an unchanged version when none is
    valid; `place_field` is the one-tile alias; `demolish_fields`
    likewise; `place_building` rejects field types with
    `field_needs_farm`). A field **belongs to
    the farm instance it was placed from** (`farm_id`). It is valid where
    its footprint is on matching terrain (and the island has the
    fertility), free, below the farm's `fields.max`
    (`field_max_reached`), and **shares at least one tile edge with the
    farm's footprint or with an *active* field of that farm**
    (`field_not_adjacent`; corner contact does not count). A field is
    **active** when the chain of edge-adjacent fields of its farm reaches
    the farm footprint (flood fill per farm; a chain never passes through
    an inactive or foreign field). Inactive fields count nothing and show
    `not_adjacent` ("Not connected to its farm"); they are not deleted and
    become active again when the chain is rebuilt. Farm `efficiency =
    min(1, active / required)`; `required` = `max` (D-051/D-054):
    wheat 140, hemp 60, orchard 160 one-tile fields, 3 pastures of 3×3
    (planned: 5 pig pens 3×4, 5 cattle pastures 4×7, 100 meadow tiles,
    CONTENT §7). A farm may stand with
    zero fields (`low_efficiency`, "n / required"). Fields **cannot be
    moved** (demolish and place again); moving the farm keeps its fields
    (they may become inactive); demolishing the farm demolishes its fields
    with one refund each (D-043).
  - Assignment and efficiency are recomputed for every work-area building
    after each placement, move, demolition or road change; they may drop
    for an existing building.
- Placement validity is computed in the simulation, never from mesh collision.
  A failed command leaves the world byte-identical.
- **Move** (D-042): any building except roads can be moved to another valid
  position on the same island, free of charge. The building keeps its ID
  and all state (residents, growth accumulator, cycle progress, pause state
  and reason, buffer); goods in transit keep arriving at the island
  inventory; work-area efficiency, warehouse assignment, transfer delay and
  building-need coverage are recomputed as after any placement. A warehouse
  may be moved only to a position where it stays coastal. Moving is one
  command and is atomic (the old footprint is free for the new one, so a
  one-tile shift is valid).
- **Group move** (D-074 §5, `move_group`): everything whose footprint lies
  fully inside a tile rectangle — buildings, fields, paint tiles, plans,
  road and planned road tiles — moves by one offset, optionally turned
  about the rectangle (0/90/180/270° clockwise; paint tiles keep rotation
  0), in one command, all or nothing and free like a single move. Pieces
  only partly inside stay. Every piece is checked at its new site among
  the pieces that stay and the other moved ones (tiles the move vacates
  are free): road tiles first (terrain, overlap, shallows for quays,
  bridges), then buildings and plans in ID order (the full placement
  site check: terrain, overlap, water rows, low shore, shore rules,
  coast, deposit, fertility, gate walls; a field its terrain, overlap and
  fertility), the harbour lane (D-078 §1) for every moved piece, then an
  open harbour (D-060, D-077 §8) and connected quays. The first failure
  rejects the move with its rule's error, naming the piece
  (`error.building_id`, absent for a road tile). Buildings keep their IDs
  and state; fields keep their farm (a chain that no longer reaches it
  makes them inactive, as after any change); a building moved onto a quay
  replaces it. Coverage, efficiency and warehouse assignment are
  recomputed afterwards as after any placement; a move that leaves a
  house outside a service's radius is not refused.
- Demolition refunds 50 % of each material **rounded down to whole units**
  and no gold (D-019), into the island where the building stood, clamped to
  free capacity (the clamped part is `lost`). Goods the building had in
  transit are delivered immediately; an unconnected producer's buffer is
  lost. Demolishing a warehouse re-assigns its producers to the next nearest
  connected warehouse; if `stock + in_transit` of any good would exceed the
  remaining capacity, the command fails with `ErrSurplusLoss` unless the
  player explicitly accepts the loss (confirmation dialog), in which case
  stock is clamped and the excess counted as `lost`.
- **Planning (D-071).** A **plan** is a planned building, a planned
  field or a planned road tile, stored on the island apart from its
  buildings and roads (`Island.Plans`, `Island.PlannedRoads`; plan IDs
  come from the building ID sequence). Plans are made with the normal
  placement commands and a flag — `place_building`, `place_road`,
  `place_fields` / `place_field` with **`planned: true`** — and are
  validated with every placement rule of the command (bounds, terrain,
  occupancy, water rows, coast, deposit, fertility, harbour, bridges,
  shallows, the field rules) **except the tier lock and the cost**;
  nothing is charged. Trading Posts (founding), houses above the first
  tier (`upgrade_only`) and hub levels cannot be planned; the island
  must be settled. A planned road tile goes only on a free tile (it
  never replaces a road). Fields painted on a planned farm are always
  planned; a planned field is validated against the island with its
  plans built, so it chains through the farm's planned fields; a field
  maximum counts the farm's fields and planned fields.
  - **Reservation:** a plan's footprint (water rows included) and a
    planned road tile are occupied for every other placement, move and
    field check (`occupied`). The one exception: a road placed over
    planned road tiles **replaces** them (one transaction, the road's
    normal cost).
  - **Invisible to the sim:** a plan has no cost, upkeep, workforce,
    production, service, reach or road connection; it is not a
    building or a road for any rule, quest, unlock or summary, and no
    plan command changes derived state or schedules an event. A world
    with plans advances exactly like the same world without them
    (tested).
  - **Build** is manual only: `build_plan {island_id, building_id}`
    places a planned building with the normal placement at that
    instant (tier, settlement, site, cost; typed errors, e.g.
    `tier_locked`, `insufficient_gold`) under a new building ID; a
    **planned farm is built together with its planned fields** — one
    transaction, the farm's and the fields' cost; a field that cannot be
    afforded fails the whole command, a planned field whose site is no
    longer valid (the farm was moved away from it, the maximum reached)
    stays planned for the new farm. `building_id` of a planned field
    builds its farm's plan (or, for a real farm, its planned fields);
    the ID of a **real farm** builds its planned fields (the fields
    built from the farm card). `build_plan {island_id, x, y}` builds
    the **planned road segment** through that tile — the 4-connected
    planned road tiles of the tile's road type — with `place_road`
    (all or nothing, tier and cost). An ID or tile without a plan
    fails with `plan_not_found`.
  - **Move and demolish** a plan with the normal commands on its ID or
    tiles, free of charge: `move_building` on a planned building
    (placement rules without tier and cost; its own footprint counts as
    free, its planned fields stay), `demolish` (a planned farm goes with
    its planned fields), `demolish_road` and `demolish_roads` (planned
    tiles go for free in the same command as real ones, §3),
    `demolish_fields` (planned fields
    of the farm). Demolishing a **real farm** removes its planned
    fields; demolishing the last Trading Post (unsettling) removes the
    island's plans. There is no cap on plans and no automatic or batch
    build.
  - **Display:** the payload lists plans apart from buildings and roads
    — `plans` (planned buildings and fields, `planned: true`, a field
    with its `farm_id`) and `planned_roads` (segments) — each buildable
    unit with its `plan_cost`: the cost of `build_plan` now (a planned
    farm with its planned fields) and the first reason it would fail at
    the payload's instant (the error code), so the client computes no
    rule; a real farm with planned fields carries `planned_fields`
    (IDs and `plan_cost`).

## 3. Roads and connection (D-014)

- A building is **connected** if there is a road path from a road tile
  adjacent to its footprint to a road tile adjacent to a **collector's**
  (Trading Post or Warehouse) footprint on the same island (D-042). This is the single connectivity
  rule for producers, public buildings and houses alike; a house on a road
  stub that does not reach a warehouse is *not* connected. A planned
  road tile (D-071, §2) is never a road for this rule. Roads are tiles;
  dirt roads (tier 1), paved roads (tier 2, +speed) and quays (tier 2,
  D-060) are the types.
- **Replacing a road:** `place_road` on a tile that carries a land road
  of a **lower** type (an earlier tier: dirt under paved) replaces it in
  the same command: the old road's demolition refund (50 % of its
  materials, as for `demolish_road`) is added, the new road's cost is
  charged for every tile of the command, and the tile is a road at every
  instant (one transaction, no gap in connectivity or assignment). The
  cost check runs before the refund. A road of the same type or of a
  higher type on a tile, and any quay tile, stay `occupied`; the command
  fails as a whole. The road tool sends the tiles it can replace and
  skips the others (display hint, the server decides).
- **Demolishing roads in a rectangle:** `demolish_roads` (the Demolish
  tool's drag) removes every road and planned road tile among its tiles
  (at most 512) in one state change; tiles without one are skipped and
  reported (`no_road`), like the field batches (D-054). Each road tile
  refunds 50 % of its type's materials, rounded down **per tile** (a
  paved road's single stone refunds nothing), no gold; planned tiles go
  for free. The command touches no building or field (the tool removes
  fields and plans under the rectangle with their own commands).
- **Quays** (D-060) are roads on the island's **shallows**: water tiles
  of its grid, not river, within 8 tiles (Chebyshev, D-077 §8; was 3;
  `ShallowsReach` in `quay.go`, mirrored in the client) of its own land
  (any tile but water, river and islet; derived from the tiles, no
  generator field). A quay tile must be free (no road, no footprint —
  the water rows of water-edge buildings included). A quay is a road for
  connection and carts like any other; for a **water-edge or coastal
  building** it counts as coast: the building's land rows may stand on
  quay tiles, which it replaces (no refund), while its water rows need
  free water without quay. Other buildings never stand on a quay. A quay
  tile never lies on a **harbour lane** (§2, `harbour_lane`, D-078 §1),
  placed or planned. For
  ships a quay tile is **land** (sea grid, approach, harbour point,
  §9.1). Quay tiles, a shore building (§2), or a berth holder moved onto
  quay tiles must leave every harbour point of the island (Trading
  Post and trading piers; `HarbourAt`, which moves to the nearest water
  a ship reaches as quays cover it) a 4-connected way over water to the
  edge of the island's grid (`harbour_blocked`), placed or planned.
  **Harbour basins** (D-077 §8): quays are **connected** — every quay
  tile of a placement reaches the island's own land or the footprint of
  a built building over edge-adjacent quay tiles (a batch may connect
  itself; a diagonal touch does not count), else `quay_disconnected`.
  A planned quay may also rest on planned quays and plans (the plan
  view, D-071); a built one only on built ground. Demolishing road
  tiles (single or rectangle, plans included), a building or a plan, or
  moving a building, is rejected with `quay_would_float` when a quay
  tile that reached the land before would no longer (built quays over
  built ground, planned ones over the plan view); quays that floated
  before D-077 never block a change. Cost and speed are content
  (provisional 5 gold / 2 stone per tile, 0.6 s/tile like the paved
  road).
- **Paint families** (D-077 §2–§3; `paint_family` in the content, `paint.go`):
  the hedge, the garden wall, the city wall and the square are 1×1
  buildings painted tile by tile with the road tools. `place_paint` is a
  batch like `place_fields`: every tile is checked as a 1×1 placement
  (`occupied`, `terrain`, …) and charged cumulatively (a tile the gold or
  materials no longer cover is refused); the valid tiles are placed in
  one state change, with `planned` as plans (D-071, free, no tier lock).
  Each tile is its own building (cost per tile; `demolish_paint` removes
  the paint-family buildings and plans on its tiles with the usual
  refund, a plan for free; single tiles also go with `demolish`).
  Neighbouring tiles of one family join (display only: the client picks
  the piece). The square is a ground kind (`cobbles_fine`) with no model;
  it is not a road. No paint tile lies on a **harbour lane** (§2,
  `harbour_lane`, D-078 §1). Nothing else reads a paint family.
- **City wall and gate** (D-077 §3): a road may share a tile with a
  **road-crossing** paint family (the city wall, drawn as an arch) in
  either order — a road placed over the wall or the wall painted over a
  road (a land road; never a bridge or a quay) — and demolishing one
  leaves the other. A **gate** (`gate` in the content, the gatehouse)
  needs a city wall (built or planned) on the tile beside the middle of
  each of the two sides its passage does not cross (`gate_needs_wall`,
  checked when it is placed or moved; later wall demolition does not
  touch it), and a road may share the tiles of its centre line along the
  passage (north–south at rotation 0 and 180, east–west at 90 and 270),
  in either order. Every other building tile stays `occupied` for roads.
  Military buildings have a `defence` value nothing reads (raids, D-005).
- **Ornaments and dormant values** (D-077 §2–§4, §6): ornaments are
  ordinary buildings with no inputs, outputs, residents, need or
  maintenance (`upkeep_per_min: 0`, never paused); their gold price is
  the only effect. A military building's `defence`, a warship's `attack`
  and the repair crane's `repairs` are content only: nothing in the
  simulation reads them until raids and ship health come (D-005); the
  military buildings' maintenance is ordinary upkeep. Neither needs a
  road (`requires_road: false`), so none is "not connected".
- **Unique buildings** (D-076 §2, D-077 §4; `unique` in the content): a
  building with `unique: island` exists at most once per island, one
  with `unique: world` (the Kontor) once in the world; a building or a
  plan of the type counts, so placing (or planning) a second fails with
  `unique_building` (`ErrUniqueBuilding`); building the plan itself and
  moving the building never do.
- Each connected producer is **assigned** to the nearest collector whose
  reach covers it (§5, D-069) by road distance `d`: the number of road tiles on the shortest 4-connected road
  path between any road tile adjacent to the producer and any road tile
  adjacent to the collector, both ends included. Equal lengths prefer the
  lower summed per-tile time; equal collectors prefer the lowest ID.
  Assignment is recomputed when roads, buildings or collectors change
  (also a collector's upgrade: its reach grows). Only
  buildings with a recipe are assigned; collectors need no road themselves.
- **Transfer delay** per delivery: `transfer_base_seconds + Σ seconds_per_tile`
  over the path (content; provisional 10 s + 1 s/tile dirt, 0.6 s/tile
  paved), minimum 1 ms. The delay is a latency: output produced during
  `[t, t+dt)` arrives during `[t+delay, t+dt+delay)` at the same rate
  (stored as transit segments per building; segments keep arriving if the
  producer is paused or disconnected meanwhile).
- Unconnected producers **without inputs** fill a per-output buffer of
  `unconnected_buffer_units` (content, provisional 5), then stop and are
  flagged. Unconnected producers **with inputs** do not run at all (they
  cannot fetch inputs). When a buffered producer gets connected, the buffer
  leaves first through its normal output stream (subject to throughput, full
  and starvation rules) and is never lost.

## 4. Production

Each production building has a recipe:

```
inputs:  [{good, amount}]      consumed per cycle from the island inventory
outputs: [{good, amount}]      added to the inventory after transfer delay
cycle:   seconds               at 100 % efficiency
```

- **Rate** = `amount / cycle × efficiency × throughput_factor ×
  workforce_factor`, where efficiency comes from the fields (farms, the
  lumberjack's tree plots since D-059; 1000 for every other building),
  `throughput_factor` from the assigned warehouse (section 5) and
  `workforce_factor` from the island's workforce pool (below).
- Inputs are drawn from the island inventory continuously at the same rate
  (fluid model). When an input is in the *starved* regime (§1.1) the
  building is **input-starved**: its rate is capped at its share of the
  input's arrival rate (zero if nothing arrives). Consumption and production
  of a building always use the same progress rate, so recipe ratios hold
  exactly. When several inputs of one recipe are starved, they leave the
  regime **one at a time** (in good order) and a consumer's demand is
  capped only by inputs that stay starved — otherwise two empty inputs
  would release each other and re-enter every millisecond.
- Output is blocked when the good is at **capacity** in the island inventory
  (D-008); the building shows "warehouse full". Blocking propagates
  upstream: a producer whose output is full and has no *running* consumer is
  blocked, so a full plank store also blocks the lumberjack feeding the idle
  sawmill.
- Rate pipeline per producer: base (nominal × efficiency × workforce; 0 if
  paused, buffer full, or unconnected with inputs) → throughput factor →
  starvation cap → full cap.
- **Workforce** (D-035): each production building declares
  `workforce: {tier, amount}`. On each island, the residents of a tier form a
  pool; buildings draw from it in placement order. If the pool is short, every
  building of that tier on the island gets
  `workforce_factor = min(1, pool / Σ required)` (proportional, not
  first-come). Rate is multiplied by `workforce_factor`. Houses never need
  workforce; public buildings do not either at launch.
- **Bootstrap rule:** a building whose output is needed to *create* the
  first houses of tier `n` (that tier's construction materials and the goods
  required to upgrade into it) must be staffed by tier `n-1` or lower.
  Otherwise the first stone could only be quarried by Citizens who cannot
  exist without stone. The balancing checklist (CONTENT §12) verifies this
  with a bootstrap scenario per tier.
- One recipe per building at launch. Buildings whose output could come from
  two recipes are modelled as two building types; selectable recipes are
  deferred (D-041).
- Each building has `upkeep` (gold/min) and a `paused` flag (player or
  insolvency, section 7). Paused buildings have zero rate and zero upkeep.
- Visible carts and cycle progress bars are derived from the rate and the
  phase of the cycle; they are not state.

## 5. Trading Post, Warehouses and inventory (D-014, D-051)

- One **inventory per island**: `stock[good]`, `capacity[good]`.
- The **Trading Post** (one per island; its presence is what "settled"
  means) holds the island's stock: `capacity[good]` = the Trading Post's
  level capacity (provisional lvl 1 = 300, lvl 2 = 500, … per good —
  capacity is per good, not total, to keep the puzzle about rates rather
  than micro-sorting). It is also the island's pier (§9.3) and the
  endpoint for ships, founding and trades. Coastal with its front rows
  over water (§2).
- **Depots** (D-062; water-edge, Merchants since D-069) add a fixed 150 capacity per
  good while a Trading Post stands: `capacity[good]` = Trading Post level
  capacity + Σ depot capacities (one function for production caps, ships,
  quests and display). Any number may stand on an island; no levels,
  upgrade or collector capability. Demolition refunds 50 % of construction
  materials, no gold, and guards surplus loss unless explicitly accepted;
  accepted surplus is clamped to the remaining capacity. The display gives
  a depot its own `capacity`, no `level`; the Trading Post shows the total.
- **Collectors** fetch producer output: the Trading Post has a base
  **throughput** `T` and every **Warehouse** (inland, cheap, no coast, no
  capacity) adds its own `T` (levels raise it). Every collector has a
  **reach** per level (D-069; content `reach`, CONTENT §7): a production
  building is *assignable* to a collector when the Euclidean distance
  between the nearest tiles of the two footprints (tile centres, like a
  service radius, §6.2) is at most the reach — the producer's **building
  footprint** only, never its fields, plots or pastures — and it is
  road-connected to it (§3). Each producer is assigned to the nearest
  assignable collector by road (ties: lowest ID). A producer that is
  road-connected only to collectors out of reach has the status
  **`no_collector_in_reach`** and **stalls**: rate 0, its buffer kept,
  nothing lost (D-009; like an unconnected producer with inputs, it
  sits right after `not_connected` in the status precedence, §14).
  Upgrading a collector raises its reach and reassigns at once; the
  Trading Post's and a Warehouse's level *n* needs tier *n* unlocked (§12);
  demolishing the only collector in reach stalls its producers. Houses,
  public buildings and shipyards only need the road connection (no
  reach). `R` is the sum of base output
  rates of a collector's assigned producers that are **running**
  (connected, not paused, not fully starved, not blocked). If `R > T`,
  every running assigned producer gets `throughput_factor = T / R`; else 1.
  The UI shows collector load as `R / T`. Warehouses never add capacity
  — storage is the Trading Post's lever, collection the Warehouse's.
- A good counts as **full** when `stock + in_transit` reaches capacity
  (committed capacity), so goods already on the road never overflow on
  arrival.
- Trading Post and Warehouses are **upgraded in place** (next level's
  gold + materials from the island). Demolishing a Warehouse refunds 50 %
  of placement and paid levels, no gold; the Trading Post can only be
  demolished when it is the island's last building (unsettles the island).
- Goods delivered by ships or trades arrive at the Trading Post's pier:
  they bypass collector throughput but respect capacity; excess waits
  aboard.

## 6. Population and needs (D-013)

### 6.1 Houses

- A house belongs to a tier and has `residents` in `[floor, max]`
  (Settlers 2–8, Citizens 5–15, Merchants 8–25, Patricians 12–40; tiers
  3–4 provisional). `floor` is the minimum that never leaves (D-009). Residents are
  **whole numbers**; growth accumulates in a signed per-house accumulator
  that steps residents by ±1 when it reaches a full resident (each step is
  a boundary, since it changes consumption, taxes and workforce). The
  accumulator resets only at those steps and on upgrade, so splitting an
  advancement never changes it.
- **Target (D-074):** a house fills with its satisfaction. Its **target
  residents** are `floor + (max − floor) × satisfaction`, rounded down to a
  whole resident (never below `floor`; `max` only at satisfaction 1): a
  Citizen house (5–15) at 0.54 holds 10, at 0.3 holds 8. There is no
  growth threshold.
- **Growth rate** = `growth_per_min × satisfaction` while residents are
  below the target; **decline rate** = `decline_per_min × (1 −
  satisfaction)` while above it; 0 at the target (the accumulator keeps
  its value there). Provisional constants (region.json): `growth_per_min`
  1, `decline_per_min` 0.5 — i.e. +1 resident/min at full satisfaction and
  −0.5/min at zero satisfaction. The display carries the target
  (`residents_target`); the house card shows "↑ 8 → 10 / 15" while the
  house moves and "→ 10 / 15" at its target.
- **Upgrade** to the next tier is a player action on a *full* house —
  at its target residents (not necessarily `max`: one alternative per
  category settles a Citizen house at 13 / 15, and the second alternative
  is never needed to progress, D-056 §4) — that passes the upgrade gate
  (§12: every required need of the
  *current* tier, carried lower-tier needs included, at coverage ≥ 0.6, as
  evaluated on the settled world at that instant); it costs the next
  tier's house materials and requires the next tier to be unlocked (§12).
  The upgraded house keeps its ID and position and **its residents**
  (D-074 §2): `min(residents, new max)`, never below the new tier's
  `floor`; the accumulator resets, and from there the house follows the
  new tier's target (it declines gently when the target is below the kept
  count). Upgrading is the only way inhabitants of a higher tier appear (so
  the player controls the tier mix). A tier may be *declared* in content
  without a house (residents, tax, unlock conditions only); upgrading into
  it fails with a typed error until its house exists. Houses above the
  first tier can never be *placed*, only upgraded into (`upgrade_only`,
  checked before `tier_locked`).
- The display carries the gate for every house as `upgrade: {available,
  reason?}`, where `reason` is the first failing condition in gate order
  (`no_house`, `tier_locked`, `not_full`,
  `needs_below_threshold:<category>:<percent>` with the need's effective
  gate as a whole percent, `cannot_afford`), so the client enables the
  Upgrade button from it and computes no rule.

### 6.2 Needs

Each tier has a list of needs (D-056 weighted shares). Each need is a
*category* with one or more *alternatives*; every alternative has a
`share` (content; the loader default is 1.0 for a category's only
alternative and 0.6 each when there are two or more; an authored share
wins). The **coverage** of a category is `min(1, Σ share × supply
ratio)` over its alternatives, so one alternative of a two-good category
covers 0.6 and both cover it fully. A need is either:

- **Goods need (category, D-031):**
  `{category, weight, goods: [{good, per_resident_per_min, share?}]}`. A
  good is *supplied* when it is not in the starved regime, or is starved
  but still has arrivals. The island's houses of that tier share the
  category's demand **equally among the supplied goods**: with `m`
  supplied goods each is consumed at `residents × per_resident_per_min /
  m` (so a house supplied with two goods does not eat double). If a
  supplied good runs short, the shortfall is drawn from the other goods
  **in list order** from whatever slack they have (unlimited for
  non-starved goods, up to the unused arrivals for starved ones). A
  good's **supply ratio** is its own allocation over its nominal demand
  (1 when not starved, its arrival share when starved; at most 1): what a
  good draws for another's shortfall is consumption only and adds no
  coverage. The reason is `ok` while no supplied good is short, even at
  a coverage of 0.6. Adding a supplied good never lowers coverage, tax or
  growth (invariant, §13). Lower-tier goods are not accepted by higher
  tiers' own categories (D-033). Houses count as running consumers for
  warehouse throughput and upstream blocking (§4, §5).
- **Building need:** `{category, weight, buildings: [{building,
  share?}]}`. An alternative serves a house when a building of that type
  is within its **service radius** of the house — Euclidean distance
  between tile centres from the **nearest footprint tile of the house** to
  the **nearest footprint tile** of the public building (D-042) — and is
  road-connected to a warehouse and not paused; the house itself must be
  connected (§3). The radius is that of the building's current **level**
  (`service.levels`). Coverage = `min(1, Σ share)` over the serving
  alternatives. Without a serving building the UI reason is, in
  precedence, `not_connected`, `paused`, `out_of_range`. The display
  lists every serving building as `served_by` (IDs), so the client can
  highlight serving buildings and, inverted, the houses a building serves
  without evaluating the distance rule.
- **Market (D-065):** every tier has a `market` category served by the
  market alone (share 1.0). The market has four levels with radius
  20/24/28/32 (D-072), raised in place with `upgrade_building`; level *n* needs
  tier *n* unlocked (Settlers place level 1; Citizens, Merchants and
  Patricians unlock levels 2–4) and the level's cost.
- **Chain need (D-065):** `{category, weight, chain, min_rank}`. The
  public buildings of a chain carry a rank (`service.chain`/`rank`):
  faith chapel 1 < church 2 < cathedral 3, education school 1 <
  university 2, culture tavern 1 < playhouse 2. A chain need is served
  (coverage 1) by **any** building of its chain whose rank is at least
  `min_rank`, within **that building's own radius** and under the same
  connection and pause rules as a building need; there is no partial
  coverage from a lower rank. Minimum ranks: Settlers faith 1; Citizens
  faith, education and culture 1; Merchants faith 2, education 1,
  culture 2; Patricians faith 3, education 2, culture 2. So one church
  serves Settlers, Citizens and Merchants around it, and a lower-rank
  building next to it adds nothing. Chain buildings have one level.
  `served_by` lists every serving chain building; the reasons are those
  of a building need.
- **Civic services (D-060/D-062/D-065):** safety (`city_guard`, Citizens and
  up), fire protection (`fire_station`, Merchants and up) and health
  (`surgery`, Patricians only) are building needs of their own category
  with one building each (share 1.0); each higher tier lists the category
  again with its own weight. They are required categories and
  count in the upgrade gate (§6.1). No new rule: a missing civic building
  lowers coverage, tax and growth; there are no fires, disease or crime
  events. City guard and fire station have one level (radius 26 and 22,
  D-072) and no upgrade; the surgery has one radius-28 level and costs
  glass.
- **Display groups:** every category names a display group
  (`need_categories[].group`): `goods` for food, drink, clothing, comfort
  and luxury, `public` for market, faith, education, culture, safety,
  fire protection and health (Anno 1404's split). The client shows a
  house's needs under these two headings; groups have no rule effect.
- **Weights (D-065):** the former services weight of a tier is split
  0.4 to the market and the rest equally among its chain categories (Settlers
  market 0.12, faith 0.18; Citizens market 0.12, faith, education and
  culture 0.06 each; Merchants 0.096 and 0.048 each; Patricians 0.04 and
  0.02 each). All own-tier weights still sum to one.
- **Cumulative tiers:** a house also carries the goods categories of
  every lower tier (`from_tier`), with that tier's goods at a reduced
  rate: `rate × (own max / higher max) × 0.5^(dist / 3)`, where *own max*
  is the lower tier's house maximum, *higher max* the carrying tier's
  and *dist* the tier distance (Citizens eat fish at 0.01 × 8/15 ×
  0.5^(1/3) ≈ 0.0042). The loader normalises the satisfaction weights:
  the tier's own required needs share 0.6 (their authored weights sum to
  1), the lower tiers share 0.4 equally, each split by the authored
  weights of its categories.
- Every need carries a flag `required` (counts toward satisfaction, so it
  gates growth, tax and the upgrade) or `optional` (displayed only; the
  tax bonus is gone). The flag is independent of the category name: the
  Patricians' `luxury` category is a `required` category like any other.

**Satisfaction** of a house = weighted mean of its required needs'
coverage (1 if the tier has no required needs; the normalised required
weights sum to 1). There is no variety multiplier and no optional tax
bonus: tax and growth scale with satisfaction alone.

**Recipe inputs** may list alternative goods (`"good": ["charcoal",
"coal"]`): a producer draws the first listed good that is not starved,
else the first with arrivals, else the first; the choice changes only at
regime boundaries, a slot is never split across goods, and a good is
accepted by at most one input of a recipe.

### 6.3 Taxes

- `tax_rate[tier]` gold per resident per minute (content, CONTENT §2;
  Settlers 0.20, Citizens 0.80, Merchants 1.50, Patricians 2.70 — tuned
  to the one-alternative baseline, D-056 amendment), multiplied by
  `satisfaction`, rounding down.
- Taxes only accrue from houses; nothing else creates gold (D-018).

## 7. Gold, upkeep and insolvency (D-017)

- `balance_rate` = Σ taxes − Σ upkeep of non-paused buildings and ships.
  Gold is linear between boundaries; only its zero crossing and the resume
  reserve (below) are boundaries.
- Gold can never go below zero. When the advancement reaches the boundary
  where gold would cross zero with a negative rate, the simulation runs the
  **auto-pause cascade** at that instant: pause one candidate according to
  the order below, recompute all rates, and repeat until `balance_rate ≥ 0`
  or no candidate remains (then gold is held at zero and taxes accrue as
  they come). Candidates are buildings that are not paused, have upkeep
  > 0 and `pause_category ≠ never`.

Auto-pause order (first paused first; within a step, highest tier first,
then lowest upkeep first so the fewest buildings stop, then lowest ID):

1. Production buildings whose outputs are **goods needs of the highest tier**,
   highest tier first.
2. **Public buildings** of the highest tier, descending — never the tier-1
   market and chapel.
3. **Intermediate and construction-material** chains (sawmill, mason, tool
   chains, …).
4. **Ships on routes** (ship anchors at its current stop; cargo stays aboard).
5. **Tier-1 food** production.

**Supply chains pause last** (D-075 §5): a candidate is skipped while it
is its island's **last running producer** (not paused) of a good that a
connected house on the island consumes — any alternative of a goods need
of the house's tier — **whether the need is met today or not**: without
it the need would fall below 0.6 (the upgrade gate), so a fisher whose
catch fills the houses is guarded as much as a weaver whose garments are
not there yet. The guard is **transitive**: the island's last running
producer of every input good of a guarded producer (any accepted
alternative) is guarded too, recursively over the recipes — the sheep
farm of a guarded weaver, the mill and the wheat farm of a guarded
bakery — so a guarded producer is never starved by the cascade; content has no
production cycles. The pause falls on the next candidate; with a second
running producer of a good the cascade pauses one (the usual order) and
guards the last, and the walk does not continue through a good with
two producers. Unconnected houses consume nothing and guard nothing. A
producer **loses its guard** (and its inputs are not walked) while an
input is **cut off**: no building on the island produces any accepted
good of the input slot, running or paused, the island's stock of each
is zero and none is on its way into the stock (a transit segment not
yet over). A paused producer of the input keeps the guard (it can
resume), and so does stock, imported or left over: a weaver without a
sheep farm stays guarded on shipped-in wool until the stock is empty,
then the cascade at that instant (a stock-empty boundary) pauses it.
Cargo aboard a ship does not count until it is unloaded (a boundary).
Stock only rises from zero with an inflow and falls to zero at a stock
boundary, so the test is constant between boundaries and splitting an
advancement cannot change it. The guard is evaluated on the settled
rates and stock of each cascade step, so it stays deterministic. With only guarded candidates left, D-008's gold floor
holds: gold is held at zero and the guarded buildings keep running
unpaid until taxes cover them or their inputs run out (D-009, no ruin).
Scenarios `supply_chains_pause_last`, `supply_chains_met_need`,
`supply_guard_import`, `ship_insolvency`, `stall_recovery_auto`.

Never auto-paused: houses, warehouses, roads, shipyard, harbourmaster,
decorations, and the tier-1 market and chapel. **Never-pausable buildings
carry no upkeep** (D-046): their running cost is folded into their
construction price, so a fully stalled city always has `balance_rate ≥ 0`
from floor-level taxes and gold keeps accumulating. Pausable public
buildings (tavern and up) keep upkeep. The exception are the hubs (D-069 §3):
Trading Post, warehouses and the market carry upkeep per level
(CONTENT §7; the Trading Post's and the market's level 1 are free) and
are never paused; when nothing pausable is left their upkeep holds gold
at zero until taxes cover it (a demolished hub stops its upkeep).

- **Auto-resume**: the candidate is the most recently auto-paused
  building or ship, **skipping a producer with a cut-off input** (the
  test of the supply guard above: no producer of the input on its
  island, running or paused, no stock, nothing in transit; D-075 §5) —
  it would only cost upkeep. It is a candidate again once an input
  producer is built or resumed or stock of the input arrives (the queue
  is evaluated at every boundary; scenario `ship_insolvency`: the
  woolless weaver is skipped and the cog gets the trial resume). It resumes when both hold: (a) gold ≥
  `auto_resume_upkeep_minutes` (content, provisional 5; **strictly
  positive** — it is the hysteresis that prevents pause/resume flapping, so
  0 is rejected as invalid content) of its upkeep, and (b) the **full**
  `balance_rate` with that building running and *all* rates recomputed
  (production, workforce, throughput, starvation and full caps, house
  consumption, taxes, upkeep) is ≥ 0. (b) is evaluated from the current
  regimes and arrival rates, never from an instantaneous stock level, so it
  only changes at boundaries and commands; gold reaching the reserve of an
  eligible candidate is a scheduled boundary. Candidates are checked in
  reverse pause order at the same instant until the first one fails. A
  building is never resumed at the millisecond it was paused. Visible
  effect: a building that looks affordable by "balance − its upkeep" can
  stay paused; the UI shows the balance rate with the reason.
- **Trial resume** (D-047): when (b) fails but gold ≥
  `trial_resume_upkeep_minutes` × the candidate's upkeep (content,
  provisional 30; must be > `auto_resume_upkeep_minutes`), the candidate is
  resumed anyway. (b) cannot see the goods a paused producer would make,
  so without a trial a city whose food ran out would stay paused forever;
  the trial lets production lift satisfaction and taxes. A trial-resumed
  building runs normally; if the balance stays negative the gold-zero
  cascade pauses it again and the next trial needs the reserve to refill,
  so attempts are at least one trial window apart. Gold reaching a trial
  reserve is a scheduled boundary (`gold_trial_reserve`). Trials are
  independent per building (several can start 1 ms apart when gold covers
  each reserve); at most one resume of any kind happens per millisecond.
  Measured: a fully stalled tier-1 city with nothing in stock or in
  transit restarts on its own ≈ 54 min after the stall; 24 h alone makes
  4 trials.
- A paused public building fulfils no building need; paused buildings
  have no upkeep and need no workforce. The display carries an
  `insolvency` block (unpaid counts, unpaid upkeep, `balance_if_resumed`)
  for the UI banner.
- Buildings paused for insolvency are flagged `paused_reason = unpaid` and
  shown distinctly from `paused_reason = player`. Players may resume any
  paused building manually; manual pause is only available for buildings
  with `pause_category ≠ never`.

## 8. Construction

- Cost: gold + materials from the **island inventory where the building is
  placed**. If the island lacks materials, the build button explains what is
  missing and where it exists (another island → suggests a shipment).
- Construction time: 2–5 s visual (no gameplay effect). The building is
  functional when the animation ends; costs are deducted immediately.
- Building unlocks depend on the player's **global** progress (highest tier
  population reached anywhere), so a new island can immediately use all
  unlocked buildings.
- **The game starts at sea** (D-051): the player's cog holds the
  starting stock; no island is settled, every island can be settled, and
  nothing is gated by tier. Settling an island means sailing there and
  placing the **Trading Post** from the ship (`found_island`): materials
  come from the ship's cargo only, gold from the balance; the rest of the
  cargo is unloaded into the new Trading Post. An island is **settled**
  while it has a Trading Post; nothing else can be placed on an unsettled
  island (`island_not_settled`); the Trading Post can only be demolished
  when it is the island's only building (roads may remain;
  `last_warehouse` → `last_trading_post`).

## 9. Ships and routes (D-007, D-015)

### 9.1 Ships

- Types (D-056, speeds D-059): *Cog* (2 slots × 50, speed 1.2, build
  2 min, tier 2), *Hulk* (4 × 50, 1.0, 5 min, tier 3), *Carrack* (6 × 60,
  0.85, 10 min, tier 4): small and fast for founding and short hops,
  large and slow for bulk; the ETA uses each ship's speed over the
  routed path length. **Warships** (D-077 §6: balinger, war cog, war
  carrack, tier 4) carry no cargo (`slots: 0`) and an `attack` value
  nothing reads until raids (D-005). Defined
  in `ships.json`; the shipyard (tier 2, no levels) offers the types
  whose tier is unlocked (`ErrTierLocked` otherwise). The start ship is a
  cog; its **founding cargo** (start stock) is exempt from the slot
  limit — slot checks apply only to player loading — and moves to the
  Trading Post at founding (§10).
- **Length and berth spacing** (display only, D-056 C3): each type has a
  hull length (`length_tiles`: cog 2, hulk 2.6, carrack 3.2); its
  ratio to the cog scales the drawn ship. At a Trading Post or trading
  pier (§9.3) each
  moored ship takes the anchor spacing (1.5 tiles without anchors) ×
  its ratio along the pier, filling outwards in anchor order, so cogs
  lie exactly on the berth anchors and a longer ship pushes its
  neighbours out instead of overlapping them; ships stay stern-first
  (stern offset × ratio), and the queue waits beyond the longest moored
  bow. The sim's berths, handling and queue order are unchanged.
- Shipyard build: one order at a time per shipyard (`shipyard_busy`);
  costs deducted at order time; cancel refunds 50 % materials; completion
  is a due moment (`ship_built`, §1.3) after the type's build time; the
  ship appears `idle` at the shipyard's island. Demolishing a shipyard
  with a pending order refunds the order like a cancel.
- Ships have upkeep (gold/min; counts in `balance_rate`) and a `state`:
  `idle@island`, `on_route`, `manual_leg`, `on_world_map` (reserved),
  `anchored_unpaid`, `patrolling`. Insolvency step 4 (§7) applies to **every** ship with
  upkeep, idle ones included: a ship on a leg finishes it, then anchors
  without unloading; it resumes at its arrival stop. A patrolling ship
  ends its patrol and anchors at the patrolled island (below).
- **Patrol** (D-077 §6, `patrol.go`): `patrol {ship_id, island_id}` sends
  an idle ship — warship or cargo ship — round an island of its region,
  settled or not (not a skerry; `route_invalid` otherwise, also for an
  island of another region; `ship_not_idle`). The server builds the
  **coast loop** once: the convex hull of the island's land for ships
  (quays and shore decks included) grown by 10 tiles (the shallows'
  8 + 2) in each direction — a square per land tile, so every hull edge
  keeps at least 10 tiles (Chebyshev) from the island's land — with
  hull corners on another island's land dropped and every edge that is
  not clear water (another island, a skerry) replaced by the sea route
  round it (§9.1 routing, string-pulled); integer-only, deterministic.
  The loop starts at its point nearest the ship; the **approach** is
  the voyage from the ship's position (at sea, offshore, its island's
  harbour or shore) to it. The ship stores both with their travel times
  at its speed and the start (`Ship.Patrol`, schema 17) and is at no
  island; the client places it on the approach and then round the loop
  for ever (display `patrol`). No boundary event: nothing changes while
  it patrols but the upkeep. `unassign_ship` ends the patrol: the ship
  idles at the patrolled island, offshore at the loop point nearest the
  island's harbour at the start (the loop's first point without one); an
  insolvency pause ends it the same way (`anchored_unpaid`). The loop is
  not rebuilt when quays or shore buildings grow later. A property test
  checks that no loop of the generated archipelagos (seeds 1–50) or its
  approach touches land.
- **Names** (D-055): a new ship is named "<type name> <id>" ("Cog 1");
  `rename_ship` renames it in any state — trimmed, 1–24 printable runes
  (the island rule), not unique; an empty name restores the default.
- **Cargo** is stored canonically per good (full slots, then one partial
  slot); loading tops up partially filled slots first. `scrap_ship`
  unloads the cargo (capacity permitting; excess lost) and refunds 50 % of
  the ship's materials.
- **Travel time** is one integer-only function per straight segment:
  `distance_milli = ceil(1000 × √(dx² + dy²))` (integer square root over
  archipelago tile coordinates), `travel_ms = max(1, ceil(distance_milli ×
  60 000 × 1000 / (speed_permille × ship_speed_milli_tiles_per_min)))`.
- **Sea routing (D-058 §5):** a leg runs from the departure island's
  harbour — 2 tiles out from the middle of its Trading Post's water edge,
  or the nearest open water tile (no land within 1 tile, outside the
  footprint) when that one is not; an island without one: its sea-reachable water tile
  next to land nearest the other end; a founding voyage (`sail_ship` with
  the Trading Post's `site`): that site's harbour — to the arrival
  island's, around land: integer A* on a 4-tile sea grid (a cell with
  any land is blocked, and so is a sea cell the open sea cannot reach —
  a bay whose mouth is narrower than a cell, D-072; an end in such a
  cell walks over water tiles to the nearest open cell, first within 24
  tiles, then anywhere on the grid — a long bay or channel), then string
  pulling with a tile-exact line test that keeps 1 tile of water from
  land (within 1 tile of an end point every tile the segment passes,
  corners included, must be water). When an end reaches no open cell
  over water (two ends in the same closed lagoon) the leg follows the
  coast: an A* over the water tiles, pulled the same way. The straight
  line is kept only when it is clear, or when the ends share no water
  at all — which the end points rule out: harbours are routable (§3),
  a shore point is a water tile the open sea reaches (never a closed
  pool or a tile behind quays), sea positions are former leg ends
  (polish 8; property test over the archipelagos of seeds 1–50: every
  island pair and every founding voyage to an island's best site touch
  no land tile). The leg stores the polyline (`path`, shown
  to the client) and its ETA is the sum of the segments' distances in
  the formula above; route loop times use the same paths.
  Constants in `region.json`: `ship_speed_tiles_per_min` (provisional 60)
  and `ship_handling_seconds` (provisional 20). Two islands 120 tiles
  apart → 100 s per cog leg (speed 1.2), 2 min per hulk leg.
- A ship is never in two places: its `island_id` is cleared at departure
  (not a boundary — no rate changes — but included in `next_change_at` so
  the client never shows a ship at an island it has left) and set at
  arrival.

### 9.2 Routes

```
route: { name?, stops: [{island, load: [{good, max_amount, keep?}], unload: [{good, max_amount?}]}], ships: [...] }
```

- A route has 2–8 stops; consecutive stops are on different islands
  (`route_invalid`).
- At a stop: unload listed goods (respecting capacity and the unload
  rule's optional `max_amount`, the most unloaded per visit; remainder
  stays aboard), then load listed goods **topping up to** `max_amount`
  per good from the stock above the load rule's optional `keep`, within
  slot availability: `load = min(max_amount − aboard, stock − keep, slot
  room)` (D-070). Both limits are evaluated at `ship_arrived`; absent,
  `keep` is 0 and the unload is unlimited. `keep` and the unload
  `max_amount` are whole units ≥ 0, an unload limit only for a good the
  stop unloads (`route_invalid`). Handling takes `ship_handling_base_seconds +
  ship_handling_seconds_per_unit × units moved` (provisional 10 s +
  0.2 s/unit) and needs a free **berth** (§9.3).
- A ship is `{routeId, stopIndex, legDepartAt, legArriveAt, cargo}`; its
  visual position is interpolated from the leg timers; arrival is a due
  moment (`ship_arrived`, §1.3) that applies unload/load and schedules the
  next leg.
- An idle or anchored ship at an island without berths (a founding ship
  before `found_island`, a ship left at an island whose Trading Post is
  gone) keeps a sea position, the end of the leg that brought it, or the
  harbour point of the demolished Trading Post when it was demolished under
  the ship (`Ship.Offshore`, sent as `position` with `island_id` set); it is cleared
  when the ship departs, is granted a berth or a berth source is placed.
- `update_route` is always allowed: assigned ships finish their current
  leg, then continue at the first stop (searched cyclically from their
  current index) on their arrival island, otherwise sail a positioning leg
  to stop 0. `delete_route` requires no assigned ships (`route_in_use`).
  `assign_ship` requires an idle ship and starts at the first stop on its
  island, else positions to stop 0.
- Loop time shown in the UI is computed at reference speed 1.0.
- **Route effects (display only, estimated):** for the UI the server
  computes per route `effects[] {island, good, per_loop, per_min}`:
  a virtual hold `H` = the smallest `slots × slot_size` among the assigned
  ships (or among all ship types when none is assigned); for every good
  that appears in a load rule, walk the stops twice from stop 0 with
  `aboard = 0` — at each stop unload first (if the good is in `unload`
  the island gains `u = min(aboard, unload max_amount)` and `aboard −=
  u`), then load (`delta = max(0,
  min(max_amount, H) − aboard)`; the island loses `delta`); the second
  pass's per-island sums are `per_loop`; `per_min = per_loop ×
  assigned_ships × 60 000 / loop_ms` (0 without ships). Stock availability
  (and so `keep`) and cross-good slot competition are ignored, so the UI labels the values
  "estimated". This is a derived display field, never used by rules.
- Manual shipment = a one-off two-stop leg from the ship's island to a
  target island with an explicit cargo list taken from the island
  inventory (or already aboard); on arrival everything is unloaded as far
  as capacity allows and the ship goes `idle` there. Goods delivered by
  ship bypass warehouse throughput but respect capacity (§5).

### 9.3 Berths (D-051)

- A Trading Post has `berths` per level (provisional lvl 1 = 1, lvl 2 = 2,
  …). A ship arriving to load/unload occupies a berth for its handling
  time; if none is free it waits at anchor and its arrival effect is
  queued as the next due moment after the earliest berth frees (FIFO by
  arrival time, then ship ID). Manual shipments, route ships and later
  trade ships queue alike. **Trading piers** (D-060; water-edge,
  Merchants since D-069, no levels) add their `berths` (provisional 2) to the
  island's pool: berths = Trading Post level berths + Σ pier berths; the
  sim keeps one pool and one queue per island. D-062 changes no berth
  arithmetic: the 6×6 Trading Post still has 1–4 by level; a 6×9 pier
  adds two, whose model anchors sit on its flanks. Both harbour points
  measure from their front row, independently of per-column water depth.
  Which pier a moored ship
  lies at is a display convention (the client fills the Trading Post's
  own berths first, then each pier by building ID; the queue waits off
  the Trading Post). The harbour check (§3) covers every pier's harbour
  point: a quay or a building that closes a pier off the open sea is
  `harbour_blocked`. A crane (shorter handling) is deferred (D-060). The Trading Post panel shows berths
  busy/free and the queue; a waiting ship shows "waiting for berth".

### 9.4 Regions and passages (D-076)

- A world holds one or more **regions** (`World.regions`, in the order of
  `content/regions.json`, the home region `old_coast` first). Each
  region is its own archipelago with its own map: `id`, `seed` (world
  seed + region index; the home region's is the world seed), `unlocked`
  (the home region always), `passage_point` (the sea position where a
  ship from a passage enters the map: the generator's start position;
  set on first use — a world migrated from schema 15 has none until the
  first passage leg into the region needs it, which computes it lazily
  like the region's archipelago; no migration fix-up) and its `islands`. Island
  positions are region coordinates; an island ID is unique in the world
  and carries its region's prefix (`oc-01`). Every island and ship
  records its `region_id`.
- **Per world:** gold, ships, routes, quests, warnings and the away
  summary (its island and still-unpaid entries name their region); **per region:** archipelago, islands, passage point (D-076 §5;
  population unlocks become per region with a second region, today the
  world's population is the home region's, §12).
- A **passage** is an off-map leg between two regions with the fixed
  time of the region pair (`passages[]` in `regions.json`): no path, the
  ship is "between regions" (`region_id` unset, `leg.passage`), it
  enters the other region at its passage point and sails the normal sea
  route from there. `sail_ship`, manual shipments and routes look up
  their islands in every region; a voyage or a pair of consecutive route
  stops in two regions fails with `no_passage` (`ErrNoPassage`) while no
  passage leg exists. The shipped content lists one region and no
  passage, so no passage leg exists yet; the expedition that opens a region
  (Kontor, D-076 §2) comes with its own decision. `Advance` treats the
  regions' islands as one list (`World.Islands()`); generation is per
  region (`archipelago.GenerateRegion`), a region's archipelago is
  generated when it is opened.

## 10. Islands, archipelago and settling (D-016, D-051)

- Each archipelago is generated from a **seed stored on the world**
  (D-053; a region's archipelago from world seed + region index, §9.4,
  the home region's from the world seed, island IDs `<prefix>-NN` with
  the region's prefix) by a pure function of seed and content: **12 habitable islands**
  (3 large ≈ 250×250, 5 medium ≈ 163×163, 4 small ≈ 106×106 extents;
  Anno 117 buildable areas, D-072) plus 6–12
  **skerries** (below; no resource rocks, D-073). Each island gets
  fertilities (2–4 from the pool), typed deposit slots (0–4) and a harbour area proportional
  to its coast; each habitable island has ≥ 2 valid Trading Post sites
  and a shipyard site. Islands are ≥ 55 tiles apart (grid to grid),
  nearest neighbour ≤ 120, every strait (land to land, skerries
  included) ≥ 24 tiles of water, and no sea point inside the hull of the
  land lies more than 150 tiles from land (a layout with more open sea is
  drawn again); the start ship spawns at the sea tile nearest the home
  candidate that lies ≥ 40 tiles from any land (its first voyage takes
  40 s or more). The archipelago may be **re-rolled** until the first
  founding (`reroll_archipelago`); a settled island may be **renamed** by
  its owner (`rename_island`).
- **Shapes (D-058, D-072):** a habitable island grows from a skeleton (a
  trunk with 1–3 arms, small 1–2) through a distance field and warped
  noise; large and
  medium islands keep at least one bay ≥ 15 % of their span deep and one
  peninsula ≥ 10 % beyond the body. Each keeps **one contiguous plain** on
  one terrace level (large ≥ 52×52, medium ≥ 32×32, small ≥ 19×19 grass)
  that the Trading Post and shipyard sites reach by land or bridges.
  - **Mountains** (D-072) form compact **rim massifs**: large 2–4,
    medium 1–2, small 0–1 (`shape.massifs`), on different sides of the
    island, the first one dominant; together 10–19 % of the land (pockets
    cut off by them included). Each stands on a short spine parallel to
    the coast, set back from it: its outer flank meets the sea as
    **cliff**, its foot runs out gently inland (rock height 1 at the
    foot up to 6 / 5 / 3 on large / medium / small islands); no massif
    reaches into the interior, which stays one connected plain, and the
    coast between the massifs is beach (cliff at most 25 % of the shore;
    no harbour buildings — reserved beach sites keep the harbour
    guarantee). Deposit slots spread over the massifs (the k-th slot on
    the k-th largest, round robin; two slots of one kind on different
    massifs where there are two); an island drawn without a massif
    gets no deposit slots. Mountain and cliff tiles are unbuildable
    (D-036).
  - **Rivers** (large 1–2, medium 0–1, small none; D-072) rise high on
    a massif and cross the island to a bay on another side (at least a
    right angle from the source, seen from the land's centroid), **2
    tiles wide** and 3 along the last 6–10 tiles (the estuary); river
    tiles are unbuildable water inside the land. A **road on a river tile is a
    bridge**: a straight crossing of at most 2 river tiles with buildable
    land at both ends and no road beside it (`terrain` otherwise).
    Fishing stays sea-only.
  - **Islets** (2–15 tiles, rock with a grass top or bare) lie inside
    an island's grid as unbuildable decor.
  - **Terraces are visual** except for one rule: every land tile has a
    level 0–2 (the beach at 0, inland higher, rivers stepping down, the
    plain on one level) and rock tiles a rock height. No tile loses
    buildability; the only placement rule that reads levels is the low
    shore of water-edge buildings (§2, D-075 §1). The client draws
    plinths, ramps and waterfalls.
- **Shallows** (D-060, D-077 §8): an island's water tiles (not river)
  within 8 tiles (Chebyshev; 3 before D-077) of its own land — islets
  are not own land — derived from the tiles; the ground of quays (§3).
  D-036 stands, with the wider band: the shallows still bound the
  harbour area, so a basin of connected quays never reaches more than
  8 tiles out (shore buildings at a pier head may stand beyond it).
- **Skerries** (size class `scenic`, D-058, D-073): 5–18 tiles of rock with a
  grass or sand top, placed after the islands within the nearest
  neighbour distance. They have no sites, fertilities, deposits or name,
  do not count toward the 12 islands or the buildable area, cannot be
  founded (`invalid_command`) or sailed to (`route_invalid`), and are
  land for sea routing, the minimap and the far view.
- **No gating** (D-051, supersedes D-039's unlock ladder): every island
  can be settled from the start; pacing comes from ships, Trading Posts
  and running a second settlement. Islands show their fertilities,
  deposits and size before settling so the first choice is informed.
- **Generator guarantees** (over the archipelago; composition fixed so
  re-rolls change the layout, not the odds): a **large** island has
  fish, grass, stone and one of wheat/apple (the home candidate; forest
  dropped with D-059 — the lumberjack plants its trees, forest is decor);
  every fertility and deposit of the pool appears within a fixed count
  range; total buildable area within ±10 % of a target;
  iron and hemp never share an island with all of those; clay, salt,
  hops, woad, coal, grapes, quartz, copper and gold (exactly one gold
  deposit) are spread so that a balanced top-tier economy needs most
  islands.
- All islands are visible from the start. Settling requires a ship
  carrying the Trading Post cost (section 8).

## 11. World map interactions (rules only; see ONLINE.md)

- Expedition: the Harbourmaster dispatches a ship for `duration` hours
  (provisional 1/4/8 h options with increasing rewards); the ship is
  unavailable meanwhile. Result rolled at `expedition_done`.
- Trade shipment: goods are **escrowed** (removed from inventory) at offer
  time. On acceptance, the acceptor's ship departs; travel time from
  world-map distance (provisional 1–6 h); at arrival both sides' goods are
  credited (acceptor's goods to the poster via the same ship's return leg).
  Cancel before acceptance refunds the escrow instantly.

## 12. Tier advancement (D-012)

Tier `n+1` becomes available (house upgrades and new buildings unlock) when
all of the tier's `unlock` conditions in content hold:

```json
{ "population": { "settlers": 120 } }
```

Conditions are evaluated against the player's whole archipelago (with
one region the home region's; per region once a second exists, D-076
§5) at the end
of every advancement and after every successful command; `population`
keys must be earlier tiers. The first tier is always unlocked. Unlocks are
permanent (no regression) and have no rate effect; the unlock moment is
reported as a `tier_unlocked` boundary. Placing a building (or road) of a
locked tier fails with `ErrTierLocked`; so does ordering a ship of a
locked tier or upgrading a public building, a Warehouse or the Trading
Post into a level of one (level *n* of each needs tier *n*, D-065 extended
to the Trading Post: level 2 Citizens, 3 Merchants, 4 Patricians). The
unlocks are population only (D-069 §4): 120 Settlers (Citizens), 360
Citizens (Merchants) and 1 200 Merchants (Patricians); the buildings the
D-056 list named are required by the house upgrade gate anyway. The
content format keeps an optional `buildings` list (a building of each
type must stand somewhere in the archipelago) for later regions. The client toasts an unlock it sees
during a session with the number of new buildings.

**House upgrade gate (D-056):** a house upgrades when it is full — at
its target residents (D-074 §1; `max` only at full satisfaction), every
required need — the tier's own and the carried lower-tier ones — has a
coverage of at least 0.6 (or its full coverage
when a category cannot reach 0.6), the next tier is unlocked and its
house cost is paid. One alternative per category is enough.

## 12a. Quests (D-022)

- Quests are content (`quests.json`): an ordered DAG of `{id, title, text,
  objectives[], rewards, prerequisites}`. Objectives are a closed set of
  generic predicates over world state — `building_count {type, min,
  island?}` (road types count tiles), `population {tier, min}`, `stock
  {good, min, island?}`, `connected {type}`, `route_exists` (a route with
  an assigned ship), `island_settled {count}`, `tier_unlocked {tier}`,
  `ship_count {min, type?}` (optionally one ship type), `satisfaction {tier, min}` (resident-weighted mean).
  No quest ID appears in code.
- A quest is active when its prerequisites are completed; completion is
  evaluated at every advancement boundary and after every command, happens
  once and is permanent (`quest_completed` boundary). The first moment a
  stock objective is met is a scheduled boundary so completion times are
  exact.
- Rewards are **claimed** by the player (`claim_quest {quest, island?}`):
  gold to the balance; goods to the chosen settled island up to free
  capacity, the excess is lost (the quest text says so). Quests are
  optional: the tier 1–2 reference game meets every target without them
  and gains ≈ 15–28 min of headroom with them.

## 12b. "While you were away" summary

- `last_seen_at` is world state set by every successful player command
  (never by reads, failed commands, the worker or scheduled events).
  Every advancement, whoever triggers it, adds to an additive accumulator
  (goods flows per island, gold change, residents per tier, pauses/resumes,
  ship arrivals), so worker events never consume the player's gap.
- On a request, if `now − last_seen_at ≥ away_summary_minutes` (content,
  15) and no summary is pending (or the pending one is older than another
  threshold), a pure function produces the summary over
  `[last_seen_at, now]`: gold before/after, population per tier
  before/after, per-island goods produced/consumed/lost with stock,
  capacity and `at_capacity`, auto-paused/resumed counts, still-unpaid
  list (island and still-unpaid entries name their region, D-076 §5), ship arrivals, quests completed, tiers unlocked (a `tier_unlocked`
  boundary inside the interval: the tier and the number of buildings it adds
  to the build menu, as in the live unlock toast; the letter shows "Citizens
  unlocked — 15 new buildings"). A read that produces one commits
  it (version bump, push) so every device sees it until one acknowledges.
- `ack_summary {id}` clears the pending summary when the id matches; it
  counts as a command for `last_seen_at` and never produces a new summary.

## 13. Invariants (tested)

- Conservation: goods are only created by recipes and only destroyed by
  consumption, demolition surplus, or explicit removal.
- `0 ≤ stock ≤ capacity` for every good on every island after every step.
- `gold ≥ 0` always.
- `floor ≤ residents ≤ max` for every house.
- `0 ≤ workforce_factor ≤ 1`; a building never occupies more than one slot.
- Goods are conserved across island inventories, goods in transit and ship
  cargo; a ship is never at two islands; unloading never exceeds capacity;
  after `advance(w, t)` every due moment of `w` is strictly after `t`.
- Adding a supplied alternative to a category never lowers its coverage,
  the house's tax or growth (monotonic non-decreasing).
- Unlocked tiers never shrink; quest completion is monotonic and each
  reward is credited at most once; summaries are deterministic for
  identical catch-ups.
- `advance(advance(s, t1), t2) == advance(s, t2)` for `t1 ≤ t2`.
- Applying an event at `due_at` then advancing equals the recorded behaviour
  regardless of processing delay.
- Plans are invisible (D-071): a world with plans advances exactly like
  the same world without them.

## 14. UI feedback rules derived from mechanics

Each building state maps to one icon and one sentence with a fix. A building
has exactly one primary status; precedence when several apply:
`paused` > `not_connected` > `no_collector_in_reach` > `warehouse_full` > `input_starved` >
`throttled` > `short_of_workers` > `low_efficiency` > `ok`.

| State | Message | Suggested fix |
|---|---|---|
| paused (player) | "Paused by you" | resume |
| not connected | "No road to the Trading Post or a Warehouse" | build road |
| no collector in reach | "Out of reach of any warehouse" | Warehouse nearby / upgrade the collector |
| input starved | "Missing: iron ore (0/min)" | build producer / import |
| warehouse full | "Planks at capacity (400/400)" | upgrade Trading Post / consume |
| throttled | "Trading Post overloaded (140 %)" (or "Warehouse …") | Warehouse / upgrade |
| unpaid | "Paused: insufficient gold (balance −3.2/min)" | demolish / grow / resume manually |
| low efficiency | "Only 60 % fertile land in range" | move / clear |
| short of workers | "Needs 12 Citizens on this island (8 available)" | build/upgrade houses here |
| no slot | "No free iron slot on this island" | other island / trade |
