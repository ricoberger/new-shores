# New Shores — Art Direction

Status: **Agreed target** (D-048). This document is the visual brief for the
art track; it does not change any game rule. Numbers (colours, budgets)
live in `assets/palette.json` and the voxel asset build
(`assets/voxel/nsvoxel/config.py`); this file explains the intent and the
rules. Since D-057 the whole game is procedural voxels; D-050's kit-bashed
look and its Blender pipeline are gone.

## 1. The feeling we are after

Anno 1404 at a glance: a warm, sunlit, lived-in archipelago. Ochre plaster
and terracotta roofs, deep green trees, turquoise shallows over sand turning
to deep blue, a low warm sun with long soft shadows, and lots of small life
— carts, people, boats, smoke, gulls.

We cannot match its painterly textures with flat-coloured voxels, so
**light, colour and silhouette carry the look, life carries the feeling,
textured detail does not** (D-048, refined by D-050 and D-057):

1. **Light + colour first.** Strong warm key light, soft shadows, a
   saturated warm palette, water and coast done well; flat-shaded voxel
   models.
2. **Life second.** Animated carts, walkers, smoke, sails, gulls, boats —
   every one of them derived from game state, so motion is also feedback.
3. **No textured detail.** No photo textures, decals or wear maps. Detail
   comes from silhouette, colour, baked ambient occlusion and motion.
4. **Chunky stylised shapes (D-050, D-057).** Exaggerated proportions —
   tall steep roofs, fat chimneys, oversized doors — strong silhouettes,
   built from voxels at 8 per tile; roofs as courses, window frames and
   shutters, chimney pots. Hero pieces may go further later (§7).

## 2. Light, palette, time of day

- **Fixed golden hour.** No day/night cycle, no seasons. Every screenshot
  and the mobile budget stay predictable.
- **Sun:** one world-fixed warm key light placed so that, at the default
  camera rotation, **shadows fall toward the camera's lower right** and the
  faces turned to the camera are lit — with our north-east-looking camera
  that is a sun in the north-west (`SUN_AZIMUTH`), not the compass
  "south-west" of the first draft; colour ≈ `#FFF1D6`, intensity 1.0,
  38° elevation. The sky fill is applied as the materials' ambient term
  so shadows are never black: the palette's sky (≈ `#9DB7D9`) leaned
  38 % toward the sun's colour (a warm bounce off the sunlit ground) at
  1.25 × the 35 % fill ratio (`render/lighting.ts` `skyFillColor`), so
  the camera-facing walls, which get the fill only, read warm brown-grey
  rather than slate blue. Other camera rotations are partly back-lit, as
  in Anno.
- **Shadows:** soft blob/contact shadows under buildings, trees and ships
  at every quality (merged static mesh per island and layer — one draw
  call; thin instances cost ≈ 3× on software WebGL); a 1024 px PCF sun
  shadow map on **high** quality only, cast by the buildings and trees of
  the islands at near **and mid** LOD and redrawn only when casters
  change. **Quality** follows the layout mode (desktop → high; tablets
  and phones → low), overridable with `?quality=`.
- **Per-voxel colour jitter (D-057 V2):** a material plugin
  (`render/jitter.ts`) hashes each fragment's voxel — its position in the
  model's own grid, so the pattern never crawls on moving or rising
  models — and shifts the vertex colour's value in four steps and its
  hue slightly along a warm–cool axis. The strength follows the material
  class the asset build writes into the vertex alpha
  (`nsvoxel/jitter.py`; tuned in V3b once the recipes exported flat
  colours): stone ±10.5 %, roofs ±8.5 %, wood ±7 %, foliage ±7 %,
  ground ±6 %, metal ±3 %, plaster ±3.5 %, glass and water none.
  The terrain keeps its own column jitter at the ground strength. Off at
  far LOD (a voxel is below a pixel) and with `?jitter=0` for A/B; WebGL 2
  only.
- **Previews** (ghosts, road drag, field paint) are pulled toward the
  camera with a polygon offset so they never z-fight with the ground.
- **Palette v1** (single source `assets/palette.json`; the voxel build's
  vertex colours, terrain materials and CSS variables all read it):

| Role | Colours |
|---|---|
| Terrain | sand `#E8D6A3` · grass `#7FA85A` / `#93B86A` · dry patches `#B9B46A` · forest floor `#4F7A3A` · mountain `#8E8A82` · cliff `#A89A80` |
| Water | shallows `#4FB1B0` → deep `#1F5F8B` · foam `#F4F6F0` |
| Buildings | plaster `#E7D7B8` · ochre `#D9A85E` · timber `#6F4A2E` · thatch `#B98F4F` · terracotta roof `#B5563B` · slate `#5C6670` · stone `#B9B2A4` · brass `#C9A24A` · plus (art task 3) `canvas` (sails), `iron`, `window`, `dye-blue` — exact values in `assets/palette.json` |
| UI chrome | parchment `#F1E6CC` · dark wood `#4A3421` · brass `#C9A24A` · ink `#2B2117` |
| Shadows (D-050) | one cooler, lower-value **shadow tone per role** (`shadows` group) used by the AO/two-tone bake; thatch keeps extra chroma in shadow |
| Island (D-050) | cliff bands (warm rock), sand rim, plateau rock and moss cap, shelf water (`island` group) |
| Status | keep the current colour-blind-safe set; icons always paired with colour |

## 3. One continuous world (D-048)

- **No separate archipelago view.** All islands are rendered in one scene
  at their archipelago positions with real sea between them; the camera
  pans freely over the whole archipelago and zooms continuously. The
  island tabs become "jump to island" camera moves; a **minimap** (2D
  canvas: island outlines, ship dots, viewport rectangle; tap to jump)
  gives orientation.
- **Zoom-based LOD** replaces the old view switch, and since D-050 every
  level shows **real models**: near and mid = full models (8 voxels per
  tile); far = the **lite** models, the same voxel grid downsampled 4× to
  2 voxels per tile (D-057 §2; footprint-covering by construction). The
  focused island's terrain has a full (4 columns per tile) and a lite
  (2 per tile) mesh; other islands at far are one coarse voxel mesh of
  their 1:4 terrain mask (1 column per tile). There are no block or
  treetop stand-ins. Carts, status icons, construction hulls and foam
  show at near only. Every island's geometry is built once (both detail
  tiers) when it first appears; zooming only toggles pre-built meshes —
  never rebuilds. Islands outside the frustum are not rendered.
- **Routes** are edited in a panel with island pickers; clicking an island
  in the world while the editor is open still adds it as a stop
  (shortcut). Ship drag-to-send works on the continuous map. Settling
  starts from the island card of an unsettled island.
- The **world map** (other players, offers, expeditions) remains a 2D HTML
  screen (UI.md §5); it is not part of the 3D scene.

## 4. Terrain and water — diorama islands (D-050, D-057 V2, D-058)

- **Continuous terrain, hidden grid.** The tile grid is not drawn; a
  subtle grid overlay fades in around the cursor (≈ 8 tiles) only while a
  build/road/field/move tool is active. Ground is flat within a terrace
  level; the levels are visual only (D-058 §4).
- **Voxel ground (D-057 V2):** the island is a column field at 4
  columns per tile, height steps of 1/8 tile, greedy-meshed per 32×32-tile
  chunk with baked corner occlusion (`render/voxelterrain.ts`). The top
  colour of each column comes from a per-island **ground texture** (one
  texel per column, nearest sampling) through a material plugin
  (`render/groundshader.ts`): grass blends smoothly between the two grass
  tones and dry patches across tiles, with a per-voxel brightness jitter
  in three steps; sides keep their vertex colours. Only the faces looking
  straight up take the texture, so the triangle count stays that of the
  greedy mesh.
- **Coast:** a pixel coastline (the smoothed coast sampled at the column
  centres) with a sand rim, a darker **wet-sand line** at the water,
  **beach pebbles** in the sand and two shelves stepping under the sea;
  cliffs and sides in **stepped rock bands** (lower, upper, ledge). The
  shallows and the **foam** follow the stepped coast column by column
  (pixel foam, not a smooth line).
- **Far coast lines up with near:** the lite (2 columns per tile) and far
  (1 per tile) terrain are the near field downsampled, and a built
  island at far feeds its own far columns into the merged mask mesh, so
  the coastline does not jump between LODs (tested). Islands in view
  without tiles draw their 1:4 mask through the same field code;
  off-screen islands are left out of the merged mesh. At far a built
  island's columns keep whole levels, one rock tier, flat rivers and 12
  colour levels, nearest the view first while the merged mesh stays
  within 100 k triangles (the others fall back to their mask); the
  focused island's lite terrain keeps at most two rock tiers (D-048's
  far budget).
- **Terraces (D-058):** each land tile's level (0–2, from the tiles
  API's `levels`) lifts its columns by four steps (½ tile) per level,
  blended at tile centres so edges run on tile borders. A level edge by
  the sea is a cliff in earth and rock bands; inland edges are cliffs or,
  in low-frequency noise zones, ramps of one step per column.
- **Rock:** mountain, cliff and islet tiles carry rock on their level:
  one height field per island, the tiles' `heights` blended between their
  centres at eight steps per height (a large island's spine up to 32
  steps, four tiles), rising three steps per column from a ragged rim
  (noise at column resolution, never outside rock tiles) and roughened by
  low-frequency noise in pairs of steps — uneven tops, not plates.
  **Warm grey** rock with sandstone and ochre strata (the cliff bands)
  in its walls, darker at the foot, moss only on the lowest rim; the
  ground around it is grey **scree** with small boulders. A big crag
  (`decor_peak_a/b`) stands on every peak, clusters of crags along the
  ridges, a few on the flanks. Cut out under building footprints, so
  mines and quarries stand in a notch. Its own layer at near and mid,
  baked into the lite and far columns.
- **Cliff coast:** cliff tiles drop to the sea as a rock face (strata,
  darker toward the foot) without a sand shelf; the foam lies at its
  foot and the shallows start further out.
- **Rivers** are tile-exact channels two steps below their level; where
  a river drops a level a waterfall wall with foam bands falls to the
  next; at level 0 it meets the shelf in an estuary. **Bridges** are
  voxel arch models (`decor_bridge_1/2`) over straight road runs of one
  or two river tiles, at the banks' level, hidden at far.
- **Things on terraces:** buildings and fields stand on the highest
  level under their footprint, lower columns filled with dressed-stone
  plinths; a road tile next to a road one level lower ramps across the
  upper tile (never on a river); carts, walkers, animals, the ghost, the
  grid and picking follow the ground height. Boats stay on the sea.
- **Skerries** (D-058) are tiny islands of rock with a grass or sand
  top: drawn like islands (minimap and far view included), never
  labelled, focused or picked.
- **Roads** are voxel paths painted into the terrain field per chunk
  (`render/roadvoxels.ts`), one voxel below the grass: a two-column path
  with arms to the neighbours and junctions, worn edges and jittered
  stones; dirt for tier-1 roads, three-shade **cobbles with a kerb** for
  the stone road. A road change repaints the field and rebuilds only the
  touched chunks; carts and walkers walk on the sunk path.
- **Field ground** is painted into the ground texture too (furrows for
  crops, pasture, orchard grass) under the field models.
- **Decor** (`assets/voxel/recipes/_decor.py`, `render/decorscatter.ts`):
  four tree species with irregular noise canopies (lobes, rim holes, lit
  tops, dark undersides) and branches — oak, beech, a conifer and birch —
  three bushes (plain, berries, flowers), and small props at 16 voxels per
  tile: flowers, mushrooms, ferns, reeds, pebbles, logs, stumps and
  tufts. Density follows the terrain role: forest (mushrooms, ferns,
  logs), meadow (tufts, flower patches by noise), beach (pebbles, reeds),
  rock (pebbles). Yaw in quarter turns, so voxels stay on the grid. The
  small detail is one merged mesh per chunk shown at near only; trees and
  bushes are merged per chunk and culled with the chunk. Canopies **sway**
  in the vertex shader (sway group `canopy`: weight 0 at the canopy's
  bottom, 0.45 at the top). Trees are thinned around buildings and roads
  and visibly inside a lumberjack's radius, with cut stumps.
- **Water:** shallows→deep gradient by distance from the coast, slow noise
  animation, subtle specular; the deep is the palette's deep 12 % toward
  the shallows and warmed (`render/mapcolors.ts` `seaDeepRgb`, shared with
  the minimap). The sea plane extends past the camera bounds and fades
  into a warm haze — never a hard edge. Unsettled islands show true
  colours at every zoom, like settled ones (labels and settled badges
  tell them apart).
- **Minimap:** an island with loaded tiles is drawn per tile (terrain
  colour, lighter per level and rock, rivers blue); the others each land
  cell of their mask in its voxel ground colour (sand, grass, forest
  floor, mountain rock) on the same sea. Skerries load their tiles right
  after the islands in view (their mask is too coarse for them).
- All decoration is **render-only**: it never blocks placement, holds no
  state and is never pickable (tile picking is a ray against the ground,
  refined to the terrace height of the tile it hits).

## 5. Scale, camera, life layer

- **Scale:** 1 tile ≈ 4 m. Carts and people ≈ 1 tile, visible at default
  zoom; a single house fills ~⅓ of a phone screen at max zoom.
- **Camera:** fixed isometric elevation (D-024) with **free rotation**
  (D-051): right-drag, two-finger twist, Q/E; on release the azimuth
  eases to the nearest 45°; the sun stays world-fixed; a compass on the
  minimap shows the heading and resets the view. Continuous zoom from
  "one house" to "whole archipelago".
- **Life layer (shipped, PR #21; brief and as-built notes in
  `docs/LIFE_LAYER.md`):** carts (`cart`/`cart_merchant`) and **walkers**
  between a producer and its collector, spawned from the transfer timers;
  **smoke** (voxel puffs in four sizes, 2/3/4/6 voxels at 16 per tile,
  the nearest size to the plan's puff, quarter turns) from chimneys of
  producers with status ok, density ∝ throughput × efficiency; **flags and sails** swaying;
  **gulls** and **fishing boats** at harbours and fishers; **strollers**
  (1 per 8 residents) on nearby roads; **sheep** wandering in active
  pastures; **quay crates** while a ship is handling; **construction
  stages** A→B→C with scaffolding on ≥ 3×3 footprints replacing the
  rise-in. `?life=0` switches it off (A/B), `?stats=1` shows instance and
  particle counts.
- **Rule: every animation encodes a game state.** No smoke = not running,
  no walkers/carts = not connected, starved, full or paused, no boats =
  no fisher, tinted = paused/inactive.
- **Budget:** ≤ 150 animated instances / 64 particles per island on
  phones and tablets, ≤ 400 / 160 on desktop, shared by fixed proportions
  across element classes; near LOD only (mid: smoke and static props;
  far: ships only); `?stats=1` shows the counts, the device check is the
  gate (D-052).

## 6. HUD — themed-flat Anno

- Anno's materials as **flat surfaces**: parchment panels with a thin
  dark-wood border and a brass accent line; dark-wood top bar and build
  bar; a serif display face for titles, a clean sans for numbers;
  game-icons.net icons (CC-BY) recoloured in ink/brass; framed building
  cards with brass tier badges; ornament only at a few anchors (top-bar
  ends, panel headers). Toasts as parchment slips; the away summary as a
  letter from the advisor; status as a wax-seal-style badge.
- **Icon set** for every good, need and status (needed for mobile anyway):
  game-icons.net SVGs pinned under `assets/icons/` with per-icon source and
  checksum in `icons.json`, recoloured via `currentColor`; CC BY 3.0 with
  attribution in the README and the in-game Credits dialog. Fonts: Cinzel
  (titles) and Source Sans 3 (text/numbers), OFL, pinned pre-subset woff2
  under `assets/fonts/`.
- **Rules:** no information in decoration; ornaments are CSS only (never
  images with text); contrast ≥ 4.5:1; every panel keeps its structure and
  test IDs (used by `make shots`); bottom sheets use the same theme.

## 7. Models — procedural voxels (D-057)

Everything with a model — buildings, fields, ships, decor (trees, bushes,
rocks, crags, outcrops, tufts, stumps), life-layer props (carts,
villagers, boats, crates, sheep) and construction stages — is a voxel
model generated by code. No kits, no Blender, no bought packs, no
hand-made `.vox` files.

### Authoring

- **Recipes:** one Python file per content ID in `assets/voxel/recipes/`
  (`<content_id>.py`) with `build(ctx)` returning a voxel grid; decor and
  life props live in `_decor.py` / `_life.py`, ships in `_ships.py`.
  `ctx` gives the footprint in tiles and voxels (`ctx.W × ctx.D`, from
  content), the water rows, the variant or level, the tier and the
  anchors the content needs. Optional `variants` (houses: 3 per tier,
  picked by building-ID hash), `levels` (warehouse, trading post) and
  `cargo` (ship attachment).
- **Parts library:** `nsvoxel/parts.py` (yards, timber frames, stone
  walls, windows with frames/sills/shutters, doors, gates, chimneys with
  pots and the smoke anchor, dormers, roofs as courses with ridges,
  fences, crates, barrels, logs, planks, hay, bushes, trees, signs,
  awnings, `house()`); materials in `nsvoxel/mats.py` are palette roles ×
  shade. A production building is typically 30–45 lines on the parts.
- **Anchors** are set in voxels by the recipe (door, chimney/smoke, cart,
  boat, berths, slip, pasture gate and animals; status defaults above the
  model) and exported in glTF space; the build fails when an anchor the
  content needs is missing (LIFE_LAYER, D-054).
- **Placeholders:** a content ID without a recipe gets an automatic model
  (`nsvoxel/auto.py`): walls and a tier-coloured roof sized to the
  footprint, water rows as a pier, a sign board with the ID's first
  letters, the anchors it needs; fields get their crop pattern. Every island is always one
  style; the manifest lists them under `placeholders`. Ships have no
  placeholder (a ship needs a recipe).
- **Planned IDs:** buildings and ships that content does not define yet
  take their footprint from `assets/voxel/planned/*.json`, read beneath
  the content (content wins per ID), so models can be built a tier ahead
  of the content sessions; `NEW_SHORES_CONTENT_DIR` points the build at
  another content directory.
- **Iterating:** `make model-sheet RECIPE=id[,id…]` renders a contact
  sheet (front-left at the game's 30°, every variant, level and
  attachment)
  to `.experiment/sheets/` in about a second; without `RECIPE` it lists
  the IDs. Review the sheet, then the game (`make shots`).

### Recipe authoring at the D-057 §3 detail

Tier 1–2 recipes are written on the v2 parts in `nsvoxel/detail.py`
(re-exported by `parts.py`, called as `P.<name>`); the v1 helpers stay
for the placeholders. A recipe is a yard, one or two `P.building`s, the
openings, the props that say what the building does, the anchors, then
`P.scatter(...)` and `return P.colour_jitter(v, seed=…)` (a no-op since
V3b — kept for the signature) — about 40–70 lines.

- **Building:** `b = P.building(v, x0, y0, x1, y1, style, along=…)`
  with style `settler` (pegged timber frame, plaster, thatch),
  `citizen` (coursed-stone ground floor with dressed quoins, jettied
  framed upper storey, tiles), `stone` or `stonethatch`. It lays the
  proud plinth, fills hidden volumes solid (only the shell is meshed)
  and returns `b.face(side, upper=False)` for openings and `b.roof`
  (`ridge_z`, `surface(x, y)`) for chimneys and dormers. Lower-level
  parts (`coursed_stone`, `dressed_quoins`, `half_timber`, `boarded`,
  `log_walls`, `jetty_course`, `roof`, `lean_to`) build anything else.
- **Openings:** `P.casement` (frame, glazing bars, sill, lintel,
  shutters, flower box; settler windows unframed with a pale sill),
  `P.entrance` (framed leaf, hinges, knob, stone step), `P.barn_gate`,
  `P.trade_sign` in the colour of the good, `P.dormer_on`.
- **Roofs:** courses with ridge tiles or a thatch roll, eaves (fascia or
  ragged fringe) and three-voxel gable ends so the lite keeps them;
  `P.roof_chimney(v, b.roof, x, y, anchor=True)` places a stack with
  pots and the chimney/smoke anchors on smoking producers (content
  `smoke`).
- **Yard and props:** uneven fences (`fence_ring`, `fence_line_v2`),
  `crop_rows`, `fruit_tree`, `shrub`, and the work props — `woodpile`,
  `log_stack`, `cask`, `box_crate`, `sacks`, `bale`, `handcart`,
  `trough`, `well`, `tool_rack`, `ladder`, `sawhorse`, `haystack`,
  `sheaf`, `stone_blocks`, `lamp_post`, `flower_bed`. One signature prop
  per producer must read at mid zoom.
- **Tier 4 (Patricians, V5):** `nsvoxel/detail_v5.py` (imported as
  `Q`) adds parts on top of `P` without changing it: `Q.palazzo` (proud
  plinth, ashlar ground floor, plastered upper storeys, string courses,
  cornice, roof; `.face`, `.roof`, `.top`), `Q.ashlar`,
  `Q.string_course`, `Q.cornice`, `Q.pilasters`; openings `Q.window`
  (hood `key`, `pediment`, `cornice`), `Q.lancet`, `Q.rose_window`,
  `Q.arcade`, `Q.colonnade`, `Q.balustrade`, `Q.grille`; `Q.tower`
  (pyramid roof, finial), `Q.finial`, `Q.buttress`, `Q.dome`; props
  `Q.heap`, `Q.lying_cask`, `Q.cask_rack`, `Q.trellis_row`, `Q.wheel`,
  `Q.headframe`, `Q.furnace` (the tier-2 smelter stack with its
  chimney/smoke anchors), `Q.bolts`, `Q.mannequin`, `Q.spinning_wheel`,
  `Q.candle_rack`, `Q.shell_heap`, `Q.leafy_bank`; and named shades
  (`Q.ASHLAR`, `Q.DRESSED`, `Q.GRAPE`, `Q.VINE`, `Q.GOLD`,
  `Q.VERDIGRIS`, `Q.COPPER`, `Q.QUARTZ`, `Q.WAX`).
- **Ships:** `recipes/_ships.py` builds all hulls with one `hull()`
  (plank courses, wale, trim band, rail, deck courses, gunports,
  bowsprit, stern cabin with windows, gallery and lanterns, forecastle)
  and `mast()` (yards, top, shrouds, pennant); sails are sway group
  `sail`, pennants `flag`. The cargo attachment places one prop per
  cargo slot at the ship's `CARGO_SPOTS`; anchors are `status` and
  `wake` (stern, waterline).
- **Anchors:** everything `model.required_anchors` lists (cart, boat,
  berths, slip, pasture gate and animals, chimney/smoke) plus a door on
  buildings; the build fails without them.
- **No baked colour noise (V3b):** recipes export flat palette colours
  and the shader jitters per voxel (§2). Authored shade *steps* that are
  structure — coursed stone, roof courses, ridge tiles, furrows,
  scorched ground — stay; random per-voxel shades do not (they split
  merged quads: V3 measured 28 MB with full baked jitter vs 21 MB
  without). The models folder has a hard limit (`MODELS_FOLDER_LIMIT`)
  — prefer structure (courses, frames,
  props) over more speckle.
- **Sway:** sails, ship canvas, flags (`flag_*`) and hung or stretched
  cloth marked with `P.cloth` — the wool and linen weavers' lines, the
  sailmaker's sail on its frame, the warehouse's level 3 awning and flag;
  sacks, bales, bolts and cart loads stay rigid. The list is LIFE_LAYER §7
  (the tests read the manifest's `sway`).
- **Lite:** the automatic lite (2 voxels/tile) must still read: keep
  jettied fronts and gable ends on 4-voxel block boundaries, roofs at
  least three voxels thick at the verges, and check the lite column of
  the sheet.
- **Budgets:** triangles per footprint tile and class
  (`nsvoxel/config.py`) and the folder limit are fixed; report a recipe
  that does not fit instead of raising them.
- **Tier 3 parts (D-057 V4):** `nsvoxel/detail_v4.py`, imported as
  `V` next to `P` (detail.py stays unchanged): `V.townhouse` (stone
  ground floor to 9–10, jettied half-timber in any frame colour, jettied
  framed gables), `cross_gable`, `stepped_gable`, `oriel`, `balcony`,
  `shop_front`, `face_awning`, `signboard`, `hoist`; round pieces
  `round_tower`, `still_tower`, `dome`, `cone_roof`, `vat`, `kettle`,
  `hood` (`V.COPPER`); `drying_frame` (cloth sway), `hide_frame`,
  `louvres`, `brick_stack`, `stack`, `hanging`; `heap`, `mine_hill`
  (seam bands), `terraces` (a pit's banks — models never go below the
  ground plate, so open them toward the camera, y+ and x−), `hop_pole`,
  `leafy_rows`. The default view looks from the front-west: put
  signature parts on the y+ and x− sides.

### Look rules

- **Colour:** palette roles only, each in a few named shades
  (`nsvoxel/mats.py`).
  **Ambient occlusion baked into vertex colours** per quad corner
  (58 % of the way to the role's cooler shadow tone, `shadows` group);
  side normals tilted toward up so walls turned from the sun stay warm.
  The alpha byte carries the role's **jitter class** (255 − class,
  `nsvoxel/jitter.py`; the shader's per-voxel jitter, §2) or, on cloth
  and leaf voxels (sway groups `sail`, `flag`, `cloth`, `canopy`), the
  sway weight (≤ 245); the manifest lists each model's sway groups.
- **Fidelity:** the structure fills the footprint (not a cottage on a
  slab) and stands on the ground; front toward +y at rotation 0 (visual
  only, D-042); one material (vertex colours). Every building reads by
  its good at mid zoom (one readable signature prop per production
  building); farms show a fenced yard and their field type.
- **Tier language:** Settlers = timber frame + thatch, single storey;
  Citizens = plaster + terracotta, 1½–2 storeys with dormers; Merchants =
  stone ground floor, gables, slate, two storeys + attic; Patricians =
  dressed stone, ornament, towers, three storeys. A house tier reads
  richer than the one below.
- **States:** place = construction stages (`life_stage[_n]` A→B→C by
  footprint class — 2, 4 and 8 tiles per side, the nearest to the
  footprint, stretched to fit — and the scaffolding in 3 and 8) over
  2.4 s (rise-in remains for fields and with `?life=0`); paused/unpaid = desaturated tint;
  not_connected/starved keep the status icon and lose smoke/walkers.
- **Lively look (D-057 §3).** The recipes (V3, authoring above) bring
  courses, frames, crop rows, uneven fences and flat palette colours;
  the world (V2) adds the shader's per-voxel jitter to every model
  material (§2), irregular swaying canopies and the richer
  ground detail (§4), stepped rock bands, wet sand, pebbles and stepped
  foam at the coast, voxel roads, and warmer light and sea.

### Pipeline and tooling

- **Build:** `make assets` runs `python3 assets/voxel/build.py` (Python 3
  standard library only, parallel, ≈ 3 s): recipe or placeholder →
  voxel grid → greedy-meshed quads (`nsvoxel/mesh.py`) with per-vertex
  colour and AO → our deterministic GLB writer (`nsvoxel/glb.py`; one
  mesh, **KHR_mesh_quantization**: POSITION int16 in voxel units with
  the unit in the node scale, NORMAL int8, COLOR_0 uint8, 4-byte
  padded, `extensionsRequired` set — ≈ 32 bytes per triangle, loaded
  through Babylon's extension plugin and dequantised in `parseGlb`; no
  UVs/textures, origin at the footprint's ground centre) into
  `client/public/models/` with
  `manifest.json` and 128 px build-card thumbnails (`thumbs/`, a small
  software rasteriser, `nsvoxel/render.py`). The build owns the folder
  and removes stale files. GLBs, manifest and thumbnails are committed,
  so the client builds without Python.
- **Lite (far) tier:** buildings only; the full grid downsampled 4× (8 →
  2 voxels per tile; a cell stays filled when ≥ 1/8 of its voxels are).
  Fields, ships, decor and life props have no lite file.
- **Checks:** `make assets-check` rebuilds into a temp dir and compares
  byte for byte (CI runs it, no skip); `make assets-test` runs the
  Python tests (`assets/voxel/tests`: determinism, manifest, one model
  per content ID, placeholders, budgets, footprint fit, anchors, folder
  size) and is part of `make check`. The client's Vitest suites check the
  manifest against content and the life classes.
- **Budgets (D-054 area scaling, re-based for voxels):** triangles per
  footprint tile — buildings 500 (lite 40), houses 540 (lite 45), fields
  410 — times the footprint area, no floor and no cap; ships sloop 2 800,
  brig 6 000, galleon 7 600, cargo 300; decor 580; life props 760,
  construction stages 2 100. Each is the prototype's densest model of its
  class with ≈ 50 % headroom; a model over its budget fails the build.
  The committed GLBs are ≈ 12.9 MB (tiers 1–2 at full detail, tiers 3–4
  as placeholders) of a **24 MiB folder limit**; what remains per
  triangle is indices and AO/normal-split vertices.
- **Rendering:** models merged per 16×16-tile chunk (one draw call per
  chunk and layer; thin instances only during rise-in); full chunks at
  near/mid, lite chunks at far, both built once and toggled. Building
  shadows are soft rounded outlines of the model bounds (merged per
  island); trees and ships keep discs. The placement ghost is the full
  model, translucent, tinted by validity. Loaded through
  `@babylonjs/loaders` (glTF only).
- **Measured (D-057 V1, desktop, `make shots STATS=1`):** far at the cap
  14 draws / 67 k triangles (8 islands) and 19 / 152 k (dense island) —
  inside D-048's ≤ 40 / ≤ 250 k; dense island mid 1.41 M and near with
  life 1.30 M, settled near 262 k. Near/mid are targets; the gate is the
  device run (§8).
- **Hero pass (later, optional):** church, harbourmaster, theatre, galleon
  may get larger budgets (a `config.py` change with its reason); still
  voxels from recipes.

## 8. Post-processing and sound

- Nearly free effects only: soft vignette (all qualities) and a slight
  warm colour grading (high) — both composited as HTML overlays above the
  canvas, below labels and HUD, because per-material image processing cost
  ≈ 5 ms/frame on the phone probe; FXAA at high on hardware WebGL (skipped
  on software rasterisers so headless runs stay fast; `?fxaa=1` forces it
  and `make shots` can show it). No bloom, SSAO or
  depth of field.
- Sound is a separate later task (ambient sea/gulls, UI clicks, build and
  completion chimes).

### Performance validation (D-050)

- The **baseline device** is the authority: iPhone 15 Pro Max (Safari),
  plus an M4 Pro MacBook — 60 fps at near, mid and far on both dense
  fixtures (2026-10-23). Each art gate re-checks on the device via
  `make preview HOST=<lan-ip>` with the `?stats=1` badge.
- There is no automated perf guard (D-052): the device check above is
  the gate, with the life layer's `?stats=1` counts and `?life=0` for
  A/B. `make shots` renders the standard views for the PR report.

## 9. Task breakdown

1. **Continuous world** — done (PR #13): view switch removed, three-level
   LOD (30/27, 48/42 half-extent), minimap, route editor with island
   pickers, 90° camera steps, sea haze. Phone perf at 4× throttling: near
   42 fps / 19 draw calls, mid 57 / 13, far 46 / 15.
2. **Visual foundation** — done (PR #14): `assets/palette.json` with
   generated TS/CSS (drift-checked), golden-hour light, blob shadows +
   desktop shadow map, continuous terrain with marching-squares coast,
   beach, foam, cliffs, deposits, trees, scatter, field patterns, road
   strips, tool-only grid overlay, shallows-to-deep animated sea, quality
   toggle, themed HUD with Cinzel/Source Sans 3 and 60 game-icons icons
   (CC BY, Credits dialog). Phone perf at 4× throttling: near 31 fps /
   26 draw calls, mid 33 / 17, far 41 / 15 (thin margin at near — profile
   on a real GPU before adding the life layer). Bundle 454 → 537 kB gzip.
3. **Asset pipeline + models** — done (PR #15), **restyled to KayKit and
   diorama islands (PR #16, D-050; both replaced by the voxel build in
   D-057 V1)**: kit manifest, recipe schema and
   Blender build with deterministic GLB writer, AO/two-tone bake, all
   tier 1–2 recipes + fields + sloop from KayKit/Pirate, slab/plateau/
   scatter islands, real models at every zoom (lite at far), device-
   validated perf floors, dev reset endpoint for fixtures.
4. **Life layer and dressing — done (PR #21):** everything in
   `docs/LIFE_LAYER.md` §2 except horses/cattle; 36 draw calls at near on
   the dense fixture (was 26), bundle +7 kB gzip, models 7.55 MB. Open:
   fisher-boat loops and ship legs crossing land, stage models for
   fields, budget per *visible* island.
5. **Voxel restyle V1 (D-057):** voxel is the only renderer — the
   `assets/voxel` build replaces the Blender build, kit manifest and kit
   recipes; slab terrain and `?voxel=1` removed; IDs without a recipe
   get placeholders. V2: the lively look (§7) and recipes tier by tier.

Each task ships screenshots at the gate; the reviewer compares against
this document and the reference board (to be added under
`docs/art/reference/` from Anno 1404 screenshots you own or links).
