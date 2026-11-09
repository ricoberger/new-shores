# New Shores — User Interface

Status: **Agreed structure** (D-024, D-027); layouts and visuals are to be
prototyped in the first playable. The UI is HTML/CSS (React) over a Babylon.js
canvas. The world is rendered from server state plus linear extrapolation; the
UI shows the same numbers the server uses.

## 1. Views

| View | Renders | Purpose |
|---|---|---|
| **World scene** (D-048, PR #13) | one 3D scene with all islands at their archipelago positions and sea between; fixed isometric-style ortho camera (30° elevation, azimuth 45° + k·90°), free pan within the archipelago bounds + 30 tiles, continuous zoom with three LOD levels; minimap | build, inspect, sail, manage routes, settle |
| **World map** | 2D HTML screen (no 3D) | neighbours, offers, expeditions, contracts, visits, leaderboards |
| **Account / shop** | HTML | profile, purchases, settings |

### World scene

- **Camera.** Zoom is the vertical orthographic half-extent in tiles:
  min 7 (a 2×2 footprint ≈ ⅓ of a 360 px phone width), default 18, max =
  whole archipelago fits (the fit uses the bounds' diagonal, so it does
  not change while turning), capped by the region's
  `camera.max_half_extent` (80, below). **Rotation is free** (D-051, as built):
  right-drag (45° per 120 px; the right button no longer pans, the middle
  button does), two-finger twist about the fingers after a 12° dead zone
  (with a ghost tool the twist rotates the ghost instead), `Q`/`E` in 45°
  steps; on release the azimuth eases (≤ 250 ms) to the nearest 45°; the
  sun stays world-fixed; the ease never blocks input. The **compass** in
  the expanded minimap's corner (hidden while the minimap is collapsed on phones) shows
  the real heading on the north-up map; drag the ring to turn, tap/Enter
  = "Reset view" (default heading, which looks north-east). No separate
  rotate buttons. Building rotation stays fixed to the world (D-042).
  **Jumps** (island tabs, Enter, founding,
  warnings panel) move the camera in ≤ 350 ms and zoom in to 18 only when
  the camera is farther out; island jumps centre the island. Founding
  frames the whole island, but never beyond the cap: an island larger
  than the view at the cap (a 250-tile island at 80) is framed at the cap
  on its centre. Minimap taps keep the zoom. A gesture in
  progress when a jump starts is cancelled without its release action; a
  press begun during a jump is ignored until all fingers lift; wheel and
  pinch are ignored during the jump.
- **LOD** is a pure function of the half-extent and the previous level
  (no timers): near → mid above 30, mid → near below 27, → far above 54,
  far → mid below 47 (far begins where a 2×2 footprint is ≈ 12 px tall on
  a phone). The **maximum zoom-out is a content constant** (`region.json`
  `camera.max_half_extent`, 80 tiles since D-072 (was 120) — one large
  island with sea around it; PR #26, following Anno): the archipelago overview is the minimap,
  not the camera; a new world opens on the ship at the cap and the
  founding hint points at the minimap. *Near:* full models, roads,
  fields, carts, status icons, construction hulls, foam. *Mid:* full
  models, roads and fields, no carts or status icons. *Far:* lite models
  (≈ 25 %), the same diorama ground, one simplified tree mesh per island
  without scatter or tree shadows, labels and settled badges; settled or
  not, an island has the same colours. Terrain, trees, scatter, roads and fields
  are built per **32×32 chunk** and culled per chunk; a change rebuilds
  only the touched chunks; the life layer spawns only in visible chunks.
  **Island tiles load lazily** (`GET /world/islands/{id}/tiles`, cached
  immutably per seed/roll; the focused and visible islands first, at
  most two requests in flight): until they arrive an island draws a
  merged mesh from its 1:4 terrain mask in the world payload (the same
  mesh non-focused islands use at far; buildings do not show on it) and
  its card says "Loading…". The minimap is drawn from the masks. Islands
  outside the frustum are not rendered; ships, route ribbons and the selected
  ship's ETA badge render at every level (ships ×2 near/mid, ×4 far). The
  level is exposed to tests via the hook.
- **Sea and haze:** a scrolling-noise sea plane sized so every viewport
  corner stays on water at the clamped bounds in all rotations, fading into
  a haze colour toward the edge; the clear colour is the haze.
- **Labels** are keyboard buttons with the island name and badge, hidden
  near the canvas edge, except that of the island under the camera
  centre: at the cap a large island's centre is often out of view, so its
  label moves into view on the side of its centre; pointer taps resolve **ship → label → land**. A
  label tap is an island tap at every LOD: it opens the **island card**
  (a read-only overview: the population of every tier (with the top bar's population icon) and the island's
  resources as icon badges, one per line: fertilities, deposits with their slot counts (a slot is two adjacent deposit tiles)
  and the free coast; no actions, ships or warnings). Founding is started
  from the ship panel's "Found settlement" or the unsettled-island panel's
  "Found settlement here" when a ship carries the Trading Post cost: the
  Trading Post ghost opens (the camera stays when the island is wholly in
  view below the far zoom, else frames the whole island at the current
  heading, D-058); once it is placed the ship sails to that site's
  harbour (`sail_ship` with the `site`), the founding is pending (shown
  on that panel and the ship panel, cancellable, survives a reload) and
  `found_island` follows on arrival. The world opens on the start cog at sea with the first quest
  ("Choose your home island") as the hint.
  Hover shows a lightweight tooltip only; nothing is hover-only.
- **Route ribbons** are drawn only for the selected ship's route or while
  the route editor is open. All ribbons are the selection yellow and as
  wide as the selection ring; in the editor the edited route and the
  draft are opaque and the other routes translucent. Each leg follows
  the server's voyage around land (`RouteDisplay.paths`, D-058; the
  draft's legs those of the saved routes, else a straight line) from
  pier anchor to harbour and back. The draft dashes only the legs
  without a known voyage (the straight ones); legs with one are solid. Ships are always drawn.
- **Ships** are low-poly instances: with a leg, lerped between the two
  islands' pier anchors by `(now − depart_at) / (arrive_at − depart_at)`
  along the leg's `path` (pier anchor, harbour, waypoints, harbour, pier
  anchor).
  A ship handling at the Trading Post moors **stern-first at berth
  anchor i** of the Trading Post model (`berth_1..4` in the manifest; the
  middle pair first, bows fanned out to sea; PR #29) — the level unlocks
  1–4 of them; with **trading piers** (D-060) ships beyond the Trading
  Post's own berths moor at the piers (by building ID, at their
  `berth_*` anchors or along the pier's front row; a display convention —
  the server keeps one berth pool per island); ships `waiting_for_berth`
  sit out to sea past the moored
  bows; idle ships take the island's harbour berths; the shipyard's hull
  under construction stands on its `slip` anchor and the finished ship
  appears at the harbour; `anchored_unpaid` ships greyed. Legs and ribbons follow the
  server's `path`, which never crosses land (MECHANICS §9.1). Route ribbons carry direction arrows; the selected ship
  shows its route and ETA.
- **Manual shipment:** only through the ship panel's "Send…" dialog; the
  destination is chosen in its dropdown (no drag and drop, no map pick).
  Send needs a destination and cargo within the ship's slots — an empty
  ship may sail (the server accepts a shipment without cargo); over the
  slots the slot line turns to a warning and Send is disabled. The server
  still validates stock and slots.
- **Focused island** = the island under the camera centre, else the
  nearest; it drives the build-menu stock display, the highlighted tab and
  the unsettled-island panel, never a command.
- **Minimap** (HUD, top of the left column; `min(180 px, 25 % of the short
  side)`; collapsible and collapsed by default in phone portrait): north-up
  2D canvas with island outlines (one land colour, settled or not; cached),
  ship dots and the camera's viewport quad (rotates with the camera);
  tap/click pans the camera there (zoom kept). Since the cap of 80 (D-072)
  the minimap is the archipelago overview: the far view shows about one
  island, the minimap all of them. `role="img"` with a label.
- The HUD's world-map button opens the 2D world-map screen as an overlay
  (later).

## 2. HUD (as built after polish round 2, PR #24)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🪙 5000  🏠 32 │ 🪵 40 🔨 0 📦 0      ISLAND NAME 🌾🍎 ⛏1 📦1 ⚓140      ☰ │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌minimap+compass┐                                           ┌ panel ┐   │
│ └───────────────┘             3D canvas                     └───────┘   │
│ 🔨 / ⚠2 / 📜 / ⛵2 / 🗺  (side dock, vertically centred)                   │
├──────────────────────────────────────────────────────────────────────────┤
│ [Houses] [Production] [Public] [Harbor] [Roads]       build cards w/ thumbs │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Focused island** = the island under the camera centre. The top bar has
  three regions. **Left**, icons and numbers only: group 1 is **gold**
  and the island's **residents** (summed over the tiers); group 2 is the
  island's **construction-material stocks**. Each group opens a small
  popup on mouse hover and toggles it on click or tap (a press elsewhere
  or Escape closes it): gold shows two lines, the current amount
  and the balance per minute (▲ / ▼ and number, coloured); population shows per tier employed / total (workforce pool,
  D-035), the satisfaction, a red "short of workers" line when the
  residents cannot fill the jobs and the worst unmet need (tiers without
  residents or open jobs are hidden except the first); materials show stock of
  capacity. A negative balance colours the gold number red, and so does a tier short of workers for the population number. **Middle**: the
  focused island's **name** with its **resources** as icon badges
  (fertilities, deposits, free coast) as one button that opens the island
  card; unsettled islands show resources only and no materials. **Right**:
  the menu icon (account: register, install, credits, log out). There are
  no island tabs — islands are reached via the island name, the island
  card, the minimap and the lists.
- **Phone top bar** (polish 7; touch layouts under 1200 px): the
  materials stay on the first line after gold and residents — the first
  three with their stocks, then a "…" button that toggles the full list
  (it may wrap; the open state is not stored, the popup is unchanged);
  the island stays on the second line in portrait, where the account
  menu shows its icon only. Desktop is unchanged.
- **Side dock:** icon buttons stacked down the left edge, vertically
  centred between the top bar and the screen's bottom edge (it does not move when the build bar shows or hides), with no backing panel: Build menu, Warnings, Quests, Ships,
  Routes. The first toggles the build menu at the bottom (closed by
  default, the choice is remembered in the browser; hiding it ends an
  active build, road or demolish tool; the founding panel of an unsettled
  island stays); it is independent of the panels below. A count
  badge shows above zero (quests: rewards to claim). A click opens that
  panel in the right-hand slot (a sheet on phones), a second click closes
  it; they are mutually exclusive with each other and with the info,
  island, ship and route-editor panels. Opening one deselects the current
  building, ship or island (closing the list does not bring its details
  back). Details-in-place is a later task.
- **Phone (compact):** same content; portrait puts the island on a second
  row below gold / population / materials and the menu icon. The left
  groups wrap onto a further line when they do not fit (all construction
  materials, a longer language) and the menu icon keeps its slot at the
  right of the first line; nothing overlaps. The minimap
  collapses to its toggle (portrait starts collapsed); the compass shows
  with the expanded minimap only.
- **Build menu** (`ui/BuildMenu.tsx`, `display/buildMenu.ts`): one tab per
  content tier, **numeral and name** ("I Settlers"), the current tier (the
  highest the server reports unlocked) selected by default. A locked tier's
  tab is dimmed and shows its unmet unlock conditions as the subtitle
  ("88/120 Settlers · Build Chapel", only what is still missing); it can be opened to look ahead, its cards
  are dimmed and disabled with the lock reason. Inside a tab the cards stay
  one sideways-scrolling row, in groups with a small label at each group's
  start (empty groups are hidden): **General** (the tier's house where it
  can be placed, roads, then the Warehouse), **Production**
  (ordered along the chains: no inputs first, then by the depth of the
  recipe's inputs, content order within a step; fields are not listed),
  **Public** (the Market first — it serves a `public`-group need, D-065 —
  then the service buildings in content order) and **Harbor** (shipyard,
  pier, depot, then the quay, a road on the shallows that the server files
  under harbour). The groups follow the server's `category`, except
  houses, roads and the Warehouse, which are General; the Trading Post is
  never listed and houses of later tiers are upgrade-only.
  A card shows the name and the 128 px model **thumbnail** in its upper
  right corner, and two lines, each on one line; below them is a note row
  that every card has (so all cards are equally high in every tab): the
  lock reason of a locked tier, else empty. Lines never wrap
  and are never cut with an ellipsis: a long line makes the card wider.
  1. the cost: gold and each material with its good icon and tonnes,
     separated by dots `·`; a part the player cannot cover right now (gold, or the island's
     stock) is red. This is a display hint from the numbers the client has:
     items are never disabled for cost and the server decides. No stock
     numbers, no size or footprint;
  2. upkeep ("2.0 gold/min"), a dot `·`, then for production `in → out` with
     good icons (several inputs separated by commas; a farm: its field type without a count, "Wheat field →
     Wheat"; a mine or quarry: the deposit it needs, "Quartz deposit →
     Quartz"; a building over water without inputs, like the fisher: "Coast →
     Fish"; a card with no input at all shows no arrow), for a public building only the need category it serves
     ("Faith", no radius); the Market's reads "Supplies goods" with the goods
     group's icon (it serves the goods needs; `build.marketSupplies`). A missing fertility replaces this line with a red "Needs
     wheat fertility" (not what the island has; the placement ghost's hint
     keeps that).
- **Panels:** parchment with a 3 px dark-wood border and inset light-wood
  edge (10 px radius; build cards 7 px); status badges as wax seals (ink
  bands, parchment ring). Every panel has a fixed title row with an icon
  close button and a scrolling body; action buttons sit in a pinned
  footer.
- **Warnings panel:** list of bottleneck messages from MECHANICS §14
  (opened from the side dock or the insolvency banner), each clickable to
  focus the building.
- **"While you were away" dialog** after ≥ 15 min absence (see §4 and
  MECHANICS §12b): the interval in the player's local time ("25 Oct,
  21:36 – 26 Oct, 04:08 (6 h 31 min)", the end's day only when it
  differs), then headed sections: **Overview** (one line each for gold,
  "Gold: 184 → 4337 (+4153)", and the population per tier), one section per
  island (its name as the heading, a goods table: produced, consumed,
  lost, stock/capacity; no at-capacity badge — the stock shows it), pauses, **Ships arrived (n)** (one line per ship: "Gull: 42
  arrivals (Cormorant Rock 21, Mistle Haven 21)") and quests; the
  signature row has the title's brass line above it. **Quests button**
  with a badge; **insolvency banner**
  whenever anything is unpaid.

## 3. Placement

- Select item → the **building's model**, translucent, follows the pointer
  snapped to the grid (the old box only while the model loads); rotation
  via `R` / two-finger twist / the placement bar. Validity tint: light
  (ok), yellow (ok but no road adjacent), red (the server would reject it;
  e.g. missing deposit or fertility) with the reason as a tooltip. A
  building ghost (build, move and found tools; not fields, roads keep
  their own preview) also outlines its footprint with the plans' thin
  gold band (`render/outline.ts`), whatever its tint, so the tiles it
  takes read under a tall or translucent model. A new
  house may come out as a different variant than the ghost showed (variant
  by building ID; follow-up: a server-side preview hint).
- **Water-edge ghosts (D-062):** each rotated footprint column follows
  the served `water_rows` bounds. A per-tile overlay marks land where water
  is required, or water/non-buildable terrain where land is required, red;
  so is a land tile above terrace level 0 (D-075 §1, from the statics'
  `levels`; hint "Needs a low shore — its land tiles must be at sea
  level, not on a terrace", after the front/land hints); valid tiles keep the normal light/no-road yellow. Quays count as land,
  rivers never as sea. The model keeps its normal tint for a water-edge
  mismatch so one bad tile does not turn the entire building red. This is
  a display hint only: the server validates every placement.
- Roads: drag to draw; auto-connect; cost preview. While dragging, the
  L-path of the drag shows as a ghost on the ground, one mark per tile in
  the field paint's tints: green where the client expects a road, red
  where a rule rejects it (terrain, a building, off the shallows for a
  quay); a land road of a lower type (dirt under a paved drag) is marked
  green too and sent — the new road replaces it (MECHANICS §3) — while
  tiles with a road of the same or a higher type are left unmarked and
  are not sent (`display/roaddrag.ts`, a display hint; bridge shapes are
  the server's). The quay (D-060) is
  drawn the same way over shallow water; a drag that leaves the shallows
  is not sent (toast; display mirror of the rule, `display/quay.ts`).
  Quays render as a stone wharf with a timber fender and a bollard every
  third tile, and in the paved road's colour on the minimap.
- **Fields** (D-051 part 4): fields are not in the build menu. The farm
  card has a fields block (active / required with a bar, placed and max, a
  warning line when fields are not connected; no field list) and **"Add field"**, which enters a field tool bound to that
  farm ("Paint wheat field (3 gold each)"): one field per tap, or a
  **rectangle drag** (PR #29, D-054) that paints every tile of the
  rectangle in one `place_fields` call on release (≤ 512 tiles; larger
  rectangles are clipped from the start corner). While dragging every
  tile shows the client hint (terrain, fertility, free, edge-adjacent
  through the rectangle's own valid tiles) and the status line counts
  "n / 140 · +k · m over the max"; tiles the server rejects flash red.
  Pasture modules (3×3) paint on a 3×3 step grid. **Remove fields** by
  right-click/long-press on Paint (rectangle drag → `demolish_fields`);
  the Demolish tool dragged over fields removes the fields of every farm
  under it (and the roads and plans, below). The ghost is a hint only; the server's per-tile result is
  the truth (D-027). The tool stays active until max or Esc/right-click. Inactive fields
  are drawn desaturated with the `not_adjacent` status (and a yellow mark);
  selecting a farm or a field tints its farm and fields green like a
  selected building; the field ghost is the field's translucent model; a field card says "Counts for its farm" (an inactive one keeps "Not connected to its farm" and its fix) and offers Demolish only (no
  Move).
- The lumberjack (D-059) is a farm: its card has the fields block and
  "Paint Tree plot" (1 gold each), painted on open land like crops.
- The civic buildings (city guard, fire station, surgery; D-060) are
  public buildings in the Public tab; the trading pier and depot are in
  the Harbor tab, water-edge like the Trading Post (quays count as
  coast; their ghost shows the free shallows tint with the quay tool).
- Public (service) buildings: a collapsed Details with the service radius (tiles) and upkeep; selecting one tints the houses it serves green (the selection tint), and selecting a house tints the buildings serving it (the server's `served_by`). A **radius ring** in gold (D-071: the colour of plans, apart from the collectors' yellow reach ring below) outlines the service radius around a public building's or the market's ghost (level 1; a moved one at its level), else around the selected one at its current level, the same measure as the reach (nearest footprint tiles, `reachOutline`); none at the far view. The ghost tints the houses it would serve (client hint from the content radius; the server's `served_by` is the truth once built): `wouldServe` in `display/served.ts` takes the houses on the ghost's island whose nearest footprint tile is within the level-1 radius (a moved building: its own level) of the ghost's nearest footprint tile; it does not check the road connection or paused state, because the display has no connectivity, so a tinted house may still be unserved. The tint follows the ghost and clears when it leaves the island or the tool closes. The same hint for other ghosts (`ghostRelated`): a house tints the service buildings on its island whose own radius (their current level) reaches it; a Warehouse or Trading Post ghost tints the producers (buildings with a recipe) on the island within its reach at its level (D-069 §1: nearest footprint tiles, the server's measure; a moved one keeps its level), a producer ghost the Warehouses and the Trading Post whose reach at their current level covers it. Who delivers to whom is the nearest of those by road, which the display cannot compute, so the latter two mark candidates in reach, not the assignment (`assigned_warehouse_id` is the truth once built). A **reach ring** (a thin band in the selection yellow, drawn over the scene like the deposit highlight) outlines the reach around a Warehouse or Trading Post ghost, else around the selected one (whose producers are tinted as before); none at the far view. Reach and radius ring are one ring (`render/reachring.ts`): the ghost's first, else the selected plan's (gold, D-071 §4), else the selected building's. The Trading Post and Warehouse cards list Reach and Upkeep of the current level, and "Upgrade to level N" the next level's reach and upkeep with the lock reason of a level whose tier is not unlocked ("Requires Citizens", like the build-menu tabs).
- Producers and collectors: selecting a producer tints the Warehouse or Trading Post it delivers to (`assigned_warehouse_id`) green, selecting a Warehouse or Trading Post tints every producer delivering to it, not their fields (`client/src/display/served.ts`, the same selection tint).
- Confirm on click/tap; the server validates and responds; the ghost becomes
  the building when the response arrives (round-trip ≈ 100 ms; show a brief
  "building" animation regardless).
- Demolish mode with confirmation for anything costing > 100 gold; refund
  shown. **Dragging a rectangle** with the Demolish tool removes what is
  cheap to lay again and never a building: the fields under it (one
  `demolish_fields` per farm), the plans (D-071) and every road and
  planned road tile (one `demolish_roads`, MECHANICS §3; 50 % refund per
  road tile, rounded down per tile), without confirmation. While
  dragging, the affected footprints and road tiles tint red and the
  status line counts them ("Remove 3 fields, 1 plan, 12 road tiles";
  "Nothing to remove" over none). At most 512 tiles, like field
  painting.
- **Move** (D-042): "Move" in the info panel (or drag a selected building)
  lifts it into a ghost that follows the pointer with the same validity
  colours; click/tap places it, Esc cancels and the building stays. Free;
  no confirmation. Roads cannot be moved. The build bar also has a
  **Move tool** (icon button next to Demolish): pick the tool, click a
  building (the one under the pointer carries the hover mark), place its
  ghost (validity tint, R rotates; on touch tap and Confirm), and the tool
  comes back for the next building; Esc or a right click leaves it.
  Same rules as the card's Move, except that clicking a field picks its
  farm (fields follow their farm; the hover mark is on the farm too, and
  a planned field picks its farm or planned farm); roads are not
  buildings to pick.
- **Planning** (D-071): the build bar's **planning toggle** (pencil and
  ruler icon, before Move and Demolish; pressed while on) switches every
  placement — buildings, road drags, fields painted or tapped — to a
  **plan**: the same commands with `planned: true` (MECHANICS §2
  "Planning"), free, without the tier lock, so the cards of a locked
  tier can be picked while planning (they keep their lock note). The
  tool hint adds "Planning: this creates a plan" (touch: the placement
  and road bars start with "Planning ·"). The toggle is a session
  setting; the plans stay on the server across toggling, sessions and
  devices. Turning it off ends a build tool of a locked tier. Plans are
  drawn in the ghost material — the model translucent and untinted — with
  a thin gold outline of the footprint, and nothing else: no slab or box
  under a planned building (while its model loads only the outline shows);
  planned road tiles are translucent slabs with the gold
  outline along the planned road's edge (`render/plans.ts`). A plan
  paints no yard into the ground (D-068): the yard appears once the
  building stands (only the placing ghost previews it). No
  construction stage, smoke, status badge or life-layer figure, and none
  at the far view (not in the far mesh or the far road layer). Plans
  reserve their tiles in the client hints too (`display/plans.ts`): a
  road drag or field ghost over a plan is red; in planning mode the road
  drag skips tiles that carry a road or a planned road (a planned road
  goes on free tiles only), and planned fields chain their farm and
  count toward its maximum. A real road dragged over a planned road
  replaces the plan.
- **Plan cards** (D-071 §4, `ui/PlanCard.tsx`): a click (or long
  press) at near LOD on a plan opens its card — **"Planned: X"** with
  "Building costs" in build-menu format (the server's `plan_cost`, a
  planned farm's fields included; parts the island cannot cover now in
  red), the server's reason as "Can't build now: …" when building would
  fail, and **Build · Move · Demolish** (Build is never disabled: the
  server decides; a built plan selects the new building). A planned
  farm's card counts its planned fields and paints more (the field tool
  on the plan: its fields are always planned, free). A planned field's
  card names its farm and builds the farm's planned fields (no Move: it
  follows its farm). A planned road tile opens **"Planned road · N
  tiles"** for its segment (the 4-connected planned tiles of one type):
  type, cost, reason, Build · Demolish. A real farm with planned fields
  shows "N planned fields", their cost and **Build planned fields** on
  its card. A selected planned road segment carries a hover mark on its tiles, a selected
  planned building none (the plate would show as a pale square under its
  translucent model); a selected planned
  Warehouse or Trading Post shows its level-1 reach and a planned
  public building or market its level-1 radius as a **gold ring**.
  Plans never count in the served/served-by hints (`display/served.ts`
  reads `buildings` only). The Move tool picks plans like buildings; the
  **Demolish tool** removes a clicked plan or planned road tile at once
  (free, no confirmation), and its rectangle removes the planned
  buildings and fields under it with the fields and the planned road
  tiles with the roads (`demolish_roads`).
- Buildings may be placed without a road; the ghost shows yellow ("not
  connected") rather than red, and the warnings panel lists the building
  until a road reaches it. A producer on a road whose collectors are all
  too far (D-069) shows "Out of reach" (status `no_collector_in_reach`:
  the not-connected colour with its own distance icon) and the warnings
  panel lists it as "Out of reach of any warehouse" with the fix "Build a
  Warehouse nearby or upgrade the Trading Post or a Warehouse". The ghost is red with the reason for the
  server-side hard failures the client can know from content and island
  data without rules: missing fertility tag, no deposit under the
  footprint, locked tier, upgrade-only house.
- **Deposit highlight:** while a mine or quarry (a building with
  `requires_deposit`) is the build tool, the tiles of its deposit kind are
  tinted in the selection yellow on every island drawn in detail (near
  and mid zoom; drawn over the rock and outcrops so they are never
  hidden; a slot with a building on either tile is taken and left out)
  with one floating **deposit marker** per free slot (a slot is two
  4-adjacent deposit tiles, MECHANICS §2; the build menu's deposit icon
  on a parchment badge with an ink rim, status-badge style, facing the
  camera centred between the slot's two tiles, drawn over the scene),
  and at far zoom the label of every island with that deposit carries
  the deposit's icon and slot count. Both go away when the tool closes. Display only (D-027):
  the deposits come from the payload (`display/deposits.ts`).

## 4. Info panel content

**Production building**

- Name, status icon + sentence + suggested fix (MECHANICS §14).
- Inputs: per good, this building's `consumption` in t/min (one row like Output; the island stock and net rate are in the Trading Post card).
- Output: `production` in t/min (the final rate, all factors included).
- A collapsed **Details** section (closed by default): one row per value, each on one line
  (cycle length in seconds, efficiency %, throughput factor, workers as the
  workforce factor in % (the shortage itself is the status sentence), upkeep like a ship's (`gold/min`, 0 while paused), the assigned collector by name (click to
  select), transfer delay, buffers). Farms show
  a fields block above it only when it has something to say: a warning
  when fields are not connected and "Add <field>" while the farm is
  below its maximum (equal to the requirement); the field count is the
  farm's efficiency in Details.
- Buttons: pause/resume, move, demolish, pinned in a footer below a divider (only the content above scrolls).
- The card never grows the layout: on the desktop it takes at most the
  map row between the top bar and the build menu (the overlay's middle
  row is `minmax(0, 1fr)`) and a long body — the Trading Post's
  inventory — scrolls inside its own box, so the open build menu stays
  whole at the bottom.

**House**

- A "Residents" heading, then two rows like the producer Details: "Residents  ↑ current → target / max" (the arrow is the growth direction; the target is the server's `residents_target`, D-074 — at the target the line reads "→ 10 / 15") and "Satisfaction  %"; no bars.
- No "Needs" heading: **Goods** and **Public buildings** are section headings
  like Residents. In Goods each category appears once as a heading row (icon
  and name), also with a single need. Its needs, one per tier the house
  carries (Food of its own tier and of the lower tiers), are below it, aligned
  with the name, the lowest tier first, each named by its goods ("Fish",
  "Roast beef or Oysters") with the server's fulfilment %. No tier names
  and no aggregate per category (the client computes no rule). Public
  buildings: one row per category (icon and name, fulfilment %). The reason if
  not met is the tooltip ("short supply", "no supply on the island", "out of
  range"); a building or chain need lists its buildings there.
- "Upgrade" (not on a house of the highest tier): the cost line of the
  upgrade — the next tier's house — like the build menu's: "150 gold ·
  [planks] 5 t · [stone] 3 t", goods by icon (name and stock in the
  tooltip), what the balance or stock does not cover red.
- Upgrade button; when it is disabled, the server's reason is one short line below all footer buttons (they keep their size) and the button's tooltip; none on a house of the highest tier, like the levelled buildings at their last level.

**Trading Post**

- A "Details" heading with rows (no bars): Level `n / max`, Capacity `per
  good` (with depots: "+ n in depots", the island total is the
  inventory's), Throughput `t/min`, Load `%`, Berths `free / total free`
  (with trading piers: "(n at piers)"; with ships queued for a berth: " · n
  waiting"). There is no per-ship list: the ships are in the ships panel.
- "Inventory": one row per good, icon and name, `stock / capacity` and the
  signed net rate (green above 0, red below, plain at 0); no header row, no filter yet.
- A collapsed "Producers (n)" like the Warehouse's.
- "Upgrade to level n" (not at the last level): one grey line with the next
  level's numbers ("500 t capacity per good · 2 berths · 55.0 t/min
  throughput") and the cost line like the build menu's (gold, then each
  good as icon and amount — the name and stock are the tooltip — " · "
  between the items, red when short). The **Upgrade** button is pinned in the footer.

**Trading pier** (D-060)

- Rows: Berths "+n" (what the pier adds) and the island's berths free /
  total (" · n waiting" while ships are queued); no size row; Move and Demolish in the footer (no levels, never paused).

**Depot** (D-060)

- Rows: Level `n / max`, Adds `capacity per good`, Island capacity (the
  Trading Post's plus every depot's). "Upgrade to level n" like the
  Warehouse's (the next level's capacity and cost; locked below its
  tier); the **Upgrade** button is pinned in the footer.

**Shipyard**

- Status "Idle" or "Building a Cog · ready in 1:42 min" (no bar); a pending
  order adds the second status line "Canceling the order returns 50 % of
  the materials." and **Cancel order** sits in the pinned footer.
- Always (also while an order runs, then the Order buttons are disabled), with
  no heading, a divider above and between the entries and one entry per
  buildable type (content order): name and Order; cargo, speed (×) and upkeep; one line of
  gold, the goods and the build time with " · " between them. Gold and goods
  the island is short of are red (Order stays enabled when idle, the server
  rejects an unaffordable order).

**Warehouse**

- A "Details" heading above the rows (no bars): Level `n / max`,
  Throughput `t/min`, Load `%`. No capacity row — capacity is the Trading
  Post's.
- A collapsed "Producers (n)": one row per assigned producer, the name a link
  that selects it (no ID); "None yet" without any. All producers are listed (the card body scrolls).
- "Upgrade to level n" (not at the last level): one grey line with the next
  level's numbers ("55.0 t/min throughput") and one cost line like the
  build menu's (gold, then each good as icon and amount, " · " between the
  items; what the balance or stock does not cover is red). The **Upgrade** button is pinned in the footer next to Move and
  Demolish (a warehouse cannot be paused). The Trading Post shares the
  producers list, the upgrade preview and the footer button.

**Ship** (ship info panel; the Ships list only selects)

- The title is the ship's name (D-055) with a pencil button; the pencil
  turns the header into a name input with ✓ (rename, saved at once) and ⊗
  (cancel, Escape) icon buttons — the island card's rename pattern; the
  close button is hidden meanwhile. The ship type ("Cog") is a small line
  below the title, then a "Details" heading (as on the Trading Post and
  Warehouse) above the rest. Everywhere else (Ships list, route editor, toasts,
  dialogs, away summary) a ship is shown by its name only.
- Status line shared with the list ("On route: name · arrives in …",
  "Shipment · …", "Idle · at …"), the from → to islands of a leg, upkeep, speed (×, from the ship type),
  slot capacity, under a "Slots" heading (no divider) one box per cargo
  slot (good icon, amount / slot size),
  pending founding and berth-wait notes.
- Buttons: "Assign to route…" (an inline picker of the saved routes; routes
  are created only in the Routes list, the picker links there when there
  are none), unassign, "Send…" (manual shipment dialog), found settlement,
  scrap; later: send on expedition (Harbormaster).

**Routes list** (panel): per route its name, then "Island 1 → Island 2
(15:00 min)" (the loop time), then "Ships: n". Clicking a route opens it in
the route editor, which has Delete next to Save while no ship is assigned.
"+ New route" ends the list. The ship panel's route picker shows the same
three lines per route.

**Route editor** (panel; the Routes list opens it)

- Opened from the Routes list; stays open while the camera moves.
- The title is the route name ("New route" for a new route) with a pencil
  button that turns the header into a name input with ✓ (apply the name to
  the draft; it is saved with Save) and ⊗ (cancel) icon buttons, as on the
  island card. A name of spaces only becomes "Route <id>". Stops are chosen from **island pickers** (each option shows
  the island name and "(unsettled)" where it applies; the stock is
  shown per good below);
  a stop is one card: number, island picker, move up/down and remove, then
  one list of goods: good | Load / Unload | amounts in whole t (a load:
  "top up to" and an optional "keep" on the island, D-070; an unload: an
  optional most per visit, empty shows "all"; both ≥ 0, empty is no
  limit) | the island's current stock | remove, and a
  "+ good" link (loads and unloads are still separate rules in the route). A "+ first stop…" / "+ stop…" picker adds stops, never a click
  on an island in the world. Server errors (e.g. consecutive stops on one
  island, `route_invalid`) are shown as toast and inline.
- Nothing is shown for effects before the first save. A saved
  route shows the per-island **net effect** (MECHANICS §9.2): the
  server's numbers for the saved version, labelled "estimated";
  per-minute values are 0 until a ship is assigned. The loop time is shown
  in the Routes list only. The effects and the ships are set off by dividers;
  the assigned ships are listed with a remove (✕) button that unassigns,
  and a "+ assign…" dropdown of the idle ships assigns one (the ship
  panel can assign too).
- Save (and Delete while no ship is assigned) are pinned below the
  scrolling body.
- Selecting a ship or island while the editor is open **suspends** it:
  their panel shows, and a
  "Back to route editor" bar resumes it as the only side panel; the draft
  survives. Esc steps back one level per press (dialogs → island tool →
  editor → selection).

## 5. World map screen

Tabs: **Neighbours** (cards with coat of arms, tier, population, distance,
travel time, visit/offer buttons), **Offers** (board + my offers, filters by
good), **Expeditions** (ship picker, duration, ETA), **Contracts**,
**Leaderboard**, **Achievements**. Pending arrivals show countdowns.

## 6. Mobile (implemented in M3)

- Minimum supported: 360 × 640 CSS px portrait and landscape.
- **Layout modes** from a pure function of width, height and pointer
  coarseness: `desktop`, `tablet` (desktop layout with touch gestures),
  `phone-portrait`, `phone-landscape`. Portrait phones and landscape phones
  narrower than 640 px use **bottom sheets** for every side panel (info,
  ship, island card, route editor and its resume bar, lists, quests): one
  sheet at a time, `role="dialog"`, drag handle with snap points at 20 /
  50 / 90 % of the area below the top bar (opens at half; tap or Enter on
  the handle cycles; dragging below the peek closes). A sheet has no header
  of its own: the panel's title (underlined) and its icon-only close
  button are the same as on the desktop side panel; the title row stays in
  place and the panel's content scrolls beneath it (every panel has a close button,
  including the building info panel). Focus moves in,
  Tab trapped, focus returned to the opener on close. Wider landscape
  phones get a narrow side panel; if it would be shorter than ≈ 240 px the
  hint bar hides and the insolvency banner is limited to one line.
- Compact top bar: see §2 (icons and numbers, the first three materials
  and "…", island on a second row in portrait; popups open on tap). Build menu: the
  desktop look (folder tabs, parchment cards, icon-only Move and Demolish
  buttons pinned at the right of the tab row behind a divider), with ≥ 44 px tabs and cards on touch; short landscape
  phones keep the stacked layout with smaller cards and thumbnails. Hints and banners stack below the top
  bar; toasts below the top bar. A tier unlock toast is clickable: it
  opens the build menu on that tier's tab (other toasts only dismiss).
- **Gestures** (one pointer-event recogniser; input type decides per
  gesture, pen = mouse): one-finger drag pans, draws a road with the road
  tool (ships are not draggable; dragging one pans); pinch pans by its centre
  and zooms about it with any tool, and pinch-out at the island's maximum
  zoom feeds the same zoom-out counter as the wheel; two-finger rotate
  steps a ghost by 45°; tap selects; long-press (450 ms, 10 px slop)
  inspects a ship/island/building and never acts, even with a tool
  active; a second finger cancels a one-finger press/drag and nothing is
  recognised until all fingers are up. UI elements stop propagation so
  panel interaction never pans the camera; browser defaults
  (pull-to-refresh, double-tap zoom, text selection, callouts) are
  suppressed on the game surface only.
- **Placement on touch:** a tap sets the pending tile and the ghost moves
  there; a **placement bar** (Confirm / Rotate / Cancel) commits; a tap
  alone never places. Mouse keeps click-to-place. **Demolish mode** shows a
  persistent tinted bar ("⚒ Demolish mode — tap a building", Done) and
  keeps the > 100 gold confirmation; the road tool shows a road bar with
  Done.
- Hit targets ≥ 44 × 44 px for every control in touch layouts (audited by
  an e2e test); no hover-only information; safe-area insets respected;
  dialogs fit `100vw − 16 px` and scroll internally.
- Accessibility baseline: focus order through HUD and sheets, visible
  focus rings, aria labels on icon buttons; Lighthouse accessibility 100
  on desktop and phone (island view).

## 6a. Theme (art task 2)

- Colours come from `assets/palette.json` through generated CSS custom
  properties (`client/src/theme/palette.css`); the renderer reads the same
  file. Parchment panels with a dark-wood border and brass accent line,
  dark-wood top bar and build bar, Cinzel titles, Source Sans 3 text,
  the tier tabs of the build menu, parchment toasts, the away summary
  as a letter, status as a wax-seal badge; bottom sheets, minimap and
  dialogs share the theme. Icons for goods, needs, statuses and tools from
  the pinned game-icons set; a **Credits** dialog (account menu) carries
  the attributions.
- Post effects are overlays above the canvas and below labels/HUD:
  vignette always, warm grading at high quality; both `pointer-events:
  none`.

## 7. Feedback and clarity rules

- Every number in the UI is a server number or a linear extrapolation of one;
  never a client-side rule result (D-027).
- Every negative state has a cause and a suggested fix in one sentence.
- Rates are always shown per minute; quantities as integers. Goods are measured
  in tonnes, abbreviated `t`, everywhere: rates `{rate} t/min`, stocks `{n} t`,
  capacities and buffers `{n}/{cap} t`, ship cargo and slot sizes, costs,
  rewards and trading offers (catalogue keys `unit.t`, `unit.tRatio`,
  `unit.tPerMin`, helpers in `client/src/display/format.ts`; the German text
  uses the same `t`, with the locale's decimal separator and a no-break space
  before the unit). Gold and population carry no unit.
- Confirmation only for irreversible actions with cost; everything else is
  one tap.
- Colour-blind-safe palette for validity and status; icons always accompany
  colour.

## 8. Rendering notes (client)

- Terrain in chunks; buildings as instanced low-poly meshes keyed by content
  ID (procedural placeholders first, GLB later); carts and ships as moving
  instances positioned from timers; simple lighting, no shadows at launch.
- The renderer consumes a display model built from `state + rates +
  timestamps`, refreshed at 4 Hz and interpolated per frame; re-fetch on
  WebSocket push or at `next_change_at`.
- Target: 30 fps on a mid-range Android phone with a dense two-island scene
  (first playable budget; see FIRST_PLAYABLE.md). Measures taken in M3:
  render DPR capped at 1.5, status icons as thin instances (one draw call
  per status), allocation-free cart updates; the (since retired)
  dense synthetic fixture ran at 27 draw calls (36 with the life layer;
  `?life=0` disables it); `?stats=1` on `make dev FIXTURE=played` (dev builds only)
  shows live instance and particle counts.
- **Picking is mesh-first** (polish 7): a tap or long press at near and
  mid LOD selects the building, field or plan whose model the view ray
  meets first — one box per building at its model's rotated bounds on its
  ground (the selection frame's and shadow blob's box; the models are
  merged per chunk, so no per-triangle ranges) — and only without such a
  hit the building or plan whose footprint holds the ground tile under
  the pointer. A roof thus selects its own house, not the one behind it
  whose footprint the ray reaches on the ground. Touch adds 0.2 tiles of
  tolerance around each box. Ships (screen radius) and far labels keep
  their own picks; tools still act on the ground tile
  (`display/raypick.ts`).

## 9. The Almanac (public reference)

- **Route:** `/almanac/<section>[/<id>]` (sections `overview`, `buildings`,
  `goods`, `needs`, `ships`, `quests`, `islands`; the ID is a content ID, a
  tier for overview/needs, a size class for islands). No login and no
  world: `Root` mounts the component tree of `client/src/almanac/` when
  the pathname starts with `/almanac` (a pathname check and the History
  API, no router library; back/forward work, links are real anchors), the
  start screen carries an "Almanac" link, and the dev server, `vite
  preview` and the Caddy `try_files … /index.html` fallback serve the
  deep links. The tree takes only the content (`AlmanacView`) or fetches
  it (`Almanac`), so the game can open it later.
- **Generated at runtime** from `GET /api/v1/content`: nothing is
  hardcoded (no tier, building or good names). `model.ts` turns the
  payload into view models; the only arithmetic is the one of the
  CONTENT tables (per-minute rates from cycle times, a full house's tax,
  shares as percent). Unknown or missing fields render nothing.
  `questText.ts` words every objective kind of MECHANICS §12a. The
  Islands page shows each size class's size, count, per-island
  fertility and deposit ranges, shape (plain, massifs, rivers, terraces,
  islets; D-072) and the home class (served since D-059's fixture
  step); content the payload does not carry (the
  archipelago-wide pools, the home guarantees, the schema version) is
  read defensively and shown only when present. Building pages show a
  depot's level table, a pier's berths and the quay's site (shallows).
  The Ships page ends with a Routes chapter that words the route rules
  of MECHANICS §9.2: unload first, then load; "top up to", the optional
  keep on the island and the optional most unloaded per visit (D-070).
  The Overview's "When gold runs out" chapter words the auto-pause of
  MECHANICS §7: the order, the transitive supply-chain guard (D-075 §5)
  and when a producer loses it (an input with no producer and no stock),
  and the resume reserve, whose minutes come from the served rules
  (`auto_resume_upkeep_ms`; the line is left out without them).
- **Look:** the HUD's parchment in a dark-wood frame, Cinzel headings,
  brass accent; left navigation on desktop, sticky tabs on the phone;
  a search box filters buildings, goods, ships, quests, tiers and island
  classes by name; building and ship thumbnails come from
  `/models/thumbs/<id>.png` with a fallback box. Headings per section,
  `aria-current` on the section, the global focus ring, link colour from
  the theme (≥ 4.5:1 on parchment).
- **Tests:** Vitest on the view models against `content/old_coast` and the
  `server/testdata/content` fixtures (every building, good, need, ship and
  quest exactly once, every reference resolves, every quest condition
  formats) and a rendering smoke test of every page.

## 10. Language (D-061)

English is the source language and the key; German is the first
translation. Two sources, one switch:

- **Content text** (names of tiers, goods, buildings, needs, ships, size
  classes, the region; quest titles and texts; island names) comes from
  `GET /api/v1/content?lang=<code>` (CONTENT §11, "Locale files"); the
  client asks in its current language and fetches again when it changes
  (`GameSync.loadContent`, the almanac's `useEffect`). Island names and
  ships' default names ("Cog 2") are stored in English in the world;
  `display/names.ts` shows them in the language through the served
  `island_names[{source, name}]` and `ships[].source_name`. A name the
  player chose is shown as typed.
- **Client text** is the catalogue `client/src/i18n/`: `en.ts` holds every
  key (`as const`, so keys are typed), `de.ts` is typed to have every key
  (a missing German text is a compile error), `index.ts` has `t(key,
  params)`, `tOr` (server codes: `error.<code>`, `reason.<code>`, `quest.<kind>`,
  `ship.state.<state>`; the fallback is the server's message), `tRich`
  (elements inside a text, `{link}`) and `inSentence` (see below). Texts
  take `{name}` placeholders and `{count, one{…} other{…}}` plurals
  (Intl.PluralRules; only the forms English and German share). German
  capitalises nouns, English lowercases a content name mid-sentence: a
  text that puts a name in a sentence takes `{name}` (lowercased in
  English through `inSentence`) and, if German needs it capitalised,
  `{Name}`; the caller passes both. Numbers, durations and dates use the
  language's locale (`currentLocale()`, `display/format.ts`).
- **Choosing the language:** `?lang=` (dev and testing) → the browser's
  stored choice (the switch) → the account's → `navigator.languages` →
  English. The switch (`ui/LanguageSwitch.tsx`, one button per language,
  named in its own language) is in the account menu, on the start screen
  below the card and in the almanac footer; on the phone the account menu
  is the same dropdown. A change applies at once (`<html lang>`, every
  screen re-renders through `useLanguage`) and is stored in the browser;
  in the account menu it is also saved with `PATCH /auth/me {language}`
  (ARCHITECTURE §4.4). After a login the account's language applies here
  unless the player picked one on this page, which then goes to the
  account (`api/auth.ts syncAccountLanguage`). Tests run in English
  (`i18n/test-setup.ts`).
- **US English:** the English texts — the catalogue's and the content's
  (names, quest titles and texts, descriptions) — use American spelling:
  harbor, center, color, jewelry, canceling, -ize. Keys and content IDs
  may keep a British word (`build.group.harbour`, `jewellery`; IDs are
  never renamed) and island names stay as they are.
  `i18n/spelling.test.ts` fails on the British spellings it knows.
- **Maintenance (D-075):** the running cost of buildings and ships reads
  "Maintenance" (DE "Betriebskosten") wherever a player sees it — cards,
  ship panel, shipyard list, almanac level table, insolvency banner,
  away summary; the build menu shows the rate alone (`2.0 gold/min`).
  Keys, code, API fields and the docs keep `upkeep`.
- **Adding text:** add the key to `en.ts` and `de.ts` in the same change
  (the German one is required to compile) and use `t()`. The ESLint rule
  `i18n/no-hardcoded-strings` fails on JSX text, prose string literals
  and text attributes (`title`, `alt`, `placeholder`, `aria-*`) in
  `src/ui` and `src/almanac`; a justified exception is marked
  `// i18n-ignore: <why>` (today: the game's title, Roman numerals, dev
  fixture data and the sync layer's `"island <id>"` key). German texts
  are longer: layouts must not rely on English widths (flex-wrap,
  `min-width: 0`, no fixed-width buttons); check with
  `make shots QUERY=lang=de`.
