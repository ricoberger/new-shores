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
```

## Pipeline (step 1)

`assets/voxel/` — Python 3 stdlib only (numpy was not installed and is not needed).

| file | role |
|---|---|
| `nsvoxel/grid.py` | `Vox` sparse grid: box, frame, walls, cyl, ellipsoid, line, gable/hip/shed roofs (one voxel course per step = tile rows), stamp, mirror_x, repeat, hash jitter, anchors; `downsample` (lite) |
| `nsvoxel/mesh.py` | greedy meshing with per-corner AO (0fps); faces merge when material and AO agree along the merge axis; down faces dropped |
| `nsvoxel/export.py` | palette role × shade → vertex colour blended to the role's shadow tone by AO; side normals tilted up (`SIDE_TILT`); cloth → sway alpha; writes through the **existing** `nsassets/glb.py` writer |
| `nsvoxel/model.py` | recipe loading, variants/levels from content, footprint/anchor/budget checks, lite file, manifest entry (same format as `assets/build`) |
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
