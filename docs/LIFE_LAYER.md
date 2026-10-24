# New Shores — Life Layer brief (art task 4)

Status: **design groundwork for art task 4**; follows ART_DIRECTION §5
("life carries the feeling", "every animation encodes a game state") and
D-050. Nothing here changes rules or state: every element below is
derived on the client from the display payload (rates, timers, statuses,
residents) and extrapolated between fetches (D-027).

## 1. Principles

- **State → motion.** No decoration animates unless it says something: no
  smoke = not running; no walkers = not connected or starved; no boats =
  no fisher; desaturated = paused; a ship at a berth = loading.
- **Deterministic.** Positions and phases come from timers and IDs (seeded
  hashes), never from `Math.random()` at render time, so two clients show
  the same scene and screenshots are reproducible.
- **Near LOD only** for everything that moves per frame; mid shows static
  props and smoke only; far nothing (ships excepted — they move at all
  LODs already).
- **Budgets** (validated on the baseline device, iPhone 15 Pro Max):
  ≤ 150 animated instances per visible island on phones, ≤ 400 on
  desktop; one merged/instanced mesh per element class; particle systems
  pooled, ≤ 64 live particles per island on phones.

## 2. Elements, their state source and their models

| Element | State source (display payload) | Motion | Model |
|---|---|---|---|
| **Carts** (exist) | producer transfer segments: `assigned_warehouse_id`, `transfer_delay_ms`, rate | along the road path producer → collector, phase from the segment timer; wheels spin (KayKit `cart` has wheel nodes) | KayKit `cart` (empty back) / `cart_merchant` (loaded back) by whether cargo is on the leg |
| **Walkers** | same transfer segments, one walker per producer with rate > 0, plus one per house tier bucket | walk producer → collector and back; idle bob at the door when starved/unconnected = **no walker** | procedural chunky villager (body + head + hat; tier colours), 3 variants |
| **Chimney smoke** | building `status === "ok"` and producer rate > 0; `anchor: chimney` from the manifest | pooled particles rising, drifting with a fixed wind; density ∝ throughput factor | particle quads, palette smoke grey; none when paused/unpaid/starved |
| **Sails and flags** | always for ships on legs; flags on Trading Post, shipyard, market | vertex sway (sine over time + fixed wind), sail bulge when sailing | recipe parts (`canvas` role), `flag_*` |
| **Fishing boats** | fisher `status === "ok"` | small loop out from the jetty and back on a fixed ellipse; bob | KayKit `boat` |
| **Gulls** | island has a fisher or a Trading Post | 3–5 per island circling over the harbour, two-frame wing flap | procedural (two quads) |
| **Inhabitants** | house residents (whole numbers) | 1 stroller per 8 residents strolling on nearby roads, pausing at the market | villager variants, tier colours |
| **Pasture animals** (exist as static) | pasture assigned to a farm with efficiency > 0 | slow idle wander within the field, head bob | procedural sheep/cattle blobs (recipe); horses later |
| **Construction** | placement rise-in (exists) | replace the rise-in with `building_stage_A→B→C` over the 2–5 s visual build, scaffolding on larger footprints | KayKit `building_stage_*`, `building_scaffolding` |
| **Berth activity** | ship `state: handling` / `waiting_for_berth` (D-051) | crates appear on the quay while handling; waiting ships bob at anchor | KayKit crates, `anchor` |
| **Water life** | always, near LOD | foam line (exists), occasional fish ripple near fishers | procedural |

Not in scope: weather, day/night (D-048), combat units, horses as traffic.

## 3. Derivation details

- **Paths:** walkers and carts need a road path producer → collector. The
  client already computes a visual road path for carts (PR #4
  interpretation); reuse it. No pathfinding over non-road tiles; if a
  producer is unconnected there is no path and therefore no walker — the
  rule and the visual agree.
- **Phase:** `phase = ((now − segment.start) / segment.duration) mod 1`
  per transfer segment; a producer with rate `r` spawns `ceil(r /
  cart_capacity)` carts spread evenly in phase (cap 3 per producer).
- **Smoke density:** particles per second = base × `throughput_factor` ×
  `efficiency`, 0 when `status ≠ ok`.
- **Stroller count:** `floor(residents / 8)` per house, placed on the
  nearest road tiles by hash(building id, index), re-spread when the
  resident count changes (a boundary in the payload).
- **Pasture animals:** `fields.assigned × 2` sheep per sheep farm, wander
  inside their own field footprints.

## 4. Pipeline additions

- Recipes for: villager variants (3, tier colour role), sheep and cattle
  blobs, gull, smoke particle texture (procedural 32 px), construction
  stages (KayKit, re-paletted), `cart` / `cart_merchant` with wheel pivots
  preserved as anchors, `boat`.
- Manifest anchors: `chimney`, `door`, `flag` per building (several
  recipes already set anchors; complete the set).
- Instancing: walkers, animals, gulls and carts as thin instances per
  class per island (they move every frame; merging is wrong here);
  measure against the budget on the device and on the perf project
  (expect low software fps — floors are tripwires).

## 5. Tests and gate material

- Vitest: phase math, cart count per rate, stroller placement hash,
  smoke density function, "no state → no motion" table (status ×
  element).
- Playwright: fixture `town` at near LOD — carts and walkers present for
  connected producers, absent for a disconnected one; smoke only on
  running producers; construction stages during a placement; perf
  project with the life layer on (new floors after the device check).
- Gate screenshots: dense town near with life, start island with a
  fisher boat and gulls, a paused producer (no smoke, no walkers), a
  construction in progress; a 10 s screen recording from the phone.

## 6. Kit inventory used (KayKit Medieval Hexagon SOURCE)

`units/neutral`: `cart`, `cart_merchant`, `horse_A–G`, `horse_saddle`,
`unit` (pawn — not used for villagers), `banner`, `boat`, `anchor`;
`decoration/props`: `haybale`, `trough`, `trough_long`, `wheelbarrow`,
crates, barrels, sacks, `flag_*`; `buildings/neutral`:
`building_stage_A/B/C`, `building_scaffolding`, `building_destroyed`.
No skinned animations in the pack — all motion is procedural.
