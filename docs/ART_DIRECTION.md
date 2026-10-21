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
- **Sun:** warm key light from the south-west so shadows fall toward the
  camera's lower right and give the isometric relief; colour ≈ `#FFF1D6`.
  Cool sky fill ≈ `#9DB7D9` at ~35 % so shadows are never black.
- **Shadows:** soft blob/contact shadows under buildings, trees and ships
  everywhere; one low-resolution sun shadow map on desktop only. Both
  inside the perf guard.
- **Palette v1** (single source `assets/palette.json`; Blender re-palette,
  terrain materials and CSS variables all read it):

| Role | Colours |
|---|---|
| Terrain | sand `#E8D6A3` · grass `#7FA85A` / `#93B86A` · dry patches `#B9B46A` · forest floor `#4F7A3A` · mountain `#8E8A82` · cliff `#A89A80` |
| Water | shallows `#4FB1B0` → deep `#1F5F8B` · foam `#F4F6F0` |
| Buildings | plaster `#E7D7B8` · ochre `#D9A85E` · timber `#6F4A2E` · thatch `#B98F4F` · terracotta roof `#B5563B` · slate `#5C6670` · stone `#B9B2A4` · brass `#C9A24A` |
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
- **Icon set** for every good, need and status (needed for mobile anyway).
- **Rules:** no information in decoration; ornaments are CSS only (never
  images with text); contrast ≥ 4.5:1; every panel keeps its structure and
  test IDs so the e2e suites stay green; bottom sheets use the same theme.

## 7. Building and ship models — kit-bash by recipe

- **Source:** Quaternius *Medieval Village MegaKit* (buildings, props) and
  *Pirate Kit* (ships, harbour), CC0; Kenney Nature/Castle pieces where
  the MegaKit has gaps. Kit files are pinned under `assets/kits/` (or
  fetched by checksum); everything is re-paletted to §2.
- **Recipes as data:** `assets/recipes/<content_id>.json` lists kit pieces
  (and procedural parts) with transforms and the footprint. A Blender
  Python script (`npm run assets`, Blender headless) builds every recipe,
  applies the palette, sets the origin to the footprint's ground centre,
  validates footprint fit and triangle budget, and exports one GLB per
  content ID plus the asset manifest (ARCHITECTURE "asset pipeline"). The
  client falls back to the procedural placeholder when a GLB is missing.
- **Procedural parts** (generated in the same script): stretched roofs,
  sails with wind bulge, flags, ropes, carts, barrel stacks, cliffs/rocks,
  deposit outcrops, field rows, quay walls, slipway, foam.
- **Fidelity rules:** fill the footprint within ±0.3 tiles; front toward
  +y at rotation 0 (visual only, D-042); ≤ 1 500 triangles per building,
  ≤ 400 for houses; one palette atlas → one material → instancing.
- **Tier language:** Settlers = timber frame + thatch, single storey;
  Citizens = plaster + terracotta tiles, 1½–2 storeys; Merchants = stone
  ground floor, gables, slate; Patricians = dressed stone, ornament,
  towers. Houses get 2–3 variants per tier chosen deterministically from
  the building ID.
- **Signature prop** per production building (sawmill blade + log pile,
  drying nets + boat, dyed cloth lines, tall chimney, oven dome, apple
  barrels, …); farms show field rows within the work radius.
- **States:** place = short rise-in; paused/unpaid = desaturated tint;
  not_connected/starved keep the status icon and lose smoke/walkers.
- **Ships:** sloop/brig/galleon from Pirate Kit hulls, differentiated by
  mast count and sail scale; crates visible on deck when carrying cargo.
- **Hero pass (later, optional):** church, harbourmaster, theatre,
  galleon may exceed budgets ×2 and be replaced by hand-made or
  AI-generated GLBs through the manifest, one entry each. AI mesh services
  are a per-asset decision, never part of the default pipeline.

## 8. Post-processing and sound

- Nearly free effects only: soft vignette, slight warm colour grading
  toward the palette, FXAA on desktop. No bloom, SSAO or depth of field.
  All behind a quality toggle set by the layout mode (phones: vignette
  only).
- Sound is a separate later task (ambient sea/gulls, UI clicks, build and
  completion chimes).

## 9. Task breakdown

1. **Continuous world** — remove the view switch, zoom LOD, minimap, route
   editor with island pickers, camera rotation steps, sea haze.
2. **Visual foundation** — palette JSON, light and shadows, terrain
   (coast, grass, trees, mountains), water, grid overlay rule, roads,
   post-processing toggle, HUD theme and icon set.
3. **Asset pipeline + models** — kit pinning, re-palette, recipe script,
   manifest/GLB loader with fallbacks, recipes for all tier 1–2 buildings
   and the sloop, state tints, variants.
4. **Life layer and island dressing** — walkers, smoke, sails, gulls,
   boats, inhabitants, scattered decoration, budgets in the perf guard.

Each task ships screenshots at the gate; the reviewer compares against
this document and the reference board (to be added under
`docs/art/reference/` from Anno 1404 screenshots you own or links).
