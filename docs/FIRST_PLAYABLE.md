# New Shores — First Playable

Status: **Agreed scope** (D-029). This is the vertical slice that proves the
pacing (D-006), the lazy simulation (D-002) and the architecture (D-025) before
content is scaled. It is a planning document, not a task list; implementation
proceeds in the milestones below, each with acceptance criteria.

## 1. Scope

### In

- **World:** one archipelago, **2 islands** generated from a fixed seed
  (start island: forest, grass, fish, stone, wheat; island 2: iron deposit,
  hemp, forest, grass).
- **Tiers:** Settlers fully; Citizens unlock and the first Citizen houses
  (needs: fish, bread, cider, linen; buildings: market, chapel, tavern).
- **Chains:** fish; wood → planks; stone; sheep → wool garments; wheat → flour
  → bread; apples → cider; hemp → linen; iron ore + charcoal → iron → tools
  (iron only on island 2 → forced trade route).
- **Logistics:** dirt + paved roads, warehouse assignment/throughput/capacity,
  one route with one sloop, manual shipment to found island 2.
- **Economy:** taxes, upkeep, auto-pause order and resume, manual pause,
  demolish refund, starting stock.
- **Offline:** lazy catch-up incl. warehouse caps and stall rule; "while you
  were away" summary.
- **Backend:** auth (email/password), world persistence, events worker
  (`ship_arrived`, `ship_built`), WebSocket push via Redis, two server
  instances in Compose.
- **Client:** Babylon.js low-poly placeholders, chunked terrain, React HUD,
  build menu, info panels, warnings tray, route editor (minimal), mouse +
  touch, extrapolation layer.
- **Guidance:** a hardcoded 5-step intro (later replaced by data-driven
  quests).

### Out

World map, neighbours, trading, gifts, expeditions, contracts, achievements,
leaderboards, shop/payments, tiers 3–4, decorations, Capacitor, social login,
GLB assets, sound.

## 2. Milestones

### M0 — Skeleton (repo, CI, hello world)

- Monorepo layout from ARCHITECTURE §3; Go module, Vite app, content folder
  with schema; Compose with server×2 + Postgres + Redis; CI running lint and
  tests for both languages.
- Acceptance: `docker compose up` serves a page that shows the server's
  version and a logged-in placeholder world.

### M1 — Simulation core (headless)

- `internal/sim`: world/island/building/inventory/house types, content
  loading, `Advance` for production/transfer/capacity/needs/growth/taxes/
  upkeep/pause order, `Apply` for place/demolish/pause/upgrade/road.
- Golden fixture scenarios: single chain; throttled warehouse; full
  warehouse; starved input; insolvency cascade and recovery; 12 h gap; 90-day
  gap under the iteration cap.
- Acceptance: all MECHANICS §13 invariants hold as property tests; `Advance`
  composition property passes; a 12-hour catch-up of the reference world runs
  in < 50 ms.

### M2 — Server (persistence, API, events)

- Store with row locking; `GET /world`, `POST /world/commands`; events worker
  with `ship_built`/`ship_arrived`; routes and manual shipments in sim; Redis
  publish + WebSocket hub; auth.
- Acceptance: two instances process a shared event queue with no duplicates
  (integration test); cross-user access denied; a command issued to instance
  A is visible from instance B immediately; event lag metric exported.

### M3 — Client (render, HUD, placement)

- Display model + extrapolation; Babylon scene with terrain chunks and
  instanced placeholder buildings; carts and ship from timers; React HUD,
  build menu with lock reasons, info panels, warnings tray; placement ghost
  with validity; roads drag; touch gestures.
- Acceptance: Playwright scripts place a chain and see production; touch
  emulation pans/zooms/places without gesture conflicts; extrapolated numbers
  match server fixtures within rounding at sampled times.

### M4 — Slice complete and measured

- Island 2 settlement flow; route editor; Citizens unlock; "while you were
  away"; intro steps; balancing pass on CONTENT numbers for tiers 1–2.
- Acceptance: see §3.

## 3. Acceptance criteria for the slice

**Gameplay**

- A new player reaches the first Citizen house within **≤ 90 min** of play
  without guidance beyond the intro.
- Every blocked state in MECHANICS §14 is reachable, visible and recoverable in
  the UI.
- The forced iron route is understood: ≥ 4 of 5 test players set it up
  without external help.
- Nothing in the player's own archipelago takes more than 10 minutes of
  waiting (ship build and travel included).

**Offline**

- Returning after 8–12 h shows full warehouses (not more), unchanged or
  grown houses, correct gold, correct pause state; the summary explains it.

**Technical**

- 12 h catch-up < 50 ms, 90-day catch-up < 500 ms (server, reference world).
- Dense two-island scene (~400 buildings, 60 carts, 2 ships) ≥ 30 fps on a
  mid-range Android phone (e.g. Pixel 6a class) and ≥ 60 fps on a 2020+
  laptop; memory < 400 MB in the browser tab.
- Multi-instance integration test green; ownership and session tests green.
- Backup + restore of Postgres rehearsed once.

## 4. Measurements to record

Simulation `Advance` duration and boundary counts per gap length; API p50/p95;
event lag; client frame time, draw calls, memory; bundle size; time-to-first-
interaction on mobile. These set the budgets for scaling content to tiers 3–4.

## 5. After the slice

Order of subsequent work (each gets its own scope doc when started):

1. Tiers 3–4 content, warehouse upgrades, data-driven quests, achievements.
2. World map: neighbours, offers, visits, expeditions, contracts.
3. Shop + Stripe, decorations.
4. Capacitor apps + store IAP.
5. Second region (design first), raids (design first).
