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

We cannot match its painterly textures with a flat-shaded kit, so **light
and colour carry the look, life carries the feeling, detail does not**:

1. **Light + colour first.** Strong warm key light, soft shadows, a
   saturated warm palette, water and coast done well; flat-shaded models.
2. **Life second.** Animated carts, walkers, smoke, sails, gulls, boats —
   every one of them derived from game state, so motion is also feedback.
3. **No textured detail.** No photo textures, decals or wear maps. Detail
   comes from silhouette, colour and motion. Hero pieces may go further
   later (§7).

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
  low), overridable with `?quality=` for tests. Both inside the perf guard.
- **Palette v1** (single source `assets/palette.json`; Blender re-palette,
  terrain materials and CSS variables all read it):

| Role | Colours |
|---|---|
| Terrain | sand `#E8D6A3` · grass `#7FA85A` / `#93B86A` · dry patches `#B9B46A` · forest floor `#4F7A3A` · mountain `#8E8A82` · cliff `#A89A80` |
| Water | shallows `#4FB1B0` → deep `#1F5F8B` · foam `#F4F6F0` |
| Buildings | plaster `#E7D7B8` · ochre `#D9A85E` · timber `#6F4A2E` · thatch `#B98F4F` · terracotta roof `#B5563B` · slate `#5C6670` · stone `#B9B2A4` · brass `#C9A24A` · plus (art task 3) `canvas` (sails), `iron`, `window`, `dye-blue` — exact values in `assets/palette.json` |
| UI chrome | parchment `#F1E6CC` · dark wood `#4A3421` · brass `#C9A24A` · ink `#2B2117` |
| Status | keep the current colour-blind-safe set; icons always paired with colour |

## 3. One continuous world (D-048)

- **No separate archipelago view.** All islands are rendered in one scene
  at their archipelago positions with real sea between them; the camera
  pans freely over the whole archipelago and zooms continuously. The
  island tabs become "jump to island" camera moves; a **minimap** (2D
  canvas: island outlines, ship dots, viewport rectangle; tap to jump)
  gives orientation.
- **Zoom-based LOD** replaces the old view switch: near = full detail and
  life layer; mid = simplified building blocks, no life; far = the island
  silhouette with landmark markers and labels (the PR #10 silhouettes).
  Islands outside the frustum are not rendered.
- **Routes** are edited in a panel with island pickers; clicking an island
  in the world while the editor is open still adds it as a stop
  (shortcut). Ship drag-to-send works on the continuous map. Settling
  starts from the island card of an unsettled island.
- The **world map** (other players, offers, expeditions) remains a 2D HTML
  screen (UI.md §5); it is not part of the 3D scene.

## 4. Terrain and water

- **Continuous terrain, hidden grid.** The tile grid is not drawn; a
  subtle grid overlay fades in around the cursor (≈ 8 tiles) only while a
  build/road tool is active. Ground stays **flat** (no elevation).
- **Coast:** smoothed outline (marching squares over tile edges), a sand
  beach band, a foam line that moves slowly; low cliffs where mountain
  meets water.
- **Grass:** two-tone noise with dry patches; scattered tufts, flowers and
  small rocks (instanced). **Forest tiles:** instanced trees that thin
  around buildings and visibly thin inside a lumberjack's work radius.
  **Mountains/deposits:** low-poly rock meshes with a deposit-specific
  outcrop colour.
- **Water:** shallows→deep gradient by distance from the coast, slow noise
  animation, subtle specular; the sea plane extends past the camera bounds
  and fades into a warm haze — never a hard edge.
- **Roads:** proper joins and a light border; dirt vs paved readable.
- All decoration is **render-only**: it never blocks placement and holds
  no state.

## 5. Scale, camera, life layer

- **Scale:** 1 tile ≈ 4 m. Carts and people ≈ 1 tile, visible at default
  zoom; a single house fills ~⅓ of a phone screen at max zoom.
- **Camera:** fixed isometric-style orthographic angles (D-024) with **four
  90° rotation steps**; continuous zoom from "one house" to "whole
  archipelago".
- **Life layer, in priority order:** carts on roads; **walkers** between a
  producer and its warehouse (spawned from the transfer timers — no new
  state); **smoke** from chimneys of running producers; **flags and sails**
  waving; **gulls** over coasts and **fishing boats** near fishers;
  inhabitants strolling near houses in proportion to residents.
- **Rule: every animation encodes a game state.** No smoke = not running,
  no walkers = not connected, no boats = no fisher, desaturated = paused.
- **Budget:** ≤ 150 animated instances per visible island on phones, ≤ 400
  on desktop; the dense-fixture perf guard enforces it.

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
  test IDs so the e2e suites stay green; bottom sheets use the same theme.

## 7. Building and ship models — kit-bash by recipe (as built, PR #15)

- **Source:** Quaternius *Medieval Village MegaKit* (doors, windows,
  chimneys, fences, barrels) and *Pirate Kit* (hull `Ship_Small`, dock,
  sawmill, barrels), CC0. Kit files live under `assets/kits/` (git-ignored;
  resolved via `NEW_SHORES_KITS_DIR` or a symlink) and are verified by
  sha256 against the committed `assets/kits/MANIFEST.json`; a missing or
  changed file fails the build naming it. Most kit wall/roof modules are
  far too dense for our budgets at 1 tile = 4 m (a 4×4 roof ≈ 2 000 tris),
  so walls, roofs and most props are **procedural primitives in kit
  colours**; kit pieces supply the detail. Kit scale factors: Medieval
  0.25 tiles/m, Pirate 0.25 (hull 0.35 → the sloop is 2.0 tiles long).
- **Recipes as data:** `assets/recipes/<content_id>.json` (schema in
  `assets/recipes/schema.json`): parts = kit piece or primitive (box,
  cylinder, wedge roof, sail, lathe) with transforms in tiles and a palette
  role; house `variants`, warehouse `levels`, ship data, attachments and
  anchor points (chimney, door, smoke). Footprints come from content.
- **Build:** `npm run assets` / `make assets` runs Blender 5.2 headless
  (`assets/build/`): import, palette mapping (kit material slots → roles;
  Pirate atlas faces snapped to named swatches), simplification, merge,
  origin at the footprint's ground centre, validation (footprint fit
  ±0.3 tiles, triangle budgets, palette-only colours), export by our own
  deterministic GLB writer (one mesh, POSITION/NORMAL/COLOR_0, no UVs or
  textures) to `client/public/models/` plus `manifest.json`, and contact
  sheets to `assets/build/out/`. `make assets-check` rebuilds into a temp
  dir and compares (skipped on CI without Blender); `make assets-test`
  runs the Python tests. **GLBs and manifest are committed**, so the client
  builds without Blender or the kits.
- **Budgets:** ≤ 1 500 tris per building, ≤ 400 per house, ≤ 60 per field,
  1 500 for the sloop + 150 cargo; warehouse, shipyard, chapel and market
  may go ×2 (not needed so far). Each building also has a **lite** model
  (~20–30 % of the budget) that must still cover its footprint and keep
  its tier language and signature prop.
- **Fidelity rules:** fill the footprint within ±0.3 tiles; front toward
  +y at rotation 0 (visual only, D-042); one material (vertex colours).
- **Tier language:** Settlers = timber frame + thatch, single storey;
  Citizens = plaster + terracotta tiles, 1½–2 storeys; Merchants = stone
  ground floor, gables, slate; Patricians = dressed stone, ornament,
  towers. Houses get 3 variants per tier chosen by building-ID hash.
- **Signature prop** per production building (sawmill blade + log pile,
  drying nets + boat, dyed cloth lines, tall chimney, oven dome, apple
  barrels, …); farms show a fenced yard and their field type; fields are
  1×1 models (pasture fence + sheep, wheat rows, orchard trees, hemp rows).
- **States:** place = short rise-in (thin instance during the animation);
  paused/unpaid = desaturated tint; not_connected/starved keep the status
  icon and lose smoke/walkers (task 4).
- **Ships:** sloop from the Pirate hull with procedural sails and bowsprit;
  cargo crates shown when the cargo list is non-empty; brig/galleon later
  via mast count and sail scale as recipe data.
- **Rendering:** models are **merged per 16×16-tile chunk** (one draw call
  per chunk and layer; measured 2 ms/frame cheaper than thin instances on
  software WebGL and equal on GPU); **lite ↔ full** switches at a camera
  half-extent of 10 tiles (full) / 11.5 (back to lite) inside the near LOD;
  mid/far LOD unchanged. Loaded through `@babylonjs/loaders` (glTF only);
  66 files ≈ 1.6 MB total, the dense town loads ≈ 125 kB.
- **Hero pass (later, optional):** church, harbourmaster, theatre,
  galleon may exceed budgets ×2 and be replaced by hand-made or
  AI-generated GLBs through the manifest. AI mesh services are a per-asset
  decision, never part of the default pipeline.

## 8. Post-processing and sound

- Nearly free effects only: soft vignette (all qualities) and a slight
  warm colour grading (high) — both composited as HTML overlays above the
  canvas, below labels and HUD, because per-material image processing cost
  ≈ 5 ms/frame on the phone probe; FXAA at high on hardware WebGL (skipped
  on software rasterisers so headless runs stay fast; `?fxaa=1` forces it
  and a dedicated screenshot baseline covers that path). No bloom, SSAO or
  depth of field.
- Sound is a separate later task (ambient sea/gulls, UI clicks, build and
  completion chimes).

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
3. **Asset pipeline + models** — done (PR #15): kit manifest, recipe
   schema and Blender build with deterministic GLB writer, 31 recipes
   (25 buildings with variants/levels, 4 fields, sloop + cargo), lite/full
   model LOD, merged chunks, state tints, rise-in. Phone perf at 4×
   throttling (software WebGL): near 28.7 fps / 26 draw calls, mid 32 / 18,
   far 38 / 16 — **≈ 2 fps of margin at near; measure on a real device
   before task 4 adds the life layer.** GPU runs hold 60 fps.
4. **Life layer and island dressing** — walkers, smoke, sails, gulls,
   boats, inhabitants, scattered decoration, budgets in the perf guard.

Each task ships screenshots at the gate; the reviewer compares against
this document and the reference board (to be added under
`docs/art/reference/` from Anno 1404 screenshots you own or links).
