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
| B | Farms, fields, mines, water | – |
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

## Open questions

1. **Slate on one merchant house.** The task asks for tiled roofs varied
   "within the warm palette"; ART_DIRECTION's tier language says
   Merchants = slate. Taken: v0 red and v1 brown terracotta tiles, v2
   slate (the crow-stepped stone house) — slate stays a minority accent
   in a merchant quarter, not a dominant cold grey. Alternative: v2 in
   orange tiles (`mat("terracotta", 1.14)`), a one-line change.
