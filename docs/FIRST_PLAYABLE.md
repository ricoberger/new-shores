# New Shores — First Playable

Status: **Agreed scope** (D-029). This is the vertical slice that proves the
pacing (D-006), the lazy simulation (D-002) and the architecture (D-025) before
content is scaled. It is a planning document, not a task list; implementation
proceeds in the milestones below, each with acceptance criteria.

## 1. Scope

### In

- **World:** one archipelago, **2 islands** generated from a fixed seed
  (start island: forest, grass, fish, stone slot, wheat & apple fertility;
  island 2: iron slot, hemp fertility, forest, grass). Other islands of the
  archipelago may be generated but are locked (D-039).
- **Tiers:** Settlers fully; Citizens unlock and the first Citizen houses
  (categories: food = bread, drink = cider, clothing = linen garments — one
  good per category in the slice; the alternatives cheese/mead/leather come
  with the content pass; buildings: market, chapel, tavern).
- **Needs model:** categories with alternative goods and variety bonus
  (D-031) and **workforce per island** (D-035) are implemented in the slice
  with tier-1/2 numbers, even though tier 1 has single goods.
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
leaderboards, shop/payments, tiers 3–4, tier-2 alternative goods, bricks,
coal, island unlock gating beyond two islands, decorations, Capacitor, social
login, GLB assets, sound.

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

### M1b — Dev server and first visible island

- A `--dev` mode of the server binary that holds **one in-memory world**
  (no Postgres, no auth, no Redis) behind the real `GET /world` and
  `POST /world/commands` handlers and the real `Display` payload shape.
- Client: display model + extrapolation, Babylon scene with terrain chunks
  and instanced placeholder buildings, placement ghost with validity, roads
  drag, carts and production bars from timers, minimal HUD (gold, population,
  build menu). Mouse only is acceptable at this stage.
- Purpose: see and play a single island early for motivation and UX
  learning without compromising the architecture. The dev mode is throwaway
  glue (one file); the API shape it serves is the one M2 persists.
- Acceptance: place the tier-1 chains on the start island in the browser and
  watch production flow; restarting the server resets the world (expected).

### M2 — Server (persistence, accounts, events, push) — done (PR #6)

- PostgreSQL store behind the existing `Store` interface (row lock per
  Update, database clock read after the lock, JSONB envelope, embedded
  migrations); guest + email/password accounts with cookie/bearer sessions
  and CSRF; scheduled-events worker proven with the generic `advance_to`
  kind; Redis pub/sub → WebSocket `world_changed`; Compose stack with two
  instances behind Caddy; start screen and account menu in the client.
- Scope change: `ship_built`/`ship_arrived`, routes and manual shipments
  moved to M4 — they are sim/content work, not infrastructure.
- Acceptance met: two workers process a shared queue with no duplicates;
  cross-player access is not addressable; a command on instance A is
  pushed to a socket on instance B in ≈ 9 ms; event lag p95 0.79 s under
  a 1 000-event burst; command p50 1.4 ms / p95 1.7 ms against Postgres.

### M3 — Client (touch, mobile layout, performance budget) — done (PR #11)

- Pointer-event gesture recogniser (pan, pinch, tap, long-press, rotate,
  road drawing, ship drag), tap-then-confirm placement with a placement
  bar, demolish and road mode bars, phone layouts with bottom sheets and a
  compact HUD, PWA shell (manifest, service worker, update toast,
  install), accessibility baseline, dense-fixture perf guard. Numbers in
  §3 (emulated). Open: real-phone verification by the user; initial camera
  should centre on the warehouse on first load.
- Acceptance: Playwright scripts place a chain and see production; touch
  emulation pans/zooms/places without gesture conflicts; extrapolated numbers
  match server fixtures within rounding at sampled times.

### M4 — Slice complete and measured

- **Part 1 — done (PR #7):** `sloop` and shipyard, `ship_built` /
  `ship_arrived` as due moments, looping routes, manual shipments,
  founding island 2 from a ship, two-island dev archipelago (120 tiles
  apart → 2 min legs), island switcher plus Ships/Routes panels (HTML).
  Measured: 12 h offline with a running route ≈ 3 ms of Advance (328
  boundaries). The first settlement flow was unaffordable from the
  starting stock (≈ 1 060 gold / 166 planks vs 500 / 130) — resolved in
  part 2a.
- **Part 2a — done (PR #8):** Citizens in play (house, needs, chains,
  quarry and tool chain, fertility tags, deposit requirement, warehouse
  level 2) and the tier 1–2 **balancing pass** with the scenario runner.
  Reference game from the starting stock (golden `bootstrap_citizens`):
  island 2 settled at 60 min (limit 60), Citizens unlocked at 79 (90),
  first Citizen house at 100 (100), tools home at 139 (150); no
  auto-pauses, ending at +23.7 gold/min. Levers used: early
  infrastructure costs/upkeep cut, wool cycles 60 → 90 s, warehouse
  throughput 60 → 30 / 90 → 55 per min (one warehouse ≈ 80 % load),
  starting gold 500 → 800; tax rates and residents untouched; dev bonus
  removed. The island-2 and first-upgrade targets sit exactly on their
  limits — **headroom should come from tutorial-quest rewards (D-022),
  not more starting gold.** Open: a city left idle before building can
  pause itself into a state that only manual demolish/resume recovers;
  add a recovery scenario and check the UI explains it.
- **Part 2b-i — done (PR #9):** 12 intro quests (claimable rewards; with
  them island 2 at 42 min and the first Citizen house at 72 — without
  them unchanged), the "while you were away" summary, the insolvency
  banner, and automatic stall recovery: never-pausable buildings carry no
  upkeep (D-046) and unpaid buildings get a trial resume from a 30-minute
  reserve (D-047) — a fully stalled city restarts by itself ≈ 54 min after
  the stall. Schema version 2 with the first real envelope migration.
- **Art 1, continuous world (D-048) — done (PR #13):** one scene, LOD,
  minimap, rotation; see UI.md §1 and ART_DIRECTION §9.
- **Fields (D-049) — done (PR #12):** farms need 16 placed 1×1 fields of
  their crop type inside the work radius (tap or rectangle drag);
  efficiency = assigned / required; schema 3 migrates existing farms by
  auto-placing their fields (both fixtures at 100 %); reference timings
  unchanged (60/80/100/139 without quests, 42/63/72/120 with).
- **Part 2b-ii — done (PR #10):** 3D archipelago view in the same scene
  (procedural island silhouettes, sea, ships on their legs from server
  timestamps, route lines), island card, ship info panel, graphical route
  editor with server-computed estimated effects, 350 ms view transitions,
  per-island camera memory. 8 islands / 20 ships fixture: 60 fps, 14–15
  draw calls; main chunk 337 → 353 kB gzip. Open: rebalance warehouse
  levels 3–4 with tier 3.
- Acceptance: see §3.

Ordering rationale: M1 carries the design risk and needs no UI (the scenario
runner balances faster than playing). The UI starts in M1b as soon as the
`Display` payload shape is stable, because the client is a view of that
payload (D-027) and would otherwise be built twice. Persistence (M2) slots in
underneath an already visible game.

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
  laptop; memory < 400 MB in the browser tab. **M3 (emulated,
  provisional):** 412 × 915 @ 4× CPU throttling with software WebGL
  34 fps (17.5 before optimisation), 27 draw calls, ≈ 20 MB JS heap, TTFI
  ≈ 0.55 s; hardware GL 60 fps (vsync); bundle 443 → 450 kB gzip;
  Lighthouse accessibility 100. **Real-device measurement still open.**
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
