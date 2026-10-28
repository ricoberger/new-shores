# Voxel art-style prototype — working notes

Branch `adhoc.20261028-094729-prototype-voxel-art-style-for-new-shores`.
A prototype for the owner's decision, **not a restyle**: everything is
behind `?voxel=1`, the current look is untouched with the flag off.

## How to run

```sh
make voxel                     # build client/public/models-voxel (≈5 s, 8 processes)
make voxel-test                # pipeline tests (part of make check)
make voxel-sheet RECIPE=fisher,house_settlers   # .experiment/voxel/sheets/<ids>.png
make dev  →  http://localhost:5173/?voxel=1
make shots VOXEL=1 …           # the shot tool with ?voxel=1
make voxel-compare             # today vs ?voxel=1 shots + .experiment/voxel/compare.png (≈2 min)
```

## Pipeline (step 1)

`assets/voxel/` — Python 3 stdlib only (numpy was not installed and is not needed).

| file | role |
|---|---|
| `nsvoxel/grid.py` | `Vox` sparse grid: box, frame, walls, cyl, ellipsoid, line, gable/hip/shed roofs (one voxel course per step = tile rows), stamp, mirror_x, repeat, hash jitter, anchors; `downsample` (lite) |
| `nsvoxel/mesh.py` | greedy meshing with per-corner AO (0fps); faces merge when material and AO agree along the merge axis; down faces dropped |
| `nsvoxel/export.py` | palette role × shade → vertex colour blended to the role's shadow tone by AO; side normals tilted up (`SIDE_TILT`); cloth → sway alpha; writes through the **existing** `nsassets/glb.py` writer |
| `nsvoxel/model.py` | recipe loading, variants/levels from content, footprint/anchor/budget checks, lite file (downsampled 4×, see step 5), manifest entry (same format as `assets/build`) |
| `nsvoxel/auto.py` | auto placeholders (walls + roof sized to the footprint, pier over water rows, sign board with the ID's first letters, all life anchors) |
| `nsvoxel/parts.py` | the voxel "kit": yards, timber frame, stone walls, windows (frame, recessed glass, sill, shutters), doors, chimney with pot, dormer, fences, props, pixel-font labels |
| `nsvoxel/render.py` | software rasteriser → PNG thumbnails (128 px, build menu) and contact sheets, no Blender |
| `recipes/<id>.py` | one building per file (`build(ctx)`, `VARIANTS`); `_decor.py`, `_life.py`, `_ships.py` are family files (`RECIPES` dict) |
| `build.py` | CLI; writes `client/public/models-voxel/` + `manifest.json` + `thumbs/`; `--check` |

Scale: buildings, fields and decor 8 voxels/tile; life 16/tile (a villager
is 9 voxels tall); ships 20 voxels per model tile (ships are drawn at
SHIP_SCALE, so their voxels end up about the size of a building's).

Findings so far
- Roof staircases have an AO gradient on every step; merging only uniform
  faces gave 30k triangles for big placeholders. Merging along the
  gradient-free axis cut that 3× (theatre 30 360 → 9 526).
- Per-voxel colour noise is what makes voxel art look hand-made, and it is
  what kills greedy merging. Yard noise now uses 4×4-voxel patches.
- Axis-aligned walls facing away from the sun got only the cool sky fill
  (cold grey slabs, worst on sails). Fix: side normals tilted up by 0.5
  (rotation-safe; a baked sun is not, buildings rotate). Sails use the up
  normal like the kit sails.
- Budgets: the build fails above 2× the kit-bash budgets (`BUDGET_FACTOR`).

## Authoring log

| recipe | lines | time | notes |
|---|---|---|---|
| house_settlers (3 variants) | 80 | ~15 min | incl. 2 iterations on roof pitch and frame density |
| house_citizens (3 variants) | 90 | ~10 min | jettied upper storey, balcony, shop front; 1 iteration (frame too dark, yard too grey) |
| fisher | 67 | ~8 min | jetty on piles, smokehouse chimney, net racks |
| market_small (l1–l3) | 99 | ~12 min | stalls + well; l2 timber hall, l3 stone hall with bell turret |
| trading_post (l1–l4) | 106 | ~12 min | pier with bollards/berths, crane, storehouse grows, counting house |
| lumberjack | 35 | ~4 min | log cabin courses, log piles, chopping block |
| sawmill | 33 | ~4 min | `P.house` + open saw shed, bench, stacks |
| quarry | 38 | ~5 min | terraced pit faces, hoist, cut blocks, mason's hut |
| chapel | 43 | ~5 min | stone nave, lancets, bell gable, churchyard wall |
| tavern | 44 | ~5 min | jettied inn, hanging sign, beer garden |
| warehouse (l1–l3) | 48 | ~5 min | grows thatch → stone, loft hoist, second hall + crane |
| shipyard | 58 | ~6 min | slipway into the sea, open shed, crane, pitch kettle |
| wheat_farm | 30 | ~4 min | barn + farmhouse, haystacks (1 fix: haystack below ground) |
| wheat_field | 17 | ~1 min | furrows + rows |
| sheep_farm | 26 | ~3 min | cottage + hurdle fold |
| pasture | 25 | ~3 min | fence with gate, trough, sheep anchors |
| orchard | 27 | ~3 min | cider house, apple crates, ladder, fruit trees |
| orchard_plot | 13 | ~1 min | one fruit tree |
| bakery | 33 | ~4 min | domed oven with chimney, bread stall |
| mill | 48 | ~6 min | tapered tower, thatched cap, lattice sails |
| weaver_wool | 35 | ~4 min | lean-to loom, swaying dyed cloth (sway group) |
| charcoal_burner | 38 | ~4 min | earth kilns, billets |
| iron_mine | 42 | ~5 min | rock hill with ore, timbered adit, rails, ore cart |
| smelter | 35 | ~4 min | stepped furnace stack, glowing mouth |
| toolmaker | 34 | ~4 min | forge lean-to, anvil, grindstone, tool rack |
| _decor.py (19 ids) | 175 | ~15 min | trees ×4, bushes, rocks, crags, stumps, tufts, outcrops |
| _life.py (10 ids) | 199 | ~15 min | villagers, carts + axle, sheep, boat, crate, stages, scaffolding |
| _ships.py (3 ships + cargo) | 149 | ~12 min | one hull builder; sloop, brig, galleon |

Times are wall-clock of this session including the contact-sheet check
(`make voxel-sheet`, ≈1 s per recipe); the later recipes are faster
because they use `P.house`, `P.windows` and `P.smoke` (whole-building
helpers written after the first four).

Roads are not models (island.ts draws them as a ground mesh), so there
are no road recipes. Construction uses the voxel `life_stage` a/b/c
(foundations → skeleton → rafters) and `life_stage_scaffolding`.

## Shots

- step 2 (models only, today's terrain): `.experiment/shots/v-step2/`
  (settled/citizens/showcase × near/mid, desktop). Voxel buildings and
  forests read well on today's smooth terrain; the forest of voxel trees
  is the most convincing part.

## Step 3: voxel world (`?voxel=1`, additive)

Every change is behind `VOXEL` (display/voxel.ts); with the flag off the
code paths are the old ones (all existing tests unchanged and green).

| Area | File | Voxel behaviour |
|---|---|---|
| Ground + coast | `render/voxelterrain.ts` (new), `terrain.ts` `TerrainBuild` | column field at 4 columns/tile, 1 step = 1 voxel = 0.25 tile; land at 0, pixel coastline = smoothed coast sampled at column centres, sand rim column, two sand shelves (−1, −2 steps), sides down to −3 steps (below the sea at −0.6) in the slab's cliff bands; 2.5D greedy meshing per existing 32×32 chunk, neighbours read across chunk borders (no seams); top corners darkened per higher neighbour (baked AO, 0.09/corner); side normals tilted up 0.55 like the slab |
| Ground colour | same | today's `groundColor` per tile, quantised to 1/48 per channel so equal neighbours merge |
| Lite terrain (far, focused island) | `terrain.ts` | same field at 2 columns/tile into the one lite mesh |
| Plateaus | `plateaus.ts` `plateauField` | terraces of the same columns: one voxel at the rim, two inside per level (level 1 → 1/2 steps, level 2 → 3/4); `PLATEAU_STEP` 0.5 (was 0.42) so decor/crags sit on the inner top. Every visible step is still one voxel |
| Far mask (other islands) | `farmesh.ts` `voxelMaskData` | **replaced** by coarse voxel terrain: 1 column/tile over the 1:4 mask, same shelves |
| Water, foam | unchanged | the shader sea is kept (warm teal shallows read well against the sand shelves); the foam strip still follows the smoothed coast, which lands on the shelf edge |
| Decor | `trees.ts` `ModelMerger.add` | voxel decor models from models-voxel; yaw snapped to quarter turns so voxels stay grid-aligned |
| Smoke | `life.ts` `puff` | cube puffs (12 tris) instead of the ico puff (80) |
| Sails, life | unchanged | ship models carry the sail/flag sway groups (vertex alpha) like the kits, so the sway shader works as is |
| Sun, lighting | unchanged | current sun + sky fill + baked AO |
| Roads | unchanged | still today's flat ribbons on top of the voxel ground; a full restyle would draw them as 1-voxel paths |

Palette check (v-step3a vs baseline): same warm greens/sand, the cliff
bands are the slab's ISLAND roles; no cold greys besides the slate-free
stone of the voxel buildings (stone #B9B2A4 is warm).

Shots: `.experiment/shots/v-step3a` (settled/showcase near/mid/far),
`v-step3b` (showcase/citizens near).

Fix after step 4: `PLATEAU_STEP` read `VOXEL_STEP` across a circular
import before it was initialised → every ground-scatter and crag height
was NaN and they vanished (trees stand at 0 and were fine). Now a
literal 0.5. The terrain side normals are tilted up 0.9 (0.55 left the
shelf sides near-black).

## Step 4: comparison

`make voxel-compare` (new target): settled near/mid/far, citizens near,
showcase near (the dense showcase town), seafaring start (the start-at-sea
camera), dense-archipelago-8 far (zoom cap, 8 islands) × desktop + phone,
once as today and once with `?voxel=1`, into
`.experiment/voxel/shots/{current,voxel}/` and the contact sheet
`.experiment/voxel/compare.png` (today left, voxel right, labelled;
`assets/voxel/compare.py`, stdlib PNG decode).

Look (my reading of the sheet; the owner decides):
- Near: the voxel buildings read as hand-made and more detailed than the
  kit-bashes (window frames, roof courses, chimney pots, crates); the
  voxel forest and crags are the strongest part. The ground is calmer
  than today (per-tile colour squares instead of the smooth blend).
- Mid: the town reads as a crisp miniature; roofs keep their colour, the
  stepped coast and the shelves give the island a clear voxel silhouette.
- Far: almost indistinguishable from today at the cap — the coast is a
  pixel outline, the islands keep their palette.
- Palette: same warm D-050 roles (one palette file); no cold greys except
  in the shade side of slate/iron, the mountain ground under rounded
  plateaus was the grey `mountain` role and is now warm rock.
- Seams: roads are still today's smooth ribbons on the voxel ground
  (visible at near); foam follows the smooth coast, the shelves are
  stepped — reads fine at mid/far, slightly off at near.

## Step 5: performance (desktop, `?stats=1`, software WebGL in headless Chromium)

| View | Today draws / tris | Voxel draws / tris |
|---|---|---|
| far at the cap, 8 islands (dense-archipelago-8) | 14 / 59 868 | 14 / **67 116** (first try 122 876) |
| far, dense island (dense-2x400) | 19 / 166 322 | 19 / **151 980** (first try **442 520**, over D-048) |
| far, settled | 10 / 213 355 | 10 / 190 894 |
| mid, dense island (dense-2x400) | 53 / 876 765 | 53 / 1 410 642 |
| near with life, dense island | 50 / 843 338 | 51 / 1 302 090 |
| near with life, settled | 42 / 188 284 | 42 / 261 538 |
| near, showcase | 33 / 136 610 | 33 / 242 538 |
| pan (dense-2x400, 10 s real clock, Metal) | longest 17 ms, p95 17, max queue 2 | longest 17 ms, p95 17, max queue 2 |
| pan (dense-archipelago-8) | longest 133 ms (1 frame > 50), max queue 7 | longest 50 ms, max queue 8 |

D-048 far budget (≤ 40 draws / ≤ 250k tris): the first voxel try broke
it on the dense island at the cap (442k: the lite houses were ~900 tris,
the kit lites ~120). **Mitigation tried:** lite level downsampled 4×
(2 voxels per tile) instead of 2× → 152k (below today's 166k). At the
cap a house is a few pixels; the side-by-side crops were
indistinguishable. Kept as the default (`NSVOXEL_LITE=2` rebuilds the
first try).

Layer triangles (`make shots STATS=2`, mid):

| Layer | settled today → voxel | dense-2x400 today → voxel |
|---|---|---|
| terrain (per 32×32 chunk) | 43 643 / 14 = 3.1k → 20 638 / 14 = **1.5k** | 46 176 / 6 = 7.7k → 16 154 / 6 = **2.7k** |
| plateaus | 25 194 → 6 524 | 4 912 → 386 |
| far mask (other islands) | 42 444 → 77 442 | 1 400 → 1 296 |
| trees | 63 640 → 171 136 | 36 074 → 97 242 |
| ground scatter | 67 888 → 149 718 | 6 796 → 11 618 |
| crags | 30 543 → 54 588 | 4 132 → 6 540 |
| buildings + life models | 14 899 → 27 276 | 710 767 → 1 210 884 |

The voxel terrain is cheaper than today's (greedy quads vs. marching
squares + slab); models, trees and scatter cost 1.6–2.7× more.

Per-model triangles (full / lite; variants and levels separated by /):

| Model | Kit full | Kit lite | Voxel full | Voxel lite |
|---|---|---|---|---|
| house_settlers | 1350/1362/1495 | 118/120/120 | 2534/2908/2742 | 168/198/226 |
| house_citizens | 1606/1641/1649 | 119/120/120 | 3110/3188/2558 | 260/246/244 |
| fisher | 1841 | 399 | 4032 | 306 |
| market_small | 3164/1595/1794 | 744/360/387 | 5300/7776/8312 | 430/490/618 |
| trading_post | 1435/1573/1679/1737 | 286/319/326/340 | 3616/4180/5400/6988 | 456/456/596/712 |
| lumberjack | 2566 | 604 | 2078 | 166 |
| sawmill | 3088 | 653 | 2498 | 296 |
| quarry | 918 | 150 | 3252 | 328 |
| chapel | 1877 | 450 | 2950 | 228 |
| tavern | 1053 | 191 | 5860 | 454 |
| warehouse | 1287/1459/1549 | 262/309/333 | 3830/3986/5636 | 408/516/646 |
| shipyard | 2358 | 461 | 5734 | 826 |
| wheat_farm | 1619 | 319 | 2802 | 280 |
| wheat_field | 62 | – | 168 | – |
| sheep_farm | 1457 | 348 | 2054 | 182 |
| pasture | 379 | – | 830 | – |
| orchard | 2219 | 399 | 2362 | 298 |
| orchard_plot | 242 | – | 270 | – |
| bakery | 2368 | 549 | 3254 | 296 |
| mill | 2948 | 614 | 4132 | 480 |
| weaver_wool | 1245 | 290 | 2034 | 248 |
| charcoal_burner | 1248 | 204 | 3388 | 360 |
| iron_mine | 1796 | 396 | 4404 | 346 |
| smelter | 452 | 150 | 2270 | 320 |
| toolmaker | 1966 | 474 | 2472 | 258 |
| sloop | 1488 | – | 1882 | – |
| brig | 1262 | – | 3948 | – |
| galleon | 1682 | – | 5096 | – |
| **all 93 models (65 voxel placeholders)** | 212244 | 41464 | 340344 | 36500 |

Decor (kit → voxel): decor_bush_a 72→34, decor_bush_b 44→56, decor_crag_a 120→278, decor_crag_b 120→280, decor_crag_c 200→242, decor_outcrop_iron 133→242, decor_outcrop_other 133→242, decor_outcrop_stone 133→242, decor_rock_a 48→82, decor_rock_b 12→38, decor_rock_c 71→114, decor_stump_a 16→18, decor_stump_b 38→18, decor_tree_a 116→384, decor_tree_b 108→270, decor_tree_c 112→282, decor_tree_d 116→286, decor_tuft_a 14→42, decor_tuft_b 14→30

GLB bytes: kit 19.6 MB, voxel 19.8 MB

Phone estimate (iPhone 15 Pro Max): draw calls are unchanged (the
voxel path adds no meshes), so the question is triangles. ART_DIRECTION
§8 records 60 fps on the device for ≈ 1.6M triangles (archipelago, mid)
and the dense town near. The voxel dense island is 1.30M near / 1.41M
mid — inside that envelope but with ~60 % more than today on the same
view, so I expect 60 fps at the cap (67–190k) and on pans (frame times
and build queue unchanged on desktop), with **less headroom at near/mid
on the dense island**. Not verified on the device — `make preview
HOST=<lan-ip>` with `?voxel=1&stats=1` is the gate. Phone shots
(`*-phone.png`): near 238k vs 168k today.

## Step 6: effort, restyle scope, risks

Effort per model (lines of the voxel recipe vs the kit-bash JSON recipe;
times from the authoring log; kit-bash times were not recorded in this
repo, but each kit recipe needed a Blender build per iteration plus kit
part lookups, while a voxel sheet renders in ≈1 s without Blender):

| | voxel recipe | kit recipe |
|---|---|---|
| **most complex** trading_post (4 levels) | 106 lines, ~12 min | 142 lines |
| market_small (3 levels) | 99 lines, ~12 min | 155 lines |
| house_citizens (3 variants) | 90 lines, ~10 min | 32 lines |
| **simplest** orchard_plot | 13 lines, ~1 min | 15 lines |
| wheat_field | 17 lines, ~1 min | 25 lines |
| pasture | 25 lines, ~3 min | 29 lines |
| eval set (25 recipes) average | ~45 lines, ~5 min | ~40 lines |

Shared helpers carry most of the effort: `parts.py` (the voxel "kit") is
~500 lines; once `P.house`/`P.windows`/`P.smoke` existed, a production
building took 30–45 lines and 3–6 minutes. Placeholders (65 ids) come
for free from `auto.py`, so every building has a voxel model on day 1.

Files and systems a full restyle would touch (session = one agent
session like this one):

| Area | Files | Estimate |
|---|---|---|
| Pipeline | `assets/voxel` becomes the asset build (Makefile `assets`, CI `--check`, thumbnails, lite policy, budgets per area), retire `assets/build` Blender parts (keep `nsassets` glb/palette/content) | 1–2 sessions |
| 123 models | 93 buildings/fields/ships (65 still placeholders) + 19 decor + 10 life + cargo; ~5 min each plus review rounds | 4–6 sessions |
| Terrain/decor | `voxelterrain.ts` → default; `terrain.ts`, `plateaus.ts`, `farmesh.ts` slab code retired; roads as voxel paths (`island.ts` roads), field patterns, deposits/outcrops, foam on the stepped coast, minimap colours | 2 sessions |
| Life | `life.ts` puffs/gulls as voxels, life model scale, construction stages sized per footprint | 1 session |
| Ships | sails/flags sway weights checked at sea, wake, cargo, ship scale vs voxel size | 1 session |
| UI icons/thumbnails | build-menu thumbs already rendered by `render.py`; HUD icons can stay (game-icons) or get voxel renders | 0.5–1 session |
| Docs/decision + device validation | new decision superseding D-050's kit-bash, ART_DIRECTION, perf on the device | 1 session |
| **Total** | | **≈ 10–14 sessions** |

Risks
- **Triangles at the cap:** solved for far with the 4× lite (152k dense,
  67k archipelago). The far mask got heavier (77k vs 42k on settled) —
  a 2-tiles-per-column mask would halve it if needed.
- **Near/mid on dense islands:** +55–60 % triangles (1.30M/1.41M); within
  the recorded device envelope but unverified; trees (2.7×) and scatter
  (2.2×) are the easiest cuts (fewer crown voxels, tufts as 1 voxel).
- **Phone memory:** GLB bytes equal (19.8 MB vs 19.6 MB) but the merged
  meshes have ~60 % more vertices (no shared vertices across quads) →
  more GPU memory per island chunk; the far mask merge also grows.
- **Construction stages:** the voxel stage/scaffolding models are generic
  (3 stages, scaled to the footprint); a restyle wants per-footprint
  stages or a "voxel rise" (build bottom-up by layers — natural in voxels).
- **Ghost previews:** work (full model, translucent), but voxel models have
  many coplanar quads; the translucent ghost can show z-fighting at quad
  edges on some GPUs — not seen in software WebGL.
- **Minimap:** unchanged (colour per tile) and fits the pixel look; no work.
- **Seams:** roads and foam are still smooth; the voxel ground is per tile
  colour, which loses today's soft blending (a style choice).

Could the kits/Blender be dropped? **Yes for this look:** buildings,
fields, decor, life, ships, lite levels and thumbnails are all generated
by the stdlib Python pipeline (no Blender, no `NEW_SHORES_KITS_DIR`, no
kit licences). What stays from `assets/build` is the shared part:
`nsassets` glb writer, palette, content, config/budgets.

Open questions for the owner
1. Voxel density: 8 per tile (this prototype) vs 4 per tile (your
   `~/Desktop/voxel` experiment): 4 halves the triangles and authoring
   detail (no window frames, no roof courses).
2. Ground: per-tile colour (now) vs per-voxel noise (more texture, more
   triangles) vs today's smooth blend under voxel models (hybrid).
3. Roads and foam: voxel paths and stepped foam, or keep smooth?
4. Is +60 % triangles at near/mid acceptable if the device check passes,
   or should trees/scatter be slimmed first?
5. Hero buildings (church, theatre, galleon): hand-authored voxel files
   (MagicaVoxel `.vox` import) or recipes?
6. Keep both looks (a setting) or replace?
