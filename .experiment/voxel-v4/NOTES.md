# D-057 V4 — tier 3 (Merchants) buildings at the target detail

Branch `adhoc.20261029-053019-d-057-v4-tier-3-merchants-buildings-at-t`
(worktree of the same name under `~/.worktrees/ricoberger/new-shores/`),
based on main `ce0e498` (after V3b/V3c #42). Direct implementation
session; V5 (tier 4 + ships) runs in parallel and shares `nsvoxel/*`.

Tools (experiment only, not product code):
- `.experiment/voxel-v4/sheet.py out.png id[,id…] [--cell N] [--cols N] [--only i,j]`
  — a copy of the V3 sheet tool: every variant/level as full + lite at
  the same scale, captioned triangles/budget (`!` = over budget or a grid
  problem).
- Sheets in `.experiment/voxel-v4/sheets/` (git-ignored), shots in
  `.experiment/voxel-v4/shots/`.

## Rules of this session

- Files: `assets/voxel/recipes/<id>.py` for the tier-3 IDs (+
  `grain_distillery`, the shared distillery class), the new helper module
  `assets/voxel/nsvoxel/detail_v4.py` (existing helpers and their output
  unchanged), tests, ART_DIRECTION §7 (helpers added).
- Not touched: `client/src/**`, `_decor.py`, `_life.py`, `_ships.py`,
  terrain, other tiers' recipes, budgets, the folder limit.

## Groups

| # | Group | State |
|---|-------|-------|
| A | Houses: `house_merchants` ×3 | done |
| B | Farms, fields, mines, water | done |
| C | Workshops | – |
| D | Public: church, theatre | – |
| E | Tests and output | – |

## Helpers added (`nsvoxel/detail_v4.py`, imported as `V`)

- `townhouse` — the merchant block: plinth, tall coursed-stone ground
  floor with quoins, jetty, half-timber upper storey in any frame colour,
  optional jettied gable ends (with king post and collar), roof of any
  material; returns a `detail.Building`.
- `cross_gable` — a framed wall dormer / cross gable flush with the front
  of an along-x townhouse, its roof running into the main roof.
- `stepped_gable` — crow-stepped stone gable with coping on an along-x
  roof end.
- `oriel`, `balcony`, `shop_front`, `face_awning`, `signboard`, `hoist`.
- `heap` (conical heap of salt/coal/clay), `mine_hill` (iron_mine's hill
  with seam bands that read as stripes and slope contours), `terraces`
  (stepped pit banks, open toward the camera), `hop_pole`, `leafy_rows`.
- Materials: `COPPER`, `VERDIGRIS`.

## A — houses

`house_merchants` v0: eaves to the street, wide framed cross gable over a
two-light oriel, shop front with a striped awning, trade sign (red tiles,
dark timber, ochre infill). v1: gable to the street (jettied, framed),
balcony across the upper storey with a door, loft door with hoist and a
hanging bale, a tiled market lean-to with cloth (brown tiles, oak timber,
plaster). v2: crow-stepped stone gables with stone fire walls, slate
roof, balcony over a shop front, side oriel, wall dormer with a hoist
(slate, ox-blood timber, warm plaster). All: ground 10 / wall top 19
(citizens 8 / 16), steeper roofs (rise 1.5), two-step entrances with
lintels.

## B — farms, fields, mines, water

- `hop_field`: two tall poles with bines (leaf runs, pale cones) per tile,
  wires along the rows across tiles, hilled soil. `woad_field`: teal
  rosette rows on ploughed soil, a few yellow flowers.
- `hop_farm`: brick-coursed oast with a steep pyramid roof and white
  cowl + vane, framed stowage barn with a loft hoist, hop pockets, a
  picking bin heaped with cones, poles. `woad_farm`: stone farmhouse,
  edge-runner woad mill, open drying shed with shelves of woad balls.
- `clay_pit`: the ground plate is the lowest a model goes, so the pit is
  the yard floor with three terraces rising to the back and east (open
  toward the camera, so it reads as a pit, not a mound); gantry hoist with
  winch and bucket; drying shed with clay blocks; hut.
- `salt_pans`: 3 × 2 basins on stone walls over the water rows in three
  stages (sea, brine, white crystallising pans with raked ridges), plank
  walk, jetty with a moored salt barge, `boat` beside it; on land a large
  salt heap, hut, store shed, second heap.
- `salt_mine` / `coal_mine`: `mine_hill` with white / black seams; salt —
  adit, tub, horse whim over the brine shaft, brine trough and casks, pump
  house, salt heap; coal — adit, tubs on rails, headframe with sheave
  wheel, winding house, coal heap, spoil tip.

## Open questions

1. **Slate on one merchant house.** The task asks for tiled roofs varied
   "within the warm palette"; ART_DIRECTION's tier language says
   Merchants = slate. Taken: v0 red and v1 brown terracotta tiles, v2
   slate (the crow-stepped stone house) — slate stays a minority accent
   in a merchant quarter, not a dominant cold grey. Alternative: v2 in
   orange tiles (`mat("terracotta", 1.14)`), a one-line change.
2. **Clay pit depth.** A pit cannot go below the ground plate (the model
   sits on the terrain), so it is terraced banks above ground opened to
   the camera side. Alternative: a client terrain cut-out — out of scope
   (no `client/src` / terrain changes).
3. **Salt mine output is brine.** The task asks for white seams and a
   heap; the mine shows rock salt (seams, tub, heap) and brine (casks,
   trough, whim over the brine shaft).
