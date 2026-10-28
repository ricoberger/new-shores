# D-057 V3 — tier 1–2 buildings at the target detail

Branch `adhoc.20261028-182719-d-057-v3-tier-1-2-buildings-at-the-targe`
(worktree of the same name under `~/.worktrees/ricoberger/new-shores/`),
based on main `8ac04f3` (after V1 #38 and #39). Direct implementation
session; V2 (terrain, decor, life, ships, client) runs in parallel.

Tools (experiment only, not product code):
- `.experiment/voxel-v3/sheet.py out.png id[,id…]` — every variant/level
  as a pair of cells: full model and its lite (2 voxels/tile) at the same
  scale, captioned with triangles/budget (`!` = over budget or a grid
  problem). The repository's `make model-sheet` renders full models only.
- `.experiment/voxel-v3/demo.py` — the same for a scratch recipe file with
  a fake footprint (helper development).
- Sheets in `.experiment/voxel-v3/sheets/` (git-ignored).

## Groups

| # | Group | State |
|---|-------|-------|
| A | Parts library v2 + `P.house` v2 | done |
| B | Houses (settlers ×3, citizens ×3) | done (`b66eb30`) |
| C | Tier-1 producers, fields, market, chapel, trading post, warehouse | done (`329c6ab`) |
| D | Tier-2 producers incl. the 15 placeholders | done |
| E | Tests, build, contact sheet, shots | done |

## A — parts library v2

New module `assets/voxel/nsvoxel/detail.py`, re-exported by `parts.py`
(`from .detail import *`), so recipes call everything as `P.<name>`. The
existing v1 helpers in `parts.py` are unchanged byte for byte (the
placeholders in `auto.py` use them: `yard`, `timber_frame`, `stone_wall`,
`window`, `door`, `chimney`, `label`, `crate`, `barrel`), except `P.house`.

Helpers added:
- **Jitter:** `colour_jitter(v, seed, scale, ground)` — per-voxel colour
  jitter on every material, three shades per material (darker / base /
  lighter) with a share and step per palette role (`JITTER`); ground
  plates (z ≤ 0) at a reduced share (see D: 0.12 ×). Called last.
- **Ground:** `scatter` (tufts, flowers, pebbles on free ground cells),
  `edging`.
- **Walls:** `plinth` (proud base course), `fill` (solid hidden core),
  `coursed_stone` (one-voxel courses of 2–4-voxel stones in three shades,
  staggered joints, a few stones proud — the layered stone), 
  `dressed_quoins` (pale long/short corner stones), `half_timber` (posts,
  sill and head beams, optional mid rail, corner braces, pale pegs at the
  joints), `jetty_course` (joist ends under a jettied storey).
- **Openings:** `casement` (frame, recessed glass with glazing bars, sill,
  optional lintel, open plank shutters, flower box), `entrance` (plank
  leaf, strap hinges, knob, frame, lintel, stone step(s)), `barn_gate`,
  `trade_sign` (hanging sign in the good's colour).
- **Roofs:** `roof` → `Roof` (courses in alternating shades; eaves with a
  dark fascia for tiles/slate or a ragged fringe for thatch; verges a
  shade darker; ridge tiles in alternate shades or a thatch roll with
  liggers; gable ends three voxels thick so the lite keeps them; solid
  attic; `Roof.surface(x, y)` for chimneys and dormers), kinds `thatch`
  (rise 1.5), `tiles` (1), `slate` (1.25); `lean_to` (eave fringe/fascia,
  optional posts); `chimney_stack` (coursed stone or brick, corbelled cap,
  one or two pots, optional chimney/smoke anchors), `roof_chimney` (stack
  that clears a Roof by n layers), `dormer_on`.
- **Fences:** `fence_cells`, `fence_ring`, `fence_line_v2` — uneven posts
  (2–3 voxels, hashed), rails, or uneven pickets, or wattle hurdles.
- **Crops:** `soil_rows`, `plant` (wheat, hemp, meadow, cabbage, grass),
  `crop_rows` (ploughed rows with a plant per ridge cell), `shrub`
  (ragged, three shades), `fruit_tree` (irregular crown, fruit dots).
- **Props:** `woodpile`, `log_stack`, `cask`, `box_crate`, `sacks`,
  `bale`, `handcart`, `trough`, `bench`, `chopping_block`, `well`,
  `washing_line`, `tool_rack`, `ladder`, `lamp_post`, `flower_bed`,
  `cloth` (a material with the sway group).
- **Whole buildings:** `building(...)` → `Building` (blocks of the ground
  and upper storey, faces and spans per storey, the Roof): proud plinth;
  `settler` pegged timber frame + plaster + thatch; `citizen` coursed-stone
  ground floor with dressed quoins, jettied timber-framed upper storey,
  tiles; `stone` / `stonethatch` coursed stone + quoins. `P.house` keeps
  its signature and returns `building(...).top`.

Hidden volumes are filled solid (walls, attics): only the outer shell is
meshed, so the per-voxel jitter does not pay for inner faces — the
`P.house` recipes got *cheaper* (sawmill 2 498 → 2 236, sheep_farm
2 054 → 1 758) while gaining courses, ridge and eaves.

Rebuild: exactly the 15 recipes that call `P.house` changed (bakery,
charcoal_burner, iron_mine, mill, orchard, quarry, sawmill, sheep_farm,
shipyard, smelter, tavern, toolmaker, warehouse l1–3, weaver_wool,
wheat_farm); placeholders, decor, life and ships are byte-identical.
Sheets `before-recipes.png` / `a-after-recipes.png`: nothing broken, lite
unchanged in character.

Fix in passing (inside `detail.py` only): `Vox.shed`'s `down` names the
*high* side (prototype naming, the docstring says the opposite);
`lean_to(down=…)` takes the eave side and maps it. `Vox.shed` itself is
unchanged (grid code is not in this session's files).

## B — houses

`house_settlers` v0 side gable with fence lines and cabbage rows, v1
front gable with a thatched lean-to woodshed, wattle fence and a (rigid)
washing line, v2 L-plan. `house_citizens` v0 townhouse with dormers, v1
front gable with a balcony and a well, v2 hipped shop with a rigid awning
and a trade sign. Citizen houses: coursed stone + quoins, jettied framed
upper storey, tiles, dormers, brick chimneys with pots, flower boxes —
clearly richer than the settler frame + thatch. Jettied fronts sit on
lite block boundaries (x ≡ 3 / y ≡ 0 mod 4) so the lite keeps the
infill colour.

Helper tuning (detail.py): `DRESSED`, `casement(frame=None)`,
`half_timber(braces=sides, sill=)`, `roof(cap=)`, ridge as a full course
in alternating shades, `dormer_on` rewritten, `cask` one hoop when low,
picket heights, `lean_to` side mapping.

## C — tier 1

All tier-1 recipes on the v2 parts. New helpers: `log_walls` (notched
log cabin), `boarded` (vertical barn boards + battens), `stump`,
`haystack`, `sheaf`, `sawhorse`, `stone_blocks`; `chimney_stack(pots=0)`;
`soil_rows` / `crop_rows(furrow=)`; wheat plants 2–3 high.

## D — tier 2 and the 15 placeholders

Existing tier-2 recipes moved to the v2 parts; the 15 placeholders got
recipes (cidery, hemp_farm, hemp_field, weaver_linen, sailmaker,
dairy_farm, cattle_pasture, cheese_dairy, apiary, meadow, meadery,
pig_farm, pig_pen, tannery, school). Modules: `cattle_pasture` anchors
gate, cattle_1..3, door; `pig_pen` gate, pig_1..4, door.

**Models-folder limit.** With per-voxel jitter at the A settings the
folder reached 28.09 MB against `MODELS_FOLDER_LIMIT` 25.17 MB (24 MiB);
the geometry itself costs little (no jitter: 21.18 MB, baseline 20.04 MB).
Measured cost of the jitter per role (zeroing one role): timber 1.6 MB,
terracotta 1.55, stone 1.1, thatch 1.05, ground 1.3, plaster/ochre 0.42.
Fit (budget not changed): roofs (thatch, tiles, slate) and timber jitter
in 2 × 2 plan patches (tile / board lengths) at shares 0.34 / 0.30, stone
0.12 over its coursed blocks, ground plates at 0.12 × (the yard's 4 × 4
patches and the scatter carry the ground), module grounds coarser. Result
24.78 MB (margin 0.39 MB, 1.5 %). This rebuilt every v2 recipe (A–C
outputs changed in the D commit). The limit will block tier 3+ at this
detail — see open question 2.

## E — tests, sheets, shots

- `assets/voxel/tests/test_detail.py`: every settler/citizen building and
  field has a recipe; anchors per the content flags (and smoke exactly on
  smoking producers), footprint size, full and lite budgets, the lite
  above a box; module animals (sheep, cattle, pigs); colour jitter on
  every model; sway only on `weaver_wool` and `trading_post.l4`; three
  distinct house variants per tier, citizen houses with more voxels and
  glazing than any settler house and tiled roofs; helper determinism
  (jitter, 2 × 2 roof patches), building/roof/chimney anchors, uneven
  fence posts. Existing tests cover byte determinism, export profile,
  folder size, footprint bounds.
- `house_citizens` v2 (shop) gained side and back windows and a flower
  bed so every citizen house out-glazes every settler house.
- Contact sheet of all 40 tier 1–2 IDs (full + lite):
  `sheets/e-contact.png`; per group `c-tier1.png`, `d-tier2.png`,
  `d-new.png`, `b-*.png`.
- `make shots` FIXTURE=showcase,settled,citizens VIEW=near,mid
  DEVICE=desktop,phone → `.experiment/voxel-v3/shots/` (12 PNGs).
- `docs/ART_DIRECTION.md` §7 "Recipe authoring at the D-057 §3 detail".

Triangles (before = main 8ac04f3):

| Model | Before | Full / budget | Lite / budget |
|---|---|---|---|
| apiary | 3048 (placeholder) | 6998 / 12500 | 388 / 1000 |
| bakery | 3254 | 5092 / 10000 | 314 / 800 |
| cattle_pasture | 148 (placeholder) | 3584 / 11480 | – |
| chapel | 2950 | 3510 / 4500 | 228 / 360 |
| charcoal_burner | 3388 | 4986 / 15000 | 358 / 1200 |
| cheese_dairy | 3254 (placeholder) | 5054 / 10000 | 358 / 800 |
| cidery | 2990 (placeholder) | 6616 / 15000 | 458 / 1200 |
| dairy_farm | 3352 (placeholder) | 4362 / 10000 | 348 / 800 |
| fisher | 4032 | 4718 / 12000 | 328 / 960 |
| hemp_farm | 2330 (placeholder) | 2756 / 6000 | 192 / 480 |
| hemp_field | 94 (placeholder) | 308 / 410 | – |
| house_citizens.v0 | 3110 | 3944 / 4860 | 252 / 405 |
| house_citizens.v1 | 3188 | 3974 / 4860 | 292 / 405 |
| house_citizens.v2 | 2558 | 3726 / 4860 | 264 / 405 |
| house_settlers.v0 | 2534 | 2874 / 4860 | 170 / 405 |
| house_settlers.v1 | 2908 | 3234 / 4860 | 200 / 405 |
| house_settlers.v2 | 2742 | 3072 / 4860 | 226 / 405 |
| iron_mine | 4404 | 5926 / 12000 | 342 / 960 |
| lumberjack | 2078 | 2770 / 4500 | 196 / 360 |
| market.l1 | 5300 | 6884 / 15000 | 454 / 1200 |
| market.l2 | 7776 | 9592 / 15000 | 566 / 1200 |
| market.l3 | 8312 | 10068 / 15000 | 648 / 1200 |
| meadery | 3196 (placeholder) | 5150 / 10000 | 394 / 800 |
| meadow | 10 (placeholder) | 382 / 410 | – |
| mill | 4132 | 5910 / 12000 | 468 / 960 |
| orchard | 2362 | 4974 / 8000 | 420 / 640 |
| orchard_plot | 270 | 328 / 410 | – |
| pasture | 830 | 1524 / 3690 | – |
| pig_farm | 2326 (placeholder) | 3196 / 6000 | 212 / 480 |
| pig_pen | 54 (placeholder) | 1962 / 4920 | – |
| quarry | 3252 | 5120 / 12000 | 330 / 960 |
| sailmaker | 4202 (placeholder) | 6616 / 16000 | 530 / 1280 |
| sawmill | 2498 | 4740 / 12000 | 314 / 960 |
| school | 4270 (placeholder) | 9860 / 24000 | 670 / 1920 |
| sheep_farm | 2054 | 2914 / 4500 | 176 / 360 |
| shipyard | 5734 | 10318 / 48000 | 1022 / 3840 |
| smelter | 2270 | 4540 / 12000 | 324 / 960 |
| tannery | 2294 (placeholder) | 2870 / 6000 | 218 / 480 |
| tavern | 5860 | 7246 / 12000 | 512 / 960 |
| toolmaker | 2472 | 4488 / 8000 | 334 / 640 |
| trading_post.l1 | 3616 | 5060 / 27000 | 360 / 2160 |
| trading_post.l2 | 4180 | 5450 / 27000 | 448 / 2160 |
| trading_post.l3 | 5400 | 6474 / 27000 | 444 / 2160 |
| trading_post.l4 | 6988 | 8398 / 27000 | 588 / 2160 |
| warehouse.l1 | 3830 | 5402 / 18000 | 340 / 1440 |
| warehouse.l2 | 3986 | 4928 / 18000 | 304 / 1440 |
| warehouse.l3 | 5636 | 7304 / 18000 | 506 / 1440 |
| weaver_linen | 3300 (placeholder) | 5234 / 10000 | 332 / 800 |
| weaver_wool | 2034 | 3280 / 6000 | 252 / 480 |
| wheat_farm | 2802 | 4060 / 6000 | 298 / 480 |
| wheat_field | 168 | 266 / 410 | – |

Models folder: 24.81 MB of 25.17 MB (`du`: 25M; baseline 20.04 MB).

## Open questions

1. **Sailmaker cloth sway vs the client test.** The task asks for the
   sailmaker's cloth in a sway group, but `client/src/render/sway.test.ts`
   asserts `sailmaker.glb` has *no* swaying vertices (it was a
   placeholder), and `client/src/**` is V2's. Stricter reading: the
   sailmaker's cloth stays rigid until that test changes; if V2 has lifted
   it by the rebase, the sway group goes in then. Alternative: edit the
   test in this PR (one line).

2. **Models-folder limit vs D-057 §3 jitter.** Per-voxel jitter on every
   surface does not fit 24 MiB once tier 1–2 are at the target detail.
   Stricter reading taken: the limit holds, the jitter on the largest
   planes is patchy (2 × 2) and sparser (stone, ground). Alternatives:
   raise the limit (a budget/decision change), or export colour jitter as
   a vertex-colour noise/texture in the client instead of geometry.
3. **Shipyard berth.** The side pier reads as a fitting-out berth but has
   no `berth_*` anchor: the content only asks for `slip`, and an extra
   anchor might let the life layer moor ships there. Alternative: add
   `berth_1` if the life layer wants it.
