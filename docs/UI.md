# New Shores — User Interface

Status: **Agreed structure** (D-024, D-027); layouts and visuals are to be
prototyped in the first playable. The UI is HTML/CSS (React) over a Babylon.js
canvas. The world is rendered from server state plus linear extrapolation; the
UI shows the same numbers the server uses.

## 1. Views

| View | Renders | Purpose |
|---|---|---|
| **Island view** | 3D, fixed isometric-style ortho camera, pan/zoom, no rotation at launch | build, inspect, fix bottlenecks |
| **Archipelago view** | 3D zoom-out of all islands, ships, route lines | pick islands, manage routes/ships, settle |
| **World map** | 2D HTML screen (no 3D) | neighbours, offers, expeditions, contracts, visits, leaderboards |
| **Account / shop** | HTML | profile, purchases, settings |

Transitions: zooming out of an island while already at its maximum zoom
(accumulated wheel/pinch past a threshold; a single tick never switches)
→ archipelago view; zooming in inside the archipelago never switches back.
Entering an island (second click on the selected island, double-click,
Enter, the island card's "Enter island", or a top-bar island tab) is a
350 ms camera move with no blank frame; each island and the archipelago
remember their last camera. A back control ("◰ Archipelago") and Backspace
return. Input is ignored while the camera animates. A world-map button in
the HUD opens the 2D screen as an overlay (later).

### Archipelago view

- One procedural silhouette mesh per island from its terrain, name label,
  settled/unsettled badge; an animated sea plane; the island view keeps the
  sea and the other silhouettes visible around the shown island.
- Ships as low-poly instances: with a leg, lerped between the two islands'
  anchors by `(now − depart_at) / (arrive_at − depart_at)`; without a leg,
  at berths spread around their island's anchor; `anchored_unpaid` ships
  greyed. Route lines between stops with direction arrows; the selected
  ship shows its route and an ETA badge.
- Single click selects an island and opens the **island card** (population,
  warehouse fill, warnings count, fertilities, deposits; "Found settlement
  with ship #n" when an idle ship there carries the warehouse cost; "New
  route from here"; "Enter island"). Hover shows a lightweight tooltip
  only; nothing is hover-only.
- Picking order on tap: nearest ship within 18 CSS px → island under or
  within one tile of the pointer → sea (clears the selection, or cancels an
  active pick/drag).
- Manual shipment: drag an idle ship onto another island (drop on sea or
  its own island cancels; dragging a non-idle ship pans), or "Send to…" in
  the ship panel then tap the target island; both open the cargo dialog.

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

**Route editor** (archipelago view; the Routes list opens it and may delete)

- Opened from the Routes list, a ship's "Assign to route…" or an island
  card; it lives in the archipelago view (entering an island closes it).
- Stops are added by clicking islands in order; per stop a load list with
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

## 6. Mobile

- Minimum supported: 360 × 640 CSS px portrait and landscape.
- Side panels become bottom sheets with a drag handle; build menu becomes a
  horizontally scrollable bar; top bar collapses population into a single
  tap-to-expand chip.
- Gestures: one-finger drag pans, pinch zooms, tap selects, long-press opens
  the context panel, two-finger rotate rotates a ghost. UI elements stop
  propagation so panel interaction never pans the camera.
- Placement on touch: tap to place the ghost, then confirm with a button
  (avoids mis-taps).
- Prefer bigger hit targets (≥ 44 px), no hover-only information.

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
  (first playable budget; see FIRST_PLAYABLE.md).
