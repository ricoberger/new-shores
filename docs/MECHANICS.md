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
     house reaches a growth threshold, gold would cross zero, or `toTime`;
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
  divides 360 s and every warehouse throughput is an exact integer flow per
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
  reaches it; houses without a road keep their floor residents but receive
  no goods and no public-building fulfilment.
- Buildable terrain: `coast`, `grass`, `forest`; `water` and `mountain`
  never (roads follow the same rule; slots sit on mountain tiles, D-036).
- Coastal buildings (warehouse, fisher, shipyard, harbourmaster) need at
  least one footprint tile on `coast`.
- Farms and lumberjacks have a **work area**: a Euclidean disc of radius `r`
  around the footprint centre (tile centres inside count). A tile matches
  when its terrain is in the building's `work_area.terrain` list and carries
  neither a building nor a road; overlapping work areas share tiles (no
  exclusivity). `efficiency = min(1, matching / required_tiles)`,
  recomputed for every work-area building after each placement, demolition
  or road change; it may drop to 0 for an existing building (status
  `low_efficiency`, rate 0). Placement with efficiency 0 is rejected.
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
- Demolition refunds 50 % of each material **rounded down to whole units**
  and no gold (D-019), into the island where the building stood, clamped to
  free capacity (the clamped part is `lost`). Goods the building had in
  transit are delivered immediately; an unconnected producer's buffer is
  lost. Demolishing a warehouse re-assigns its producers to the next nearest
  connected warehouse; if `stock + in_transit` of any good would exceed the
  remaining capacity, the command fails with `ErrSurplusLoss` unless the
  player explicitly accepts the loss (confirmation dialog), in which case
  stock is clamped and the excess counted as `lost`.

## 3. Roads and connection (D-014)

- A producer is **connected** if there is a road path from a road tile
  adjacent to its footprint to a road tile adjacent to a warehouse's
  footprint on the same island (D-042). Roads are tiles; dirt roads (tier 1)
  and paved roads (tier 2, +speed) are the two types.
- Each connected producer is **assigned** to the nearest warehouse by road
  distance `d`: the number of road tiles on the shortest 4-connected road
  path between any road tile adjacent to the producer and any road tile
  adjacent to the warehouse, both ends included. Equal lengths prefer the
  lower summed per-tile time; equal warehouses prefer the lowest ID.
  Assignment is recomputed when roads, buildings or warehouses change. Only
  buildings with a recipe are assigned; warehouses need no road themselves.
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
  workforce_factor`, where efficiency comes from the work area (farms),
  `throughput_factor` from the assigned warehouse (section 5) and
  `workforce_factor` from the island's workforce pool (below).
- Inputs are drawn from the island inventory continuously at the same rate
  (fluid model). When an input is in the *starved* regime (§1.1) the
  building is **input-starved**: its rate is capped at its share of the
  input's arrival rate (zero if nothing arrives). Consumption and production
  of a building always use the same progress rate, so recipe ratios hold
  exactly.
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

## 5. Warehouses and inventory (D-014)

- One **inventory per island**: `stock[good]`, `capacity[good]`.
- `capacity[good]` = Σ over the island's warehouses of their level's capacity
  (provisional: level 1 = 300, level 2 = 500, … per good — capacity is per
  good, not total, to keep the puzzle about rates rather than micro-sorting).
- Each warehouse has a **throughput** `T` (units/min; provisional level 1 =
  60). `R` is the sum of base output rates of its assigned producers that
  are **running** (connected, not paused, not fully starved, not blocked).
  If `R > T`, every running assigned producer gets
  `throughput_factor = T / R`; else 1. The UI shows warehouse load as
  `R / T`.
- A good counts as **full** when `stock + in_transit` reaches capacity
  (committed capacity), so goods already on the road never overflow on
  arrival.
- Warehouses are **upgraded in place** (gold + materials) rather than
  demolished; an upgrade raises capacity and throughput. Additional
  warehouses can also be built (coastal only).
- Goods bought via trade or delivered by ships bypass throughput (they arrive
  at the pier) but respect capacity; excess waits aboard the ship.

## 6. Population and needs (D-013)

### 6.1 Houses

- A house belongs to a tier and has `residents` in `[floor, max]`
  (provisional Settlers 2–8, Citizens 5–15, Merchants 9–25, Patricians
  14–40). `floor` is the minimum that never leaves (D-009). Residents are
  **whole numbers**; growth accumulates in a signed per-house accumulator
  that steps residents by ±1 when it reaches a full resident (each step is
  a boundary, since it changes consumption, taxes and workforce). The
  accumulator resets only at those steps and on upgrade, so splitting an
  advancement never changes it.
- **Growth rate** = `growth_per_min × satisfaction × variety_multiplier` when
  `satisfaction ≥ growth_satisfaction_threshold` (content, provisional 0.5);
  **decline rate** = `decline_per_min × (threshold − satisfaction)` down to
  `floor` when below. Provisional constants (region.json): `growth_per_min`
  1, `decline_per_min` 0.5 — i.e. +1 resident/min at full satisfaction and
  −0.25/min at zero satisfaction. The rate is 0 at `max` while growing and
  at `floor` while declining.
- **Upgrade** to the next tier is a player action on a house at `max`
  residents with all required needs of the *current* tier satisfied (as
  evaluated on the settled world at that instant); it costs the next
  tier's house materials and requires the next tier to be unlocked (§12).
  The upgraded house keeps its ID and position and starts at its new tier's
  `floor`. Upgrading is the only way inhabitants of a higher tier appear (so
  the player controls the tier mix). A tier may be *declared* in content
  without a house (residents, tax, unlock conditions only); upgrading into
  it fails with a typed error until its house exists.

### 6.2 Needs

Each tier has a list of needs, each either:

- **Goods need (category, D-031):**
  `{category, weight, goods: [{good, per_resident_per_min}], variety_bonus,
  max_extra_goods}`. A good is *supplied* when it is not in the starved
  regime, or is starved but still has arrivals. The island's houses of that
  tier share the category's demand **equally among the supplied goods**:
  with `m` supplied goods each is consumed at
  `residents × per_resident_per_min / m` (so a house supplied with two goods
  does not eat double). If a supplied good runs short, the shortfall is
  drawn from the other goods **in list order** from whatever slack they
  have (unlimited for non-starved goods, up to the unused arrivals for
  starved ones). Fulfilment is 1 if any supplied good is non-starved,
  otherwise `min(1, Σ consumed / demand)`. **Variety** = `min(m − 1,
  max_extra_goods)`. Adding a supplied good never lowers fulfilment, tax or
  growth (invariant, §13). Lower-tier goods are not accepted by higher
  tiers' categories (D-033). Tier 1 categories have exactly one good
  (D-032). Houses count as running consumers for warehouse throughput and
  upstream blocking (§4, §5).
- **Building need:** `{building, radius, weight}`. Fulfilled (1) if a
  public building of that type is within `radius` of the house — Euclidean
  distance between tile centres from the **nearest footprint tile of the
  house** to the **nearest footprint tile** of the public building (D-042)
  — and that building is road-connected to a warehouse and not paused; the
  house itself must be road-adjacent; else 0. The UI reason is, in
  precedence, `not_connected`, `paused`, `out_of_range`.
- Every need carries a flag `required` (counts toward satisfaction, so it
  gates growth and base tax) or `optional` (bonus only; D-012 guardrail).
  The flag is independent of the category name: the Patricians' `luxury`
  category is a `required` category like any other; `optional` needs are
  the mechanism for adding bonus needs to an existing tier after launch.

**Satisfaction** of a house = weighted mean of its required needs'
fulfilment (1 if the tier has no required needs; required weights sum to 1).
**Variety multiplier** of a house = `1 + Σ_categories variety × variety_bonus`
(provisional bonus 0.10 per extra good, max 2 extras per category); it
multiplies both tax and growth rate. Optional needs add up to
`optional_tax_bonus` (content, provisional 0.25 = +25 %) tax, scaled by the
weighted fulfilment of the optional needs.

### 6.3 Taxes

- `tax_rate[tier]` gold per resident per minute (content, CONTENT §2;
  currently Settlers 0.20, Citizens 0.48, Merchants 1.20, Patricians 2.80),
  multiplied by `satisfaction`, by the `variety_multiplier` (§6.2) and by
  `(1 + optional_tax_bonus × optional_fulfilment)`; each factor rounds
  down.
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

Never auto-paused: houses, warehouses, roads, shipyard, harbourmaster,
decorations.

- **Auto-resume**: the candidate is the most recently auto-paused
  building. It resumes when both hold: (a) gold ≥
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
- A paused public building fulfils no building need; paused buildings
  have no upkeep and need no workforce.
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
- Settling a new island requires a ship carrying the warehouse cost (planks,
  tools, gold); the first warehouse is placed from the ship.

## 9. Ships and routes (D-007, D-015)

### 9.1 Ships

- Types (provisional): *Sloop* (2 slots × 50, speed 1.0, build 2 min, tier 1),
  *Brig* (4 × 50, 1.2, 5 min, tier 2), *Galleon* (6 × 60, 1.0, 10 min, tier 3).
  Later: war ships (D-005).
- Shipyard build = scheduled event `ship_built`; one ship at a time per
  shipyard; costs deducted at order time; cancel refunds 50 % materials.
- Ships have upkeep (gold/min) and a `state`: `idle@island`, `on_route`,
  `manual_leg`, `on_world_map`, `anchored_unpaid`.

### 9.2 Routes

```
route: { stops: [{island, load: [{good, max_amount}], unload: [{good}]}], ships: [...] }
```

- At a stop: unload listed goods (respecting capacity; remainder stays
  aboard), then load listed goods up to `max_amount` per slot availability.
  Loading takes `handling_time` (provisional 20 s) + 0 s per unit (abstract).
- Travel time between islands = `distance / speed` where distance is the
  straight-line archipelago distance in tiles over a fixed speed constant
  (provisional: 1–5 min typical).
- A ship is `{routeId, stopIndex, legDepartAt, legArriveAt, cargo}`; its
  visual position is interpolated from the leg timers.
- Manual shipment = a one-off route of two stops that ends in `idle`.

## 10. Islands, archipelago and settling (D-016)

- Each archipelago has 6–8 islands of varied size (small/medium/large)
  generated from a seed. Each island gets fertilities (2–4 from the pool),
  typed deposit slots (0–4) and a harbour area proportional to its coast.
- **Settling is gated** (D-039): the start island and one further island are
  settleable at once; additional islands unlock at tier milestones defined in
  content (`islands.json: unlock`). Locked islands are visible and show their
  resources and unlock condition.
- **Generator guarantees** (over the archipelago, per tier): the start island
  always has forest, fish, grass, stone slot(s) and one of wheat/apple; iron
  and hemp are on the second settleable island, never the first; clay, salt,
  hops, woad and coal are reachable with the islands unlocked at Merchants;
  grapes, quartz, copper and gold (exactly one gold slot) with those unlocked
  at Patricians. Slot totals are chosen so that a balanced top-tier economy
  needs most islands.
- All islands are visible from the start. Settling requires a warehouse
  delivery by ship (section 8).

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
{ "population": { "settlers": 120 }, "buildings": ["market_small"], "goods_delivered": [] }
```

Conditions are evaluated against the player's whole archipelago at the end
of every advancement and after every successful command; `population`
keys must be earlier tiers. The first tier is always unlocked. Unlocks are
permanent (no regression) and have no rate effect; the unlock moment is
reported as a `tier_unlocked` boundary. Placing a building (or road) of a
locked tier fails with `ErrTierLocked`. A non-empty `goods_delivered` list
cannot be satisfied until trade routes exist (M4).

## 13. Invariants (tested)

- Conservation: goods are only created by recipes and only destroyed by
  consumption, demolition surplus, or explicit removal.
- `0 ≤ stock ≤ capacity` for every good on every island after every step.
- `gold ≥ 0` always.
- `floor ≤ residents ≤ max` for every house.
- `0 ≤ workforce_factor ≤ 1`; a building never occupies more than one slot.
- Variety never reduces fulfilment: adding a good to a category is
  monotonic non-decreasing for tax and growth.
- Unlocked tiers never shrink.
- `advance(advance(s, t1), t2) == advance(s, t2)` for `t1 ≤ t2`.
- Applying an event at `due_at` then advancing equals the recorded behaviour
  regardless of processing delay.

## 14. UI feedback rules derived from mechanics

Each building state maps to one icon and one sentence with a fix. A building
has exactly one primary status; precedence when several apply:
`paused` > `not_connected` > `warehouse_full` > `input_starved` >
`throttled` > `short_of_workers` > `low_efficiency` > `ok`.

| State | Message | Suggested fix |
|---|---|---|
| paused (player) | "Paused by you" | resume |
| not connected | "No road to a warehouse" | build road |
| input starved | "Missing: iron ore (0/min)" | build producer / import |
| warehouse full | "Planks at capacity (400/400)" | upgrade warehouse / consume |
| throttled | "Warehouse overloaded (140 %)" | second warehouse / upgrade |
| unpaid | "Paused: insufficient gold (balance −3.2/min)" | demolish / grow / resume manually |
| low efficiency | "Only 60 % fertile land in range" | move / clear |
| short of workers | "Needs 12 Citizens on this island (8 available)" | build/upgrade houses here |
| no slot | "No free iron slot on this island" | other island / trade |
