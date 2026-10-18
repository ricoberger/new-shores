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
  2. find the earliest **boundary** — a buffer becomes empty/full, a house
     reaches a growth threshold, gold would cross zero, a cycle completes, or
     `toTime`;
  3. advance all quantities linearly to that boundary; apply the boundary's
     discrete effect; repeat.
- Iteration cap: if more than N boundaries (provisional 10 000) occur in one
  advancement, the simulation switches to a coarse step (1 min) for the rest.
  This bounds pathological cases such as 90-day gaps; warehouse caps make it
  rare.
- All quantities are stored as fixed-point integers (milli-units) to keep
  determinism across platforms.

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
  terrain type (water, coast, grass, forest, mountain), optional **fertility**
  tags (e.g. `wheat`, `hemp`, `grapes`) and optional **deposits** (stone, iron,
  salt, quartz, copper, gold) with finite or infinite quantity (provisional:
  infinite at launch).
- Buildings have a rectangular footprint, a rotation, and an **entrance tile**
  that must touch a road (except roads, decorations, and farm fields).
- Coastal buildings (warehouse, fisher, shipyard, harbourmaster) need a
  footprint edge on coast tiles.
- Farms and lumberjacks have a **work area** (radius) that must contain enough
  fertile/forest tiles; their rate scales with the fraction available
  (0–100 %), computed on placement and when neighbouring tiles change.
- Placement validity is computed in the simulation, never from mesh collision.
- Demolition refunds 50 % of materials, no gold (D-019). Demolishing a
  warehouse re-assigns its producers to the next nearest connected warehouse;
  if the island inventory exceeds the new capacity, the surplus is lost after
  a confirmation dialog.

## 3. Roads and connection (D-014)

- A producer is **connected** if there is a road path from its entrance to a
  warehouse entrance on the same island. Roads are tiles; dirt roads (tier 1)
  and paved roads (tier 2, +speed) are the two types.
- Each connected producer is **assigned** to the nearest warehouse by road
  distance `d` (tiles). Assignment is recomputed when roads or warehouses
  change.
- **Transfer delay** per delivery: `base + d × per_tile` (provisional 10 s +
  1 s/tile on dirt, 0.6 s/tile on paved). The delay is a latency: output
  produced at `t` arrives in the island inventory at `t + delay`.
- Unconnected producers run until their internal output buffer (provisional 5
  units) is full, then stop, and are flagged.

## 4. Production

Each production building has a recipe:

```
inputs:  [{good, amount}]      consumed per cycle from the island inventory
outputs: [{good, amount}]      added to the inventory after transfer delay
cycle:   seconds               at 100 % efficiency
```

- **Rate** = `amount / cycle × efficiency × throughput_factor`, where
  efficiency comes from the work area (farms) and `throughput_factor` from the
  assigned warehouse (section 5).
- Inputs are drawn from the island inventory continuously at the same rate
  (fluid model). If any input stock is zero and its net rate is ≤ 0, the
  building is **input-starved** and its rate is zero.
- Output is blocked when the good is at **capacity** in the island inventory
  (D-008); the building shows "warehouse full".
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
  60). If the sum of output rates of its assigned producers `R > T`, every
  assigned producer gets `throughput_factor = T / R`; else 1. The UI shows
  warehouse load as `R / T`.
- Warehouses are **upgraded in place** (gold + materials) rather than
  demolished; an upgrade raises capacity and throughput. Additional
  warehouses can also be built (coastal only).
- Goods bought via trade or delivered by ships bypass throughput (they arrive
  at the pier) but respect capacity; excess waits aboard the ship.

## 6. Population and needs (D-013)

### 6.1 Houses

- A house belongs to a tier and has `residents` in `[floor, max]`
  (provisional Settlers 2–8, Citizens 5–15, Merchants 9–25, Patricians
  14–40). `floor` is the minimum that never leaves (D-009).
- **Growth rate** = `growth_per_min × satisfaction` when `satisfaction ≥ 0.5`;
  **decline rate** = `decline_per_min × (0.5 − satisfaction)` down to `floor`
  when below. Provisional: +1 resident/min at full satisfaction, −0.5/min at
  zero.
- **Upgrade** to the next tier is a player action on a house at `max`
  residents with all needs of the *current* tier satisfied; it costs the next
  tier's house materials. The upgraded house starts at its new tier's `floor`.
  Upgrading is the only way inhabitants of a higher tier appear (so the player
  controls the tier mix).

### 6.2 Needs

Each tier has a list of needs, each either:

- **Goods need:** `{good, per_resident_per_min, weight}`. The island's houses of
  that tier consume `residents × per_resident_per_min` continuously from the
  island inventory. Fulfilment = `min(1, supply_rate / demand_rate)` when stock
  is zero, else 1.
- **Building need:** `{building_type, radius, weight}`. Fulfilled (1) if a
  connected public building of that type is within `radius` tiles of the house
  entrance; else 0.
- Needs are `basic` (required for growth and tax) or `luxury` (bonus only;
  D-012 guardrail).

**Satisfaction** of a house = weighted mean of its basic needs' fulfilment.
Luxury needs add up to +25 % tax.

### 6.3 Taxes

- `tax_rate[tier]` gold per resident per minute (provisional Settlers 0.05,
  Citizens 0.12, Merchants 0.3, Patricians 0.7), multiplied by
  `satisfaction` and by `(1 + 0.25 × luxury_fulfilment)`.
- Taxes only accrue from houses; nothing else creates gold (D-018).

## 7. Gold, upkeep and insolvency (D-017)

- `balance_rate` = Σ taxes − Σ upkeep of non-paused buildings and ships.
- Gold can never go below zero. When the advancement reaches a boundary where
  gold would cross zero with a negative rate, the simulation **auto-pauses one
  building** according to the order below, recomputes rates, and continues.
  Repeat until the rate is ≥ 0 or nothing pausable remains (then gold simply
  stays at zero and taxes accrue as they come).

Auto-pause order (first paused first; within a step, lowest upkeep first so
the fewest buildings stop):

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

- **Auto-resume**: when gold ≥ 5 min of the paused building's upkeep *and*
  `balance_rate` after resuming would be ≥ 0, resume in reverse order, one at
  a time (hysteresis).
- Buildings paused for insolvency are flagged `paused_reason = unpaid` and
  shown distinctly from `paused_reason = player`.

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

- Each archipelago has 4–6 islands generated from a seed with a guaranteed
  **resource distribution**: the start island always has forest, fish, grass
  and stone; iron and hemp are guaranteed on *other* islands so the trade
  route is a real need by tier 2; later deposits (salt, quartz, copper, gold)
  are spread so no single island has everything.
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

Conditions are evaluated against the player's whole archipelago. Unlocks are
permanent (no regression).

## 13. Invariants (tested)

- Conservation: goods are only created by recipes and only destroyed by
  consumption, demolition surplus, or explicit removal.
- `0 ≤ stock ≤ capacity` for every good on every island after every step.
- `gold ≥ 0` always.
- `floor ≤ residents ≤ max` for every house.
- `advance(advance(s, t1), t2) == advance(s, t2)` for `t1 ≤ t2`.
- Applying an event at `due_at` then advancing equals the recorded behaviour
  regardless of processing delay.

## 14. UI feedback rules derived from mechanics

Each building state maps to one icon and one sentence with a fix:

| State | Message | Suggested fix |
|---|---|---|
| not connected | "No road to a warehouse" | build road |
| input starved | "Missing: iron ore (0/min)" | build producer / import |
| warehouse full | "Planks at capacity (400/400)" | upgrade warehouse / consume |
| throttled | "Warehouse overloaded (140 %)" | second warehouse / upgrade |
| unpaid | "Paused: insufficient gold" | demolish / grow / resume manually |
| low efficiency | "Only 60 % fertile land in range" | move / clear |
