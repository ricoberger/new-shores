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
| 1 | `settlers` | Settlers | 2–8 | 0.20 | 5 planks (§7) | farms, fishers, lumber, gatherers |
| 2 | `citizens` | Citizens | 5–15 | 0.80 | §7 `house_citizens` | mines, kilns, mills, basic workshops |
| 3 | `merchants` | Merchants | 8–25 | 1.50 | §7 `house_merchants` | refined workshops, printing, brewing |
| 4 | `patricians` | Patricians | 12–40 | 2.70 | §7 `house_patricians` | fine crafts, opticians (small numbers) |

Residents and tax for tiers 3–4 per D-056 (provisional; the reference
games tune the tax).

### Unlock conditions (archipelago-wide)

| Unlocks | Requires |
|---|---|
| Citizens | 120 Settlers, `market`, `chapel` |
| Merchants | 360 Citizens, `tavern` (D-056) |
| Patricians | 1 200 Merchants, `church` (D-056) |
| Islands | no tier gating — every island can be settled from the start (D-051) |

### Need categories per tier (D-056; supersedes D-031's bonus and D-033)

Every alternative of a category with two or more alternatives has
**share 0.6**; a category with exactly one alternative has share 1.0
(D-056 amendment); category coverage = `min(1, Σ shares of supplied
alternatives)` — one of two alternatives gives 60 %, both give 100 %.
Tax rates are tuned to the one-alternative baseline (§2). Consumption in units per resident per minute (provisional;
a 60 s cycle producer making 1 unit = 1 unit/min). A house also has the
categories of every **lower tier** (cumulative, D-056 §2) at reduced
rates: `rate × (own max residents / higher max residents) × 0.5^(tier
distance / 3)`, e.g. fish 0.010 → Citizens 0.0042, Merchants 0.0020,
Patricians 0.0010. Weights: the own tier's categories share 0.6 of
satisfaction, all lower tiers' categories 0.4 together (split equally
per lower tier, then by the lower tier's own weights). Public services
(D-065, MECHANICS §6.2): every tier has a **market** category (the
`market` alone, its level's radius) and the **chain** categories
faith, education and culture with a minimum rank — any building of the
chain with that rank or higher serves the house fully within its own
radius (faith `chapel` 1 < `church` 2 < `cathedral` 3, education
`school` 1 < `university` 2, culture `tavern` 1 < `playhouse` 2). The
**security** group (D-060/D-065, display only) holds **safety**
(`city_guard`, from Citizens), **fire protection** (`fire_station`, from
Merchants) and **health** (`surgery`, Patricians only), one building
each (share 1.0). Every category is a category of every house of its
tier and above, counted in the upgrade gate (≥ 0.6) like any required
category. The table lists each tier's **own** categories (weights
relative within the tier; chains as `faith ≥ 2`).

| Tier | Goods categories → acceptable goods | Building needs (radius) |
|---|---|---|
| Settlers | food 0.5: **fish** 0.010 · clothing 0.2: **wool_garments** 0.005 | market 0.12: `market` 12 · faith ≥ 1 0.18: `chapel` 16 |
| Citizens | food 0.2: bread 0.008 \| cheese 0.006 · drink 0.2: cider 0.006 \| mead 0.005 · clothing 0.2: linen_garments 0.005 \| leather_jerkins 0.004 | market 0.12: `market` 15 · faith ≥ 1, education ≥ 1 (`school` 16), culture ≥ 1 (`tavern` 14) 0.06 each · security: safety 0.1: `city_guard` 16 |
| Merchants | food 0.17: sausages 0.006 \| pies 0.005 · drink 0.17: beer 0.006 \| brandy 0.004 · clothing 0.09: coats 0.004 \| dyed_garments 0.004 · comfort 0.17: books 0.002 \| soap 0.003 | market 0.096: `market` 18 · faith ≥ 2 (`church` 20), education ≥ 1, culture ≥ 2 (`playhouse` 24) 0.048 each · security: safety 0.08: `city_guard` 16, fire protection 0.08: `fire_station` 16 |
| Patricians | food 0.14: roast_beef 0.005 \| oysters 0.004 · drink 0.14: wine 0.004 \| grain_spirit 0.003 · clothing 0.14: fine_garments 0.003 \| lace 0.003 · comfort 0.14: candles 0.004 \| spectacles 0.002 · luxury 0.14: jewellery 0.001 \| instruments 0.001 | market 0.04: `market` 21 · faith ≥ 3 (`cathedral` 28), education ≥ 2 (`university` 24), culture ≥ 2 0.02 each · security: safety/fire protection 0.06 each, health 0.08: `surgery` 20 |

The market radius is that of its level (12/15/18/21, level *n* from
tier *n*, D-065); the table lists the level the tier unlocks.

Variety reserve (D-056, IDs reserved, not in the tier plan): fur_coats,
tableware, confectionery, paintings.

## 3. Construction materials (D-037)

| Material | Tier | Chain | Slot / resource |
|---|---|---|---|
| `planks` | Settlers | `lumberjack` (24 `tree_plot`s, D-059) → `sawmill` | open land for the plots |
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
| `charcoal` | `charcoal_burner` (wood) | `coal_mine` (coal slot, T3) → `coal` accepted wherever charcoal is | smelter, brickworks, salt_works, glass_smelter, distillery, grain_distillery, copper_smelter, gold_smelter |
| `salt` | `salt_pans` (harbour slot, slow) | `salt_mine` (salt slot) → brine → `salt_works` (+charcoal) | butcher, slaughterhouse, oyster_house |
| `clay` | `clay_pit` (clay slot) | — | brickworks, potter |
| `flour` | `mill` (wheat) | — | bakery, pastry_kitchen, confectioner |
| `iron` | `smelter` | — | toolmaker, cooperage |
| `pigs` | `pig_farm` (grass) | — | tannery, butcher, rendering_house |
| `tallow` | `rendering_house` (pigs) | — | soap_maker, candle_foundry |
| `honey` | `apiary` (meadow) | — | meadery, confectioner |
| `wood` | `lumberjack` | — | sawmill, charcoal_burner, paper_mill |
| `leather` | `leather_works` (pigs, T3) | — | `tailor` (coats); `tannery` makes the T2 good `leather_jerkins` directly (D-041) |
| `barrels` | `cooperage` (planks + iron) | — | winepress, grain_distillery |
| `brass` | `copper_smelter` (copper slot + charcoal) | — | optician, luthier |
| `dye` | `dyer_works` (woad fertility) | — | dyer (dyed garments), studio (pigments) |
| `thread` | `thread_spinner` (hemp) | — | lace_maker, fashion_house |
| `malt` | `malt_house` (wheat) | — | grain_distillery |

## 5. Production chains by tier

Notation: `building (inputs → output, cycle s) [workforce]`. Ratios give the
number of buildings for a balanced chain at 100 %. Workforce numbers are
provisional.

### Tier 1 — Settlers (first playable; implemented)

| Good | Chain | Ratio |
|---|---|---|
| planks | `lumberjack` (24 tree plots → wood, 30 s) [4 S], `sawmill` (wood → planks, 30 s) [4 S] | 1 : 1 |
| fish | `fisher` (harbour slot → fish, 40 s) [4 S] | — |
| wool_garments | `sheep_farm` (grass → wool, 90 s) [4 S], `weaver_wool` (wool → wool_garments, 90 s) [6 S] | 1 : 1 |

Infrastructure: `trading_post` lvl 1 (founding), `warehouse` lvl 1,
`road_dirt`, `market` lvl 1, `chapel`, `house_settlers`. The start
ship is a sloop; the shipyard unlocks at tier 2 (D-056).

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

Infrastructure: `trading_post` lvl 2, `market` and `warehouse` lvl 2 (D-065), `road_paved`, `quay` (D-060), `tavern`, `school`,
`city_guard`, `trading_pier`, `depot` (D-060), `shipyard` (sloop, 2 slots), `house_citizens`. Iron and hemp are on the second settleable island, never the first.
The construction chains (quarry, tool chain) are **Settler-staffed** per the
bootstrap rule (MECHANICS §4): the first Citizen house costs stone, so stone
must be producible before any Citizen exists. Likewise bricks (tier 3) are
made by Citizens and glass (tier 4) by Citizens.

### Tier 3 — Merchants (implemented, content `old_coast-0.12.0`)

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | sausages | `pig_farm`, salt chain, `butcher` (pigs + salt → sausages, 60 s) [8 M] | 3 : 1 : 2 |
| food | pies | `wheat_farm`, `mill`, `orchard`, `pastry_kitchen` (flour + apples → pies, 60 s) [8 M] | 2 : 1 : 2 : 2 |
| drink | beer | `wheat_farm`, `hop_farm` (hop fert. → hops, 60 s) [6 S], `brewery` (wheat + hops → beer, 60 s) [10 M] | 1 : 1 : 1 |
| drink | brandy | `orchard`, `cidery`, `distillery` (cider + charcoal → brandy, 90 s) [8 M] | 4 : 2 : 1 |
| clothing | coats | `weaver_wool`, `pig_farm`, `leather_works` (pigs → leather, 60 s) [8 C], `tailor` (wool_garments + leather → coats, 90 s) [10 M] | 1 : 1 : 1 : 1 |
| clothing | dyed_garments | `weaver_linen`, `woad_farm` (woad fert. → woad, 90 s) [6 S], `dyer_works` (woad → dye, 60 s) [6 C], `dyer` (linen_garments + dye → dyed_garments, 60 s) [8 M] | 1 : 1 : 1 : 1 |
| comfort | books | `lumberjack`, `paper_mill` (wood → paper, 30 s) [8 C], `printing_press` (paper → books, 60 s) [10 M] | 1 : 1 : 2 |
| comfort | soap | `pig_farm`, `rendering_house` (pigs → tallow, 60 s) [6 C], `soap_maker` (tallow → soap, 60 s) [8 M] | 2 : 1 : 1 |
| intermediate | salt | `salt_pans` (harbour slot → salt, 120 s) [4 S] **or** `salt_mine` (salt slot → brine, 30 s) [10 C] + `salt_works` (brine + charcoal → salt, 30 s) [8 C] | — |
| construction | bricks | `clay_pit`, `brickworks` (clay + charcoal → bricks, 45 s) [8 C] | 1 : 1 |
| energy | coal | `coal_mine` (coal slot → coal, 45 s) [10 C]; coal substitutes charcoal 1:1 | — |

One recipe per building (D-041): `leather_works` is a separate building from
`tannery` rather than a second recipe.

Infrastructure: `trading_post` lvl 3, `market` and `warehouse` lvl 3 (D-065), `church`,
`playhouse`, `fire_station` (one level, D-065), `brig`
(4 slots), `house_merchants`;
`harbourmaster_office` (world map, expeditions, contracts) is an ONLINE
feature, not a tier gate, and not authored yet. Variety reserve
(D-056): fur_coats (`trapper`, `furrier`), tableware (`potter`;
`clay_pit` stays for bricks).

### Tier 4 — Patricians (implemented, content `old_coast-0.13.0`)

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | roast_beef | `cattle_farm` (grass → cattle, 120 s) [8 S], salt, `slaughterhouse` (cattle + salt → roast_beef, 60 s) [8 P] | 2 : 1 : 1 |
| food | oysters | `oyster_beds` (harbour slot → raw_oysters, 90 s) [6 S], salt, `oyster_house` (raw_oysters + salt → oysters, 60 s) [6 P] | 3 : 1 : 2 |
| drink | wine | `vineyard` (grape fert. → grapes, 90 s) [8 S], `cooperage` (planks + iron → barrels, 60 s) [8 C], `winepress` (2 grapes + barrels → wine, 60 s) [8 P] | 3 : 1 : 1.5 |
| drink | grain_spirit | `wheat_farm`, `malt_house` (wheat → malt, 60 s) [6 C], `cooperage`, `grain_distillery` (malt + barrels + charcoal → grain_spirit, 90 s) [8 P] | 2 : 1 : 1 : 1 |
| clothing | fine_garments | `dyer`, `thread_spinner`, `fashion_house` (dyed_garments + thread → fine_garments, 120 s) [10 P] | 1 : 1 : 1 |
| clothing | lace | `hemp_farm`, `thread_spinner` (hemp → thread, 45 s) [6 C], `lace_maker` (thread → lace, 120 s) [10 P] | 1 : 1 : 2 |
| comfort | candles | `rendering_house`, `hemp_farm`, `candle_foundry` (tallow + hemp → candles, 45 s) [6 P] | 2 : 1 : 2 |
| comfort | spectacles | `glass_smelter`, `copper_mine` (copper slot → copper_ore, 60 s) [10 C], `copper_smelter` (copper_ore + charcoal → brass, 60 s) [8 C], `optician` (glass + brass → spectacles, 90 s) [8 P] | 1 : 1 : 1 : 1.5 |
| luxury | jewellery | `gold_mine` (gold slot → gold_ore, 120 s) [10 C], `gold_smelter` (gold_ore + charcoal → gold_bars, 60 s) [8 C], `goldsmith` (gold_bars → jewellery, 90 s) [6 P] | 1 : 2 : 1.5 |
| luxury | instruments | `sawmill`, `copper_smelter`, `luthier` (planks + brass → instruments, 120 s) [8 P] | 1 : 1 : 2 |
| construction | glass | `quartz_quarry` (quartz slot → quartz, 60 s) [10 C], `glass_smelter` (quartz + charcoal → glass, 60 s) [8 C] | 1 : 1 |

`gold_bars` avoids a good named `gold`, which is the reserved cost key
(§11). Variety reserve (D-056): confectionery (`confectioner`), paintings
(`mineral_quarry`, `studio`).

Infrastructure: `trading_post` lvl 4, `market` and `warehouse` lvl 4 (D-065), `university`,
`cathedral`, `surgery` (health, radius 20; glass cost, D-062),
`galleon` (6 slots), `house_patricians`.

## 6. Catalogue totals

| | Settlers | Citizens | Merchants | Patricians | Total |
|---|---|---|---|---|---|
| Final goods (needs) | 2 | 6 | 8 | 10 | **26** (+4 reserve) |
| Construction/ship materials | 1 | 3 | 1 (+coal) | 1 | 6 (+1) |
| Buildings (all kinds, content `old_coast-0.13.0`; reserve not counted) | 12 | 30 | 25 | 26 | **93** |
| Fertilities | — | wheat, apple, hemp | hops, woad | grapes | 6 |
| Deposit slot types | — | stone, iron | clay, salt, coal | quartz, copper, gold | 8 |

Mandatory chains for one player to reach Patricians with one alternative
per category (0.6 coverage): ~14. The second alternative of each category
fills the house (D-056).

## 7. Buildings — reference table (D-054)

**Status:** tiers 1–4 (the shipped set, content `old_coast-0.17.0`;
tiers 1–2 since PR #27/#28, tier 3 since D-056 C3, tier 4 since D-056
C4) are implemented exactly as listed, except the `(reserve)` rows and
`harbourmaster_office` (an ONLINE feature).
The pre-D-054 numbers survive only in `server/testdata/content/
old_coast_pre_d054` for the hand-made scenarios and mechanics tests.

Every building entry carries: `footprint`, `coastal`/`slot` requirement,
`requires_road`, `cost`, `upkeep_per_min`, `workforce {tier, amount}`,
`recipes[]` (one entry at launch, D-041), `pause_category`, `work_area`
(a fertility requirement) and `tier`.

Derivation (D-054): footprints are Anno 117 Latium's for the counterpart
named in the reference column ("… class" = the nearest same-role Latium
building; no Albion sizes). Materials are Anno's counts × 3 with the
ladder planks → planks, bricks → stone, concrete → bricks, marble → glass,
clamped to the building's tier (a material above the tier is added to the
tier's top material); at least 5 planks where Anno charges planks. Gold: Anno
gold ÷ 3 for producers and harbour buildings; public buildings keep
Anno's gold; where Anno charges no gold, 10 × (planks + 2 stone + 3
bricks + 4 glass). Upkeep is Anno's denarii / 4
(min 1 for producers). Workforce and cycle times are ours (§5). Fields:
Anno's tile counts and per-tile prices; animal farms use pasture modules
(`pasture` 3×3, `pig_pen` 3×4, `cattle_pasture` 4×7); `max = required`.
Everything is provisional and re-verified against §12.

Footprint in tiles as width × depth (depth away from the road; for
harbour buildings the front faces the water); `water_rows` bounds the
sea-water prefix independently per column (D-062); upkeep in gold/min;
`R` = requires road connection; workforce as `amount tier` (S/C/M/P).

| ID | Tier | Footprint | water_rows | Anno 117 reference | Cost (gold / planks / stone / bricks / glass, up to the tier) | Upkeep | Workforce | Notes |
|---|---|---|---|---|---|---|---|---|
| `house_settlers` | 1 | 3×3 | — | Residence | 0 / 5 | 0 | — | R; all houses 3×3, upgrade in place |
| `road_dirt` | 1 | 1×1 | — | road | see text | 0 | — |  |
| `trading_post` | 1 | 6×6 | 1–2 | Trading Post (D-062) | see text | 0 | — | founding only; levels as below |
| `warehouse` | 1 | 6×6 | — | Warehouse 6×6 | 50 / 6 | 0 | — | collector; throughput per level, four levels (D-065, below) |
| `market` | 1 | 5×6 | — | Market | 250 / 15 | 0 | — | R (was `market_small` until D-056 C3; that ID is retired); market category (D-065); levels: lvl 1 radius 12; lvl 2 (tier 2) radius 15, 400 gold / 10 planks / 10 stone; lvl 3 (tier 3) radius 18, 1000 gold / 15 planks / 30 stone; lvl 4 (tier 4) radius 21, 5000 gold / 15 planks / 45 stone / 15 bricks (D-065) |
| `chapel` | 1 | 3×5 | — | Chapel (Anno 1404) | 100 / 6 | 0 | — | R, radius 16; faith rank 1 (D-065) |
| `lumberjack` | 1 | 3×3 + 24 `tree_plot` | — | Woodcutter | 60 / 6 | 1 | 4 S | R; plants its trees like a farm (D-059; was work radius 4 forest) |
| `tree_plot` | 1 | 1×1 field | — | field tile | 1 g | 0 | — | lumberjack only; painted; grass or forest, no fertility (D-059) |
| `sawmill` | 1 | 4×6 | — | Sawmill | 120 / 9 | 2 | 4 S | R |
| `fisher` | 1 | 3×8 | 2–3 | Fishing Hut | 60 / 6 | 2 | 4 S | R |
| `sheep_farm` | 1 | 3×3 + 3 `pasture` | — | Sheep Farm | 60 / 6 | 1 | 4 S | R, cycle 90 s |
| `pasture` | 1 | 3×3 field | — | pasture module | 15 g / 1 plank | 0 | — | sheep_farm only; grass; edge-adjacent chain |
| `weaver_wool` | 1 | 3×4 | — | Spinner | 60 / 6 | 2 | 6 S | R, cycle 90 s |
| `shipyard` | 2 | 8×12 | 3–4 | Shipyard | 300 / 45 / 0 | 0 | — | R, never auto-paused; tier 2 since D-056; builds every unlocked ship type |
| `house_citizens` | 2 | 3×3 | — | Residence | 150 / 5 / 3 | 0 | — | upgrade only |
| `road_paved` | 2 | 1×1 | — | road | see text | 0 | — | 3 gold / 1 stone |
| `quay` | 2 | 1×1 on shallows | — | road (D-060) | see text | 0 | — | 5 gold / 2 stone; 0.6 s/tile; water-edge buildings stand on it |
| `trading_pier` | 2 | 6×9 | 5–6 | Pier class (ours) | 250 / 20 / 10 | 0 | — | R, never auto-paused; +2 berths for the island (D-060); no levels |
| `depot` | 2 | 4×11 | 7–9 | Depot class (ours) | 280 / 20 / 10 | 0 | — | R, never auto-paused; +150 capacity per good, no levels; any number (D-062) |
| `quarry` | 2 | 3×8 on a stone slot | — | Limestone Quarry | 120 / 9 / 0 | 3 | 8 S | R; strip into the mountain |
| `iron_mine` | 2 | 3×8 on an iron slot | — | Iron Mine | 180 / 6 / 6 | 2 | 10 S | R |
| `charcoal_burner` | 2 | 5×6 | — | Charcoal Burner | 90 / 9 / 0 | 2 | 4 S | R, forest nearby (visual) |
| `smelter` | 2 | 4×6 | — | Furnace | 290 / 5 / 12 | 2 | 8 S | R |
| `toolmaker` | 2 | 4×4 | — | Weaponsmith | 230 / 5 / 9 | 4 | 8 S | R |
| `wheat_farm` | 2 | 3×4 + 140 `wheat_field` | — | Wheat Farm | 150 / 9 / 3 | 2 | 6 S | R, wheat fertility |
| `wheat_field` | 2 | 1×1 field | — | field tile | 3 g | 0 | — | wheat_farm only; painted |
| `mill` | 2 | 4×6 | — | Grain Mill | 180 / 6 / 6 | 2 | 4 C | R (no river slot: plain land) |
| `bakery` | 2 | 4×5 | — | Bakery | 230 / 5 / 9 | 4 | 6 C | R |
| `dairy_farm` | 2 | 4×5 + 5 `cattle_pasture` | — | Pig Farm class, large | 170 / 5 / 6 | 2 | 6 S | R, grass |
| `cattle_pasture` | 2 | 4×7 field | — | pasture module | 30 g / 5 planks | 0 | — | dairy_farm and cattle_farm; grass |
| `cheese_dairy` | 2 | 4×5 | — | Garum Works class | 180 / 6 / 6 | 3 | 6 C | R |
| `orchard` | 2 | 4×4 + 160 `orchard_plot` | — | Olive Grower | 230 / 5 / 9 | 2 | 6 S | R, apple fertility |
| `orchard_plot` | 2 | 1×1 field | — | field tile | 1 g | 0 | — | orchard only |
| `cidery` | 2 | 5×6 | — | Olive Press | 240 / 6 / 9 | 4 | 6 C | R |
| `apiary` | 2 | 5×5 + 100 `meadow` | — | Apiary | 290 / 5 / 12 | 4 | 4 S | R |
| `meadow` | 2 | 1×1 field | — | field tile | 1 g | 0 | — | apiary only; grass |
| `meadery` | 2 | 4×5 | — | Victualler class | 180 / 6 / 6 | 3 | 6 C | R |
| `hemp_farm` | 2 | 3×4 + 60 `hemp_field` | — | Hemp Farm | 60 / 6 / 0 | 1 | 6 S | R, hemp fertility |
| `hemp_field` | 2 | 1×1 field | — | field tile | 2 g | 0 | — | hemp_farm only |
| `weaver_linen` | 2 | 4×5 | — | Loom Weavery | 410 / 5 / 18 | 5 | 6 C | R |
| `pig_farm` | 2 | 3×4 + 5 `pig_pen` | — | Pig Farm | 170 / 5 / 6 | 2 | 6 S | R, grass |
| `pig_pen` | 2 | 3×4 field | — | pasture module | 20 g / 5 planks | 0 | — | pig_farm only; grass |
| `tannery` | 2 | 3×4 | — | Tannery | 180 / 6 / 6 | 2 | 8 C | R |
| `sailmaker` | 2 | 4×8 | — | Ropemaker | 240 / 6 / 9 | 2 | 6 C | R |
| `tavern` | 2 | 4×6 | — | Tavern | 250 / 15 / 0 | 2 | — | R, radius 14; culture rank 1 (D-065) |
| `school` | 2 | 6×8 | — | Grammaticus | 1000 / 15 / 30 | 4 | — | R, radius 16 (D-056); education rank 1 (D-065) |
| `city_guard` | 2 | 4×4 | — | Watch post class | 200 / 10 / 6 | 2 | — | R, safety (security group); radius 16, one level (D-065) |
| `house_merchants` | 3 | 3×3 | — | Residence | 400 / 5 / 3 / 3 | 0 | — | upgrade only |
| `church` | 3 | 6×10 | — | Sanctuary | 1500 / 30 / 15 / 0 | 6 | — | R, radius 20; faith rank 2 (D-065) |
| `playhouse` | 3 | 11×14 | — | Playhouse (D-063) | 15000 / 30 / 60 / 30 | 15 | — | R, radius 24 (tier 3 since D-056); culture rank 2 (D-065) |
| `fire_station` | 3 | 4×5 | — | Fire station class | 400 / 15 / 15 / 5 | 4 | — | R, fire protection (security group); radius 16, one level (D-065) |
| `surgery` | 4 | 4×6 | — | Surgery class | 450 / 10 / 15 / 0 / 5 | 4 | — | R, radius 20, health (security group); one level, glass cost (D-062) |
| `harbourmaster_office` | 3 | 5×5 | (reserve) | Repair Crane class | 1000 / 60 / 45 / 0 | 6 | — | world map, expeditions, contracts |
| `butcher` | 3 | 4×5 | — | Victualler class | 270 / 6 / 6 / 3 | 3 | 8 M | R |
| `pastry_kitchen` | 3 | 4×5 | — | Bakery class | 320 / 5 / 9 / 3 | 4 | 8 M | R |
| `hop_farm` | 3 | 3×4 + 60 `hop_field` | — | crop farm class | 120 / 6 / 3 / 0 | 2 | 6 S | R, hops fertility |
| `hop_field` | 3 | 1×1 field | — | field tile | 3 g | 0 | — | hop_farm only |
| `brewery` | 3 | 5×6 | — | Olive Press class | 330 / 6 / 9 / 3 | 4 | 10 M | R |
| `distillery` | 3 | 5×6 | — | Olive Press class | 420 / 6 / 9 / 6 | 4 | 8 M | R (brandy only, D-041) |
| `leather_works` | 3 | 3×4 | — | Tannery | 270 / 6 / 6 / 3 | 2 | 8 C | R |
| `tailor` | 3 | 4×5 | — | Loom Weavery class | 410 / 5 / 9 / 6 | 5 | 10 M | R |
| `woad_farm` | 3 | 3×4 + 100 `woad_field` | — | crop farm class | 120 / 6 / 3 / 0 | 2 | 6 S | R, woad fertility |
| `woad_field` | 3 | 1×1 field | — | field tile | 1 g | 0 | — | woad_farm only |
| `dyer_works` | 3 | 5×5 | — | Dye Works | 470 / 5 / 12 / 6 | 3 | 6 C | R |
| `dyer` | 3 | 4×5 | — | Loom Weavery class | 410 / 5 / 9 / 6 | 5 | 8 M | R |
| `trapper` (reserve) | 3 | 5×5 | — | Resin Trapper | 180 / 6 / 6 / 0 | 2 | 4 S | R, forest radius |
| `furrier` (reserve) | 3 | 3×4 | — | Sandal Maker class | 270 / 6 / 6 / 3 | 3 | 8 M | R |
| `paper_mill` | 3 | 4×6 | — | Sawmill class | 300 / 9 / 6 / 3 | 2 | 8 C | R |
| `printing_press` | 3 | 4×5 | — | Tabulus class | 330 / 6 / 9 / 3 | 6 | 10 M | R |
| `clay_pit` | 3 | 4×6 on a clay slot | — | Clay Pit | 60 / 6 / 0 / 0 | 2 | 8 C | R (no river slot: deposit slot) |
| `potter` (reserve) | 3 | 4×5 | — | Potter | 180 / 6 / 6 / 0 | 4 | 8 M | R |
| `rendering_house` | 3 | 3×3 | — | Renderer | 170 / 5 / 6 / 0 | 2 | 6 C | R |
| `soap_maker` | 3 | 3×4 | — | Soap Maker | 120 / 6 / 3 / 0 | 3 | 8 M | R |
| `salt_pans` | 3 | 5×9 | 2–3 | Salt Ponds | 180 / 6 / 6 / 0 | 2 | 4 S | R |
| `salt_mine` | 3 | 3×8 on a salt slot | — | Iron Mine class | 180 / 6 / 6 / 0 | 2 | 10 C | R |
| `salt_works` | 3 | 4×6 | — | Furnace class | 290 / 5 / 12 / 0 | 2 | 8 C | R |
| `brickworks` | 3 | 4×5 | — | Tiler | 90 / 9 / 0 / 0 | 3 | 8 C | R |
| `coal_mine` | 3 | 3×8 on a coal slot | — | Iron Mine class | 180 / 6 / 6 / 0 | 2 | 10 C | R |
| `house_patricians` | 4 | 3×3 | — | Residence | 1000 / 5 / 3 / 3 / 3 | 0 | — | upgrade only |
| `university` | 4 | 12×12 | — | Library | 50000 / 45 / 45 / 60 / 0 | 45 | — | R, radius 24; education rank 2 (D-065) |
| `cathedral` | 4 | 12×16 | — | Temple | 60000 / 15 / 60 / 60 / 30 | 30 | — | R, radius 28 (D-056); faith rank 3 (D-065) |
| `cattle_farm` | 4 | 4×5 + 5 `cattle_pasture` | — | Pig Farm class, large | 410 / 5 / 9 / 6 / 0 | 4 | 8 S | R, grass |
| `slaughterhouse` | 4 | 4×4 | — | Fish Gutter class | 390 / 6 / 6 / 3 / 3 | 8 | 8 P | R |
| `oyster_beds` | 4 | 6×12 | 3–4 | Oyster Bed | 480 / 12 / 9 / 6 / 0 | 3 | 6 S | R |
| `oyster_house` | 4 | 6×6 | — | Epicure of Water class | 510 / 6 / 6 / 3 / 6 | 10 | 6 P | R |
| `confectioner` (reserve) | 4 | 4×5 | — | Bakery class | 650 / 5 / 9 / 6 / 6 | 4 | 8 P | R |
| `vineyard` | 4 | 4×5 + 100 `vine_row` | — | Vineyard | 330 / 6 / 9 / 3 / 0 | 2 | 8 S | R, grapes fertility |
| `vine_row` | 4 | 1×1 field | — | field tile | 3 g | 0 | — | vineyard only |
| `cooperage` | 4 | 4×6 | — | Caelator class | 840 / 9 / 12 / 9 / 6 | 7 | 8 C | R |
| `winepress` | 4 | 6×9 | — | Vintner | 540 / 6 / 15 / 6 / 0 | 8 | 8 P | R |
| `malt_house` | 4 | 4×6 | — | Grain Mill class | 270 / 6 / 6 / 3 / 0 | 2 | 6 C | R |
| `grain_distillery` | 4 | 5×6 | — | Olive Press class | 600 / 6 / 9 / 6 / 6 | 5 | 8 P | R; model: the distillery recipe with its own roof colour (D-041: one recipe per building) |
| `fashion_house` | 4 | 5×7 | — | Chair Maker class | 900 / 6 / 9 / 6 / 12 | 7 | 10 P | R; dyed_garments + thread (furs are reserve) |
| `thread_spinner` | 4 | 3×4 | — | Spinner | 240 / 6 / 0 / 6 / 0 | 2 | 6 C | R |
| `lace_maker` | 4 | 3×5 | — | Cushion Stuffer | 650 / 5 / 3 / 6 / 9 | 4 | 10 P | R |
| `candle_foundry` | 4 | 4×4 | — | Jeweller class | 680 / 5 / 0 / 9 / 9 | 12 | 6 P | R |
| `quartz_quarry` | 4 | 3×8 on a quartz slot | — | Marble Quarry | 300 / 6 / 3 / 6 / 0 | 4 | 10 C | R |
| `glass_smelter` | 4 | 4×6 | — | Glass Smelter | 270 / 6 / 6 / 3 / 0 | 3 | 8 C | R (no river slot) |
| `copper_mine` | 4 | 3×8 on a copper slot | — | Mineral Quarry | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R |
| `copper_smelter` | 4 | 4×6 | — | Goldsmith class | 740 / 5 / 9 / 9 / 6 | 6 | 8 C | R |
| `optician` | 4 | 4×4 | — | Jeweller class | 680 / 5 / 0 / 9 / 9 | 12 | 8 P | R |
| `gold_mine` | 4 | 3×8 on a gold slot | — | Gold Mine | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R; exactly one gold slot per archipelago |
| `gold_smelter` | 4 | 4×6 | — | Goldsmith | 740 / 5 / 9 / 9 / 6 | 6 | 8 C | R |
| `goldsmith` | 4 | 4×4 | — | Jeweller | 680 / 5 / 0 / 9 / 9 | 12 | 6 P | R |
| `mineral_quarry` (reserve) | 4 | 3×8 on a quartz slot | — | Mineral Quarry | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R |
| `studio` (reserve) | 4 | 5×5 | — | Gilder | 680 / 5 / 6 / 9 / 6 | 4 | 6 P | R |
| `luthier` | 4 | 5×5 | — | Lythier | 870 / 6 / 9 / 9 / 9 | 8 | 8 P | R |

Roads: `road_dirt` 1 gold; `road_paved` 3 gold / 1 stone; `quay` 5 gold /
2 stone on the shallows (D-060, MECHANICS §3). Trading Post
founding cost 200 gold / 15 planks (start stock, D-051) — the levels below.

Trading Post levels (provisional): lvl 1 cap 300 / T 30 / 1 berth; lvl 2
cap 500 / T 55 / 2 berths (upgrade 300 gold / 20 planks / 10 stone); lvl 3
cap 800 / T 80 / 3 berths (600 gold / 30 planks / 20 stone); lvl 4 cap
1 200 / T 110 / 4 berths (1 200 gold / 40 planks / 30 stone / 10 tools).
Warehouse levels (provisional, throughput only — collectors have no
radius rule in the sim; level *n* needs tier *n*, D-065): lvl 1 T 30;
lvl 2 T 50 (Citizens; 150 gold / 10 planks / 5 stone); lvl 3 T 70
(Merchants; 300 gold / 15 planks / 10 stone); lvl 4 T 90 (Patricians;
600 gold / 20 planks / 20 stone). A 6×6 hub earns its size with
throughput (D-054); a reach rule would be a new decision. Market and
warehouse level 4 have no model yet; the client draws level 3.

Harbour extensions (D-060, provisional, numbers ours — no Anno
counterpart): the **trading pier** adds 2 berths to its island's pool
(MECHANICS §9.3); the **depot** adds capacity per good to its island
while a Trading Post stands (MECHANICS §5): 150 each, no levels, any
number (D-062). Both have
upkeep 0 and `pause_category: never` like the Trading Post (a paused
depot would question its own capacity).

## 8. Ships

| ID | Tier | Slots × size | Speed | Build | Cost | Upkeep |
|---|---|---|---|---|---|---|
| `sloop` | 2 (start ship from tier 1) | 2 × 50 | 1.2 | 2 min | 100 gold, 20 planks, 10 sails* | 1 |
| `brig` | 3 | 4 × 50 | 1.0 | 5 min | 1 500 gold, 60 planks, 20 sails, 10 tools | 4 |
| `galleon` | 4 | 6 × 60 | 0.85 | 10 min | 6 000 gold, 120 planks, 40 sails, 30 tools | 8 |

\*The sails for the first built sloop are the reward of the tier-2
"Build a shipyard" quest (D-056); the start ship is a sloop and carries
the founding stock (planks and sails fit its two slots, D-051).

Ships live in `ships.json` (`{ id, name, tier, slots, slot_size, speed,
build_seconds, cost, upkeep_per_min, length_tiles? }`, schema under
`content/schema/`); all three are authored. `length_tiles` is the hull
length at model scale (sloop 2, brig 2.6, galleon 3.2; absent: 2), display
only: the client draws each ship and spaces the berths of Trading Posts
and trading piers by it (MECHANICS §9.1). Speeds differ (D-059,
supersedes D-056's equal speed): the sloop is small and fast for founding
and short hops, the galleon large and slow for bulk. Ship positions and legs follow MECHANICS
§9; the archipelago seed stores island positions in tile coordinates.

## 9. Islands (D-036, D-053, D-058)

| Property | Value |
|---|---|
| Habitable islands per archipelago | 12: 3 large (≈ 192×192), 5 medium (≈ 112×112), 4 small (≈ 64×64) |
| Resource rocks | 0–2 (≈ 16×16, mountain + coast; Trading Post and mines only) |
| Skerries | 4–8 per archipelago (class `scenic`, 4–12 tiles of rock with a grass or sand top): scenery only — no sites, fertilities, deposits or name, not settleable, not a destination; land for routing, minimap and far view |
| Shape per class | arms 1–3 (small 1–2); plain ≥ 40 / 24 / 14 tiles square; rivers 1–2 / 0–1 / 0; terrace levels 2 / 2 / 1; islets 3–6 / 2–5 / 2–4 (large / medium / small; rocks and skerries none) |
| Fertilities per habitable island | 2–4 from the pool (wheat, apple, hemp 3–5 times per archipelago; hops, woad, grapes 2–5 times; provisional) |
| Deposit slots per island | 0–4, typed (rocks 2–4); a slot is two deposit tiles on a mountain edge; per archipelago stone 3–6, iron 2–4, clay 2–4, salt 1–3, coal 1–3, quartz 2–4, copper 1–3, gold exactly 1; only stone on the home island |
| Harbour area | proportional to coast length; ≥ 2 Trading Post sites per habitable island |
| Shallows | water tiles of an island's grid (not river) within 3 tiles (Chebyshev) of its own land, islets excluded; derived from the tiles, the quay's ground (D-060, MECHANICS §3) |
| Spacing | ≥ 50 tiles between islands, nearest neighbour ≤ 120, straits ≥ 24 tiles of water (land to land, skerries included), open sea ≤ 150 tiles from land |
| Buildable area | 91 000 tiles (coast, grass, forest) per archipelago ± 10 % (≈ 48 % of the 189 696-tile land extents, the share the shape rules give: ≈ 17.7 k per large island, D-054; provisional) |
| Names | from `island_names.json` (≥ 40 entries), unique per archipelago; renamable |

Guarantees per tier are specified in MECHANICS §10. No gating (D-051).
Sizes, counts, pools and ranges live in `islands.json`; the generator
reads them and the content loader validates that the ranges are
satisfiable (pool size × max ≥ islands × min fertilities, etc.).

## 10. Decorations (cosmetic, Doubloons)

Launch set (examples): hedge, hedge corner, flower bed, lantern, well, small
statue, fountain, pond, old tree, bell tower, pillory, graveyard, maypole;
seasonal items later. Zero gameplay effect (D-021). Also cosmetic: ship skins
and house facade variants per tier.

## 11. Content data format

Content lives in `content/<region>/*.json`, one file per entity type
(`region.json`, `start.json`, `tiers.json`, `goods.json`, `buildings.json`,
`needs.json`, `ships.json`, `quests.json`, `islands.json`; later
`decorations.json`), with
JSON Schemas (draft 2020-12, unknown fields rejected) under
`content/schema/`. The server validates on startup and fails fast on broken
references, duplicate IDs, need weights not summing to 1 and out-of-range
values, naming file, entity and field; the client gets generated TypeScript
types for display only. Decimals have at most 3 places (weights 6), no
exponent notation; they are converted to fixed point at load time.

### Locale files (D-061)

The main JSON files are the **English source**. Every other language is
one flat file `content/<region>/i18n/<lang>.json` (schema
`content/schema/locale.schema.json`): `"<file>.<id>.<field>": "text"`.
`i18n/de.json` is the first; English has no file. The translatable
fields (everything the server sends that is prose; errors and reasons
are codes and stay in the client):

| Key | Source |
|---|---|
| `region.<id>.name` | `region.json` name |
| `tiers.<id>.name`, `goods.<id>.name`, `buildings.<id>.name`, `need_categories.<id>.name`, `needs.<id>.name`, `ships.<id>.name` | `name` of each entry |
| `quests.<id>.title`, `quests.<id>.text` | quest title and advisor text |
| `islands.<size class id>.name` | `islands.json` size class name |
| `island_names.<index>` | entry of `island_names.json`; the index is **zero-based** (`island_names.0` is the first entry) |

The loader enforces **completeness**: a language with a file must have
every key and no unknown key (a content error, naming file and key);
names obey the English limits (1–32 characters, island names 1–24),
other texts 1–2000. `Catalogue.Languages()` is `["en", …]`. Fertility,
deposit, terrain and category *display* words that the client composes
itself are client keys, not content. Island names are chosen at world
creation and stored in English; the content payload lists
`island_names[{source, name}]` so the client shows the translation until
the player renames the island (ship default names such as "Sloop 2" are
mapped the same way by the type's `source_name`). Storing the list index or
ship type in the world instead would be a schema change and is left to a
future decision. A new translatable field must be added to
`Catalogue.Texts` (and to every locale file) in the same change.

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
    "ship_handling_base_seconds": 10,
    "ship_handling_seconds_per_unit": 0.2,
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
| `ship_handling_base_seconds` | fixed part of the berth time per stop (provisional 10) | §9.2 |
| `ship_handling_seconds_per_unit` | berth time per unit unloaded or loaded (provisional 0.2) | §9.2 |
| `away_summary_minutes` | minimum absence before a "while you were away" summary is produced (15) | §12b |
| `trial_resume_upkeep_minutes` | gold reserve for a trial resume of an unpaid building; must be > `auto_resume_upkeep_minutes` (30) | §7 |
| `camera.max_half_extent` | zoom-out cap of the camera, vertical half extent in tiles (120); client view only, no rule reads it; the client never caps below its far-LOD reach | render |

`version` is the `content_version` embedded in every saved world.

### start.json — starting stock

```json
{ "gold": 1000, "goods": { "planks": 150, "sails": 10 } }
```

Aboard the start sloop and on the balance from the first moment; the
Trading Post is paid from it when the player founds (MECHANICS §8). Goods must exist in `goods.json`.

### buildings.json — capability blocks instead of a type enum

Every building has `id`, `name`, `region` (must equal the region id),
`tier`, `footprint: [width, height]` (rotation 0), `requires_road`, `cost`
(`{ "gold": n, "<good>": n }`; the key `gold` is reserved, so no good may be
called `gold`; zero-cost is `{ "gold": 0 }`), `upkeep_per_min` and
`pause_category`. Optional `description` is localized like the name
(English source plus locale key, 1–2000 printable characters).
World schema **13**, content **old_coast-0.17.0** (D-065): no migration while
undeployed; recreate local databases with `make down VOLUMES=1 && make up`.
The old `water_tiles` key is rejected; `water_rows` has required integer
`min`/`max`, with `0 ≤ min ≤ max < depth` checked by the loader.
What a building *does* is defined by the optional blocks
it carries:

| Block | Fields | Used by |
|---|---|---|
| `recipe` (later `recipes[]`, D-041) | `inputs[] {good, amount}` (may be empty), `outputs[] {good, amount}` (non-empty), `cycle_seconds` | producers |
| `house` | `tier` | residences |
| `trading_post` | `levels[] {capacity, throughput_per_min, berths, cost?}` — level 1 has no cost (founding places it), later levels have one (`upgrade_trading_post`); with `water_rows` (per-column water prefix) | Trading Post, one per island |
| `pier` | `berths` (≥ 1) — berths added to the island's pool; needs `water_rows`; no collector, service or levels (D-060) | trading_pier |
| `depot` | `capacity` — fixed capacity per good added to the island; no levels, collector, service or pier (D-062) | depot |
| `warehouse` | `levels[] {throughput_per_min, tier?, cost?}` — collector only, no capacity (`upgrade_warehouse`); every later level names the tier it needs (D-065) | inland Warehouse |
| `road` | `seconds_per_tile`, `shallows?` (true: laid on the shallows instead of land, D-060) (building must be 1×1) | roads, quay |
| `service` | `radius` or `levels[] {radius, cost?}` (level *n* needs tier *n*, derived by the loader, D-065; only the market has levels); `chain` + `rank` for a chain building (one radius, D-065) | public buildings |
| `work_area` | `fertility` (island-wide tag the island must carry, else `no_fertility`); no radius or terrain rule | farms (the lumberjack is a farm since D-059) |
| `fields` | `type` (a field building's `field.type`), `required`, `max` | farms (D-051 part 4), lumberjack (D-059) |
| `field` | `type`, `farm` (the farm type that owns it, or a list of farm types sharing the module: `cattle_pasture` serves `dairy_farm` and `cattle_farm`), `terrain[]`, `fertility?` — 1×1 (crops) or a pasture module (`pasture` 3×3, `pig_pen` 3×4, `cattle_pasture` 4×7), small gold cost, no upkeep, `pause_category: never`, `requires_road: false`; validation requires every listed farm to exist with a matching `fields.type` | pasture, wheat_field, orchard_plot, hemp_field, pig_pen, meadow, cattle_pasture, hop_field, woad_field, vine_row, tree_plot |
| `workforce` | `tier`, `amount` | producers only (D-035) |
| `requires_deposit` | deposit type; the footprint must cover ≥ 1 tile with that deposit (`no_deposit`) and may cover mountain tiles | mines, quarries |
| `slot` | typed deposit/harbour slots (D-036) — not yet implemented; `requires_deposit` is the interim rule | — |
| `shipyard` | `ships[]` (ship IDs it can build) | shipyard |
| `smoke` | boolean, absent false — display only: the model carries chimney/smoke anchors and the client draws smoke | producers whose model has a chimney: every shipped producer except hop_farm, woad_farm, leather_works, tailor, printing_press, clay_pit, salt_pans, salt_mine, coal_mine, cattle_farm, oyster_beds, vineyard, fashion_house, thread_spinner, lace_maker, quartz_quarry, copper_mine, gold_mine and luthier |
| `boat` | boolean, absent false — display only: the client rows a boat out from the model's boat anchor and back; needs `water_rows` | water-edge producers (fisher, oyster_beds) |

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
`charcoal` or `coal` list both as the input's good, `{ "good": ["charcoal",
"coal"], "amount": 1 }` (tier 3: distillery, salt_works, brickworks;
tier 4: grain_distillery, glass_smelter, copper_smelter, gold_smelter).

### islands.json — archipelago generator parameters

```json
{
  "size_classes": [
    { "id": "large", "name": "Large", "size": 192, "count": { "min": 3, "max": 3 },
      "fertilities": { "min": 2, "max": 4 }, "deposits": { "min": 0, "max": 4 },
      "shape": { "arms": { "min": 1, "max": 3 }, "plain": 40, "rivers": { "min": 1, "max": 2 },
                 "levels": 2, "islets": { "min": 3, "max": 6 } } },
    { "id": "rock", "size": 16, "rock": true, "…": "…" },
    { "id": "scenic", "name": "Skerry", "size": 4, "scenic": true, "count": { "min": 4, "max": 8 }, "…": "…" }
  ],
  "spacing": { "min": 50, "nearest_max": 120, "strait_min": 24, "void_max": 150 },
  "fertilities": "…", "deposits": "…", "buildable_area": "…", "home": "…"
}
```

`shape` (D-058) is required per class: `arms` ≤ 3, `rivers` ≤ 2,
`levels` ≤ 2, `islets` ≤ 8, `plain` ≤ size / 3; a rock class has all
zeros. A `scenic` class (skerries) is no rock, has no fertilities,
deposits or shape (all zeros) and a `size` of 2–8: its skerries have
`size` … ¾ · size² tiles; it can never be the home class. `spacing`:
`min` and `nearest_max` apply between habitable islands and rocks
(grid to grid), `strait_min` to every pair's land, `void_max` bounds the
open sea inside the hull of the land. `home.terrain` lists `grass` only
since D-059 (the lumberjack plants its trees; forest is decor). The
content payload (`GET /api/v1/content`) serves every size class with
its size, count, per-island fertility and deposit ranges, shape and
whether it is the home class (the almanac's Islands table).

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
(`intro_home_island` … `intro_citizen_house`; island 2 is founded with
the start sloop) with rewards of 25–100 gold or 30–45 planks; never
stone, tools or sails (those are taught, not given). The tier-2 chain
(D-056) is 5 linear quests branching off at `intro_settlers_120`
(`citizens_shipyard`, `citizens_sloop`, `citizens_tavern`,
`citizens_school`, `citizens_cheese`) with rewards of 50–100 gold; the
shipyard quest's 10 sails for the first built sloop are the only sails
(§8). The tier-3 chain is 6 quests after `citizens_cheese`
(`merchants_church` … `merchants_bricks`, 100–200 gold) and the tier-4
chain 6 after it (`patricians_cathedral`, `patricians_house`,
`patricians_food`, `patricians_drink`, `patricians_glass` — 30 glass in
stock — and `patricians_galleon`, 150–250 gold); `ship_count` takes an
optional ship `type`, so the galleon quest counts galleons.
Quests that reward goods must mention that excess beyond capacity is lost
(content test).

### need_categories.json and needs.json

`need_categories.json` lists the display data per category: `{ id, name,
icon, group? }` (icon IDs from the HUD icon set; a test checks they
exist). `group` is a display group the client shows the category under
(D-065: `security` for safety, fire protection and health; the group's
name is a client catalogue string); it has no rule effect.

One entry per need: `{ id, name, tier, from_tier?, kind:
required|optional, weight, category }` plus one of `goods[] {good,
per_resident_per_min, share?}`, `buildings[] {building, share?}` (the
radius is the building's service level) or, for a chain need (D-065),
`chain` and `min_rank` (served by any building of the chain with that
rank or higher; the loader checks that the chain exists and has the
rank). Shares default to
1.0 for a lone alternative and 0.6 each otherwise (D-056). Required
weights of a tier's own needs sum to exactly 1; `from_tier` marks a
carried lower-tier category. See MECHANICS §6.2 for the semantics.

```json
{
  "id": "citizens_drink",
  "name": "Drink",
  "tier": "citizens",
  "category": "drink",
  "weight": 0.2,
  "goods": [
    { "good": "cider", "per_resident_per_min": 0.006 },
    { "good": "mead",  "per_resident_per_min": 0.005 }
  ],
  "kind": "required"
}
```

## 12. Balancing checklist

### Retired IDs (never reused)

| ID | Reason |
|---|---|
| `market_small` | Renamed to `market` in D-056 C3 |
| `theatre` | Retired for D-063; `playhouse` is a new ID, same cost/radius/ladder position. Roman recipe parked for a later southern region. |
| `settlers_services`, `citizens_services`, `merchants_services`, `patricians_services` | Need IDs retired with the `services` category in D-065 (split into market and the faith/education/culture chains) |

### D-062 reference results (sim minutes, seed 1053001)

| Game | Milestones | Targets | Margins |
|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools: 53 / 33 / 91 / 134 | 60 / 90 / 100 / 150 | 7 / 57 / 9 / 16 |
| Quests | island 2 / first house: 38 / 76 (unlock 28, tools 119) | 45 / 85 | 7 / 9; exactly 15 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6: 229 / 264 / 297 | 240 / 270 / 420 | 11 / 6 / 123 |
| Patricians | unlock / first house / final all-needs ≥0.6: 855 / 887 / 1437 | 900 / 960 / 1800 | 45 / 73 / 363 |

All four are real starting-stock replays; costs/rates/targets unchanged.
Layouts reconnect the smaller founding footprint, reserve enlarged civic
buildings and their connected fields, defer surgery until Patricians/glass,
and use the existing farming island for a crowded dairy. Whole-minute waits
and building/island choices are the only pacing levers. The final Patrician
measurement is conservative, not the earliest crossing. Merchants lose the
health gate but these layout repairs cost about six minutes versus the
old 223/258/291 replay. The checklist below retains older balancing history.

### D-065 reference results (sim minutes, seed 1053001)

The reference replays are generated from plans (D-067,
`server/testdata/plans/*.plan.json`, `go run ./cmd/replay-plan`); a
plan sets build order, counts, waits, island choice and layout hints,
and the generator places. Before D-065 (generator only, D-062 content)
and after (content `old_coast-0.17.0`):

| Game | Milestones | Targets | Before D-065 | D-065 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 47 / 33 / 80 / 116 | 48 / 24 / 82 / 118 | 12 / 66 / 18 / 32 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 32 / 64 (23, 100) | 32 / 64 (11, 100) | 13 / 21; ≥ 15 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 217 / 243 / 271 | 224 / 256 / 369 | 16 / 14 / 51 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 798 / 836 / 939 | 826 / 866 / 1073 | 74 / 94 / 727 |

Plan changes for D-065 are build order, counts and waits only:

- The citizens plan's `chains` block lists the chain buildings by rank
  and each tier's minimum rank (checked against the content). The
  generator reserves chain plots by **coverage**, island-wide, once an
  island's quarters are reserved: per chain, highest rank first, the
  site that adds the most needed coverage; rank 1 at 100 % of the
  houses (it gates every upgrade), higher ranks at 80 %, and a rank
  stops when a site would add fewer than 32 tiles. Quarters without
  `serves` (island 2 and island 6) get no chain plots; their chapel is
  a civic building. Per-quarter reservation left 1 242 reserved tiles
  unbuilt on the home island and did not fit; coverage reservation
  leaves 0 (island 2: 16, island 6: 16, none of them chain plots).
- Farms moved for room (the only buildings allowed to): pig farms #11–14
  from the home island to island 6, with an extra sloop on route
  "Stone out, pigs home": with every chain plot reserved, the home
  island's last wheat farm (140 fields) found no grass area large
  enough. Wheat cannot move (fertile only on islands 1, 5, 10 and 11).
- Merchants: a school (education gates the Citizen → Merchant upgrade)
  before the upgrades, church and playhouse before the categories
  checkpoint (followed by a one-minute wait); island 2 gets a chapel;
  the guard upgrade is gone (no levels).
- Patricians: island 6 gets a chapel; home-3 and home-4 get their
  schools, tavern, churches and playhouse around their first Citizen
  upgrades, and their Settler and Citizen upgrades are interleaved
  (lag 3); university and cathedral follow the first Patrician house;
  the guard upgrades are gone.
- The guard and fire radius stays 16 (D-065). With coverage reservation
  it is not the binding constraint: the home island's binding resource
  is grass for the last wheat farm, solved by moving pig farms.

The upgrade gate now needs every chain category at its minimum rank:
the other milestones move by −9 to +30 min, the Merchants' categories
milestone by 98 min and the final Patrician measurement by 134 min, all
within target.


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
  house and by the goldens `bootstrap_settlers`, `bootstrap_citizens`,
  `bootstrap_merchants` and `bootstrap_patricians` (tiers 3–4, below)
  (the tier 1–2 reference game from the starting stock: island 2 settled
  at 52 min by the start sloop, Citizens unlocked by 30 min, the first
  Citizen house at 88 min, tools from island 2 on the home island by
  132 min; with the quests 34 / 21 / 73 / 117 — on the generated dev
  archipelago, seed 1053001, with the D-056 need model; before D-056:
  59 / 62 / 88 / 141, quests 44 / 70; PR #25: 60 / 80 / 99 / 136; the
  hand-made islands: 100 / 139). The first-house margin (88 of 100;
  quests 15 min earlier) is the tight one: a change that slows the
  first hours must say so.
  If a later change needs room, the first lever is the sloop's reference
  speed (legs are 3.4–4.3 min on the dev seed), not the targets.
- **Tier 3–4 reference games (D-056, sim minutes from the starting
  stock, attentive play; not faster):** Merchants unlocked (360
  Citizens + tavern) ≤ 240, first Merchant house ≤ 270, every Merchant
  category ≥ 0.6 ≤ 420; Patricians unlocked (1 200 Merchants + church)
  ≤ 900, first Patrician house ≤ 960, every Patrician category ≥ 0.6
  ≤ 1 800. Goldens `bootstrap_merchants` / `bootstrap_patricians` once
  the tiers exist. `bootstrap_merchants` (D-056 C3) continues
  `bootstrap_citizens` step for step (so the tier-1/2 times above are
  unchanged) and holds the Merchant targets at 225 / 235 / 283 (the
  last found on a ten-wait scan) with the build order alone; its home
  island then uses 3 102 of 16 387 buildable tiles (19 %) for 144
  Settlers, 285 Citizens and 75 Merchants.
  `bootstrap_patricians` (D-056 C4) continues `bootstrap_merchants`
  step for step (tier 1–3 times unchanged) and holds the Patrician
  targets at 501 / 798 / 843 with build order and island choice alone:
  the Patrician houses and public buildings stand at home; island 6
  (quartz, copper, grapes, hemp) makes glass, brass, thread and grapes
  for a sloop and a brig, island 2 pigs, salt, milk and cattle for a
  galleon. At the end (minute 873: 560 Settlers, 210 Citizens, 1 250
  Merchants, 160 Patricians at home) the used share of the buildable
  tiles is 59 % at home (16 387; houses and public buildings 1 443,
  production and fields 6 632, roads 1 332, collectors 234), 30 % on
  island 2 (15 612) and 18 % on island 6 (6 892): 1 200 Merchants and
  the first Patricians fit on the home island with room to spare.
  With D-056 the tier-1/2 game runs its categories at
  0.6 until the second alternatives are built; the §12 tier-1/2 targets
  stay and hold (see Bootstrap above). Two notes from S1: "Citizens
  unlocked" is gated by the chapel being placed (both games pass 120
  Settlers by minute 12), so the first-house time is the pacing check;
  and Settler houses earn 15 % less than before D-056 until the chapel
  stands (market alone covers 0.6 of the services category) — absorbed
  by the margins.
- Warehouse throughput at each level must cover a "typical" island at that
  tier with one warehouse ≈ 80 % load.
- Tax income at each tier's unlock population must cover upkeep of the
  balanced chain set with ≥ 20 % margin.
- Charcoal demand of a balanced Merchant economy must exceed one island's
  forest capacity so coal or a second forest island becomes relevant.
- Starting stock (`start.json`: 1 000 gold, 150 planks, 10 sails; the
  goods aboard the start sloop, 800 gold and 135 planks left after founding
  the Trading Post for 200 gold / 15 planks) must allow: 8 settler houses + fisher +
  lumberjack + sawmill + market + ~40 road tiles, and cover the early
  deficit for ≥ 15 min of upkeep (currently ≈ 54 min: 270 gold left at
  5 gold/min of upkeep).
- Verify with headless scenarios before touching any client code.
