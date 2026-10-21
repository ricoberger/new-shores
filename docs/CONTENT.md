# New Shores — Content: Tiers, Goods, Buildings, Chains

Status: **Agreed catalogue structure, numbers provisional.** Tier 1 is the
first-playable content and is being implemented; tiers 2–4 are authored
after the first playable (D-040). Structure follows D-031 – D-039: need
categories with alternative goods and a variety bonus, workforce per island,
infinite deposits with limited slots, one construction material per tier,
depth growing with tier. Adapted from Anno Online, Anno 1404 and Anno 117 as
references; colonial goods are reserved for later regions (D-011).

Content IDs are stable snake_case strings and never reused.

## 1. Region

| ID | Name (working) | Climate | Notes |
|---|---|---|---|
| `old_coast` | The Old Coast | temperate | launch region; all content below. Materials are regional (D-037). |

## 2. Tiers

| # | ID | Name | Residents (floor–max) | Tax/res/min | House cost | Workforce role |
|---|---|---|---|---|---|---|
| 1 | `settlers` | Settlers | 2–8 | 0.20 | 10 planks | farms, fishers, lumber, gatherers |
| 2 | `citizens` | Citizens | 5–15 | 0.48 | 15 planks, 10 stone, 150 gold | mines, kilns, mills, basic workshops |
| 3 | `merchants` | Merchants | 9–25 | 1.20 | 20 planks, 20 stone, 10 bricks, 1 500 gold | refined workshops, printing, brewing |
| 4 | `patricians` | Patricians | 14–40 | 2.80 | 20 stone, 20 bricks, 10 glass, 8 000 gold | fine crafts, studios, opticians (small numbers) |

### Unlock conditions (archipelago-wide)

| Unlocks | Requires |
|---|---|
| Citizens | 120 Settlers, `market_small`, `chapel` |
| Merchants | 400 Citizens, `tavern`, a trade route delivering ≥ 1 good |
| Patricians | 800 Merchants, `church`, `harbourmaster_office` |
| Island 3 | Citizens unlocked · Islands 4–5: 200 Merchants · Islands 6+: Patricians unlocked |

### Need categories per tier (D-031 – D-033)

Weights sum to 1 per tier. Consumption in units per resident per minute
(provisional; a 60 s cycle producer making 1 unit = 1 unit/min). Variety bonus
+10 % tax and growth per extra good supplied, max 2 extras per category.

| Tier | Goods categories → acceptable goods | Building needs (radius) |
|---|---|---|
| Settlers | food 0.5: **fish** 0.010 · clothing 0.2: **wool_garments** 0.005 | `market_small` 12 (0.3) |
| Citizens | food 0.2: bread 0.008 \| cheese 0.006 · drink 0.2: cider 0.006 \| mead 0.005 · clothing 0.2: linen_garments 0.005 \| leather_jerkins 0.004 | `market_small` 12 (0.1), `chapel` 16 (0.15), `tavern` 14 (0.15) |
| Merchants | food 0.15: sausages 0.006 \| pies 0.005 · drink 0.15: beer 0.006 \| brandy 0.004 · clothing 0.15: coats 0.004 \| dyed_garments 0.004 \| fur_coats 0.003 · comfort 0.15: books 0.002 \| tableware 0.003 \| soap 0.003 | `market_medium` 14 (0.15), `church` 20 (0.15), `tavern` 14 (0.1) |
| Patricians | food 0.12: roast_beef 0.005 \| oysters 0.004 \| confectionery 0.004 · drink 0.12: wine 0.004 \| grain_spirit 0.003 · clothing 0.12: fine_garments 0.003 \| lace 0.003 · comfort 0.12: candles 0.004 \| spectacles 0.002 · luxury 0.12: jewellery 0.001 \| paintings 0.001 \| instruments 0.001 | `market_large` 16 (0.15), `church` 20 (0.1), `theatre` 22 (0.1), `university` 24 (0.05) |

Lower-tier goods do not satisfy higher tiers' categories.

## 3. Construction materials (D-037)

| Material | Tier | Chain | Slot / resource |
|---|---|---|---|
| `planks` | Settlers | `lumberjack` (forest) → `sawmill` | forest tiles |
| `stone` | Citizens | `quarry` | stone slot |
| `tools` | Citizens | `iron_mine` (iron slot) + `charcoal` → `smelter` → `toolmaker` | iron slot; also ships |
| `bricks` | Merchants | `clay_pit` (clay slot) + `charcoal` → `brickworks` | clay slot (shared with tableware) |
| `glass` | Patricians | `quartz_quarry` (quartz slot) + `charcoal` → `glass_smelter` | quartz slot (shared with spectacles) |
| `sails` | Citizens (ships) | `hemp_farm` → `sailmaker` | hemp fertility |

Cost ramp: T1 buildings cost planks; T2 planks + stone; T3 planks + stone +
bricks; T4 stone + bricks + glass.

## 4. Shared intermediates (D-034)

| Good | Produced by | Alternatives | Consumed by |
|---|---|---|---|
| `charcoal` | `charcoal_burner` (wood) | `coal_mine` (coal slot, T3) → `coal` accepted wherever charcoal is | smelter, brickworks, salt_works, glass_smelter, distillery, copper_smelter, gold_smelter |
| `salt` | `salt_pans` (harbour slot, slow) | `salt_mine` (salt slot) → brine → `salt_works` (+charcoal) | butcher, slaughterhouse, oyster_house |
| `clay` | `clay_pit` (clay slot) | — | brickworks, potter |
| `flour` | `mill` (wheat) | — | bakery, pastry_kitchen, confectioner |
| `iron` | `smelter` | — | toolmaker, cooperage |
| `pigs` | `pig_farm` (grass) | — | tannery, butcher, rendering_house |
| `tallow` | `rendering_house` (pigs) | — | soap_maker, candle_foundry |
| `honey` | `apiary` (meadow) | — | meadery, confectioner |
| `wood` | `lumberjack` | — | sawmill, charcoal_burner, paper_mill |
| `leather` | `leather_works` (pigs, T3) | — | `tailor` (coats); `tannery` makes the T2 good `leather_jerkins` directly (D-041) |
| `barrels` | `cooperage` (planks + iron) | — | winepress, distillery (grain spirit) |
| `brass` | `copper_smelter` (copper slot + charcoal) | — | optician, luthier |
| `dye` | `dyer_works` (woad fertility) | — | dyer (dyed garments), studio (pigments) |
| `thread` | `thread_spinner` (hemp) | — | lace_maker |
| `malt` | `malt_house` (wheat) | — | distillery (grain spirit) |

## 5. Production chains by tier

Notation: `building (inputs → output, cycle s) [workforce]`. Ratios give the
number of buildings for a balanced chain at 100 %. Workforce numbers are
provisional.

### Tier 1 — Settlers (first playable; implemented)

| Good | Chain | Ratio |
|---|---|---|
| planks | `lumberjack` (forest → wood, 30 s) [4 S], `sawmill` (wood → planks, 30 s) [4 S] | 1 : 1 |
| fish | `fisher` (harbour slot → fish, 40 s) [4 S] | — |
| wool_garments | `sheep_farm` (grass → wool, 90 s) [4 S], `weaver_wool` (wool → wool_garments, 90 s) [6 S] | 1 : 1 |

Infrastructure: `warehouse` lvl 1, `road_dirt`, `market_small`, `chapel`,
`shipyard` (sloop), `house_settlers`.

### Tier 2 — Citizens

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | bread | `wheat_farm` (wheat fert. → wheat, 60 s) [6 S], `mill` (wheat → flour, 30 s) [4 C], `bakery` (flour → bread, 60 s) [6 C] | 2 : 1 : 2 |
| food | cheese | `dairy_farm` (grass → milk, 60 s) [6 S], `cheese_dairy` (milk → cheese, 60 s) [6 C] | 1 : 1 |
| drink | cider | `orchard` (apple fert. → apples, 90 s) [6 S], `cidery` (apples → cider, 45 s) [6 C] | 2 : 1 |
| drink | mead | `apiary` (meadow → honey, 90 s) [4 S], `meadery` (honey → mead, 60 s) [6 C] | 3 : 2 |
| clothing | linen_garments | `hemp_farm` (hemp fert. → hemp, 60 s) [6 S], `weaver_linen` (hemp → linen_garments, 45 s) [6 C] | 3 : 2 |
| clothing | leather_jerkins | `pig_farm` (grass → pigs, 90 s) [6 S], `tannery` (pigs → leather_jerkins, 60 s) [8 C] | 3 : 2 |
| construction | stone, tools | `quarry` (stone slot → stone, 45 s) [8 S]; `iron_mine` (iron slot → iron_ore, 60 s) [10 S], `charcoal_burner` (wood → charcoal, 45 s) [4 S], `smelter` (iron_ore + charcoal → iron, 60 s) [8 S], `toolmaker` (iron → tools, 60 s) [8 S] | tools 1 : 1.3 : 1 : 1 |
| ships | sails | `sailmaker` (hemp → sails, 60 s) [6 C] | — |

Infrastructure: `warehouse` lvl 2, `road_paved`, `tavern`, `house_citizens`,
brig. Iron and hemp are on the second settleable island, never the first.
The construction chains (quarry, tool chain) are **Settler-staffed** per the
bootstrap rule (MECHANICS §4): the first Citizen house costs stone, so stone
must be producible before any Citizen exists. Likewise bricks (tier 3) are
made by Citizens and glass (tier 4) by Citizens.

### Tier 3 — Merchants

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | sausages | `pig_farm`, salt chain, `butcher` (pigs + salt → sausages, 60 s) [8 M] | 3 : 1 : 2 |
| food | pies | `wheat_farm`, `mill`, `orchard`, `pastry_kitchen` (flour + apples → pies, 60 s) [8 M] | 2 : 1 : 2 : 2 |
| drink | beer | `wheat_farm`, `hop_farm` (hop fert. → hops, 60 s) [6 S], `brewery` (wheat + hops → beer, 60 s) [10 M] | 1 : 1 : 1 |
| drink | brandy | `orchard`, `cidery`, `distillery` (cider + charcoal → brandy, 90 s) [8 M] | 4 : 2 : 1 |
| clothing | coats | `weaver_wool`, `pig_farm`, `leather_works` (pigs → leather, 60 s) [8 C], `tailor` (wool_garments + leather → coats, 90 s) [10 M] | 1 : 1 : 1 : 1 |
| clothing | dyed_garments | `weaver_linen`, `woad_farm` (woad fert. → woad, 90 s) [6 S], `dyer_works` (woad → dye, 60 s) [6 C], `dyer` (linen_garments + dye → dyed_garments, 60 s) [8 M] | 1 : 1 : 1 : 1 |
| clothing | fur_coats | `trapper` (forest → furs, 90 s) [4 S], `furrier` (furs → fur_coats, 90 s) [8 M] | 1 : 1 |
| comfort | books | `lumberjack`, `paper_mill` (wood → paper, 30 s) [8 C], `printing_press` (paper → books, 60 s) [10 M] | 1 : 1 : 2 |
| comfort | tableware | `clay_pit` (clay slot → clay, 45 s) [8 C], `potter` (clay + charcoal → tableware, 60 s) [8 M] | 1 : 1 (+ charcoal) |
| comfort | soap | `pig_farm`, `rendering_house` (pigs → tallow, 60 s) [6 C], `soap_maker` (tallow → soap, 60 s) [8 M] | 2 : 1 : 1 |
| intermediate | salt | `salt_pans` (harbour slot → salt, 120 s) [4 S] **or** `salt_mine` (salt slot → brine, 30 s) [10 C] + `salt_works` (brine + charcoal → salt, 30 s) [8 C] | — |
| construction | bricks | `clay_pit`, `brickworks` (clay + charcoal → bricks, 45 s) [8 C] | 1 : 1 |
| energy | coal | `coal_mine` (coal slot → coal, 45 s) [10 C]; coal substitutes charcoal 1:1 | — |

One recipe per building (D-041): `leather_works` is a separate building from
`tannery` rather than a second recipe.

Infrastructure: `warehouse` lvl 3, `market_medium`, `church`,
`harbourmaster_office` (world map, expeditions, contracts), `house_merchants`,
galleon.

### Tier 4 — Patricians

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | roast_beef | `cattle_farm` (grass → cattle, 120 s) [8 S], salt, `slaughterhouse` (cattle + salt → roast_beef, 60 s) [8 P] | 2 : 1 : 1 |
| food | oysters | `oyster_beds` (harbour slot → raw_oysters, 90 s) [6 S], salt, `oyster_house` (raw_oysters + salt → oysters, 60 s) [6 P] | 3 : 1 : 2 |
| food | confectionery | `apiary`, `mill`, `orchard`, `confectioner` (honey + flour + apples → confectionery, 90 s) [8 P] | 3 : 1 : 2 : 2 |
| drink | wine | `vineyard` (grape fert. → grapes, 90 s) [8 S], `cooperage` (planks + iron → barrels, 60 s) [8 C], `winepress` (2 grapes + barrels → wine, 60 s) [8 P] | 3 : 1 : 1.5 |
| drink | grain_spirit | `wheat_farm`, `malt_house` (wheat → malt, 60 s) [6 C], `cooperage`, `distillery` (malt + barrels + charcoal → grain_spirit, 90 s) [8 P] | 2 : 1 : 1 : 1 |
| clothing | fine_garments | `dyer`, `furrier`, `fashion_house` (dyed_garments + furs → fine_garments, 120 s) [10 P] | 1 : 1 : 1 |
| clothing | lace | `hemp_farm`, `thread_spinner` (hemp → thread, 45 s) [6 C], `lace_maker` (thread → lace, 120 s) [10 P] | 1 : 1 : 2 |
| comfort | candles | `rendering_house`, `hemp_farm`, `candle_foundry` (tallow + hemp → candles, 45 s) [6 P] | 2 : 1 : 2 |
| comfort | spectacles | `glass_smelter`, `copper_mine` (copper slot → copper_ore, 60 s) [10 C], `copper_smelter` (copper_ore + charcoal → brass, 60 s) [8 C], `optician` (glass + brass → spectacles, 90 s) [8 P] | 1 : 1 : 1 : 1.5 |
| luxury | jewellery | `gold_mine` (gold slot → gold_ore, 120 s) [10 C], `gold_smelter` (gold_ore + charcoal → gold_bars, 60 s) [8 C], `goldsmith` (gold_bars → jewellery, 90 s) [6 P] | 1 : 2 : 1.5 |
| luxury | paintings | `weaver_linen`, `dyer_works`, `mineral_quarry` (quartz slot → minerals, 60 s) [10 C], `studio` (linen_garments + dye + minerals → paintings, 180 s) [6 P] | 1 : 1 : 1 : 3 |
| luxury | instruments | `sawmill`, `copper_smelter`, `luthier` (planks + brass → instruments, 120 s) [8 P] | 1 : 1 : 2 |
| construction | glass | `quartz_quarry` (quartz slot → quartz, 60 s) [10 C], `glass_smelter` (quartz + charcoal → glass, 60 s) [8 C] | 1 : 1 |

`mineral_quarry` is a separate building on the same quartz slot type rather
than a second quartz_quarry recipe (D-041); `gold_bars` avoids a good named
`gold`, which is the reserved cost key (§11).

Infrastructure: `warehouse` lvl 4, `market_large`, `theatre`, `university`,
`house_patricians`.

## 6. Catalogue totals

| | Settlers | Citizens | Merchants | Patricians | Total |
|---|---|---|---|---|---|
| Final goods (needs) | 2 | 6 | 10 | 12 | **30** |
| Construction/ship materials | 1 | 3 | 1 (+coal) | 1 | 6 (+1) |
| Buildings (all kinds) | ~11 | ~22 | ~26 | ~26 | **~85** |
| Fertilities | — | wheat, apple, hemp | hops, woad | grapes | 6 |
| Deposit slot types | — | stone, iron | clay, salt, coal | quartz, copper, gold | 8 |

Mandatory chains for one player to reach Patricians with one good per
category: ~14. Everything else is variety bonus and trade material.

## 7. Buildings — reference table

Tier 1–2 entries are the provisional baseline (tier 1 is implemented in
`content/old_coast/`); tier 3–4 entries are authored with the
post-first-playable content pass. Every building entry carries: `footprint`,
`coastal`/`slot` requirement, `requires_road`, `cost`, `upkeep_per_min`,
`workforce {tier, amount}`, `recipes[]` (one entry at launch, D-041),
`pause_category`, `work_area` (farms/gatherers) and `tier`.

Footprint in tiles; upkeep in gold/min; `R` = requires road connection;
workforce as `amount tier` (S = Settlers, C = Citizens).

| ID | Tier | Footprint | Cost (gold / planks / stone / tools) | Upkeep | Workforce | Notes |
|---|---|---|---|---|---|---|
| `house_settlers` | 1 | 2×2 | 0 / 10 | 0 | — | R |
| `road_dirt` | 1 | 1×1 | 0 | 0 | — | |
| `warehouse` | 1 | 4×3 harbour slot | 200 / 20 | 0 | — | lvl 1: cap 300/good, T 30/min |
| `market_small` | 1 | 3×3 | 225 / 15 | 0 | — | R, radius 12 |
| `chapel` | 1 | 2×2 | 275 / 15 | 0 | — | R, radius 16 |
| `lumberjack` | 1 | 2×2 | 50 / 5 | 1 | 4 S | R, work radius 4 forest, 24 tiles |
| `sawmill` | 1 | 2×2 | 80 / 8 | 2 | 4 S | R |
| `fisher` | 1 | 2×2 harbour slot | 60 / 6 | 1 | 4 S | R |
| `sheep_farm` | 1 | 3×3 + fields | 50 / 10 | 1 | 4 S | R, work radius 4, 16 `pasture` fields, cycle 90 s |
| `pasture` | 1 | 1×1 field | 0 | 0 | — | grass, inside an accepting farm's radius, never paused |
| `weaver_wool` | 1 | 2×2 | 70 / 10 | 1 | 6 S | R, cycle 90 s |
| `shipyard` | 1 | 5×4 harbour slot | 225 / 25 | 0 | — | R, `shipyard.ships: [sloop]`, never auto-paused |
| `house_citizens` | 2 | 2×2 | 150 / 15 / 10 | 0 | — | upgrade only |
| `road_paved` | 2 | 1×1 | 5 / – / 1 | 0 | — | |
| `quarry` | 2 | 3×3 stone slot | 100 / 20 | 2 | 8 S | R |
| `iron_mine` | 2 | 3×3 iron slot | 200 / 25 / 10 | 3 | 10 S | R |
| `charcoal_burner` | 2 | 2×2 | 150 / 10 | 3 | 4 S | R |
| `smelter` | 2 | 3×3 | 200 / 20 / 20 | 3 | 8 S | R |
| `toolmaker` | 2 | 2×2 | 200 / 15 / 15 | 3 | 8 S | R |
| `wheat_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | 6 S | R, wheat fertility, work radius 4, 16 `wheat_field` fields |
| `wheat_field` | 2 | 1×1 field | 0 | 0 | — | grass, wheat fertility |
| `mill` | 2 | 2×2 | 250 / 20 / 10 | 3 | 4 C | R |
| `bakery` | 2 | 2×2 | 300 / 15 / 15 | 4 | 6 C | R |
| `dairy_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | 6 S | R, grass |
| `cheese_dairy` | 2 | 2×2 | 300 / 15 / 10 | 4 | 6 C | R |
| `orchard` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | 6 S | R, apple fertility, work radius 4, 16 `orchard_plot` fields |
| `orchard_plot` | 2 | 1×1 field | 0 | 0 | — | grass, apple fertility |
| `cidery` | 2 | 2×2 | 300 / 15 / 10 | 4 | 6 C | R |
| `apiary` | 2 | 2×2 + fields | 200 / 15 / 5 | 3 | 4 S | R, meadow |
| `meadery` | 2 | 2×2 | 300 / 15 / 10 | 4 | 6 C | R |
| `hemp_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | 6 S | R, hemp fertility, work radius 4, 16 `hemp_field` fields |
| `hemp_field` | 2 | 1×1 field | 0 | 0 | — | grass, hemp fertility |
| `weaver_linen` | 2 | 2×2 | 300 / 15 / 10 | 4 | 6 C | R |
| `pig_farm` | 2 | 3×3 + fields | 200 / 15 / 5 | 3 | 6 S | R, grass |
| `tannery` | 2 | 3×3 | 400 / 20 / 15 | 5 | 8 C | R |
| `sailmaker` | 2 | 2×2 | 300 / 20 / 5 | 3 | 6 C | R |
| `tavern` | 2 | 3×3 | 600 / 30 / 20 | 6 | — | R, radius 14 |

Tier 3–4 buildings: see the chain tables in §5 for inputs, outputs, cycles
and workforce; costs and upkeep to be authored (cost ramp in §3).

Warehouse levels (provisional): lvl 1 cap 300 / T 30; lvl 2 cap 500 / T 55
(upgrade 300 gold / 20 planks / 10 stone); levels 3–4 below were authored
for the old throughput scale and must be rebalanced with tier 3;
lvl 3 cap 800 / T 130; lvl 4 cap 1 200 / T 180.

## 8. Ships

| ID | Tier | Slots × size | Speed | Build | Cost | Upkeep |
|---|---|---|---|---|---|---|
| `sloop` | 1 | 2 × 50 | 1.0 | 2 min | 100 gold, 20 planks, 10 sails* | 1 |
| `brig` | 2 | 4 × 50 | 1.2 | 5 min | 1 500 gold, 60 planks, 20 sails, 10 tools | 4 |
| `galleon` | 3 | 6 × 60 | 1.0 | 10 min | 6 000 gold, 120 planks, 40 sails, 30 tools | 8 |

\*Starting stock includes sails for one sloop.

Ships live in `ships.json` (`{ id, name, tier, slots, slot_size, speed,
build_seconds, cost, upkeep_per_min }`, schema under `content/schema/`);
only `sloop` is authored so far. Ship positions and legs follow MECHANICS
§9; the archipelago seed stores island positions in tile coordinates.

## 9. Islands (D-036, D-039)

| Property | Range |
|---|---|
| Islands per archipelago | 6–8 (2 small, 2–3 medium, 2–3 large) |
| Fertilities per island | 2–4 |
| Deposit slots per island | 0–4, typed |
| Harbour area | proportional to coast length |

Guarantees per tier are specified in MECHANICS §10. Settling order is gated
by `islands.json: unlock` conditions (see §2).

## 10. Decorations (cosmetic, Doubloons)

Launch set (examples): hedge, hedge corner, flower bed, lantern, well, small
statue, fountain, pond, old tree, bell tower, pillory, graveyard, maypole;
seasonal items later. Zero gameplay effect (D-021). Also cosmetic: ship skins
and house facade variants per tier.

## 11. Content data format

Content lives in `content/<region>/*.json`, one file per entity type
(`region.json`, `start.json`, `tiers.json`, `goods.json`, `buildings.json`,
`needs.json`, `ships.json`, `quests.json`; later `islands.json`,
`decorations.json`), with
JSON Schemas (draft 2020-12, unknown fields rejected) under
`content/schema/`. The server validates on startup and fails fast on broken
references, duplicate IDs, need weights not summing to 1 and out-of-range
values, naming file, entity and field; the client gets generated TypeScript
types for display only. Decimals have at most 3 places (weights 6), no
exponent notation; they are converted to fixed point at load time.

### region.json — region-wide rule constants only

```json
{
  "id": "old_coast",
  "name": "The Old Coast",
  "version": "old_coast-0.6.0",
  "rules": {
    "transfer_base_seconds": 10,
    "unconnected_buffer_units": 5,
    "iteration_cap": 10000,
    "coarse_step_seconds": 60,
    "growth_per_min": 1,
    "decline_per_min": 0.5,
    "growth_satisfaction_threshold": 0.5,
    "optional_tax_bonus": 0.25,
    "auto_resume_upkeep_minutes": 5,
    "ship_speed_tiles_per_min": 60,
    "ship_handling_seconds": 20,
    "away_summary_minutes": 15,
    "trial_resume_upkeep_minutes": 30
  }
}
```

| Constant | Meaning | Reference |
|---|---|---|
| `transfer_base_seconds` | fixed part of the producer → warehouse delay | MECHANICS §3 |
| `unconnected_buffer_units` | output buffer of an unconnected producer | §3 |
| `iteration_cap`, `coarse_step_seconds` | boundary cap and coarse fallback | §1.1 |
| `growth_per_min`, `decline_per_min`, `growth_satisfaction_threshold` | house growth and decline | §6.1 |
| `optional_tax_bonus` | tax bonus at full optional-need fulfilment | §6.2 |
| `auto_resume_upkeep_minutes` | gold reserve before an auto-paused building resumes; **strictly > 0** (0 is rejected: it removes the pause/resume hysteresis) | §7 |
| `ship_speed_tiles_per_min` | archipelago tiles per minute at ship speed 1.0 (provisional 60) | §9.1 |
| `ship_handling_seconds` | load/unload time per stop (provisional 20) | §9.2 |
| `away_summary_minutes` | minimum absence before a "while you were away" summary is produced (15) | §12b |
| `trial_resume_upkeep_minutes` | gold reserve for a trial resume of an unpaid building; must be > `auto_resume_upkeep_minutes` (30) | §7 |

`version` is the `content_version` embedded in every saved world.

### start.json — starting stock

```json
{ "gold": 800, "goods": { "planks": 130, "sails": 10 } }
```

Granted once, after the first (free) warehouse is placed from the ship
(MECHANICS §8). Goods must exist in `goods.json`.

### buildings.json — capability blocks instead of a type enum

Every building has `id`, `name`, `region` (must equal the region id),
`tier`, `footprint: [width, height]` (rotation 0), `requires_road`, `cost`
(`{ "gold": n, "<good>": n }`; the key `gold` is reserved, so no good may be
called `gold`; zero-cost is `{ "gold": 0 }`), `upkeep_per_min` and
`pause_category`. What a building *does* is defined by the optional blocks
it carries:

| Block | Fields | Used by |
|---|---|---|
| `recipe` (later `recipes[]`, D-041) | `inputs[] {good, amount}` (may be empty), `outputs[] {good, amount}` (non-empty), `cycle_seconds` | producers |
| `house` | `tier` | residences |
| `warehouse` | `levels[] {capacity, throughput_per_min, cost?}` — level 1 has no cost (the building cost places it), every later level has one (`upgrade_warehouse`) | warehouse |
| `road` | `seconds_per_tile` (building must be 1×1) | roads |
| `service` | `radius` | public buildings |
| `work_area` | `radius`, `fertility?` (island-wide tag the island must carry, else `no_fertility`); harvesters also `terrain[]`, `required_tiles` | farms (radius only), lumberjack, gatherers |
| `fields` | `type` (a field building's `field.type`), `required` (16) | farms (D-049) |
| `field` | `type`, `terrain[]`, `fertility?` — a 1×1 field placeable, cost `{gold: 0}`, no upkeep, `pause_category: never`, `requires_road: false`; validation requires at least one farm accepting the type | pasture, wheat_field, orchard_plot, hemp_field (pig_pen, meadow, hop/woad/vineyard rows with their tiers) |
| `workforce` | `tier`, `amount` | producers only (D-035) |
| `requires_deposit` | deposit type; the footprint must cover ≥ 1 tile with that deposit (`no_deposit`) and may cover mountain tiles | mines, quarries |
| `slot` | typed deposit/harbour slots (D-036) — not yet implemented; `requires_deposit` is the interim rule | — |
| `shipyard` | `ships[]` (ship IDs it can build) | shipyard |

```json
{
  "id": "smelter",
  "name": "Smelter",
  "region": "old_coast",
  "tier": "citizens",
  "footprint": [3, 3],
  "requires_road": true,
  "cost": { "gold": 400, "planks": 20, "stone": 20 },
  "upkeep_per_min": 6,
  "workforce": { "tier": "settlers", "amount": 8 },
  "recipe": {
    "inputs": [{ "good": "iron_ore", "amount": 1 }, { "good": "charcoal", "amount": 1 }],
    "outputs": [{ "good": "iron", "amount": 1 }],
    "cycle_seconds": 60
  },
  "pause_category": "intermediate"
}
```

`pause_category` ∈ `need_goods`, `public`, `intermediate`, `food_basic`,
`never` drives the insolvency order (MECHANICS §7). Buildings accepting
`charcoal` will list `"accepts": ["charcoal", "coal"]` on the input (tier 3).

### tiers.json and goods.json

`tiers.json`: array in progression order of `{ id, name, residents: {floor,
max}, tax_per_resident_per_min, house?, unlock: { population: {tier: n},
buildings: [], goods_delivered: [] } }`. `house` is optional: a tier
without it is *declared only* (no needs, no house building may reference
it; upgrading into it fails cleanly) — this is how Citizens exist in the
first playable before its content is authored. `unlock.population` keys
must be earlier tiers. `goods.json`: `{ id, name, type }`
with `type` ∈ raw, intermediate, construction, food, drink, clothing,
comfort, luxury.

### quests.json

Ordered list of `{ id, title, text, objectives[], rewards: { gold?, goods?,
decorations: [] }, prerequisites[] }`; objectives are `oneOf` the predicate
kinds in MECHANICS §12a (`building_count`, `population`, `stock`,
`connected`, `route_exists`, `island_settled`, `tier_unlocked`,
`ship_count`, `satisfaction`). The intro chain is 12 linear quests
(`intro_first_road` … `intro_citizen_house`) with rewards of 25–100 gold or
30–45 planks; never stone, tools or sails (those are taught, not given).
Quests that reward goods must mention that excess beyond capacity is lost
(content test).

### needs.json

One entry per need: `{ id, tier, kind: required|optional, weight }` plus
either a goods category — `category`, `goods[] {good,
per_resident_per_min}`, `variety_bonus`, `max_extra_goods` — or a building
need — `building`, `radius`. Required weights of a tier sum to exactly 1.
See MECHANICS §6.2 for the semantics.

```json
{
  "id": "citizens_drink",
  "tier": "citizens",
  "category": "drink",
  "weight": 0.2,
  "goods": [
    { "good": "cider", "per_resident_per_min": 0.006 },
    { "good": "mead",  "per_resident_per_min": 0.005 }
  ],
  "variety_bonus": 0.10,
  "max_extra_goods": 2,
  "kind": "required"
}
```

## 12. Balancing checklist

- For each tier, one good per category at 100 % must support the tier's
  unlock population with ≤ 25 % surplus; full variety must be affordable
  with ~1.6× the chains.
- Workforce: the house count needed for a tier's unlock population must
  also cover the workforce of that tier's balanced chain set on the same
  island(s) with ≥ 20 % slack.
- **Bootstrap:** for each tier, a scenario starting from the starting stock
  must reach the tier's unlock and build its first house without a deadlock
  (no required material or good whose only producers need workforce of the
  tier being unlocked). Run in the scenario runner for every content change.
  Current staffing satisfies it: stone and tools [S] for Citizens, bricks
  [C] for Merchants, glass (quartz_quarry, glass_smelter) [C] for
  Patricians. Checked by a generic content test over every tier with a
  house and by the goldens `bootstrap_settlers` and `bootstrap_citizens`
  (the tier 1–2 reference game from the starting stock: island 2 settled
  at 60 min, Citizens unlocked by 80 min, the first Citizen house at
  100 min, tools from island 2 on the start island by 139 min).
- Warehouse throughput at each level must cover a "typical" island at that
  tier with one warehouse ≈ 80 % load.
- Tax income at each tier's unlock population must cover upkeep of the
  balanced chain set with ≥ 20 % margin.
- Charcoal demand of a balanced Merchant economy must exceed one island's
  forest capacity so coal or a second forest island becomes relevant.
- Starting stock (`start.json`: 800 gold, 130 planks, 10 sails), granted
  after the free first warehouse, must allow: 8 settler houses + fisher +
  lumberjack + sawmill + market + ~40 road tiles, and cover the early
  deficit for ≥ 15 min of upkeep (currently ≈ 96 min: 385 gold left at
  4 gold/min of upkeep).
- Verify with headless scenarios before touching any client code.
