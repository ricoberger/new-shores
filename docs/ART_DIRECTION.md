# New Shores — Art Direction

Status: **Agreed target** (D-048). This document is the visual brief for the
art track; it does not change any game rule. Numbers (colours, budgets)
live in `assets/palette.json` and the asset build script once those exist;
this file explains the intent and the rules.

## 1. The feeling we are after

Anno 1404 at a glance: a warm, sunlit, lived-in archipelago. Ochre plaster
and terracotta roofs, deep green trees, turquoise shallows over sand turning
to deep blue, a low warm sun with long soft shadows, and lots of small life
— carts, people, boats, smoke, gulls.

We cannot match its painterly textures with a flat-shaded kit, so **light,
colour and silhouette carry the look, life carries the feeling, textured
detail does not** (D-048, refined by D-050):

1. **Light + colour first.** Strong warm key light, soft shadows, a
   saturated warm palette, water and coast done well; flat-shaded models.
2. **Life second.** Animated carts, walkers, smoke, sails, gulls, boats —
   every one of them derived from game state, so motion is also feedback.
3. **No textured detail.** No photo textures, decals or wear maps. Detail
   comes from silhouette, colour, baked ambient occlusion and motion.
4. **Chunky stylised shapes (D-050).** Exaggerated proportions — tall steep
   roofs, fat chimneys, oversized doors — strong silhouettes, bevelled
   edges; KayKit's shape language is the lead for buildings and nature.
   Hero pieces may go further later (§7).

## 2. Light, palette, time of day

- **Fixed golden hour.** No day/night cycle, no seasons. Every screenshot
  and the mobile budget stay predictable.
- **Sun:** one world-fixed warm key light placed so that, at the default
  camera rotation, **shadows fall toward the camera's lower right** and the
  faces turned to the camera are lit — with our north-east-looking camera
  that is a sun in the north-west (`SUN_AZIMUTH`), not the compass
  "south-west" of the first draft; colour ≈ `#FFF1D6`. The sky fill
  (≈ `#9DB7D9` at ~35 %) is applied as the materials' ambient term so
  shadows are never black. Other camera rotations are partly back-lit, as
  in Anno.
- **Shadows:** soft blob/contact shadows under buildings, trees and ships
  at every quality (merged static mesh per island and layer — one draw
  call; thin instances cost ≈ 3× on software WebGL); a 1024 px PCF sun
  shadow map on **high** quality only, redrawn only when casters change.
  **Quality** follows the layout mode (desktop → high; tablets and phones →
  low), overridable with `?quality=`.
- **Palette v1** (single source `assets/palette.json`; Blender re-palette,
  terrain materials and CSS variables all read it):

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
  level shows **real models**: near and mid = full models; far = the
  ≈ 25 % decimated **lite** models (silhouette-preserving, footprint-
  covering). There are no block or treetop stand-ins. Carts, status icons,
  construction hulls and foam show at near only. Every island's geometry
  is built once (both detail tiers) when it first appears; zooming only
  toggles pre-built meshes — never rebuilds. Islands outside the frustum
  are not rendered.
- **Routes** are edited in a panel with island pickers; clicking an island
  in the world while the editor is open still adds it as a stop
  (shortcut). Ship drag-to-send works on the continuous map. Settling
  starts from the island card of an unsettled island.
- The **world map** (other players, offers, expeditions) remains a 2D HTML
  screen (UI.md §5); it is not part of the 3D scene.

## 4. Terrain and water — diorama islands (D-050)

- **Continuous terrain, hidden grid.** The tile grid is not drawn; a
  subtle grid overlay fades in around the cursor (≈ 8 tiles) only while a
  build/road/field/move tool is active. Buildable ground stays **flat**.
- **Slab:** the marching-squares coastline is extruded ≈ 0.6 tile down to
  the water with a layered, rounded cliff profile in warm rock bands, an
  AO-darkened underside and a sand rim on top; a coarser five-ring profile
  at default zoom and far, the full profile when zoomed in (visibility
  toggle, no rebuild). The foam line follows the slab.
- **Plateaus:** mountain/deposit clusters rise as 1–2 rounded steps
  (corners ≥ 0.5 tile) with the cliff profile, a moss cap on top and KayKit
  crags/boulders along the step edges and on the deposits. Visual only:
  rules keep mountains unbuildable; mines and quarries stand in a notch.
- **Grass:** two-tone noise with dry patches. **Scatter** is clustered, not
  uniform: rocks and bushes in clumps at the coast, forest edges and
  plateau feet; open grass gets tufts and rare bushes only; everything
  light with AO only in crevices. **Forest tiles:** KayKit Forest trees
  (4 species, smooth-shaded), thinned around buildings and roads and
  visibly thinned inside a lumberjack's radius with cut stumps.
- **Water:** shallows→deep gradient by distance from the coast, slow noise
  animation, subtle specular, foam line; the sea plane extends past the
  camera bounds and fades into a warm haze — never a hard edge.
  Unsettled islands show true colours at every zoom, like settled ones
  (labels and settled badges tell them apart).
- **Roads:** continuous strips with joins and a light border; dirt vs paved
  readable.
- All decoration is **render-only**: it never blocks placement, holds no
  state and is never pickable (tile picking is a ray against the ground
  plane).

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
  **smoke** (solid low-poly puffs) from chimneys of producers with status
  ok, density ∝ throughput × efficiency; **flags and sails** swaying;
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

## 7. Building and ship models — kit-bash by recipe (D-050, PR #15/#16)

- **Kits (CC0, local, sha256-pinned in `assets/kits/MANIFEST.json`,
  git-ignored): KayKit only, SOURCE editions.** **KayKit Medieval
  Hexagon** (buildings: houses, market, church, tavern, blacksmith,
  lumbermill, windmill, mine; units: `ship`, `boat`, `cart*`, animals;
  harbour: `building_docks`, `building_shipyard`, `anchor`; props,
  fences, construction stages) and **KayKit Forest Nature** (trees,
  bushes, rocks, grass). The Quaternius kits (Medieval, Nature, Pirate)
  have been removed from manifest, config and recipes. Kits resolve via
  `NEW_SHORES_KITS_DIR` or a git-ignored `assets/kits` symlink; a missing
  or changed file fails the build naming it.
- **Colour mapping:** KayKit's 1024² gradient atlas is a grid of cells;
  every UV triangle lies inside one cell, so faces are classified by cell
  and gradient position and mapped to palette roles (walls → plaster,
  timber frame → timber, team-colour cell → roof role per tier: thatch
  for Settlers, terracotta for Citizens). The Pirate atlas is sampled per
  face and snapped to named swatches. Only the blue KayKit files are used;
  roofs are recoloured per recipe. Kit buildings face −y and are turned
  180° (ours face +y).
- **Richness without textures:** **ambient occlusion baked into vertex
  colours**, darkening toward a cooler per-role shadow tone (`shadows`
  palette group); **two-tone** lit/shadow hues; thatch normals tilted
  toward up and extra chroma in shadow so sun-averted thatch slopes stay
  warm; bevels on procedural parts; per-instance colour jitter on houses.
- **Recipes as data:** `assets/recipes/<content_id>.json` (schema
  `assets/recipes/schema.json`): whole kit buildings (`kit_building`), kit
  pieces, procedural primitives (box, cylinder, wedge roof, sail, lathe)
  with transforms in tiles and palette roles; exaggeration helpers (roof
  ×1.3, chimney ×1.5); house `variants`, warehouse `levels`, ship data,
  attachments, anchor points. Footprints come from content. Mapping used:
  houses ← `home_A/B`, market ← `market`, chapel ← `church`, tavern ←
  `tavern`, lumberjack/sawmill ← `lumbermill`, mill ← `windmill`,
  smelter/toolmaker ← `blacksmith`, quarry/iron_mine ← `mine`, farms ←
  `home` + fences + yard props, warehouse ← procedural barn + props,
  shipyard ← procedural slipway + Pirate hull + `scaffolding`, fisher ←
  hut + Pirate dock. Fields: pasture (fence + sheep), wheat (chunky rows),
  orchard_plot (small tree), hemp (rows).
- **Build:** `npm run assets` / `make assets` runs Blender 5.2 headless
  (`assets/build/`): import, cell/atlas → palette mapping, decimation of
  heavy pieces, merge, AO bake, origin at the footprint's ground centre,
  validation (footprint fit ±0.3 tiles, triangle budgets, palette-only
  colours), export by our deterministic GLB writer (one mesh,
  POSITION/NORMAL/COLOR_0, no UVs/textures) to `client/public/models/` +
  `manifest.json`, contact sheets to `assets/build/out/`. A **lite** model
  per recipe is generated by decimation to ≈ 25 % (stepping up through
  35/50/70/100 % until the footprint check passes; ≥ 150 tris) — this is
  the far-zoom tier. `make assets-check` rebuilds into a temp dir and
  compares (skipped on CI without Blender); `make assets-test` runs the
  Python tests. GLBs and manifest are committed (5.3 MiB of an 8 MiB
  ceiling) so the client builds without Blender or the kits.
- **Budgets:** ≤ 6 000 tris per building, ≤ 2 500 per house, ≤ 300 per
  field, sloop 1 500 + 150 cargo; houses' lite ≈ 120 tris, production
  buildings' lite 14–25 % of full. Hero exceptions ×2 if ever needed.
- **Fidelity rules:** fill the footprint within ±0.3 tiles; front toward
  +y at rotation 0 (visual only, D-042); one material (vertex colours).
- **Tier language:** Settlers = timber frame + thatch, single storey;
  Citizens = plaster + terracotta tiles, 1½–2 storeys (home_B + dormer);
  Merchants = stone ground floor, gables, slate; Patricians = dressed
  stone, ornament, towers. Houses get 3 variants per tier by building-ID
  hash. One readable **signature prop** per production building; farms
  show a fenced yard and their field type.
- **States:** place = construction stages over 2.4 s (rise-in remains
  for fields and with `?life=0`); paused/unpaid = desaturated tint;
  not_connected/starved keep the status icon and lose smoke/walkers.
- **Ships:** sloop from the KayKit `ship` (team colour → canvas sails,
  hull in timber tones, ≈ 1 500 tris); cargo from KayKit crates when the
  cargo list is non-empty; the large KayKit ship and sail recolours give
  brig/galleon later. The fisher and shipyard jetties are procedural
  planks dressed with KayKit `boat`, `barrel`, `bucket`.
- **Rendering:** models merged per 16×16-tile chunk (one draw call per
  chunk and layer; thin instances only during rise-in); full chunks at
  near/mid, lite chunks at far, both built once and toggled. Building
  shadows are soft rounded outlines of the model bounds (merged per
  island); trees and ships keep discs. The placement ghost is the full
  model, translucent, tinted by validity. Build-menu cards show 128 px
  thumbnails rendered by the asset build (`client/public/models/thumbs/`,
  byte-identical under `--check`). Loaded through `@babylonjs/loaders`
  (glTF only). Dense town: ≈ 700 k triangles at near,
  the 8-island archipelago ≈ 1.6 M at mid, 450 k at far — 60 fps on the
  baseline device.
- **Hero pass (later, optional):** church, harbourmaster, theatre, galleon
  may exceed budgets ×2 and be replaced by hand-made or AI-generated GLBs
  through the manifest after the same quantise-to-palette + AO step. AI
  mesh services are a per-asset decision, never the default pipeline.

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
   diorama islands (PR #16, D-050)**: kit manifest, recipe schema and
   Blender build with deterministic GLB writer, AO/two-tone bake, all
   tier 1–2 recipes + fields + sloop from KayKit/Pirate, slab/plateau/
   scatter islands, real models at every zoom (lite at far), device-
   validated perf floors, dev reset endpoint for fixtures.
4. **Life layer and dressing — done (PR #21):** everything in
   `docs/LIFE_LAYER.md` §2 except horses/cattle; 36 draw calls at near on
   the dense fixture (was 26), bundle +7 kB gzip, models 7.55 MB. Open:
   fisher-boat loops and ship legs crossing land, stage models for
   fields, budget per *visible* island.

Each task ships screenshots at the gate; the reviewer compares against
this document and the reference board (to be added under
`docs/art/reference/` from Anno 1404 screenshots you own or links).
