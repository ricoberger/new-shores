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
  whole archipelago fits. **Rotation is free** (D-051): right-drag,
  two-finger twist (no ghost tool active) or `Q`/`E` in 45° steps; on
  release the azimuth eases to the nearest 45°; the sun stays world-fixed.
  A **compass on the minimap** shows the heading, can be dragged to rotate
  and tapped to return north; there are no separate rotate buttons.
  Building rotation stays fixed to the world (D-042).
  **Jumps** (island tabs, island card "Go to island", Enter, founding,
  warnings tray) move the camera in ≤ 350 ms and zoom in to 18 only when
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
  label tap is an island tap at every LOD: it appends a stop when the route
  editor is open, picks the destination for an awaiting shipment, otherwise
  opens the **island card** (population, warehouse fill, warnings count,
  fertilities, deposits; "Found settlement with ship #n" when an idle ship
  there carries the warehouse cost; "New route from here"; "Go to island").
  Hover shows a lightweight tooltip only; nothing is hover-only.
- **Ships** are low-poly instances: with a leg, lerped between the two
  islands' berth anchors by `(now − depart_at) / (arrive_at − depart_at)`;
  berth 0 (nearest the harbour building) is the anchor for legs and
  ribbons, idle and anchored ships take the next berths; `anchored_unpaid`
  ships greyed. Legs and ribbons are straight lines and may cross land
  (dressing task). Route ribbons carry direction arrows; the selected ship
  shows its route and ETA.
- **Manual shipment:** drag an idle ship onto another island (drop on sea
  or its own island cancels; dragging a non-idle ship pans), or "Send to…"
  then tap the target island; both open the cargo dialog.
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

## 2. Island view HUD

```
┌──────────────────────────────────────────────────────────────────────┐
│ gold 12 340  (+48/min)   ⌂ 230 S · 95 C · 0 M · 0 P   ⚓ 2 ships   ◎ 120 │ ← top bar
│                                                      [quests] [map] [≡] │
├──────────────────────────────────────────────────────────────────────┤
│                                                             ┌────────┐ │
│                        3D canvas                            │ info   │ │
│                                                             │ panel  │ │
│                                                             └────────┘ │
│ ⚠ 3 warnings                                                            │
├──────────────────────────────────────────────────────────────────────┤
│ [Houses] [Production] [Public] [Harbour] [Roads] [Decor]   build menu  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** gold and balance/min (green/red), population per tier, ship
  count, Doubloons; quest, world-map and menu buttons.
- **Build menu:** categories → items with cost, upkeep and a lock reason if
  unavailable ("Needs 120 Settlers", "Missing 10 stone — available on Island
  2"). Items show the island's stock for each required material.
- **Info panel** (right on desktop, bottom sheet on mobile) for the selected
  object — see §4.
- **Warnings tray:** collapsible list of bottleneck messages from
  MECHANICS §14, each clickable to focus the building.
- **"While you were away" dialog** after ≥ 15 min absence: gold and
  population before/after, per-island goods produced/consumed/lost and
  "at capacity" flags, buildings paused/resumed and still unpaid, ship
  arrivals, quests completed. Shown once per summary id; closing it
  acknowledges on the server so no other device shows it again.
- **Quests button** with a badge for claimable rewards; the quests panel
  lists active quests with objective progress, claimable rewards (island
  choice for goods, with the "excess is lost" note) and completed quests.
- **Insolvency banner** whenever anything is `unpaid`: "Your city cannot
  afford its upkeep: −x gold/min (balance if everything resumed). Paused:
  n buildings, m ships. Demolish, resume manually, or grow your tax base."
  — links to the warnings tray.

## 3. Placement

- Select item → ghost follows the pointer, snapped to grid; rotation via key
  `R` / two-finger rotate / on-screen button. Validity colour: green (ok),
  yellow (ok but not connected / low efficiency), red (invalid) with the
  reason as a tooltip.
- Roads: drag to draw; auto-connect; cost preview.
- **Fields** (D-049): the field tool (build menu under Production, or the
  farm panel's "Place pastures n / 16") places one field per click/tap;
  dragging a rectangle previews every valid free tile inside it (green =
  will be placed; yellow = outside every accepting farm's radius, not
  sent) and places them with one command on release (touch: via the
  placement bar's Confirm). A server rejection shows the error and
  refreshes — never a partial placement. The accepting farms' radius rings
  show "n / required" while the tool is active; the farm panel shows the
  assigned count and efficiency; demolish mode removes fields like
  buildings.
- Farms show their work radius and fertile-tile fraction while placing.
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
  connected") rather than red, and the warnings tray lists the building
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

**Warehouse**

- Level, capacity per good, throughput `R / T` load bar, assigned producers
  count, upgrade button.
- Island inventory table: good, stock/capacity, net rate, with a filter.

**Ship** (ship info panel; the Ships list only selects)

- Type, state, cargo slots, current leg with ETA, route assignment, upkeep.
- Buttons: "Assign to route…" (opens the editor with the ship pending;
  pick a saved route or save a new one to assign), unassign, "Send…"
  (manual shipment dialog), "Send to… (pick island)", found settlement,
  scrap; later: send on expedition (Harbourmaster).

**Route editor** (panel; the Routes list opens it and may delete)

- Opened from the Routes list, a ship's "Assign to route…" or an island
  card; stays open while the camera moves.
- Stops are chosen from **island pickers** (each option shows the island
  name, settled state and the relevant goods' stock/capacity); clicking an
  island or its label in the world while the editor is open also appends
  it. Per stop a load list with
  "top up to" amounts and an unload list, with the island's current stock
  inline; assigned ships. Server errors (e.g. consecutive stops on one
  island, `route_invalid`) are shown as toast and inline.
- Loop time and per-island **effects** (MECHANICS §9.2) show "Save to
  compute" until the route is saved, then the server's numbers for the
  saved version, labelled "estimated"; per-minute values are 0 until a
  ship is assigned.
- Selecting a ship or island while the editor is open **suspends** it:
  their panel shows, island clicks select instead of adding stops, and a
  "Back to route editor" bar resumes it as the only side panel; the draft
  survives. Esc steps back one level per press (dialogs → island tool →
  drag/pick → pending ship → editor → selection).

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
  the handle cycles; dragging below the peek closes), focus moved in,
  Tab trapped, focus returned to the opener on close. Wider landscape
  phones get a narrow side panel; if it would be shorter than ≈ 240 px the
  hint bar hides and the insolvency banner is limited to one line.
- Compact top bar: gold, balance and a population chip (tap expands the
  per-tier list), quests and account pinned; island tabs, Archipelago,
  Ships and Routes in a horizontally scrolling row. Build menu: category
  chips and ≥ 44 px item cards in one horizontal scroller (Demolish at the
  end); landscape shares one row. Hints and banners stack below the top
  bar; toasts below the top bar; warnings tray ≤ 25 vh.
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
  (`?fixture=dense-2x400`, dev/e2e builds only) runs at 27 draw calls.
