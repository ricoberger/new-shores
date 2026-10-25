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
  not change while turning). **Rotation is free** (D-051, as built):
  right-drag (45° per 120 px; the right button no longer pans, the middle
  button does), two-finger twist about the fingers after a 12° dead zone
  (with a ghost tool the twist rotates the ghost instead), `Q`/`E` in 45°
  steps; on release the azimuth eases (≤ 250 ms) to the nearest 45°; the
  sun stays world-fixed; the ease never blocks input. The **compass** in
  the expanded minimap's corner (hidden while the minimap is collapsed on phones) shows
  the real heading on the north-up map; drag the ring to turn, tap/Enter
  = "Reset view" (default heading, which looks north-east). No separate
  rotate buttons. Building rotation stays fixed to the world (D-042).
  **Jumps** (island tabs, island card "Go to island", Enter, founding,
  warnings panel) move the camera in ≤ 350 ms and zoom in to 18 only when
  the camera is farther out; minimap taps keep the zoom. A gesture in
  progress when a jump starts is cancelled without its release action; a
  press begun during a jump is ignored until all fingers lift; wheel and
  pinch are ignored during the jump.
- **LOD** is a pure function of the half-extent and the previous level
  (no timers): near → mid above 30, mid → near below 27, → far above 54,
  far → mid below 47 (far begins where a 2×2 footprint is ≈ 12 px tall on
  a phone). *Near:* full models, roads, fields, carts, status icons,
  construction hulls, foam. *Mid:* full models, roads and fields, no carts
  or status icons. *Far:* lite models (≈ 25 %), the same diorama ground,
  labels and settled badges; unsettled islands desaturated (D-050). All
  geometry is built once per island; zoom only toggles. Islands outside
  the frustum are not rendered; ships, route ribbons and the selected
  ship's ETA badge render at every level (ships ×2 near/mid, ×4 far). The
  level is exposed to tests via the hook.
- **Sea and haze:** a scrolling-noise sea plane sized so every viewport
  corner stays on water at the clamped bounds in all rotations, fading into
  a haze colour toward the edge; the clear colour is the haze.
- **Labels** are keyboard buttons with the island name and badge, hidden
  near the canvas edge; pointer taps resolve **ship → label → land**. A
  label tap is an island tap at every LOD: it opens the **island card** (population, Trading Post fill, warnings
  count, fertilities, deposits, coast; **"Found settlement here"** on an
  unsettled island when a ship carries the Trading Post cost — the ship
  sails there first (`sail_ship`), the founding is pending (shown on the
  card and the ship panel, cancellable, survives a reload) and the
  Trading Post ghost opens on arrival; "New route from here"; "Go to
  island"). The world opens on the start sloop at sea with the first quest
  ("Choose your home island") as the hint.
  Hover shows a lightweight tooltip only; nothing is hover-only.
- **Route ribbons** are drawn only for the selected ship's route or while
  the route editor is open. All ribbons are the selection yellow and as
  wide as the selection ring; in the editor the edited route and the
  draft are opaque and the other routes translucent. Ships are always
  drawn.
- **Ships** are low-poly instances: with a leg, lerped between the two
  islands' pier anchors by `(now − depart_at) / (arrive_at − depart_at)`.
  A ship handling at the Trading Post sits at **pier slot i** (tile i of
  the front water row, one tile out, bow to sea); ships `waiting_for_berth`
  sit one tile further out between two slots, two tiles apart; idle ships
  take the island's harbour berths; `anchored_unpaid` ships greyed. Legs and ribbons are straight lines and may cross land
  (dressing task). Route ribbons carry direction arrows; the selected ship
  shows its route and ETA.
- **Manual shipment:** only through the ship panel's "Send…" dialog; the
  destination is chosen in its dropdown (no drag and drop, no map pick).
- **Focused island** = the island under the camera centre, else the
  nearest; it drives the build-menu stock display, the highlighted tab and
  the unsettled-island panel, never a command.
- **Minimap** (HUD, top of the left column; `min(180 px, 25 % of the short
  side)`; collapsible and collapsed by default in phone portrait): north-up
  2D canvas with island outlines (settled/unsettled tint, cached),
  ship dots and the camera's viewport quad (rotates with the camera);
  tap/click jumps the camera. `role="img"` with a label.
- The HUD's world-map button opens the 2D world-map screen as an overlay
  (later).

## 2. HUD (as built in the polish pass)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🪙 5000  🏠 32 │ 🪵 40 🔨 0 📦 0      ISLAND NAME 🌾🍎 ⛏1 📦1 ⚓140      ☰ │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌minimap+compass┐                                           ┌ panel ┐   │
│ └───────────────┘             3D canvas                     └───────┘   │
│ 🔨 / ⚠2 / 📜 / ⛵2 / 🗺  (side dock, vertically centred)                   │
├──────────────────────────────────────────────────────────────────────────┤
│ [Houses] [Production] [Public] [Harbour] [Roads]      build cards w/ thumbs │
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
- **Side dock:** icon buttons stacked down the left edge, vertically
  centred between the top bar and the screen's bottom edge (it does not move when the build bar shows or hides), with no backing panel: Build menu, Warnings, Quests, Ships,
  Routes. The first toggles the build menu at the bottom (closed by
  default, the choice is remembered in the browser; hiding it ends an
  active build, road or demolish tool; the founding panel of an unsettled
  island stays); it is independent of the panels below. A count
  badge shows above zero (quests: rewards to claim). A click opens that
  panel in the right-hand slot (a sheet on phones), a second click closes
  it; they are mutually exclusive with each other and with the info,
  island, ship and route-editor panels. Details-in-place is a later task.
- **Phone (compact):** same content; portrait puts the island on a second
  row below gold / population / materials and the menu icon. The minimap
  collapses to its toggle (portrait starts collapsed); the compass shows
  with the expanded minimap only.
- **Build menu:** categories → items with cost, upkeep, lock reason and a
  128 px model **thumbnail**; items are never disabled for cost.
- **Panels:** parchment with a 3 px dark-wood border and inset light-wood
  edge (10 px radius; build cards 7 px); status badges as wax seals (ink
  bands, parchment ring). Producer panels show workforce as "needs 4
  Settlers · 16 available on this island (working at n %)".
- **Warnings panel:** list of bottleneck messages from MECHANICS §14
  (opened from the side dock or the insolvency banner), each clickable to
  focus the building.
- **"While you were away" dialog** after ≥ 15 min absence (see §4 and
  MECHANICS §12b); **Quests button** with a badge; **insolvency banner**
  whenever anything is unpaid.

## 3. Placement

- Select item → the **building's model**, translucent, follows the pointer
  snapped to the grid (the old box only while the model loads); rotation
  via `R` / two-finger twist / the placement bar. Validity tint: light
  (ok), yellow (ok but no road adjacent), red (the server would reject it;
  e.g. missing deposit or fertility) with the reason as a tooltip. A new
  house may come out as a different variant than the ghost showed (variant
  by building ID; follow-up: a server-side preview hint).
- Roads: drag to draw; auto-connect; cost preview.
- **Fields** (D-051 part 4): fields are not in the build menu. The farm
  panel has a fields row (active / required / max, the list highlights
  on hover) and **"Add field"**, which enters a field tool bound to that
  farm: one field per click/tap, the ghost valid only edge-adjacent to
  the farm or one of its active fields (client hint; the server decides),
  the tool stays active until max or Esc/right-click. Inactive fields
  are drawn desaturated with the `not_adjacent` status; selecting a field
  highlights its farm and chain; a field panel offers Demolish only (no
  Move).
- Public buildings show their radius; houses in range highlight.
- Confirm on click/tap; the server validates and responds; the ghost becomes
  the building when the response arrives (round-trip ≈ 100 ms; show a brief
  "building" animation regardless).
- Demolish mode with confirmation for anything costing > 100 gold; refund
  shown.
- **Move** (D-042): "Move" in the info panel (or drag a selected building)
  lifts it into a ghost that follows the pointer with the same validity
  colours; click/tap places it, Esc cancels and the building stays. Free;
  no confirmation. Roads cannot be moved.
- Buildings may be placed without a road; the ghost shows yellow ("not
  connected") rather than red, and the warnings panel lists the building
  until a road reaches it. The ghost is red with the reason for the
  server-side hard failures the client can know from content and island
  data without rules: missing fertility tag, no deposit under the
  footprint, locked tier, upgrade-only house.

## 4. Info panel content

**Production building**

- Name, tier, status icon + sentence + suggested fix (MECHANICS §14).
- Inputs: per good, `stock on island`, `consumption/min`, `net/min`.
- Output: `production/min`, efficiency %, assigned warehouse (click to
  highlight) and transfer delay, throughput factor.
- Buttons: pause/resume, move, demolish.

**House**

- Tier, residents `floor–current–max` with growth arrow, satisfaction %.
- Needs list: each with fulfilment bar and the reason if not met ("fish:
  0/min on island", "no market within 12").
- Upgrade button with cost and lock reason.

**Trading Post**

- Level `n of 4`, capacity per good, throughput `R / T` load bar, berths
  `busy / total`, who is at the pier and who waits, assigned producers
  count; upgrade button with the next level's numbers and the cost in
  build-card format ("300 gold · 20 planks · 10 stone", unaffordable parts
  greyed with the stock on hover).
- Island inventory table: good, stock/capacity, net rate, with a filter.

**Warehouse**

- Level, throughput `R / T` load bar, assigned producers count, upgrade
  button (same cost format). No capacity row — capacity is the Trading
  Post's.

**Ship** (ship info panel; the Ships list only selects)

- Status line shared with the list ("On route: name · arrives in …",
  "Shipment · …", "Idle · at …"), the from → to islands of a leg, upkeep,
  slot capacity, one box per cargo slot (good icon, amount / slot size),
  pending founding and berth-wait notes.
- Buttons: "Assign to route…" (an inline picker of the saved routes; routes
  are created only in the Routes list, the picker links there when there
  are none), unassign, "Send…" (manual shipment dialog), found settlement,
  scrap; later: send on expedition (Harbourmaster).

**Routes list** (panel): per route its name, then "Island 1 → Island 2
(15:00 min)" (the loop time), then "Ships: n". Clicking a route opens it in
the route editor, which has Delete next to Save while no ship is assigned.
"+ New route" ends the list. The ship panel's route picker shows the same
three lines per route.

**Route editor** (panel; the Routes list opens it)

- Opened from the Routes list or an island card; stays open while the camera moves.
- The title is the route name (typed live; "New route" while empty), then
  a name input. Stops are chosen from **island pickers** (each option shows
  the island name and "(unsettled)" where it applies; the stock is
  shown per good below);
  a stop is one card: number, island picker, move up/down and remove, then
  one list of goods: good | Load / Unload | amount ("top up to" for a
  load, "all" for an unload) | the island's current stock | remove, and a
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
- Compact top bar: see §2 (icons and numbers, island on a second row in
  portrait; popups open on tap). Build menu: the
  desktop look (folder tabs, parchment cards, an icon-only Demolish button
  pinned at the right of the tab row behind a divider), with ≥ 44 px tabs and cards on touch; short landscape
  phones keep the stacked layout with smaller cards and thumbnails. Hints and banners stack below the top
  bar; toasts below the top bar.
- **Gestures** (one pointer-event recogniser; input type decides per
  gesture, pen = mouse): one-finger drag pans, draws a road with the road
  tool, or drags an idle ship in the archipelago; pinch pans by its centre
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
  brass tier badges on building cards, parchment toasts, the away summary
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
- Rates are always shown per minute; quantities as integers.
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
  per status), allocation-free cart updates; the dense fixture
  (`?fixture=dense-2x400`, dev builds only) runs at 27 draw calls
  (36 with the life layer; `?life=0` disables it, `?stats=1` shows live
  instance and particle counts).
