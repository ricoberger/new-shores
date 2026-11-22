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
| `old_coast` | The Old Coast | temperate | launch region and home region (D-076); all content below. Materials are regional (D-037). Island prefix `oc`. |

The regions of a world are listed in `content/regions.json` (D-076), the
home region first:

```json
{
  "regions": [{ "id": "old_coast", "prefix": "oc", "home": true, "gate": null }],
  "passages": []
}
```

`id` names the region folder `content/<id>` (its `region.json` carries the
same ID); `prefix` (2–4 lower-case letters, unique) prefixes the island IDs
of the region's archipelago (`oc-01` … `oc-NN`); `home` marks the home
region — exactly one, the first; `gate` is the building ID that opens a
later region (D-076 §2: the Kontor) and `null` for the home region;
`passages[]` = `{ from, to, minutes }` are the off-map legs between two
listed regions (one per pair, both directions; provisional 10 min at
scale 1). The loader validates the list (schema `regions.schema.json`,
unique IDs and prefixes, every folder present, gates are buildings of a
region, passages join two listed regions), loads every region folder on
its own and merges their goods into one ID space: a good ID in two regions
is an error (goods are global, D-076 §3). While the list holds one region
there is no passage and no gate.

## 2. Tiers

| # | ID | Name | Residents (floor–max) | Tax/res/min | House cost | Workforce role |
|---|---|---|---|---|---|---|
| 1 | `settlers` | Settlers | 2–6 | 1.05 | 5 planks (§7) | farms, fishers, lumber, gatherers |
| 2 | `citizens` | Citizens | 5–14 | 0.90 | §7 `house_citizens` | mines, kilns, mills, basic workshops |
| 3 | `merchants` | Merchants | 8–26 | 1.62 | §7 `house_merchants` | refined workshops, printing, brewing |
| 4 | `patricians` | Patricians | 12–43 | 2.39 | §7 `house_patricians` | fine crafts, opticians (small numbers) |

House sizes are Anno 117's (D-080 §1; 8 / 15 / 25 / 40 before content
0.23.0); the unlocks (below) are 20 / 26 / 46 full houses. Tax follows
Anno's `Money` per full house divided by its size, 6 / 6 : 12 / 14 :
40 / 26 : 98 / 43 = 1.00 : 0.86 : 1.54 : 2.28 per resident, times one
scale `k_tax` = 1.05, rounded to two decimals (D-082 §1; 1.18 under
D-080, which kept the Patricians at 2.70). `k_tax` is tuned so that in
the reference games tax exceeds upkeep by 20–50 % at the tightest point
from minute 30 on; the Merchants and Patricians games meet it, the
Citizens games stay richer (§12, D-082 reference results). It is the
one number to move when a change shifts the gold balance; civic and
producer maintenance are Anno's (D-080 table C, D-082 table E, §7).

### Unlock conditions (archipelago-wide)

| Unlocks | Requires |
|---|---|
| Citizens | 120 Settlers (D-069: population only) |
| Merchants | 360 Citizens |
| Patricians | 1 200 Merchants |
| Islands | no tier gating — every island can be settled from the start (D-051) |

Since D-069 the unlocks are population only: the market, chapel, tavern
and church the D-056 list named are already required by the house
upgrade gate (their categories ≥ 0.6), and the intro quests still lead
the player to them. `tiers.json` keeps `unlock.buildings` as an optional
key for later regions.

### Need categories per tier (D-056; supersedes D-031's bonus and D-033)

Every alternative of a category with two or more alternatives has
**share 0.6**; a category with exactly one alternative has share 1.0
(D-056 amendment); category coverage = `min(1, Σ shares of supplied
alternatives)` — one of two alternatives gives 60 %, both give 100 %.
Tax rates are tuned to the one-alternative baseline (§2). Consumption in units per resident per minute
(a 60 s cycle producer making 1 unit = 1 unit/min). Since D-080 §2 the
own-tier rate of every good is its Anno 117 counterpart's per-house rate
divided by the Anno house size (D-080 table A, e.g. fish = Sardines
0.01785 / 6 = 0.002975: one fisher feeds 56 Settler houses). A house also has the
categories of every **lower tier** (cumulative, D-056 §2) at reduced
rates: `rate × (own max residents / higher max residents) × 0.5^(tier
distance / 3)`, e.g. fish 0.002975 → Citizens 0.001012, Merchants
0.000432, Patricians 0.000208. The rates are **generated, not typed**:
`content/tools/needs_gen.py` holds table A and writes every goods rate
of `needs.json`, own and carried, with that formula and the house sizes
of `tiers.json`, rounded half-even to six decimals (the content's
micro-unit resolution); `make content-gen` runs it and `make
content-test` fails when `needs.json` differs from its output. Weights: the own tier's categories share 0.6 of
satisfaction, all lower tiers' categories 0.4 together (split equally
per lower tier, then by the lower tier's own weights). Public services
(D-065, MECHANICS §6.2): every tier has a **market** category (the
`market` alone, its level's radius) and the **chain** categories
faith, education and culture with a minimum rank — any building of the
chain with that rank or higher serves the house fully within its own
radius (faith `chapel` 1 < `church` 2 < `cathedral` 3, education
`school` 1 < `university` 2, culture `tavern` 1 < `playhouse` 2). The
civic services (D-060) are **safety** (`city_guard`, from Citizens),
**fire protection** (`fire_station`, from Merchants) and **health**
(`surgery`, Patricians only), one building each (share 1.0). Every category is a category of every house of its
tier and above, counted in the upgrade gate (≥ 0.6) like any required
category. The table lists each tier's **own** categories (weights
relative within the tier; chains as `faith ≥ 2`).

| Tier | Goods categories → acceptable goods | Building needs (radius) |
|---|---|---|
| Settlers | food 0.5: **fish** 0.002975 · clothing 0.2: **wool_garments** 0.002975 | market 0.12: `market` 20 · faith ≥ 1 0.18: `chapel` 16 |
| Citizens | food 0.2: bread 0.001156 \| cheese 0.000621 · drink 0.2: cider 0.001099 \| mead 0.000621 · clothing 0.2: linen_garments 0.001018 \| leather_jerkins 0.000465 | market 0.12: `market` 24 · faith ≥ 1, education ≥ 1 (`school` 20), culture ≥ 1 (`tavern` 20) 0.06 each · safety 0.1: `city_guard` 28 |
| Merchants | food 0.17: sausages 0.000431 \| pies 0.000220 · drink 0.17: beer 0.000496 \| brandy 0.000220 · clothing 0.09: coats 0.000385 \| dyed_garments 0.000218 · comfort 0.17: books 0.000192 \| soap 0.000189 | market 0.096: `market` 28 · faith ≥ 2 (`church` 28), education ≥ 1, culture ≥ 2 (`playhouse` 38) 0.048 each · safety 0.08: `city_guard` 28, fire protection 0.08: `fire_station` 28 |
| Patricians | food 0.14: roast_beef 0.000175 \| oysters 0.000140 · drink 0.14: wine 0.000140 \| grain_spirit 0.000130 · clothing 0.14: fine_garments 0.000201 \| lace 0.000127 · comfort 0.14: candles 0.000119 \| spectacles 0.000104 · luxury 0.14: jewellery 0.000124 \| instruments 0.000158 | market 0.04: `market` 32 · faith ≥ 3 (`cathedral` 50), education ≥ 2 (`university` 46), culture ≥ 2 0.02 each · safety/fire protection 0.06 each, health 0.08: `surgery` 28 |

The market radius is that of its level (20/24/28/32, level *n* from
tier *n*, D-065); the table lists the level the tier unlocks. The radii
are Anno 117's (D-072 §3, on the islands of D-072; before 12/15/18/21
for the market, tavern 14, school 16, church 20, playhouse 24,
university 24, cathedral 28, guard and fire 16, surgery 20); the three
civic services share 28 since D-080 §7 (guard 26 and fire 22 before).

Houses per final producer at the own-tier rate (residents × rate against
the producer's output per minute, D-080 table A): fisher and weaver 56
Settler houses; bakery 62, cheese dairy and meadery 115, cidery 43,
linen weaver 70, tannery 77 Citizen houses; butcher 89, pastry kitchen
175, brewery 78, distillery 117, tailor 100, dyer 176, printing press
100, soap maker 204 Merchant houses; slaughterhouse 133, oyster house
166, winepress 221, grain distillery 119, fashion house 58, lace maker
122, candle foundry 261, optician 112, goldsmith 125, luthier 147
Patrician houses.

Variety reserve (D-056, IDs reserved, not in the tier plan): fur_coats,
tableware, confectionery, paintings.

## 3. Construction materials (D-037, D-083)

One construction material per tier (D-083 §2): planks (Settlers), stone
(Citizens), bricks (Merchants), glass (Patricians); every tier reuses the
earlier materials, nothing else is a construction material. Sails are
the ship material. `tools` and the `toolmaker` are retired (D-083 §1,
content 0.24.0, §12); iron is a Patricians intermediate (§4).

| Material | Tier | Chain | Slot / resource |
|---|---|---|---|
| `planks` | Settlers | `lumberjack` (48 `tree_plot`s, D-059; 24 before 0.20.0) → `sawmill` | open land for the plots |
| `stone` | Citizens | `quarry` | stone slot |
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
| `iron` | `smelter` (Patricians, D-083 §3) | — | cooperage; warships balinger 10, war cog 20, war carrack 40 (§8) |
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
provisional. Since D-080 §4 (content 0.23.0) the final-good producers run
at their Anno 117 counterpart's cycle (D-080 table C); upstream cycles
changed only where a chain ratio stopped being whole: `sheep_farm` 90 →
60 s (with weaver_wool at 60 s the old cycle would need 1.5 farms per
weaver; 1 : 1 kept, also for the tailor's wool) and `cooperage` 60 →
45 s (with the winepress at 45 s the old cycle would need 1.33
cooperages per winepress; 1 : 1 kept; cooperage : grain distillery
2 : 3 → 1 : 2). The other changed ratios stay whole
with the old upstream cycles: orchard : cidery 2 : 1 → 1 : 1, hemp :
linen weaver 4 : 3 → 1 : 1, pig farm : tannery 3 : 2 → 3 : 4, paper mill :
printing press 1 : 2 → 1 : 4, thread spinner : lace maker 3 : 8 → 1 : 2,
glass / copper smelter : optician 2 : 3 → 1 : 2, sawmill / copper
smelter : luthier 1 : 4 / 1 : 2 → 1 : 2 / 1 : 1.

### Tier 1 — Settlers (first playable; implemented)

| Good | Chain | Ratio |
|---|---|---|
| planks | `lumberjack` (48 tree plots → wood, 30 s) [4 S], `sawmill` (wood → planks, 30 s) [4 S] | 1 : 1 |
| fish | `fisher` (harbour slot → fish, 60 s) [4 S] | — |
| wool_garments | `sheep_farm` (grass → wool, 60 s) [4 S], `weaver_wool` (wool → wool_garments, 60 s) [6 S] | 1 : 1 |

Infrastructure: `trading_post` lvl 1 (founding), `warehouse` lvl 1,
`road_dirt`, `market` lvl 1, `chapel`, `house_settlers`. The start
ship is a cog; the shipyard unlocks at tier 2 (D-056).

### Tier 2 — Citizens

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | bread | `wheat_farm` (wheat fert. → wheat, 60 s) [6 S], `mill` (wheat → flour, 30 s) [4 C], `bakery` (flour → bread, 60 s) [6 C] | 2 : 1 : 2 |
| food | cheese | `dairy_farm` (grass → milk, 60 s) [6 S], `cheese_dairy` (milk → cheese, 60 s) [6 C] | 1 : 1 |
| drink | cider | `orchard` (apple fert. → apples, 90 s) [6 S], `cidery` (apples → cider, 90 s) [6 C] | 1 : 1 |
| drink | mead | `apiary` (meadow → honey, 90 s) [4 S], `meadery` (honey → mead, 60 s) [6 C] | 3 : 2 |
| clothing | linen_garments | `hemp_farm` (hemp fert. → hemp, 60 s) [6 S], `weaver_linen` (hemp → linen_garments, 60 s) [6 C] | 1 : 1 |
| clothing | leather_jerkins | `pig_farm` (grass → pigs, 90 s) [6 S], `tannery` (pigs → leather_jerkins, 120 s) [8 C] | 3 : 4 |
| construction | stone | `quarry` (stone slot → stone, 45 s) [8 S] | — |
| intermediate | charcoal | `charcoal_burner` (wood → charcoal, 45 s) [4 S] — no Citizens consumer since D-083; kept for the Merchants' brickworks, salt works and distillery | — |
| ships | sails | `sailmaker` (hemp → sails, 60 s) [6 C] | — |

Infrastructure: `trading_post` lvl 2, `market` and `warehouse` lvl 2 (D-065), `road_paved`, `quay` (D-060), `tavern`, `school`,
`city_guard`, `shipyard` (cog, 2 slots), `house_citizens`. Hemp is on the second settleable island, never the first; the home candidate has stone and no other deposit, so one island suffices until Merchants (D-083).
The construction chain (quarry) is **Settler-staffed** per the
bootstrap rule (MECHANICS §4): the first Citizen house costs stone, so stone
must be producible before any Citizen exists. Likewise bricks (tier 3) are
made by Citizens and glass (tier 4) by Citizens.

### Tier 3 — Merchants (implemented, content `old_coast-0.12.0`)

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | sausages | `pig_farm`, salt chain, `butcher` (pigs + salt → sausages, 60 s) [8 M] | 3 : 1 : 2 |
| food | pies | `wheat_farm`, `mill`, `orchard`, `pastry_kitchen` (flour + apples → pies, 60 s) [8 M] | 2 : 1 : 2 : 2 |
| drink | beer | `wheat_farm`, `hop_farm` (hop fert. → hops, 60 s) [6 S], `brewery` (wheat + hops → beer, 60 s) [10 M] | 1 : 1 : 1 |
| drink | brandy | `orchard`, `cidery`, `distillery` (cider + charcoal → brandy, 90 s) [8 M] | 1 : 1 : 1 |
| clothing | coats | `weaver_wool`, `pig_farm`, `leather_works` (pigs → leather, 60 s) [8 C], `tailor` (wool_garments + leather → coats, 60 s) [10 M] | 2 : 3 : 2 : 2 |
| clothing | dyed_garments | `weaver_linen`, `woad_farm` (woad fert. → woad, 90 s) [6 S], `dyer_works` (woad → dye, 60 s) [6 C], `dyer` (linen_garments + dye → dyed_garments, 60 s) [8 M] | 1 : 1 : 1 : 1 |
| comfort | books | `lumberjack`, `paper_mill` (wood → paper, 30 s) [8 C], `printing_press` (paper → books, 120 s) [10 M] | 1 : 1 : 4 |
| comfort | soap | `pig_farm`, `rendering_house` (pigs → tallow, 60 s) [6 C], `soap_maker` (tallow → soap, 60 s) [8 M] | 2 : 1 : 1 |
| intermediate | salt | `salt_pans` (harbour slot → salt, 120 s) [4 S] **or** `salt_mine` (salt slot → brine, 30 s) [10 C] + `salt_works` (brine + charcoal → salt, 30 s) [8 C] | — |
| construction | bricks | `clay_pit`, `brickworks` (clay + charcoal → bricks, 45 s) [8 C] | 1 : 1 |
| energy | coal | `coal_mine` (coal slot → coal, 45 s) [10 C]; coal substitutes charcoal 1:1 | — |

One recipe per building (D-041): `leather_works` is a separate building from
`tannery` rather than a second recipe.

Infrastructure: `trading_post` lvl 3, `market` and `warehouse` lvl 3 (D-065), `church`,
`playhouse`, `fire_station` (one level, D-065), `trading_pier`, `depot`
(D-060; Merchants since D-069 §5), `hulk` (4 slots), `house_merchants`;
`harbourmaster_office` (world map, expeditions, contracts) is an ONLINE
feature, not a tier gate, and not authored yet. Variety reserve
(D-056): fur_coats (`trapper`, `furrier`), tableware (`potter`;
`clay_pit` stays for bricks).

### Tier 4 — Patricians (implemented, content `old_coast-0.13.0`)

| Category | Good | Chain | Ratio |
|---|---|---|---|
| food | roast_beef | `cattle_farm` (grass → cattle, 120 s) [8 S], salt, `slaughterhouse` (cattle + salt → roast_beef, 60 s) [8 P] | 2 : 1 : 1 |
| food | oysters | `oyster_beds` (harbour slot → raw_oysters, 90 s) [6 S], salt, `oyster_house` (raw_oysters + salt → oysters, 60 s) [6 P] | 3 : 1 : 2 |
| drink | wine | `vineyard` (grape fert. → grapes, 90 s) [8 S], `cooperage` (planks + iron → barrels, 45 s) [8 C], `winepress` (2 grapes + barrels → wine, 45 s) [8 P] | 4 : 1 : 1 |
| drink | grain_spirit | `wheat_farm`, `malt_house` (wheat → malt, 60 s) [6 C], `cooperage`, `grain_distillery` (malt + barrels + charcoal → grain_spirit, 90 s) [8 P] | 4 : 4 : 3 : 6 |
| clothing | fine_garments | `dyer`, `thread_spinner`, `fashion_house` (dyed_garments + thread → fine_garments, 120 s) [10 P] | 1 : 1 : 1 |
| clothing | lace | `hemp_farm`, `thread_spinner` (hemp → thread, 45 s) [6 C], `lace_maker` (thread → lace, 90 s) [10 P] | 4 : 3 : 6 |
| comfort | candles | `rendering_house`, `hemp_farm`, `candle_foundry` (tallow + hemp → candles, 45 s) [6 P] | 2 : 1 : 2 |
| comfort | spectacles | `glass_smelter`, `copper_mine` (copper slot → copper_ore, 60 s) [10 C], `copper_smelter` (copper_ore + charcoal → brass, 60 s) [8 C], `optician` (glass + brass → spectacles, 120 s) [8 P] | 1 : 1 : 1 : 2 |
| luxury | jewellery | `gold_mine` (gold slot → gold_ore, 120 s) [10 C], `gold_smelter` (gold_ore + charcoal → gold_bars, 60 s) [8 C], `goldsmith` (gold_bars → jewellery, 90 s) [6 P] | 1 : 2 : 1.5 |
| luxury | instruments | `sawmill`, `copper_smelter`, `luthier` (planks + brass → instruments, 60 s) [8 P] | 1 : 2 : 2 |
| construction | glass | `quartz_quarry` (quartz slot → quartz, 60 s) [10 C], `glass_smelter` (quartz + charcoal → glass, 60 s) [8 C] | 1 : 1 |
| intermediate | iron | `iron_mine` (iron slot → iron_ore, 60 s) [10 S], `charcoal_burner`, `smelter` (iron_ore + charcoal → iron, 60 s) [8 S] — Patricians since D-083 §3 (Citizens before, for tools); feeds the `cooperage` and the warships | 1 : 1.3 : 1 |

`gold_bars` avoids a good named `gold`, which is the reserved cost key
(§11). Variety reserve (D-056): confectionery (`confectioner`), paintings
(`mineral_quarry`, `studio`).

Infrastructure: `trading_post` lvl 4, `market` and `warehouse` lvl 4 (D-065), `university`,
`cathedral`, `surgery` (health, radius 28; glass cost, D-062),
`carrack` (6 slots), `house_patricians`.

## 6. Catalogue totals

| | Settlers | Citizens | Merchants | Patricians | Total |
|---|---|---|---|---|---|
| Final goods (needs) | 2 | 6 | 8 | 10 | **26** (+4 reserve) |
| Construction/ship materials | 1 | 2 | 1 (+coal) | 1 | 5 (+1) |
| Buildings (all kinds, content `old_coast-0.13.0`; reserve not counted) | 12 | 30 | 25 | 26 | **93** |
| Fertilities | — | wheat, apple, hemp | hops, woad | grapes | 6 |
| Deposit slot types | — | stone | clay, salt, coal | iron, quartz, copper, gold | 8 |

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
(min 1 for producers); since D-080 §5 the **final-good producers** (the
26 buildings of D-080 table C) pay `k_upkeep` × the Anno counterpart's
gold maintenance, rounded (`k_upkeep = 1.0` after the D-080 tuning,
§12 — start value 0.5: fisher 6, bakery 14, slaughterhouse 40,
goldsmith 48),
the other producers keep their D-054 upkeep. Workforce is ours; the
final producers' cycle times are their Anno counterparts' (D-080 §4),
the other cycles ours (§5). Fields:
Anno's tile counts and per-tile prices; animal farms use pasture modules
(`pasture` 3×3, `pig_pen` 3×4, `cattle_pasture` 4×7); `max = required`.
Everything is provisional and re-verified against §12.

Footprint in tiles as width × depth (depth away from the road; for
harbour buildings the front faces the water); `water_rows` bounds the
sea-water prefix independently per column (D-062), `shore` marks the
shore placement (D-077 §5, MECHANICS §2); upkeep in gold/min;
`R` = requires road connection; workforce as `amount tier` (S/C/M/P).

| ID | Tier | Footprint | water_rows | Anno 117 reference | Cost (gold / planks / stone / bricks / glass, up to the tier) | Upkeep | Workforce | Notes |
|---|---|---|---|---|---|---|---|---|
| `house_settlers` | 1 | 3×3 | — | Residence | 0 / 5 | 0 | — | R; all houses 3×3, upgrade in place |
| `road_dirt` | 1 | 1×1 | — | road | see text | 0 | — |  |
| `trading_post` | 1 | 6×6 | 1–2 | Trading Post (D-062) | see text | 0 / 6 / 12 / 24 | — | founding only; collector with reach; levels as below (D-069) |
| `warehouse` | 1 | 6×6 | — | Warehouse 6×6 | 50 / 6 | 6 / 10 / 16 / 24 | — | collector; reach and throughput per level, four levels (D-065, D-069, below) |
| `market` | 1 | 5×6 | — | Market | 250 / 15 | 10 / 20 / 40 / 60 | — | R (was `market_small` until D-056 C3; that ID is retired); market category (D-065); levels: lvl 1 radius 20; lvl 2 (tier 2) radius 24, 400 gold / 10 planks / 10 stone; lvl 3 (tier 3) radius 28, 2000 gold / 30 planks / 60 stone; lvl 4 (tier 4) radius 32, 10000 gold / 30 planks / 90 stone / 30 bricks (D-065; radii, and cost and upkeep of levels 3–4 ×2, D-072) |
| `chapel` | 1 | 3×5 | — | Chapel (Anno 1404) | 100 / 6 | 6 | — | R, radius 16; faith rank 1 (D-065) |
| `lumberjack` | 1 | 3×3 + 48 `tree_plot` | — | Woodcutter | 60 / 6 | 1 | 4 S | R; plants its trees like a farm (D-059; was work radius 4 forest; 24 plots before content 0.20.0 — a forest of 48 reads as a wood, polish 7) |
| `tree_plot` | 1 | 1×1 field | — | field tile | 1 g | 0 | — | lumberjack only; painted; grass or forest, no fertility (D-059; every field since D-079) |
| `sawmill` | 1 | 4×6 | — | Sawmill | 120 / 9 | 2 | 4 S | R |
| `fisher` | 1 | 3×8 | 2–6 | Fishing Hut | 60 / 6 | 6 | 4 S | R |
| `sheep_farm` | 1 | 3×3 + 3 `pasture` | — | Sheep Farm | 60 / 6 | 1 | 4 S | R, cycle 60 s (90 s before D-080: keeps the weaver's 1 : 1) |
| `pasture` | 1 | 3×3 field | — | pasture module | 15 g / 1 plank | 0 | — | sheep_farm only; grass or forest (D-079); edge-adjacent chain |
| `weaver_wool` | 1 | 3×4 | — | Spinner | 60 / 6 | 8 | 6 S | R, cycle 60 s (D-080; 90 s before) |
| `shipyard` | 2 | 8×12 | shore | Shipyard | 300 / 45 / 0 | 0 | — | R, never auto-paused; tier 2 since D-056; builds every unlocked ship type |
| `house_citizens` | 2 | 3×3 | — | Residence | 150 / 5 / 3 | 0 | — | upgrade only |
| `road_paved` | 2 | 1×1 | — | road | see text | 0 | — | 3 gold / 1 stone |
| `quay` | 2 | 1×1 on shallows | — | road (D-060) | see text | 0 | — | 5 gold / 2 stone; 0.6 s/tile; water-edge and shore buildings stand on it; connected to land (D-077 §8) |
| `quarry` | 2 | 3×8 on a stone slot | — | Limestone Quarry | 120 / 9 / 0 | 3 | 8 S | R; strip into the mountain |
| `charcoal_burner` | 2 | 5×6 | — | Charcoal Burner | 90 / 9 / 0 | 2 | 4 S | R, forest nearby (visual) |
| `wheat_farm` | 2 | 3×4 + 140 `wheat_field` | — | Wheat Farm | 150 / 9 / 3 | 2 | 6 S | R, wheat fertility |
| `wheat_field` | 2 | 1×1 field | — | field tile | 3 g | 0 | — | wheat_farm only; painted |
| `mill` | 2 | 3×3 | — | Grain Mill | 180 / 6 / 6 | 2 | 4 C | R (no river slot: plain land); a lone windmill, no miller's house and no chimney (D-074 §6; 4×6 before content 0.20.0) |
| `bakery` | 2 | 4×5 | — | Bakery | 230 / 5 / 9 | 14 | 6 C | R |
| `dairy_farm` | 2 | 4×5 + 5 `cattle_pasture` | — | Pig Farm class, large | 170 / 5 / 6 | 2 | 6 S | R, grass |
| `cattle_pasture` | 2 | 4×7 field | — | pasture module | 30 g / 5 planks | 0 | — | dairy_farm and cattle_farm; grass or forest (D-079) |
| `cheese_dairy` | 2 | 4×5 | — | Garum Works class | 180 / 6 / 6 | 12 | 6 C | R |
| `orchard` | 2 | 4×4 + 160 `orchard_plot` | — | Olive Grower | 230 / 5 / 9 | 2 | 6 S | R, apple fertility |
| `orchard_plot` | 2 | 1×1 field | — | field tile | 1 g | 0 | — | orchard only |
| `cidery` | 2 | 5×6 | — | Olive Press | 240 / 6 / 9 | 16 | 6 C | R |
| `apiary` | 2 | 5×5 + 100 `meadow` | — | Apiary | 290 / 5 / 12 | 4 | 4 S | R |
| `meadow` | 2 | 1×1 field | — | field tile | 1 g | 0 | — | apiary only; grass or forest (D-079) |
| `meadery` | 2 | 4×5 | — | Victualler class | 180 / 6 / 6 | 12 | 6 C | R |
| `hemp_farm` | 2 | 3×4 + 60 `hemp_field` | — | Hemp Farm | 60 / 6 / 0 | 1 | 6 S | R, hemp fertility |
| `hemp_field` | 2 | 1×1 field | — | field tile | 2 g | 0 | — | hemp_farm only |
| `weaver_linen` | 2 | 4×5 | — | Loom Weavery | 410 / 5 / 18 | 8 | 6 C | R |
| `pig_farm` | 2 | 3×4 + 5 `pig_pen` | — | Pig Farm | 170 / 5 / 6 | 2 | 6 S | R, grass |
| `pig_pen` | 2 | 3×4 field | — | pasture module | 20 g / 5 planks | 0 | — | pig_farm only; grass or forest (D-079) |
| `tannery` | 2 | 3×4 | — | Tannery | 180 / 6 / 6 | 12 | 8 C | R |
| `sailmaker` | 2 | 4×8 | — | Ropemaker | 240 / 6 / 9 | 2 | 6 C | R |
| `tavern` | 2 | 4×6 | — | Tavern | 250 / 15 / 0 | 10 | — | R, radius 20 (D-072); culture rank 1 (D-065) |
| `school` | 2 | 6×8 | — | Grammaticus | 1000 / 15 / 30 | 16 | — | R, radius 20 (D-072); education rank 1 (D-065) |
| `city_guard` | 2 | 4×4 | — | Watch post class | 200 / 10 / 6 | 5 | — | R, safety; radius 28 (D-080 §7; 26 since D-072), one level (D-065) |
| `house_merchants` | 3 | 3×3 | — | Residence | 400 / 5 / 3 / 3 | 0 | — | upgrade only |
| `church` | 3 | 6×10 | — | Sanctuary | 3000 / 60 / 30 / 0 | 26 | — | R, radius 28; faith rank 2 (D-065); cost and upkeep ×2 (D-072) |
| `playhouse` | 3 | 11×14 | — | Playhouse (D-063) | 15000 / 60 / 120 / 60 | 60 | — | R, radius 38 (tier 3 since D-056); culture rank 2 (D-065); materials and upkeep ×2, gold kept (D-072: the Merchants game waits for its gold) |
| `fire_station` | 3 | 4×5 | — | Fire station class | 400 / 15 / 15 / 5 | 8 | — | R, fire protection; radius 28 (D-080 §7; 22 since D-072), one level (D-065) |
| `trading_pier` | 3 | 6×9 | shore | Pier class (ours) | 250 / 20 / 10 | 0 | — | R, never auto-paused; +2 berths for the island (D-060); no levels; Merchants since D-069 §5 |
| `depot` | 3 | 4×11 | shore | Depot class (ours) | 280 / 20 / 10 | 0 | — | R, never auto-paused; +150 capacity per good, no levels; any number (D-062); Merchants since D-069 §5 |
| `surgery` | 4 | 4×6 | — | Surgery class | 450 / 10 / 15 / 0 / 5 | 8 | — | R, radius 28 (D-072), health; one level, glass cost (D-062) |
| `harbourmaster_office` | 3 | 5×5 | (reserve) | Repair Crane class | 1000 / 60 / 45 / 0 | 6 | — | world map, expeditions, contracts |
| `butcher` | 3 | 4×5 | — | Victualler class | 270 / 6 / 6 / 3 | 12 | 8 M | R |
| `pastry_kitchen` | 3 | 4×5 | — | Bakery class | 320 / 5 / 9 / 3 | 14 | 8 M | R |
| `hop_farm` | 3 | 3×4 + 60 `hop_field` | — | crop farm class | 120 / 6 / 3 / 0 | 2 | 6 S | R, hops fertility |
| `hop_field` | 3 | 1×1 field | — | field tile | 3 g | 0 | — | hop_farm only |
| `brewery` | 3 | 5×6 | — | Olive Press class | 330 / 6 / 9 / 3 | 14 | 10 M | R |
| `distillery` | 3 | 5×6 | — | Olive Press class | 420 / 6 / 9 / 6 | 16 | 8 M | R (brandy only, D-041) |
| `leather_works` | 3 | 3×4 | — | Tannery | 270 / 6 / 6 / 3 | 2 | 8 C | R |
| `tailor` | 3 | 4×5 | — | Loom Weavery class | 410 / 5 / 9 / 6 | 20 | 10 M | R |
| `woad_farm` | 3 | 3×4 + 100 `woad_field` | — | crop farm class | 120 / 6 / 3 / 0 | 2 | 6 S | R, woad fertility |
| `woad_field` | 3 | 1×1 field | — | field tile | 1 g | 0 | — | woad_farm only |
| `dyer_works` | 3 | 5×5 | — | Dye Works | 470 / 5 / 12 / 6 | 3 | 6 C | R |
| `dyer` | 3 | 4×5 | — | Loom Weavery class | 410 / 5 / 9 / 6 | 12 | 8 M | R |
| `trapper` (reserve) | 3 | 5×5 | — | Resin Trapper | 180 / 6 / 6 / 0 | 2 | 4 S | R, forest radius |
| `furrier` (reserve) | 3 | 3×4 | — | Sandal Maker class | 270 / 6 / 6 / 3 | 3 | 8 M | R |
| `paper_mill` | 3 | 4×6 | — | Sawmill class | 300 / 9 / 6 / 3 | 2 | 8 C | R |
| `printing_press` | 3 | 4×5 | — | Tabulus class | 330 / 6 / 9 / 3 | 22 | 10 M | R |
| `clay_pit` | 3 | 4×6 on a clay slot | — | Clay Pit | 60 / 6 / 0 / 0 | 2 | 8 C | R (no river slot: deposit slot) |
| `potter` (reserve) | 3 | 4×5 | — | Potter | 180 / 6 / 6 / 0 | 4 | 8 M | R |
| `rendering_house` | 3 | 3×3 | — | Renderer | 170 / 5 / 6 / 0 | 2 | 6 C | R |
| `soap_maker` | 3 | 3×4 | — | Soap Maker | 120 / 6 / 3 / 0 | 12 | 8 M | R |
| `salt_pans` | 3 | 5×9 | 2–5 | Salt Ponds | 180 / 6 / 6 / 0 | 2 | 4 S | R |
| `salt_mine` | 3 | 3×8 on a salt slot | — | Iron Mine class | 180 / 6 / 6 / 0 | 2 | 10 C | R |
| `salt_works` | 3 | 4×6 | — | Furnace class | 290 / 5 / 12 / 0 | 2 | 8 C | R |
| `brickworks` | 3 | 4×5 | — | Tiler | 90 / 9 / 0 / 0 | 3 | 8 C | R |
| `coal_mine` | 3 | 3×8 on a coal slot | — | Iron Mine class | 180 / 6 / 6 / 0 | 2 | 10 C | R |
| `house_patricians` | 4 | 3×3 | — | Residence | 1000 / 5 / 3 / 3 / 3 | 0 | — | upgrade only |
| `university` | 4 | 12×12 | — | Library | 100000 / 90 / 90 / 120 / 0 | 180 | — | R, radius 46; education rank 2 (D-065); cost and upkeep ×2 (D-072) |
| `cathedral` | 4 | 12×16 | — | Temple | 120000 / 30 / 120 / 120 / 60 | 100 | — | R, radius 50 (D-072); faith rank 3 (D-065); cost and upkeep ×2 (D-072) |
| `cattle_farm` | 4 | 4×5 + 5 `cattle_pasture` | — | Pig Farm class, large | 410 / 5 / 9 / 6 / 0 | 4 | 8 S | R, grass |
| `slaughterhouse` | 4 | 4×4 | — | Fish Gutter class | 390 / 6 / 6 / 3 / 3 | 40 | 8 P | R |
| `oyster_beds` | 4 | 6×12 | 3–8 | Oyster Bed | 480 / 12 / 9 / 6 / 0 | 3 | 6 S | R |
| `oyster_house` | 4 | 6×6 | — | Epicure of Water class | 510 / 6 / 6 / 3 / 6 | 40 | 6 P | R |
| `confectioner` (reserve) | 4 | 4×5 | — | Bakery class | 650 / 5 / 9 / 6 / 6 | 4 | 8 P | R |
| `vineyard` | 4 | 4×5 + 100 `vine_row` | — | Vineyard | 330 / 6 / 9 / 3 / 0 | 2 | 8 S | R, grapes fertility |
| `vine_row` | 4 | 1×1 field | — | field tile | 3 g | 0 | — | vineyard only |
| `iron_mine` | 4 | 3×8 on an iron slot | — | Iron Mine | 180 / 6 / 6 / 0 / 0 | 2 | 10 S | R; tier 2 until D-083 §3 (costs, workforce and model kept) |
| `smelter` | 4 | 4×6 | — | Furnace | 290 / 5 / 12 / 0 / 0 | 2 | 8 S | R; tier 2 until D-083 §3 (costs, workforce and model kept) |
| `cooperage` | 4 | 4×6 | — | Caelator class | 840 / 9 / 12 / 9 / 6 | 7 | 8 C | R |
| `winepress` | 4 | 6×9 | — | Vintner | 540 / 6 / 15 / 6 / 0 | 30 | 8 P | R |
| `malt_house` | 4 | 4×6 | — | Grain Mill class | 270 / 6 / 6 / 3 / 0 | 2 | 6 C | R |
| `grain_distillery` | 4 | 5×6 | — | Olive Press class | 600 / 6 / 9 / 6 / 6 | 20 | 8 P | R; model: the distillery recipe with its own roof colour (D-041: one recipe per building) |
| `fashion_house` | 4 | 5×7 | — | Chair Maker class | 900 / 6 / 9 / 6 / 12 | 28 | 10 P | R; dyed_garments + thread (furs are reserve) |
| `thread_spinner` | 4 | 3×4 | — | Spinner | 240 / 6 / 0 / 6 / 0 | 2 | 6 C | R |
| `lace_maker` | 4 | 3×5 | — | Cushion Stuffer | 650 / 5 / 3 / 6 / 9 | 16 | 10 P | R |
| `candle_foundry` | 4 | 4×4 | — | Jeweller class | 680 / 5 / 0 / 9 / 9 | 16 | 6 P | R |
| `quartz_quarry` | 4 | 3×8 on a quartz slot | — | Marble Quarry | 300 / 6 / 3 / 6 / 0 | 4 | 10 C | R |
| `glass_smelter` | 4 | 4×6 | — | Glass Smelter | 270 / 6 / 6 / 3 / 0 | 3 | 8 C | R (no river slot) |
| `copper_mine` | 4 | 3×8 on a copper slot | — | Mineral Quarry | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R |
| `copper_smelter` | 4 | 4×6 | — | Goldsmith class | 740 / 5 / 9 / 9 / 6 | 6 | 8 C | R |
| `optician` | 4 | 4×4 | — | Jeweller class | 680 / 5 / 0 / 9 / 9 | 26 | 8 P | R |
| `gold_mine` | 4 | 3×8 on a gold slot | — | Gold Mine | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R; exactly one gold slot per archipelago |
| `gold_smelter` | 4 | 4×6 | — | Goldsmith | 740 / 5 / 9 / 9 / 6 | 6 | 8 C | R |
| `goldsmith` | 4 | 4×4 | — | Jeweller | 680 / 5 / 0 / 9 / 9 | 48 | 6 P | R |
| `mineral_quarry` (reserve) | 4 | 3×8 on a quartz slot | — | Mineral Quarry | 210 / 6 / 3 / 3 / 0 | 5 | 10 C | R |
| `studio` (reserve) | 4 | 5×5 | — | Gilder | 680 / 5 / 6 / 9 / 6 | 4 | 6 P | R |
| `luthier` | 4 | 5×5 | — | Lythier | 870 / 6 / 9 / 9 / 9 | 30 | 8 P | R |

Roads: `road_dirt` 1 gold; `road_paved` 3 gold / 1 stone; `quay` 5 gold /
2 stone on the shallows (D-060, MECHANICS §3). Trading Post
founding cost 200 gold / 15 planks (start stock, D-051) — the levels below.

Collector levels (D-069, throughput D-074 §3; T = throughput per minute, reach in
tiles from the nearest footprint tile like a service radius, upkeep in
gold/min; level *n* of the Trading Post, the warehouse and the market
needs tier *n*, D-065, extended to the Trading Post):

| Collector | Level | Capacity | T | Reach | Upkeep | Berths | Upgrade cost |
|---|---|---|---|---|---|---|---|
| Trading Post | 1 | 300 | 10 | 24 | 0 | 1 | founding (200 gold / 15 planks) |
| Trading Post | 2 (Citizens) | 500 | 20 | 28 | 6 | 2 | 300 gold / 20 planks / 10 stone |
| Trading Post | 3 (Merchants) | 800 | 40 | 32 | 12 | 3 | 600 gold / 30 planks / 20 stone |
| Trading Post | 4 (Patricians) | 1 200 | 80 | 36 | 24 | 4 | 1 200 gold / 40 planks / 30 stone (10 tools until D-083) |
| Warehouse | 1 | — | 8 | 18 | 6 | — | placement (50 gold / 6 planks) |
| Warehouse | 2 (Citizens) | — | 16 | 21 | 10 | — | 150 gold / 10 planks / 5 stone |
| Warehouse | 3 (Merchants) | — | 32 | 24 | 16 | — | 300 gold / 15 planks / 10 stone |
| Warehouse | 4 (Patricians) | — | 64 | 27 | 24 | — | 600 gold / 20 planks / 20 stone |

Reach grew by 4 tiles per level with D-072 §3 (D-069: Trading Post 20 /
24 / 28 / 32, warehouse 14 / 17 / 20 / 23). Throughput fell with D-074 §3
(content 0.20.0; was Trading Post 20 / 40 / 60 / 80, warehouse 20 / 35 /
50 / 65): one level-1 warehouse serves a block of ≈ 5 producers, so the
collector levels become a tier-1/2 decision. D-075 §2 (content 0.21.0)
doubles the ramp and cheapens it: throughput Trading Post 10 / 20 / 40 /
80 (D-074: 8 / 16 / 32 / 64), warehouse 8 / 16 / 32 / 64 (6 / 12 / 24 /
48); upkeep Trading Post 0 / 6 / 12 / 24 (0 / 10 / 20 / 30), warehouse
1 / 5 / 10 / 20 (1 / 10 / 15 / 25) — the level-2 upgrade of a warehouse
is no longer a quarter of a tier-1 town's income. Reach, capacity and
upgrade costs unchanged. D-082 table E (content 0.23.1) sets the
warehouse to Anno 117's (Warehouse 6): 6 / 10 / 16 / 24.

Market upkeep per level 10 / 20 / 40 / 60 since D-082 table E (Anno 117's
Market 10; content 0.23.1; before 0 / 10 / 40 / 60, D-072 doubled levels
3–4 from 20 / 30). The chapel pays 6 (D-082), like the market without
ever being auto-paused. D-069 §3 named 5 for the
level 1 of market and warehouse; the plan replay tuned them: a market
with any upkeep placed before the first houses holds gold at zero for
good (it cannot be paused and roads cost gold), so its level 1 stays
free like the Trading Post's; a warehouse at 5 gold/min (2.5 fishers)
cost the Merchants game 30–50 minutes against its targets at the
number of warehouses reach needs, 2 still 8–10, so level 1 costs 1
(half a fisher) and the upkeep is felt from level 2 on (§12). Before D-069
the Trading Post had T 30 / 55 / 80 / 110 and the warehouse T 30 / 50 /
70 / 90, both without reach, and no hub carried upkeep. A producer only
delivers to a collector whose reach covers its building footprint
(MECHANICS §5); a 6×6 warehouse is the placement lever for that. Market
and warehouse level 4 have no model yet; the client draws level 3.

Harbour extensions (D-060, provisional, numbers ours — no Anno
counterpart): the **trading pier** adds 2 berths to its island's pool
(MECHANICS §9.3); the **depot** adds capacity per good to its island
while a Trading Post stands (MECHANICS §5): 150 each, no levels, any
number (D-062). Both have
upkeep 0 and `pause_category: never` like the Trading Post (a paused
depot would question its own capacity). Both arrive with the Merchants
(D-069 §5: they matter once several routes run); shipyard and quay stay
at Citizens.

Harbour additions (D-077 §4, D-076 §2, content 0.22.0; provisional):

| ID | Tier | Footprint | Placement | Cost | Upkeep | Notes |
|---|---|---|---|---|---|---|
| `repair_crane` | 3 | 3×3 | shore | 400 gold, 20 planks, 10 stone | 2 (`public`) | `repairs: true`; dormant until ship health comes with raids |
| `kontor` | 4 | 4×11 (depot class) | shore | 3 000 gold, 60 planks, 40 bricks, 20 glass | 10 (`public`) | `unique: world` (one per world, built or planned: `unique_building`); later opens expeditions and the online features (D-076 §2); DE name *Hansekontor* (the Trading Post is already *Kontor* in German) |

Both are `look: harbour`, stand in the build menu's Harbour group (the
server derives the category from `repairs` / `unique`) and need no road.

### Ornaments (D-077 §2, content 0.22.0; tiers D-078 §2, 0.22.1)

Ornaments start with the Citizens (D-078 §2: none at Settlers); the
pond moved to the Merchants. Zero effect, no maintenance (the price is the sink; `upkeep_per_min: 0`,
`pause_category: never`), `look: civic`, no road needed, movable,
`category: ornaments` (build-menu group Ornaments). Costs provisional.

| ID | Tier | Footprint | Cost (gold) | Notes |
|---|---|---|---|---|
| `hedge` | 2 | 1×1 | 10 | paint family: tiles join like roads (join pieces `hedge.<piece>`, ART_DIRECTION §7) |
| `garden_wall` | 2 | 1×1 | 15 | paint family (join pieces) |
| `tree_ornament` | 2 | 1×1 | 20 | 3 voxel variants |
| `flower_bed` | 2 | 1×1 | 15 | |
| `well` | 2 | 1×1 | 40 | |
| `maypole` | 2 | 2×2 | 120 | |
| `pillory` | 2 | 1×1 | 60 | |
| `pond` | 3 | 3×3 | 250 | ground kind `water_still` |
| `fountain` | 3 | 2×2 | 600 | |
| `statue` | 3 | 2×2 | 800 | |
| `cemetery` | 3 | 4×4 | 500 | |
| `square` | 3 | 1×1 | 20 | paint family, ground kind `cobbles_fine` (no model) |
| `harbour_statue` | 3 | 2×2 | 1 000 | shore placement |
| `gold_statue` | 4 | 3×3 | 2 000 | |

### Military (D-077 §3, content 0.22.0; tiers D-078 §3, 0.22.1)

Every military building arrives with the Patricians (D-078 §3: walls
are a late-game statement). `category: military` (build-menu group Military), `look: civic`, no road
needed, small maintenance (`pause_category: public`), a `defence` value
that **nothing reads** until raids (D-005) — the almanac and the card
show it. Costs provisional.

| ID | Tier | Footprint | Defence | Upkeep | Cost | Notes |
|---|---|---|---|---|---|---|
| `city_wall` | 4 | 1×1 | 1 | 0.1 per tile | 15 gold, 2 stone | paint family; a road may cross a tile (`road_crossing`, drawn as an arch) |
| `tower` | 4 | 2×2 | 5 | 2 | 200 gold, 10 stone | joins a wall line: wall stubs on every edge tile (ART_DIRECTION §7 wall set) |
| `gatehouse` | 4 | 3×3 | 5 | 3 | 300 gold, 15 stone | `gate: true`: wall on two opposite sides (stubs there), the road through its centre line |
| `harbour_tower` | 4 | 2×2 | 8 | 4 | 600 gold, 20 stone, 10 bricks | shore placement |
| `castle` | 4 | 12×12 | 30 | 40 | 80 000 gold, 200 stone, 150 bricks | the monument (D-078 §5): keep, curtain, four corner towers and gate |

## 8. Ships

| ID | Tier | Slots × size | Speed | Build | Cost | Upkeep |
|---|---|---|---|---|---|---|
| `cog` | 2 (start ship from tier 1) | 2 × 50 | 1.2 | 2 min | 100 gold, 20 planks, 10 sails* | 1 |
| `hulk` | 3 | 4 × 50 | 1.0 | 5 min | 1 500 gold, 60 planks, 20 sails | 4 |
| `carrack` | 4 | 6 × 60 | 0.85 | 10 min | 6 000 gold, 120 planks, 40 sails | 8 |
| `balinger` | 4 | — (attack 4) | 1.3 | 5 min | 800 gold, 40 planks, 15 sails, 10 iron | 3 |
| `war_cog` | 4 | — (attack 10) | 1.0 | 7.5 min | 2 500 gold, 80 planks, 30 sails, 20 iron | 5 |
| `war_carrack` | 4 | — (attack 20) | 0.8 | 10 min | 6 000 gold, 150 planks, 50 sails, 40 iron | 8 |

Trading ships cost gold, planks and sails only; warships replace the
retired tools 1 : 1 with iron (D-083 §3, content 0.24.0; brass stays the
luxury metal).

\*The sails for the first built cog are the reward of the tier-2
"Build a shipyard" quest (D-056) — the only source of sails before a
sailmaker (D-074 §4: the founding stock no longer carries any); the start
ship is a cog and carries the founding stock, 100 planks in its two
50-t slots (D-051).

Ships live in `ships.json` (`{ id, name, tier, slots, slot_size, speed,
build_seconds, cost, upkeep_per_min, length_tiles?, attack? }`, schema
under `content/schema/`); all six are authored and built at the
shipyard. The **warships** (D-077 §6; DE Balinger, Friedeschiff,
Kriegskraweel) carry no cargo — `slots: 0`, `slot_size: 0` (the loader
requires both zero together) — and an `attack` value that nothing reads
until raids (only ships without slots may carry one). Build times and
upkeep provisional (D-077 names cost, speed and attack only). `length_tiles` is the hull
length at model scale (cog 2, hulk 2.6, carrack 3.2; absent: 2), display
only: the client draws each ship and spaces the berths of Trading Posts
and trading piers by it (MECHANICS §9.1). Speeds differ (D-059,
supersedes D-056's equal speed): the cog is small and fast for founding
and short hops, the carrack large and slow for bulk. Ship positions and legs follow MECHANICS
§9; the archipelago seed stores island positions in tile coordinates.

## 9. Islands (D-036, D-053, D-058)

| Property | Value |
|---|---|
| Habitable islands per archipelago | 12: 3 large (≈ 250×250), 5 medium (≈ 163×163), 4 small (≈ 106×106) (D-072) |
| Skerries | 6–12 per archipelago (class `scenic`, `size` 5: 5–18 tiles of rock with a grass or sand top, D-073): scenery only — no sites, fertilities, deposits or name, not settleable, not a destination; land for routing, minimap and far view |
| Shape per class | rim massifs 2–4 / 1–2 / 0–1 (10–19 % of the land, rock height up to 6 / 5 / 3; D-072); plain ≥ 52 / 32 / 19 tiles square; rivers 1–2 / 0–1 / 0; terrace levels 2 / 2 / 1; islets 3–6 / 2–5 / 2–4 (large / medium / small; skerries none) |
| Fertilities per habitable island | 2–4 from the pool (wheat, apple, hemp 3–5 times per archipelago; hops, woad, grapes 2–5 times; provisional) |
| Deposit slots per island | 0–4, typed; a slot is two deposit tiles on a mountain edge, ≥ 16 tiles (Chebyshev) from every other slot of the island; every slot admits its building: the generator reserves a footprint of the largest building requiring the kind (3 × 8, clay pit 4 × 6, either rotation) on mountain tiles covering a slot tile, with a buildable tile beside it for the road, pairwise disjoint with the other slots' (D-072 part 2; generator-only, not stored); two slots of one kind lie on different massifs when the island has two or more; per archipelago stone 3–6, iron 2–4, clay 2–4, salt 1–3, coal 1–3, quartz 2–4, copper 1–3, gold exactly 1; only stone on the home island |
| Harbour area | proportional to coast length; ≥ 2 Trading Post sites per habitable island |
| Shallows | water tiles of an island's grid (not river) within 8 tiles (Chebyshev; 3 before D-077 §8) of its own land, islets excluded; derived from the tiles, the quay's ground; quays connect to land (D-060, D-077 §8, MECHANICS §3) |
| Spacing | ≥ 55 tiles between islands (50 before D-072: the nearest neighbour of the dev seed fell under a minute at the hulk's speed), nearest neighbour ≤ 120, straits ≥ 24 tiles of water (land to land, skerries included), open sea ≤ 150 tiles from land |
| Buildable area | 185 000 tiles (coast, grass, forest) per archipelago ± 10 % (D-072; ≈ 51 % of the 365 289-tile land extents, the share the shape rules give; provisional) |
| Anno 117 sizes (D-072) | buildable mean over seeds 1–50: large 31 725 (Anno 117: 31 573), medium 13 614 (13 369), small 6 011 (5 860) tiles; ≈ 2 640 / 1 130 / 500 houses at 12 tiles per house; with the rim massifs (D-072 §4) 13 % of a large or medium island is rock, and a quarter of the small islands have no massif |
| Names | from `island_names.json` (≥ 40 entries), unique per archipelago; renamable |
| IDs | `<region prefix>-NN` (`regions.json`, D-076): `oc-01` (the home candidate) … `oc-12`, skerries after them; global across the regions of a world |

Guarantees per tier are specified in MECHANICS §10. No gating (D-051).
Sizes, counts, pools and ranges live in `islands.json`; the generator
reads them and the content loader validates that the ranges are
satisfiable (pool size × max ≥ islands × min fertilities, etc.).

The generator places deposits in groups by tier: a kind joins the group
of the lowest tier with a building that mines it. A deposit entry's
optional `group_tier` pins the group instead. Iron has `"group_tier":
"citizens"` (D-083): its mine moved to the Patricians tier, and without
the pin every seed's archipelago would change. A mine that moves tier
later needs the same pin, or a `GeneratorVersion` bump with every plan
and fixture regenerated.

## 10. Decorations (cosmetic)

The ornaments are gold buildings since D-077 §2 (§7 Ornaments; no
Doubloons, D-077 §1). Possible later cosmetics: ship skins and house
facade variants per tier (MONETIZATION.md). Zero gameplay effect (D-021).

## 11. Content data format

Content lives in `content/regions.json` (the region list, §1) and
`content/<region>/*.json`, one file per entity type
(`region.json`, `start.json`, `tiers.json`, `goods.json`, `buildings.json`,
`needs.json`, `ships.json`, `quests.json`, `islands.json`; later
`decorations.json`), with
JSON Schemas (draft 2020-12, unknown fields rejected) under
`content/schema/`. The server validates on startup and fails fast on broken
references, duplicate IDs, need weights not summing to 1 and out-of-range
values, naming file, entity and field; the client gets generated TypeScript
types for display only. Decimals have at most 3 places (weights and
consumption rates 6), no exponent notation; they are converted to fixed point at load time.

`islands.json` deposit pool entries are `{ id, count: { min, max },
group_tier? }`. `group_tier` must name a tier in `tiers.json` (§9,
D-083); fertility entries have no `group_tier`.

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
the player renames the island (ship default names such as "Cog 2" are
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
| `growth_per_min`, `decline_per_min` | house growth (× satisfaction, below the target) and decline (× (1 − satisfaction), above it); the target is `floor + (max − floor) × satisfaction` (D-074, no threshold) | §6.1 |
| `optional_tax_bonus` | tax bonus at full optional-need fulfilment | §6.2 |
| `auto_resume_upkeep_minutes` | gold reserve before an auto-paused building resumes; **strictly > 0** (0 is rejected: it removes the pause/resume hysteresis) | §7 |
| `ship_speed_tiles_per_min` | archipelago tiles per minute at ship speed 1.0 (provisional 60) | §9.1 |
| `ship_handling_base_seconds` | fixed part of the berth time per stop (provisional 10) | §9.2 |
| `ship_handling_seconds_per_unit` | berth time per unit unloaded or loaded (provisional 0.2) | §9.2 |
| `away_summary_minutes` | minimum absence before a "while you were away" summary is produced (15) | §12b |
| `trial_resume_upkeep_minutes` | gold reserve for a trial resume of an unpaid building; must be > `auto_resume_upkeep_minutes` (30) | §7 |
| `camera.max_half_extent` | zoom-out cap of the camera, vertical half extent in tiles (80, D-072; was 120); client view only, no rule reads it; the client never caps below its far-LOD reach | render |

`version` is the `content_version` embedded in every saved world.

### start.json — starting stock

```json
{ "gold": 2000, "goods": { "planks": 100 } }
```

D-074 §4 (content 0.20.0; was 1 000 gold, 150 planks and 10 sails —
150 t never fit the cog's two 50-t slots, and the sails came again
from the shipyard quest). Aboard the start cog and on the balance from
the first moment; the
Trading Post is paid from it when the player founds (MECHANICS §8). Goods must exist in `goods.json`.

### buildings.json — capability blocks instead of a type enum

Every building has `id`, `name`, `region` (must equal the region id),
`tier`, `footprint: [width, height]` (rotation 0), `requires_road`, `cost`
(`{ "gold": n, "<good>": n }`; the key `gold` is reserved, so no good may be
called `gold`; zero-cost is `{ "gold": 0 }`), `upkeep_per_min`,
`pause_category` and `look`. Optional `description` is localized like the name
(English source plus locale key, 1–2000 printable characters).
World schema **17** (D-077 patrol), content **old_coast-0.24.0** (D-083 tools and the toolmaker retired, iron at Patricians, quests `citizens_stone` / `merchants_island2` — 0.23.x worlds and snapshots do not load; 0.23.1 D-082 civic maintenance and tax; 0.23.0 D-080 Anno 117 house sizes, generated rates, final-producer cycles, tax and upkeep; D-081 Trading Post road root — 0.22.x worlds and snapshots do not load; 0.22.1 D-078 `harbour_lane`, ornament and military tiers, the 12 × 12 castle; 0.22.0 D-077 ornaments, military, repair crane, Kontor, warships, `placement`, `category`, `defence`, `unique`, `paint_family`, `repairs`, `attack`; 0.21.1 D-076 `regions.json`, island IDs `oc-NN`, worlds with `regions[]`; 0.21.0 D-075; 0.20.0 D-074; 0.19.0 D-072; 0.18.0 D-069): schema-15 and schema-16 worlds migrate (MECHANICS §9.4, ARCHITECTURE §4.2); older
ones need a fresh local database (`make down VOLUMES=1 && make up`).
The old `water_tiles` key is rejected; `water_rows` has required integer
`min`/`max`, with `0 ≤ min ≤ max < depth` checked by the loader.
Optional `placement: "shore"` (D-077 §5) places a building by the shore
rule of MECHANICS §2; it excludes `water_rows`, `coastal`, a deposit and
the trading_post, road, field and house blocks; a `pier` needs
`water_rows` or the shore placement.
D-077 fields: `category` (`ornaments` or `military`; absent: derived
from the blocks) — such a building carries no capability block, an
ornament no upkeep; `defence` (integer ≥ 1, exactly on military
buildings; dormant); `unique` (`island` or `world`: one per scope, built
or planned, `unique_building`; not on a trading post, road, field or
house); `paint_family` (`{ ground?: "cobbles_fine", road_crossing?:
bool }`: a 1×1 land building without blocks painted with the road tools
whose tiles join, MECHANICS §3); `repairs` (boolean, shore buildings
only; dormant); `gate` (boolean: the gatehouse — a square military
building with an odd side ≥ 3 that needs a city wall on two opposite
sides and lets a road along its centre line, MECHANICS §3).
D-078 field: `harbour_lane` (boolean; needs the shore placement or
`water_rows`): the building is a berth holder with a harbour lane in
front of its water edge — its width plus one tile on each side, four
rows deep — on which quays, shore buildings and paint tiles are refused
(MECHANICS §2). Set on `trading_post`, `trading_pier`, `depot`,
`shipyard`, `repair_crane` and `kontor`.
What a building *does* is defined by the optional blocks
it carries:

| Block | Fields | Used by |
|---|---|---|
| `recipe` (later `recipes[]`, D-041) | `inputs[] {good, amount}` (may be empty), `outputs[] {good, amount}` (non-empty), `cycle_seconds` | producers |
| `house` | `tier` | residences |
| `trading_post` | `levels[] {capacity, throughput_per_min, reach?, upkeep_per_min?, berths, tier?, cost?}` — level 1 has no cost or tier (founding places it), later levels have a cost (`upgrade_trading_post`) and name the tier they need (D-065); with `water_rows` (per-column water prefix) | Trading Post, one per island |
| `pier` | `berths` (≥ 1) — berths added to the island's pool; needs `water_rows` or `placement: shore`; no collector, service or levels (D-060) | trading_pier |
| `depot` | `capacity` — fixed capacity per good added to the island; no levels, collector, service or pier (D-062) | depot |
| `warehouse` | `levels[] {throughput_per_min, reach?, upkeep_per_min?, tier?, cost?}` — collector only, no capacity (`upgrade_warehouse`); every later level names the tier it needs (D-065) | inland Warehouse |
| `road` | `seconds_per_tile`, `shallows?` (true: laid on the shallows instead of land, D-060) (building must be 1×1) | roads, quay |
| `service` | `radius` or `levels[] {radius, upkeep_per_min?, cost?}` (level *n* needs tier *n*, derived by the loader, D-065; only the market has levels); `chain` + `rank` for a chain building (one radius, D-065) | public buildings |
| `work_area` | `fertility` (island-wide tag the island must carry, else `no_fertility`); no radius or terrain rule | farms (the lumberjack is a farm since D-059) |
| `fields` | `type` (a field building's `field.type`), `required`, `max` | farms (D-051 part 4), lumberjack (D-059) |
| `field` | `type`, `farm` (the farm type that owns it, or a list of farm types sharing the module: `cattle_pasture` serves `dairy_farm` and `cattle_farm`), `terrain[]`, `fertility?` — 1×1 (crops) or a pasture module (`pasture` 3×3, `pig_pen` 3×4, `cattle_pasture` 4×7), small gold cost, no upkeep, `pause_category: never`, `requires_road: false`; validation requires every listed farm to exist with a matching `fields.type` | pasture, wheat_field, orchard_plot, hemp_field, pig_pen, meadow, cattle_pasture, hop_field, woad_field, vine_row, tree_plot |
| `workforce` | `tier`, `amount` | producers only (D-035) |
| `requires_deposit` | deposit type; the footprint must cover ≥ 1 tile with that deposit (`no_deposit`) and may cover mountain tiles | mines, quarries |
| `slot` | typed deposit/harbour slots (D-036) — not yet implemented; `requires_deposit` is the interim rule | — |

Collector and hub levels (D-069): `reach` (tiles, integer ≥ 1) is the
collector reach of a Trading Post or Warehouse level (MECHANICS §5); it
must be set on every level or on none (absent: no reach limit, only the
pinned test contents) and never shrinks from one level to the next.
`upkeep_per_min` on a level is that level's upkeep (absent: the
building's); level 1 must equal the building's top-level
`upkeep_per_min`. A `pause_category: never` building carries no upkeep
(D-046) — except the hubs, collectors and public buildings with levels,
whose levels carry upkeep (D-069 §3).
| `shipyard` | `ships[]` (ship IDs it can build) | shipyard |
| `smoke` | boolean, absent false — display only: the model carries chimney/smoke anchors and the client draws smoke | producers whose model has a chimney: every shipped producer except hop_farm, woad_farm, leather_works, tailor, printing_press, clay_pit, salt_pans, salt_mine, coal_mine, cattle_farm, oyster_beds, vineyard, fashion_house, thread_spinner, lace_maker, quartz_quarry, copper_mine, gold_mine, luthier and mill (the lone windmill, D-074 §6) |
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
  "pause_category": "intermediate",
  "look": "workshop"
}
```

`look` ∈ `rural`, `workshop`, `civic`, `harbour` (D-075 §3, required, no
gameplay effect) names who works the building, which sets its art
(ART_DIRECTION §7): **rural** wears the tier-1 look whatever its tier,
**workshop** the tier-2 look (dark tile allowed on tier-4 workshops),
**civic** and **harbour** the unlock-tier ladder. Fields, plots and
roads are `rural` too (no exemption: one rule for every building; they
have no roof, so the value only documents their place). The shipped
assignment:

| Look | Buildings |
|---|---|
| `rural` | lumberjack, tree_plot, sheep_farm, pasture, fisher, wheat_farm, wheat_field, dairy_farm, cattle_pasture, orchard, orchard_plot, apiary, meadow, hemp_farm, hemp_field, pig_farm, pig_pen, quarry, iron_mine, charcoal_burner, hop_farm, hop_field, woad_farm, woad_field, clay_pit, salt_pans, salt_mine, coal_mine, cattle_farm, oyster_beds, vineyard, vine_row, quartz_quarry, copper_mine, gold_mine, road_dirt, road_paved |
| `workshop` | sawmill, weaver_wool, mill, bakery, cheese_dairy, cidery, meadery, weaver_linen, tannery, sailmaker, smelter, butcher, pastry_kitchen, brewery, distillery, leather_works, tailor, dyer_works, dyer, paper_mill, printing_press, rendering_house, soap_maker, salt_works, brickworks, slaughterhouse, oyster_house, cooperage, winepress, malt_house, grain_distillery, fashion_house, thread_spinner, lace_maker, candle_foundry, glass_smelter, copper_smelter, optician, gold_smelter, goldsmith, luthier |
| `civic` | house_settlers, house_citizens, house_merchants, house_patricians, market, chapel, church, cathedral, school, university, tavern, playhouse, city_guard, fire_station, surgery, every ornament and military building (D-077) |
| `harbour` | trading_post, warehouse, shipyard, quay, trading_pier, depot, repair_crane, kontor |

Fisher, salt pans and oyster beds are primary producers on the water
(`rural`); the quay is a harbour structure although it is a road.

`pause_category` ∈ `need_goods`, `public`, `intermediate`, `food_basic`,
`never` drives the insolvency order (MECHANICS §7). Buildings accepting
`charcoal` or `coal` list both as the input's good, `{ "good": ["charcoal",
"coal"], "amount": 1 }` (tier 3: distillery, salt_works, brickworks;
tier 4: grain_distillery, glass_smelter, copper_smelter, gold_smelter).

### islands.json — archipelago generator parameters

```json
{
  "size_classes": [
    { "id": "large", "name": "Large", "size": 250, "count": { "min": 3, "max": 3 },
      "fertilities": { "min": 2, "max": 4 }, "deposits": { "min": 0, "max": 4 },
      "shape": { "massifs": { "min": 2, "max": 4 }, "plain": 52, "rivers": { "min": 1, "max": 2 },
                 "levels": 2, "islets": { "min": 3, "max": 6 } } },
    { "id": "scenic", "name": "Skerry", "size": 5, "scenic": true, "count": { "min": 6, "max": 12 }, "…": "…" }
  ],
  "spacing": { "min": 55, "nearest_max": 120, "strait_min": 24, "void_max": 150 },
  "fertilities": "…", "deposits": "…", "buildable_area": "…", "home": "…"
}
```

`shape` (D-058, D-072) is required per class: `massifs` (rim massifs,
D-072) ≤ 4, `rivers` ≤ 2, `levels` ≤ 2, `islets` ≤ 8, `plain` ≤ size /
3. An island with deposit slots of the
first mining tier has at least one massif; one drawn without a massif
gets no slots of the later tiers either. A `scenic` class (skerries) has no fertilities,
deposits or shape (all zeros) and a `size` of 2–8: its skerries have
`size` … ¾ · size² tiles; it can never be the home class. `spacing`:
`min` and `nearest_max` apply between habitable islands
(grid to grid), `strait_min` to every pair's land, `void_max` bounds the
open sea inside the hull of the land. `home.terrain` lists `grass` only
since D-059 (the lumberjack plants its trees; forest is decor). The
content payload (`GET /api/v1/content`) serves every size class with
its size, count, per-island fertility and deposit ranges, shape and
whether it is the home class (the almanac's Islands table).

### tiers.json and goods.json

`tiers.json`: array in progression order of `{ id, name, residents: {floor,
max}, tax_per_resident_per_min, house?, unlock: { population: {tier: n},
buildings?: [] } }` (`buildings` optional; the Old Coast unlocks by
population only, D-069). `house` is optional: a tier
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
`ship_count`, `satisfaction`). The intro chain is 10 linear quests
(`intro_home_island` … `intro_settlers_120`, then `intro_citizen_house`)
with rewards of 25–100 gold or 30–45 planks; never stone or sails (those
are taught, not given). Since D-083 §4 (content 0.24.0) one island
suffices until Merchants: `citizens_stone` ("Stone for your builders",
20 stone in stock, 50 gold) follows `intro_settlers_120` and leads to
`intro_citizen_house` — it completes at once on a home island with a
stone slot and otherwise nudges the player to sail; `intro_island2` and
`intro_tools` are retired (§12, their 30 planks and 100 gold dropped).
The tier-2 chain (D-056) is `citizens_stone` and 5 linear quests
branching off at `intro_settlers_120` (`citizens_shipyard`,
`citizens_cog`, `citizens_tavern`, `citizens_school`, `citizens_cheese`)
with rewards of 50–100 gold; the shipyard quest's 10 sails for the first
built cog are the only sails (§8). The tier-3 chain is 7 quests after
`citizens_cheese` (`merchants_church` … `merchants_hulk`, then
`merchants_island2` — a second settlement on an island with clay,
`island_settled` ≥ 2, 30 planks — and `merchants_bricks`, whose text
names the route home; gold 100–200) and the tier-4
chain 6 after it (`patricians_cathedral`, `patricians_house`,
`patricians_food`, `patricians_drink`, `patricians_glass` — 30 glass in
stock — and `patricians_carrack`, 150–250 gold); `ship_count` takes an
optional ship `type`, so the carrack quest counts carracks.
Quests that reward goods must mention that excess beyond capacity is lost
(content test).

### need_categories.json and needs.json

`need_categories.json` lists the display data per category: `{ id, name,
icon, group? }` (icon IDs from the HUD icon set; a test checks they
exist). `group` is the display group the client shows the category
under: `goods` (food, drink, clothing, comfort, luxury) or `public`
(market, faith, education, culture, safety, fire protection, health),
headed "Goods" and "Public buildings" (client catalogue strings); it has
no rule effect.

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
    { "good": "cider", "per_resident_per_min": 0.001099 },
    { "good": "mead",  "per_resident_per_min": 0.000621 }
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
| `tools`, `toolmaker` | Retired with D-083 §1 (content 0.24.0): the good had no building consumer; construction is one material per tier. The recipe and the models `toolmaker.glb` / `.lite.glb` are deleted. |
| `intro_island2`, `intro_tools` | Quests retired with D-083 §4: the second island is a Merchants lesson (`merchants_island2`), tools are gone; `citizens_stone` leads to the first Citizen house. |
| the three pre-D-075 ship IDs and the three quest IDs that named them | Renamed to `cog`, `hulk`, `carrack` and `citizens_cog`, `merchants_hulk`, `patricians_carrack` in D-075 §4 (content 0.21.0; the old names are listed in DECISIONS D-075 only — a test keeps them out of every other tracked file) |

### D-083 reference results (sim minutes, seed 1053001)

Content `old_coast-0.24.0`: tools and the toolmaker retired, the iron
mine and smelter at Patricians, `citizens_stone` and
`merchants_island2` (D-083). The Citizens games no longer found island
2 (D-083 §5); their milestones are the unlock and the first Citizen
house, and the Merchants game adds "island 2 (clay) settled":

| Game | Milestones | Targets | D-082 | D-083 | Margins |
|---|---|---|---|---|---|
| Citizens | unlock / first house | 90 / 100 | 28 / 64 (island 2 50, tools 112) | 28 / 54 | 62 / 46 |
| Quests | first house (unlock) | 85 | 30 (6) | 25 (6) | 60; 29 earlier than without claims |
| Merchants | island 2 settled / unlock / first house / categories ≥0.6 | 240 / 240 / 270 / 420 | — / 153 / 219 / 304 | 80 / 141 / 215 / 308 | 160 / 99 / 55 / 112 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 573 / 615 / 948 | 576 / 618 / 950 | 324 / 342 / 850 |

Both Citizens plans now end with the city guard and the cheese chain
(dairy farm, cheese dairy) on the start island, moved from the Merchants
plan; the Quests game replays the same plan. Without them, the Quests
game had built its whole town by minute 25. `TestReferenceGamesGold`
reads from minute 30, so the game was judged on that finished town
alone: +284 % of tax over upkeep, above the unchanged D-082 bound of
200–2 100 ‰. With the extra upkeep both games sit at +179 %. The
milestones are reached before these buildings, and the Merchants game
builds the same set, only earlier in its replay.

Gold (tax over upkeep at the tightest advance step from minute 30;
min gold over every step; nothing auto-pauses in any game):

| Game | Tax over upkeep (tightest, minute) | Min gold (minute) | End gold | D-082 end gold |
|---|---|---|---|---|
| Citizens | +179.4 % (97) | 865 (20) | 10 387 | 17 661 |
| Quests | +179.4 % (68) | 706 (1); 738 after minute 5 | 9 635 | 16 141 |
| Merchants | +41.7 % (308) | 865 (20) | 36 454 | 32 635 |
| Patricians | +39.2 % (309) | 865 (20) | 501 342 | 493 436 |

Plan changes (declarative, `server/testdata/plans`):

- Citizens: no manual shipment to island 2, no founding, no iron chain,
  toolmaker, tools shipment, route or tools checkpoint. After the first
  Citizen house the game goes on to the city guard and the cheese chain
  (dairy farm, cheese dairy) on the start island — moved from the
  Merchants plan: ending at the first Citizen house, the Quests game's
  town from minute 30 had +284 % of tax over upkeep, above its D-082
  bound (≤ 210 %). The games are shorter (end at 97 / 68 minutes, were
  142 / 108), hence the lower end gold.
- Merchants: founds island 2 first (58 planks by ship 1, then 60; the
  fisher, ten Settler houses, lumberjack and charcoal burner the
  Citizens game used to build there) and creates route 1 "Goods out,
  stone home" (50 planks a trip, the old Citizens route's load, until
  the bricks run); no tools on any route ("Goods out, bricks home",
  "Hops home").
- Patricians: the iron mine and smelter on island 2 after the first
  Patrician house and the Trading Post's level 4, before the cooperage;
  no tools on any route; five explicit warehouse upgrades on the start
  island instead of six (the reach collectors place five warehouses
  there, six before, and take the last level).

### D-082 reference results (sim minutes, seed 1053001)

Content `old_coast-0.23.1`: civic maintenance from Anno 117 (D-082
table E, §7) and **`k_tax` = 1.05** (tax 1.05 / 0.90 / 1.62 / 2.39 =
the ladder 1.00 / 0.86 / 1.54 / 2.28 × 1.05); producers keep D-080's
`k_upkeep` = 1.0. The plans regenerate byte for byte, so every
milestone equals D-080's (deltas 0, inside the ±5 min of D-082):

| Game | Milestones | Targets | D-080 | D-082 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 50 / 28 / 64 / 112 | 50 / 28 / 64 / 112 | 10 / 62 / 36 / 38 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 21 / 30 (6, 78) | 21 / 30 (6, 78) | 24 / 55 |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 153 / 219 / 304 | 153 / 219 / 304 | 87 / 51 / 116 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 573 / 615 / 948 | 573 / 615 / 948 | 327 / 345 / 852 |

Gold (tax over upkeep at the tightest advance step from minute 30;
min gold over every step; nothing auto-pauses in any game):

| Game | Tax over upkeep (tightest, minute) | Min gold (minute) | End gold | D-080 end gold |
|---|---|---|---|---|
| Citizens | +194.9 % (33) | 871 (20) | 17 661 | 24 546 |
| Quests | +204.2 % (63) | 712 (1); 740 (6) after minute 5 | 16 141 | 22 146 |
| Merchants | +39.0 % (304) | 871 (20) | 32 635 | 73 675 |
| Patricians | +35.3 % (305) | 871 (20) | 493 436 | 932 046 |

The Merchants and Patricians games sit in D-082's 20–50 % window; the
two Citizens games cannot: their tightest point is a Settlers town with
market, chapel and the first producers (tax 138 against upkeep 47 at
minute 33), and ≤ 50 % there needs `k_tax` ≈ 0.53, while 0.65 already
stops the Merchants plan (the playhouse's 15 000 gold never accrues).
Kept by the D-082 rule "the k that satisfies the Patricians game";
rule (2) (cheaper chapel / market level 1) was not applied — the
Citizens games are too rich, not too poor (≥ 500 gold after the
opening purchases, ≥ 20 % margin). The Patricians game ends with
493 k gold, above D-082's 100–250 k expectation. Tuning log (every
`k_tax` tried; margins Citizens / Quests / Merchants / Patricians):

- 1.18 (D-080, table E only): 231.4 / 241.8 / 56.1 / 52.0 %, min gold
  935, end gold Patricians 682 512 — Patricians above 50 %.
- 0.65 (D-082's estimate): 82.6 / 88.3 % / — / —; the Merchants plan
  fails at action 54 (playhouse unaffordable after a 4 h wait, balance
  negative) — gold would pace the game.
- 0.92: 158.4 / 166.5 / 21.9 / 18.7 %, min gold 789, Patricians end
  304 554 — Patricians below 20 %.
- **1.05**: 194.9 / 204.2 / 39.0 / 35.3 %, min gold 871 — kept.

### D-080 reference results (sim minutes, seed 1053001)

Content `old_coast-0.23.0`: Anno 117 house sizes, rates and final-producer
cycles (D-080), the Trading Post as the road root (D-081), **`k_tax` =
1.18** (tax 1.18 / 1.01 / 1.82 / 2.70) and **`k_upkeep` = 1.0** (the
table-C producers pay Anno's gold maintenance):

| Game | Milestones | Targets | D-075 | D-080 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 50 / 25 / 71 / 124 | 50 / 28 / 64 / 112 | 10 / 62 / 36 / 38 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 21 / 38 (6, 91) | 21 / 30 (6, 78) | 24 / 55 |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 215 / 250 / 387 | 153 / 219 / 304 | 87 / 51 / 116 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 721 / 868 / 1180 | 573 / 615 / 948 | 327 / 345 / 852 |

One producer now feeds 40–60 houses of its tier, so the plans build a
final producer (and its farm) only where the game's peak demand asks
for it: the Patricians game ends with one brewery, butcher, tailor,
meadery and cheese dairy instead of 14, 11, 10, 9 and 6, and 4 wool
weavers instead of 19 (plans' descriptions); a second clay pit and
brickworks supply the university's and cathedral's 240 bricks. At the
end of each game no consumption good has more than 60 % surplus beyond
its last producer (`TestReferenceGamesSurplus`, below). Gold never falls
below the starting gold after the first purchases (lowest 976 at minute
4, Quests 712 at minute 1) and nothing auto-pauses; the games end with
24 546 (Citizens), 22 146 (Quests), 73 675 (Merchants) and 932 046 gold
(Patricians). At the tightest point (from minute 30) tax exceeds upkeep
by 133.5 % (Patricians game, minute 305; Merchants 144.6 %, Citizens
427.7 %). The milestones do not move with `k_tax` / `k_upkeep` (tried
0.5 – 2.0; `k_upkeep` 2.0 still left 52.7 % on the first trimmed plans):
materials and population pace the games, not gold. One
milestone stays later than D-075: the Citizens unlock (+3) — 120
Settlers now need twenty full six-resident houses, wool included
(D-080 §1), and the planks for them pace it.

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

### D-075 reference results (sim minutes, seed 1053001)

Content `old_coast-0.21.0` (collectors 10 / 20 / 40 / 80 and 8 / 16 /
32 / 64 t/min with lower upkeep, `look`, cog / hulk / carrack), the
low-shore rule for water-edge buildings and supply chains paused last:

| Game | Milestones | Targets | D-074 | D-075 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 53 / 27 / 80 / 135 | 50 / 25 / 71 / 124 | 10 / 65 / 29 / 26 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 23 / 44 (7, 99) | 21 / 38 (6, 91) | 24 / 47; 29 / 33 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 230 / 265 / 405 | 215 / 250 / 387 | 25 / 20 / 33 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 719 / 838 / 1188 | 721 / 868 / 1180 | 179 / 92 / 620 |

`growth_per_min` stays 1. The plans are the D-074 plans with the ships
renamed: no step changed; the regenerated games differ only through
the content and the rules. Every milestone up to the Merchant
categories comes earlier: the level-1 collectors carry 25 % (Trading
Post) and 33 % (warehouse) more and the level-2 upgrades cost about
half the upkeep. The Patrician unlock and first house come 2 and 30
minutes later, still with the widest margins. The low-shore rule (D-075 §1) changes no reference
game: none places a trading pier or a depot, and the fishers, salt pans
and shipyard of the plans all stand on level-0 shores. The supply-chain
guard (D-075 §5) never fires: no reference game runs out of gold.

### D-074 reference results (sim minutes, seed 1053001)

Content `old_coast-0.20.0` (houses fill with satisfaction, residents
stay on upgrade, collectors 8 / 16 / 32 / 64 and 6 / 12 / 24 / 48 t/min,
start 2 000 gold and 100 planks, 48 tree plots, lone windmill):

| Game | Milestones | Targets | D-072 | D-074 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 54 / 11 / 86 / 145 | 53 / 27 / 80 / 135 | 7 / 63 / 20 / 15 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 34 / 70 (8, 129) | 23 / 44 (7, 99) | 22 / 41; 30 / 36 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 225 / 267 / 413 | 230 / 265 / 405 | 10 / 5 / 15 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 763 / 799 / 1116 | 719 / 838 / 1188 | 181 / 122 / 612 |

`growth_per_min` stays 1. The Citizens unlock comes later (population
counts residents, and a house now fills only as far as its
satisfaction allows); every other early milestone comes earlier, mostly
from the doubled start gold. A Citizen house with one alternative per
category settles at about 13 / 15 and a Merchant house at about 20 / 25,
so the upgrade gate counts a house as full at its target residents
(MECHANICS §6.1) and the Patrician unlock (1 200 merchants) needs about
sixty Merchant houses instead of 48.

Generator changes for D-074:

- A `claim` action claims one quest (waiting until it is completed);
  the games without quest claims claim `citizens_shipyard` only — its
  10 sails are the first built cog's, the start stock has none.
- A collector upgrade for reach is skipped while its materials are
  neither in stock nor produced on the island (the opening has no
  stone); a warehouse is placed instead.
- A producer the sim assigns to another collector than the predicted
  one (nearest by road, not by distance) gets a warehouse next to it
  when that collector is over its throughput, else (`reach_upgrade`) an
  upgrade.

Plan changes for D-074:

- Citizens: the shipyard, the claim and the cog moved to the
  Merchants plan; the second and third weaver stand by their sheep
  farms (the level-1 Trading Post carries five producers; it ends at
  94 % load, nothing throttled).
- Merchants: route 1 brings stone home (the opening has none to
  spare); Citizen upgrades alternate with the need chains (a house
  grows with each chain); the shipyard, the shipyard claim and the
  cog come after home-2's Citizen upgrades; the cog brings the first
  three bricks by hand (route 1's round trip was too slow for the
  first Merchant house); no sheep farm and weaver for home-2, no
  explicit warehouse (their gold is the first Merchant house's).
- Patricians: home-2's civic plots and houses and the second home
  quarry are built in the Merchants game now; a sheep farm and weaver
  for isle2-1; two lumberjacks and four sawmills more (planks were the
  wait from minute 550); a new quarter home-6 (market, chapel,
  tavern, school, city guard, fire station; 24 houses, serves 12
  Merchant houses; the plan repeats the chains because serves needs
  them) for settlers and twelve more Merchant houses, upgraded before
  the winepress waits for the unlock; two mills and two bakeries
  (Citizen food); hemp on "Island goods" until the hulks are ordered
  and two hemp farms more (no start sails); 18 warehouse upgrades at
  home; five breweries, five wheat farms and a hops-only hulk more;
  three apiaries and two meaderies more; two butchers more.

### D-072 reference results (sim minutes, seed 1053001)

Content `old_coast-0.19.0` on the D-072 archipelago (Anno 117 island
sizes, rim massifs, rivers two tiles wide; Anno 117 service radii and
collector reach, §7; camera cap 80):

| Game | Milestones | Targets | D-069 | D-072 | D-072 slots | Margins |
|---|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 48 / 12 / 85 / 128 | 49 / 11 / 86 / 130 | 54 / 11 / 86 / 145 | 6 / 79 / 14 / 5 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 32 / 68 (8, 111) | 32 / 70 (8, 114) | 34 / 70 (8, 129) | 11 / 15; 16 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 220 / 263 / 397 | 220 / 264 / 412 | 225 / 267 / 413 | 15 / 3 / 7 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 808 / 847 / 1078 | 745 / 782 / 1082 | 763 / 799 / 1116 | 137 / 161 / 684 |

"D-072 slots" is the same content on generator version 6 (§9: every
deposit slot reserves its building's footprint, slots 16 apart, a
kind's two slots on two massifs); the margins are against it.

No milestone comes more than 25 % early that was not already early
under D-069 (the Citizens unlock is population-only since D-069, the
Patricians' final check is a ceiling), so no cost rose beyond D-072 §3.

Plan changes for D-072 (generator and authoring levers):

- The generator: Trading Post sites prefer connected room
  (`tradingPostRoom`), a chain plot shared with another quarter is
  skipped instead of failing, and the plans name no coordinates but
  the citizens home Trading Post (`[122,198,180]`: the step-3 terrain
  moved the coast under the old site).
- Citizens: the manual shipment to island 2 carries 45 planks (was
  40); home-3 lists its `school` among its civic plots — with the chain
  reservation alone the houses east of the one school stayed out of its
  radius 20 and the 16th Citizen → Merchant upgrade there waited on
  education.
- Merchants: unchanged; the playhouse keeps 15 000 gold (§7): at 30 000
  the categories came at minute 513, at 22 500 at 461.
- Patricians: the chain keys follow the generator (home-3 keeps its
  school and shares home-1's playhouse, church and tavern; home-4 gets
  school, tavern, playhouse and church); home-3's 33rd–36th houses
  stand in home-5; a second quarry at home and on island 2 (the
  doubled stone of playhouse and university); a leather works and a
  tailor at home and three pig farms on island 2 more (coats and
  sausages ran short in the final wait).

Plan changes for the deposit slots (generator version 6; the dev
seed's islands moved, island 2 lies farther from home):

- Citizens: unchanged (replayed).
- Merchants: the fire station, city guard, school and the three
  Citizen → Merchant upgrades come before the dairy farm, cheese
  dairy, pig farm and apiary (the first Merchant house came at minute
  273 with the old order, over its 270).
- Patricians: a second carrack on the farm-goods route, a hulk with the
  pigs that piled up on island 6 (the route loads 150), and the
  roast-beef chain (three cattle farms on island 2 with three houses
  for their workers, two slaughterhouses at home) right with the
  farm-goods route instead of after the cathedral (roast beef and
  sausages ran out in the final wait).

### D-069 reference results (sim minutes, seed 1053001)

Content `old_coast-0.18.0` (collector reach and throughput, hub upkeep
per level, population-only unlocks, harbour extensions at Merchants;
§7 collector levels):

| Game | Milestones | Targets | D-065 | D-069 | Margins |
|---|---|---|---|---|---|
| Citizens | island 2 / unlock / first house / tools | 60 / 90 / 100 / 150 | 48 / 24 / 82 / 118 | 48 / 12 / 85 / 128 | 12 / 78 / 15 / 22 |
| Quests | island 2 / first house (unlock, tools) | 45 / 85 | 32 / 64 (11, 100) | 32 / 68 (8, 111) | 13 / 17; 17 earlier than without claims |
| Merchants | unlock / first house / categories ≥0.6 | 240 / 270 / 420 | 224 / 256 / 369 | 220 / 263 / 397 | 20 / 7 / 23 |
| Patricians | unlock / first house / final all-needs ≥0.6 | 900 / 960 / 1800 | 826 / 866 / 1073 | 808 / 847 / 1078 | 92 / 113 / 722 |

Plan changes for D-069 (generator and authoring levers only):

- The citizens plan sets `collectors: "reach"` (inherited by the
  continuing plans): before a production building the generator places
  a warehouse when no collector reaches its site or the one it would
  deliver to (the sim's assignment) would exceed its throughput at
  nominal rates; the warehouse goes within level-1 reach, forest before
  grass, keeping the producer's road and fields free; where no road
  comes near enough yet (a remote quarry), the producer goes first and
  its warehouse follows on its road. Farms first try to raise a
  collector's level instead (no land).
- The patricians plan sets `collectors: "reach_upgrade"`: every
  producer first tries a collector upgrade (upkeep for land in the rich
  late game). The home island then has 13 collectors for 142 producers.
- Merchants: the Trading Post upgrade moves after the 21 Settler
  upgrades (level 2 costs 10 gold/min). Its level 2 (minute 195) and
  level 3 (minute 240) come after the Citizens and Merchants unlocks,
  so their tier gate changes nothing there.
- Patricians: the Trading Post's level 4 needs Patricians (tier gate):
  its upgrade moves from minute 720 to right after the first Patrician
  house (done at minute 922). Without the 30 gold/min upkeep in
  between, the unlock and the first house come 23 and 25 minutes earlier
  (831 / 872 before the gate).
- Patricians: pig farms #13–14 and the second dairy farm move to island
  6 (milk home on the pig route, created first); the round's two wheat
  farms come before its pastures and small buildings — the warehouses
  took the grass of the last wheat farm.
- The population-only unlocks open Citizens at minute 12 instead of 24
  (no market or chapel condition).

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
  from the home island to island 6, with an extra cog on route
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
  unlock population; full variety must be affordable with ~1.6× the
  chains. Since D-080 one producer feeds 40–60 houses, so the surplus
  bound moved from the unlock population to the reference games: at the
  end of each, no consumption good may have more than 60 % surplus
  capacity beyond its last producer (archipelago-wide nominal output vs
  the houses' consumption plus the producers' inputs; the plans build to
  peak demand × 1.25). One producer of a little-used good is granularity,
  not surplus.
- Workforce: the house count needed for a tier's unlock population must
  also cover the workforce of that tier's balanced chain set on the same
  island(s) with ≥ 20 % slack.
- **Bootstrap:** for each tier, a scenario starting from the starting stock
  must reach the tier's unlock and build its first house without a deadlock
  (no required material or good whose only producers need workforce of the
  tier being unlocked). Run in the scenario runner for every content change.
  Current staffing satisfies it: stone [S] for Citizens (tools until
  D-083; one island suffices until Merchants), bricks
  [C] for Merchants, glass (quartz_quarry, glass_smelter) [C] for
  Patricians. Checked by a generic content test over every tier with a
  house and by the goldens `bootstrap_settlers`, `bootstrap_citizens`,
  `bootstrap_merchants` and `bootstrap_patricians` (tiers 3–4, below)
  (the tier 1–2 reference game from the starting stock: island 2 settled
  at 52 min by the start cog, Citizens unlocked by 30 min, the first
  Citizen house at 88 min, tools from island 2 on the home island by
  132 min; with the quests 34 / 21 / 73 / 117 — on the generated dev
  archipelago, seed 1053001, with the D-056 need model; before D-056:
  59 / 62 / 88 / 141, quests 44 / 70; PR #25: 60 / 80 / 99 / 136; the
  hand-made islands: 100 / 139). The first-house margin (88 of 100;
  quests 15 min earlier) is the tight one: a change that slows the
  first hours must say so.
  If a later change needs room, the first lever is the cog's reference
  speed (legs are 3.4–4.3 min on the dev seed), not the targets.
- **Tier 3–4 reference games (D-056, sim minutes from the starting
  stock, attentive play; not faster):** island 2 (clay) settled ≤ 240
  (D-083 §5), Merchants unlocked (360
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
  for a cog and a hulk, island 2 pigs, salt, milk and cattle for a
  carrack. At the end (minute 873: 560 Settlers, 210 Citizens, 1 250
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
- Collector throughput (D-074 §3): a level-1 warehouse (6 t/min) serves a
  block of ≈ 5 tier-1 producers (≈ 1.2 t/min each), the level-1 Trading
  Post (8 t/min) about seven; a tier-2 island needs either more
  warehouses or a level-2 collector.
- Tax income at each tier's unlock population must cover upkeep of the
  balanced chain set with ≥ 20 % margin.
- **Gold pressure (D-082):** in every reference game, from minute 30 on,
  tax exceeds upkeep by 20–50 % at the tightest advance step, gold stays
  positive, nothing is paused for insolvency, and the Citizens game
  never drops below 500 gold after minute 5 (the opening purchases).
  `TestReferenceGamesGold` (next to `TestReferenceGamesSurplus`) checks
  it with hard bounds per game; the two Citizens games, which no
  `k_tax` brings to 50 % (D-082 reference results above), are held at
  20–210 % — their recorded 195 / 204 % plus headroom — so a drift
  still fails. A content change that moves a margin out of its bounds
  retunes `k_tax` (the one knob, D-082 §1), never a plan.
- Charcoal demand of a balanced Merchant economy must exceed one island's
  forest capacity so coal or a second forest island becomes relevant.
- Starting stock (`start.json`: 2 000 gold, 100 planks — D-074 §4; the
  goods aboard the start cog, 1 800 gold and 85 planks left after
  founding the Trading Post for 200 gold / 15 planks) must allow: 8
  settler houses + fisher + lumberjack + sawmill + market + ~40 road
  tiles, and cover the early deficit for ≥ 15 min of upkeep without
  spending the gold to zero and waiting for taxes (the D-074 playtest
  finding).
- Verify with headless scenarios before touching any client code.
