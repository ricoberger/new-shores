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
| house_settlers (3 variants) | 77 | ~15 min | incl. 2 iterations on roof pitch and frame density |

## Shots

(see below, filled in per step)
