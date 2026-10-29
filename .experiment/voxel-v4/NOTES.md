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
| C | Workshops | done |
| D | Public: church, theatre | done |
| E | Tests and output | done |

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
- Round work pieces and frames: `round_tower`, `dome`, `cone_roof`,
  `still_tower`, `vat`, `kettle`, `hood`, `drying_frame` (cloth sway),
  `hide_frame`, `louvres`, `brick_stack`, `stack`, `hanging`.
- Materials: `COPPER` (the iron deposit's red-brown ×1.5 — brass read as
  olive), `VERDIGRIS`.

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

## C — workshops

Camera note: the default view looks from the front-west — the visible
facades are y+ (lower left) and x− (lower right). Signature parts sit on
those sides (butcher's smoking shed, pastry oven, tailor's cutting shed,
still towers on the west).

- butcher: thatched hall with a shop hatch + counter, open smoking shed
  with rows of hanging sides, louvre (smoke). pastry_kitchen: ochre
  townhouse, shop front + awning, brick dome oven with flue (smoke).
- brewery: stone kettle house, copper vent hood on the ridge (smoke),
  arched door open on the kettle, cask yard lean-to with tiers of casks,
  dray. distillery: round still tower + copper dome, stack, barrel hall
  (red tiles). grain_distillery: brick still tower, slate barrel hall,
  framed malt loft with kiln vent and hoist.
- leather_works: hide frames as tall as the hut, tanning pits. tailor:
  jettied gable townhouse, bolts in shop windows, wide signboard with
  shears, cutting shed, washing line (sway). dyer: dye house, vat shed,
  three tall drying frames (sway). dyer_works: open vat hall on tall
  posts, four vats with dyed cloths over the rims, louvre (smoke), back
  drying frames (sway).
- paper_mill: drying hall with louvred loft, vat house (smoke), screw
  press, paper stacks; no wheel. printing_press: open front bay on
  posts with the press, type case, book/paper stacks, signboard.
- rendering_house: iron kettle shed, tallow casks, brick stack.
  soap_maker: copper kettle shed, racks and stacks of cakes. salt_works:
  open boiling house with two pans, cistern, stack. brickworks: kiln with
  fire holes and stack, green-brick hacks under a shed, brick stacks.
- Shared test changed: `test_pipeline` used `grain_distillery` as its
  example of an ID without a recipe; it now picks any building still
  without one (none left once V5 lands) and checks that fisher and
  grain_distillery get their recipes.

## D — public

- church (6 × 10): warm sandstone (`cliff-upper` ×1.12, dressed ×1.28)
  nave with buttresses and lancets, red tile roof, half-round apse with a
  half-cone roof at the back, three-stage west tower at the front
  (portal, clock, belfry openings with a bell, tiled spire, cross), west
  porch, coped churchyard wall with a lych gate, gravestones, yews.
- theatre (11 × 14): Roman theatre — a half-elliptic cavea toward the
  street (tiers, a walkway, four radial stairs) behind an outer wall
  with an arcade of arches and pilasters; paved orchestra; raised stage
  with a niched front; a two-storey scaenae frons with columns,
  entablatures, niches, three doors and a tile roof; end towers; back
  portico; forecourt with statues and cypresses. Seats face the stage
  (away from the camera); the arcade faces the street.
- Renderer note: a recess two voxels deep on the x− face shows only its
  side wall in the sheet's view; openings there are one voxel deep.

## E — tests and output

- `assets/voxel/tests/test_tier3.py`: recipe per tier-3 ID (+ grain
  distillery), anchors per content flags (cart, chimney/smoke = content
  `smoke`, boat on salt_pans, door, status), budgets full and lite,
  footprint fit, structure in every quarter of the plot, flat plain
  roles (< 5 % differing neighbours), sway only on dyer / dyer_works /
  tailor, determinism, three distinct merchant houses bigger and taller
  than any citizen house with three roofs; helper tests for detail_v4.
- `make assets`, `make assets-check` (models current, 356 files),
  `make check` after every group: passed.
- Contact sheet: `sheets/tier3-contact.png` (full + lite, every model);
  per group `a-houses.png`, `b-farms-mines-water.png`,
  `c-workshops.png`, `d-public.png`.
- Shots: `shots/merchants-{near,mid}-{desktop,phone}.png`. The fixture's
  near view frames open grass (no buildings in frame); mid shows the
  merchant town.

### Triangles

| Model | Full / budget | Lite / budget |
|---|---|---|
| house_merchants.v0 | 4204 / 4860 | 266 / 405 |
| house_merchants.v1 | 4446 / 4860 | 304 / 405 |
| house_merchants.v2 | 4270 / 4860 | 294 / 405 |
| hop_farm | 3656 / 6000 | 286 / 480 |
| hop_field | 362 / 410 | — / — |
| woad_farm | 3848 / 6000 | 234 / 480 |
| woad_field | 274 / 410 | — / — |
| clay_pit | 3106 / 12000 | 324 / 960 |
| salt_pans | 5438 / 22500 | 442 / 1800 |
| salt_mine | 5094 / 12000 | 388 / 960 |
| coal_mine | 5582 / 12000 | 408 / 960 |
| butcher | 4090 / 10000 | 300 / 800 |
| pastry_kitchen | 4752 / 10000 | 356 / 800 |
| brewery | 6514 / 15000 | 456 / 1200 |
| distillery | 6658 / 15000 | 434 / 1200 |
| grain_distillery | 6056 / 15000 | 450 / 1200 |
| leather_works | 2210 / 6000 | 210 / 480 |
| tailor | 4992 / 10000 | 370 / 800 |
| dyer | 4080 / 10000 | 376 / 800 |
| dyer_works | 4722 / 12500 | 520 / 1000 |
| paper_mill | 5140 / 12000 | 336 / 960 |
| printing_press | 5168 / 10000 | 366 / 800 |
| rendering_house | 2312 / 4500 | 196 / 360 |
| soap_maker | 3314 / 6000 | 264 / 480 |
| salt_works | 4328 / 12000 | 390 / 960 |
| brickworks | 3858 / 10000 | 290 / 800 |
| church | 12270 / 30000 | 792 / 2400 |
| theatre | 19896 / 77000 | 1620 / 6160 |

All within budget; none over. Models folder 16140 KB (was 14144 KB;
limit 24 MB).

### Time (wall clock)

| Group | Time | Recipes |
|---|---|---|
| Reading, setup, helpers start | 05:33–05:36 | – |
| A houses | ≈ 05:36–05:42 | 1 (×3 variants) |
| B farms/fields/mines/water | 05:42–05:49 | 8 (≈ 1 min each) |
| C workshops | 05:49–05:58 | 15 (≈ 0.6 min each) |
| D public | 05:58–06:04 | 2 (≈ 3 min each) |
| E tests, docs, sheets, shots | 06:04–06:12 | – |

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
4. **Copper colour.** No copper role in the palette; `COPPER` is the
   iron deposit's red-brown lightened (×1.5). Alternatives: brass (reads
   olive) or a new palette role (a palette change, out of scope).
5. **Warm stone.** The palette has no warm building stone; church and
   theatre use the island's `cliff-upper` sandstone (an allowed role).
   Alternative: `ochre`-tinted stone (reads as plaster) or a palette role.
6. **Theatre orientation.** The cavea's outer arcade faces the street
   (+y), the stage house is at the back; the seats are read from above.
   Alternative: stage to the street (the stage house would hide the
   seats from the default camera).
7. **grain_distillery is a tier-4 (patrician) ID** authored here as the
   distillery class's twin, as asked. If V5 also writes
   `grain_distillery.py`, keep one (this one, or V5's) at merge.
8. **LIFE_LAYER §7 sway list** still names the tier 1–2 cloth only; the
   dyer, dyer_works and tailor cloth sways (manifest `sway`). The docs
   rule here allows ART_DIRECTION §7 only, so LIFE_LAYER is not updated.
9. **Shared test change:** `test_pipeline` placeholder example (see C).
