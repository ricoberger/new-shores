# New Shores — Content: Tiers, Goods, Buildings, Chains

Status: **Proposed launch catalogue, numbers provisional.** Structure (tiers,
which chain belongs to which tier, construction-material progression) is
agreed; all quantities are balancing values to be tuned in the first playable
and beyond. Derived from the Anno Online timeline and production chains as a
starting point, adapted to our four tiers (D-010) and to the rules in
[MECHANICS.md](MECHANICS.md). Colonial goods are reserved for later regions
(D-011, D-012).

Content IDs are stable snake_case strings and never reused.

## 1. Region

| ID | Name (working) | Climate | Notes |
|---|---|---|---|
| `old_coast` | The Old Coast | temperate | launch region; all content below |

## 2. Tiers

| # | ID | Name | House residents (floor–max) | Tax/resident/min | House cost |
|---|---|---|---|---|---|
| 1 | `settlers` | Settlers | 2–8 | 0.05 | 10 planks |
| 2 | `citizens` | Citizens | 5–15 | 0.12 | 15 planks, 10 stone, 200 gold |
| 3 | `merchants` | Merchants | 9–25 | 0.30 | 20 planks, 20 stone, 5 tools, 1 500 gold |
| 4 | `patricians` | Patricians | 14–40 | 0.70 | 25 stone, 10 tools, 10 glass, 8 000 gold |

### Unlock conditions

| Unlocks | Requires |
|---|---|
| Citizens | 120 Settlers, `market_small`, `chapel` |
| Merchants | 400 Citizens, `tavern`, a trade route delivering ≥ 1 good |
| Patricians | 800 Merchants, `church`, `harbourmaster_office` |

### Needs

Weights sum to 1 per tier; `basic` unless marked *luxury*. Consumption in
units per resident per minute (provisional; a 60 s cycle producer making 1 unit
= 1 unit/min).

| Tier | Goods needs (unit/res/min) | Building needs (radius) |
|---|---|---|
| Settlers | fish 0.010 (0.5), wool_garments 0.005 (0.2) | `market_small` 12 (0.3) |
| Citizens | fish 0.010 (0.2), bread 0.008 (0.2), cider 0.006 (0.15), linen_garments 0.005 (0.15) | `market_small` 12 (0.1), `chapel` 16 (0.1), `tavern` 14 (0.1) |
| Merchants | bread 0.008 (0.15), beer 0.006 (0.15), leather_jerkins 0.004 (0.15), books 0.002 (0.1) | `market_medium` 14 (0.15), `church` 20 (0.15), `tavern` 14 (0.15) |
| Patricians | meat 0.006 (0.15), wine 0.004 (0.15), candles 0.004 (0.15), spectacles 0.002 (0.1), *luxury:* jewellery 0.001 | `market_large` 16 (0.15), `church` 20 (0.1), `theatre` 22 (0.2) |

## 3. Goods

| ID | Type | Produced by | Consumed by |
|---|---|---|---|
| `wood` | raw | lumberjack | sawmill, charcoal_burner, paper_mill |
| `planks` | construction | sawmill | construction, shipyard, cooperage |
| `stone` | construction | quarry | construction |
| `iron_ore` | raw | iron_mine | smelter |
| `charcoal` | intermediate | charcoal_burner | smelter, glass_smelter |
| `iron` | intermediate | smelter | toolmaker, metalworks |
| `tools` | construction | toolmaker | construction, shipyard |
| `quartz` | raw | quartz_quarry | glass_smelter |
| `glass` | construction | glass_smelter | construction, optician |
| `fish` | food | fisher | Settlers, Citizens |
| `wool` | raw | sheep_farm | weaver_wool |
| `wool_garments` | clothing | weaver_wool | Settlers |
| `wheat` | raw | wheat_farm | mill, brewery |
| `flour` | intermediate | mill | bakery |
| `bread` | food | bakery | Citizens, Merchants |
| `apples` | raw | orchard | cidery |
| `cider` | drink | cidery | Citizens |
| `hemp` | raw | hemp_farm | weaver_linen, sailmaker |
| `linen_garments` | clothing | weaver_linen | Citizens |
| `sails` | construction | sailmaker | shipyard |
| `hops` | raw | hop_farm | brewery |
| `beer` | drink | brewery | Merchants |
| `salt` | intermediate | salt_works | tannery, butcher |
| `brine` | raw | salt_mine | salt_works |
| `pigs` | raw | pig_farm | tannery |
| `leather_jerkins` | clothing | tannery | Merchants |
| `paper` | intermediate | paper_mill | printing_press |
| `books` | luxury | printing_press | Merchants |
| `cattle` | raw | cattle_farm | butcher |
| `meat` | food | butcher | Patricians |
| `grapes` | raw | vineyard | winepress |
| `barrels` | intermediate | cooperage | winepress |
| `wine` | drink | winepress | Patricians |
| `wax` | raw | apiary | candle_foundry |
| `candles` | luxury | candle_foundry | Patricians |
| `copper_ore` | raw | copper_mine | copper_smelter |
| `brass` | intermediate | copper_smelter | optician |
| `spectacles` | luxury | optician | Patricians |
| `gold_ore` | raw | gold_mine | goldsmith |
| `jewellery` | luxury | goldsmith | Patricians (luxury need) |

Construction-material progression (mirrors Anno Online): Settlers build with
planks; Citizens add stone; Merchants add tools; Patricians add glass.

## 4. Production chains

Notation: `building (inputs → outputs, cycle s)`. Ratios give the number of
buildings for a balanced chain at 100 %.

### Tier 1 — Settlers

| Chain | Buildings | Ratio |
|---|---|---|
| Planks | `lumberjack` (forest → 1 wood, 30 s), `sawmill` (1 wood → 1 planks, 30 s) | 1 : 1 |
| Fish | `fisher` (coast → 1 fish, 40 s) | — |
| Wool garments | `sheep_farm` (grass → 1 wool, 60 s), `weaver_wool` (1 wool → 1 wool_garments, 60 s) | 1 : 1 |

Public/infrastructure: `warehouse` (lvl 1), `road_dirt`, `market_small`,
`chapel`, `shipyard` (sloop), `house_settlers`.

### Tier 2 — Citizens

| Chain | Buildings | Ratio |
|---|---|---|
| Stone | `quarry` (stone deposit → 1 stone, 45 s) | — |
| Tools | `iron_mine` (iron deposit → 1 iron_ore, 60 s), `charcoal_burner` (1 wood → 1 charcoal, 45 s), `smelter` (1 iron_ore + 1 charcoal → 1 iron, 60 s), `toolmaker` (1 iron → 1 tools, 60 s) | 1 : 1.3 : 1 : 1 |
| Bread | `wheat_farm` (wheat fertility → 1 wheat, 60 s), `mill` (1 wheat → 1 flour, 30 s), `bakery` (1 flour → 1 bread, 60 s) | 2 : 1 : 2 |
| Cider | `orchard` (apple fertility → 1 apples, 90 s), `cidery` (1 apples → 1 cider, 45 s) | 2 : 1 |
| Linen | `hemp_farm` (hemp fertility → 1 hemp, 60 s), `weaver_linen` (1 hemp → 1 linen_garments, 45 s) | 3 : 2 |
| Sails | `sailmaker` (1 hemp → 1 sails, 60 s) | — |

Public/infrastructure: `warehouse` lvl 2, `road_paved`, `tavern`,
`house_citizens`, brig at the shipyard. Iron and hemp are guaranteed **not**
on the start island (MECHANICS §10) so the tier-2 → 3 route requirement is
natural.

### Tier 3 — Merchants

| Chain | Buildings | Ratio |
|---|---|---|
| Beer | `hop_farm` (hop fertility → 1 hops, 60 s), `brewery` (1 wheat + 1 hops → 1 beer, 60 s) | 1 : 1 (+1 wheat_farm) |
| Leather jerkins | `pig_farm` (grass → 1 pigs, 90 s), `salt_mine` (salt deposit → 1 brine, 30 s), `salt_works` (1 brine + 1 charcoal → 1 salt, 30 s), `tannery` (1 pigs + 1 salt → 1 leather_jerkins, 60 s) | 3 : 1 : 2 : 2 |
| Books | `paper_mill` (1 wood → 1 paper, 30 s), `printing_press` (1 paper → 1 books, 60 s) | 1 : 2 |
| Glass | `quartz_quarry` (quartz deposit → 1 quartz, 60 s), `glass_smelter` (1 quartz + 1 charcoal → 1 glass, 60 s) | 1 : 1 |

Public/infrastructure: `warehouse` lvl 3, `market_medium`, `church`,
`harbourmaster_office` (world map, expeditions, contracts), `house_merchants`,
galleon at the shipyard.

### Tier 4 — Patricians

| Chain | Buildings | Ratio |
|---|---|---|
| Meat | `cattle_farm` (grass → 1 cattle, 120 s), `butcher` (1 cattle + 1 salt → 1 meat, 60 s) | 2 : 1 |
| Wine | `vineyard` (grape fertility → 1 grapes, 90 s), `cooperage` (1 planks + 1 iron → 1 barrels, 60 s), `winepress` (2 grapes + 1 barrels → 1 wine, 60 s) | 3 : 1 : 1.5 |
| Candles | `apiary` (meadow → 1 wax, 90 s), `candle_foundry` (1 wax → 1 candles, 45 s) | 2 : 1 |
| Spectacles | `copper_mine` (copper deposit → 1 copper_ore, 60 s), `copper_smelter` (1 copper_ore + 1 charcoal → 1 brass, 60 s), `optician` (1 brass + 1 glass → 1 spectacles, 90 s) | 1 : 1 : 1.5 |
| Jewellery (luxury) | `gold_mine` (gold deposit → 1 gold_ore, 120 s), `goldsmith` (1 gold_ore → 1 jewellery, 90 s) | 1 : 1.3 |

Public/infrastructure: `warehouse` lvl 4, `market_large`, `theatre`,
`house_patricians`.

## 5. Buildings — summary table

Footprint in tiles; upkeep in gold/min; costs are provisional. "Coastal" means
an edge must touch coast. `R` = requires road connection.

| ID | Tier | Footprint | Cost (gold / planks / stone / tools / glass) | Upkeep | Notes |
|---|---|---|---|---|---|
| `house_settlers` | 1 | 2×2 | 0 / 10 / – / – / – | 0 | R |
| `road_dirt` | 1 | 1×1 | 0 / – | 0 | |
| `warehouse` | 1 | 4×3 coastal | 200 / 30 | 4 | lvl 1: cap 300/good, T 60/min |
| `market_small` | 1 | 3×3 | 150 / 15 | 3 | R, radius 12 |
| `chapel` | 1 | 2×2 | 300 / 10 / 5 | 3 | R, radius 16 |
| `lumberjack` | 1 | 2×2 | 50 / 5 | 1 | R, work radius 4 forest |
| `sawmill` | 1 | 2×2 | 80 / 8 | 2 | R |
| `fisher` | 1 | 2×2 coastal | 60 / 6 | 1 | R |
| `sheep_farm` | 1 | 3×3 + fields | 100 / 10 | 2 | R, grass radius 4 |
| `weaver_wool` | 1 | 2×2 | 120 / 10 | 2 | R |
| `shipyard` | 1 | 5×4 coastal | 500 / 40 | 5 | R |
| `house_citizens` | 2 | 2×2 | 200 / 15 / 10 | 0 | upgrade only |
| `road_paved` | 2 | 1×1 | 5 / – / 1 | 0 | |
| `quarry` | 2 | 3×3 on deposit | 300 / 20 | 4 | R |
| `iron_mine` | 2 | 3×3 on deposit | 400 / 25 / 10 | 5 | R |
| `charcoal_burner` | 2 | 2×2 | 150 / 10 | 3 | R |
| `smelter` | 2 | 3×3 | 400 / 20 / 20 | 6 | R |
| `toolmaker` | 2 | 2×2 | 400 / 15 / 15 | 5 | R |
| `wheat_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | R, wheat fertility |
| `mill` | 2 | 2×2 | 250 / 20 / 10 | 3 | R |
| `bakery` | 2 | 2×2 | 300 / 15 / 15 | 4 | R |
| `orchard` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | R, apple fertility |
| `cidery` | 2 | 2×2 | 300 / 15 / 10 | 4 | R |
| `hemp_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | R, hemp fertility |
| `weaver_linen` | 2 | 2×2 | 300 / 15 / 10 | 4 | R |
| `sailmaker` | 2 | 2×2 | 300 / 20 / 5 | 3 | R |
| `tavern` | 2 | 3×3 | 600 / 30 / 20 | 6 | R, radius 14 |
| `house_merchants` | 3 | 2×2 | 1 500 / 20 / 20 / 5 | 0 | upgrade only |
| `hop_farm` | 3 | 3×3 + fields | 500 / 20 / 10 / 2 | 5 | R, hop fertility |
| `brewery` | 3 | 3×3 | 1 200 / 30 / 30 / 10 | 10 | R |
| `pig_farm` | 3 | 3×3 + fields | 600 / 20 / 10 / 2 | 5 | R, grass |
| `salt_mine` | 3 | 3×3 on deposit | 1 000 / 30 / 30 / 10 | 8 | R |
| `salt_works` | 3 | 2×2 coastal or inland | 800 / 20 / 20 / 10 | 8 | R |
| `tannery` | 3 | 3×3 | 1 200 / 30 / 30 / 10 | 10 | R |
| `paper_mill` | 3 | 3×3 | 1 000 / 30 / 20 / 10 | 8 | R |
| `printing_press` | 3 | 2×2 | 1 500 / 20 / 30 / 15 | 12 | R |
| `quartz_quarry` | 3 | 3×3 on deposit | 1 200 / 30 / 30 / 10 | 8 | R |
| `glass_smelter` | 3 | 3×3 | 1 500 / 30 / 40 / 15 | 12 | R |
| `market_medium` | 3 | 4×4 | 2 000 / 40 / 40 / 10 | 10 | R, radius 14 |
| `church` | 3 | 4×5 | 5 000 / 50 / 100 / 20 | 15 | R, radius 20 |
| `harbourmaster_office` | 3 | 5×4 coastal | 8 000 / 80 / 80 / 30 | 15 | R; world map |
| `house_patricians` | 4 | 2×2 | 8 000 / – / 25 / 10 / 10 | 0 | upgrade only |
| `cattle_farm` | 4 | 4×4 + fields | 2 500 / 40 / 30 / 10 / – | 12 | R, grass |
| `butcher` | 4 | 3×3 | 3 000 / 30 / 40 / 15 / 5 | 15 | R |
| `vineyard` | 4 | 3×3 + fields | 2 500 / 30 / 30 / 10 / – | 12 | R, grape fertility |
| `cooperage` | 4 | 2×2 | 2 500 / 30 / 30 / 15 / – | 12 | R |
| `winepress` | 4 | 3×3 | 4 000 / 30 / 50 / 20 / 10 | 18 | R |
| `apiary` | 4 | 2×2 + fields | 2 000 / 30 / 20 / 10 / – | 10 | R, meadow |
| `candle_foundry` | 4 | 2×2 | 3 500 / 30 / 40 / 15 / 10 | 15 | R |
| `copper_mine` | 4 | 3×3 on deposit | 4 000 / 40 / 50 / 20 / – | 15 | R |
| `copper_smelter` | 4 | 3×3 | 4 500 / 40 / 60 / 20 / 10 | 18 | R |
| `optician` | 4 | 2×2 | 6 000 / 30 / 50 / 25 / 20 | 20 | R |
| `gold_mine` | 4 | 3×3 on deposit | 8 000 / 40 / 60 / 30 / – | 20 | R |
| `goldsmith` | 4 | 2×2 | 8 000 / 30 / 50 / 30 / 20 | 20 | R |
| `market_large` | 4 | 5×5 | 10 000 / 60 / 100 / 30 / 20 | 20 | R, radius 16 |
| `theatre` | 4 | 5×5 | 20 000 / 80 / 150 / 50 / 60 | 30 | R, radius 22 |

Warehouse upgrade levels (provisional): lvl 2 cap 500 / T 90 (Citizens), lvl 3
cap 800 / T 130 (Merchants), lvl 4 cap 1 200 / T 180 (Patricians).

## 6. Ships

| ID | Tier | Slots × size | Speed | Build | Cost | Upkeep |
|---|---|---|---|---|---|---|
| `sloop` | 1 | 2 × 50 | 1.0 | 2 min | 300 gold, 30 planks, 10 sails* | 2 |
| `brig` | 2 | 4 × 50 | 1.2 | 5 min | 1 500 gold, 60 planks, 20 sails, 10 tools | 4 |
| `galleon` | 3 | 6 × 60 | 1.0 | 10 min | 6 000 gold, 120 planks, 40 sails, 30 tools | 8 |

\*The starting stock includes sails for one sloop so the first ship does not
require the tier-2 sailmaker; later sloops do.

## 7. Islands

Archipelago generation guarantees (MECHANICS §10):

| Resource | Start island | Elsewhere |
|---|---|---|
| forest, grass, fish, stone | always | common |
| wheat, apple fertility | usually one of the two | common |
| iron deposit, hemp fertility | **never** | guaranteed on ≥ 1 island |
| hops, salt, quartz | never | spread across ≥ 2 islands |
| grapes, copper, gold, meadow | never | spread; gold on exactly one |

## 8. Decorations (cosmetic, Doubloons)

Launch set (examples): hedge, hedge corner, flower bed, lantern, well, small
statue, fountain, pond, old tree, bell tower, pillory, graveyard, maypole;
seasonal items later. Zero gameplay effect (D-021). Also cosmetic: ship skins
(sail colours, figureheads) and house facade variants per tier.

## 9. Content data format

Content lives in `content/<region>/*.json`, one file per entity type
(`tiers.json`, `goods.json`, `buildings.json`, `needs.json`, `ships.json`,
`quests.json`, `islands.json`, `decorations.json`), with a JSON Schema under
`content/schema/`. The server validates on startup and fails fast on broken
references; the client gets generated TypeScript types for display only.

```json
{
  "id": "smelter",
  "region": "old_coast",
  "tier": "citizens",
  "footprint": [3, 3],
  "coastal": false,
  "requires_road": true,
  "cost": { "gold": 400, "planks": 20, "stone": 20 },
  "upkeep_per_min": 6,
  "recipe": { "inputs": [{ "good": "iron_ore", "amount": 1 }, { "good": "charcoal", "amount": 1 }],
              "outputs": [{ "good": "iron", "amount": 1 }], "cycle_seconds": 60 },
  "pause_category": "intermediate"
}
```

`pause_category` ∈ `need_goods`, `public`, `intermediate`, `food_basic`,
`never` drives the insolvency order (MECHANICS §7).

## 10. Balancing checklist

- For each tier, a balanced set of chains at 100 % must support the tier's
  unlock population with ≤ 25 % surplus.
- Warehouse throughput at each level must cover a "typical" island at that
  tier with one warehouse ≈ 80 % load, so the second warehouse is a real but
  not immediate decision.
- Tax income at each tier's unlock population must cover upkeep of the
  balanced chain set with ≥ 20 % margin.
- Starting stock must allow: warehouse + 8 settler houses + fisher +
  lumberjack + sawmill + ~40 road tiles + 15 min upkeep.
- Verify with headless scenarios before touching any client code.
