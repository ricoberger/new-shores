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

Transitions: zoom out of an island past a threshold → archipelago view; a
world-map button in the HUD opens the 2D screen as an overlay.

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
- **"While you were away" dialog** on login after > 15 min absence: goods
  accumulated, warehouses full, buildings paused, ships/trades/expeditions
  completed.

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
  until a road reaches it.

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

**Ship**

- Type, state, cargo slots, current leg with ETA, route assignment, upkeep.
- Buttons: assign to route, manual shipment, send on expedition (if
  Harbourmaster), scrap.

**Route editor** (archipelago view)

- Ordered stops; per stop a load/unload list per good with max amounts;
  assigned ships; computed loop time and estimated throughput per good; the
  per-good net effect on each island shown inline.

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
