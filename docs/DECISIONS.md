# New Shores — Decision Log

Status: **Agreed.** Every entry below was decided in the design interview. Entries
marked **Revisit** are deliberately deferred and may change after launch data
exists; everything else is a fixed constraint for implementation. Add new
decisions at the end; never rewrite an accepted entry — supersede it with a new
one that references the old number.

Format: **Decision** · Rationale · Consequences · Alternatives rejected.

---

## D-001 Server-authoritative persistent world

**Decision:** New Shores is an Anno-Online-style persistent online game. The
server owns all game state and runs the economy; the client is a view that
sends commands.

- *Rationale:* Player-to-player trading and a real-money cosmetic currency are
  defining features. Both are unsafe with a client-owned simulation.
- *Consequences:* No fully offline play. The Go backend is the game server, not
  a save store. The earlier single-player/PocketBase drafts are superseded.
- *Rejected:* Single-player client-authoritative (blocks trading and
  monetisation); hybrid "migrate later" (a rewrite in disguise).

## D-002 Event-driven lazy evaluation (no server tick loop)

**Decision:** The server never ticks idle worlds. A world's state is stored
with `last_evaluated_at`; it is advanced to the current time only when read,
commanded, or when a scheduled event for it fires. Advancement is a pure,
deterministic function `advance(world, toTime)` implemented as a
piecewise-constant-rate simulation (compute rates → find next boundary event →
advance → repeat).

- *Rationale:* Server cost scales with active players; offline and online
  progression are identical by construction; trivially persistent and testable.
  This is what every persistent browser economy game does.
- *Consequences:* **All rules must be expressible as rates, capacities and
  timed events.** No path-finding-dependent behaviour (traffic jams, fire
  spreading). Things that must happen at a precise time to an offline player
  go through a scheduled-event queue.
- *Rejected:* Continuous per-player tick (cost without gameplay return);
  hybrid live tick while online (two models that must agree → exploits).

## D-003 Private archipelago per player + shared social world map

**Decision:** Each player owns a private archipelago (no land contention).
A separate world map layer is where players discover each other, trade and
(later) raid. Modelled as a social graph + marketplace, not a shared geography.

- *Rationale:* Anno Online model; isolation, no griefing, generated maps.
- *Consequences:* Shared/contested regions remain possible later as a new world
  type with multiple owners (D-005 keeps this open).
- *Rejected:* Shared realm map (land squatting, forced combat, sharding).

## D-004 Matchmade neighbours with stable fake geography

**Decision:** Neighbours on the world map are assigned by the server from
players of similar progress, given persistent positions, so distance (and
hence travel time) is defined and discovery feels like exploration.

- *Rationale:* New players never discover only dead accounts; distance is
  required for travel timers (trade, expeditions, future raids).

## D-005 Future combat = scheduled raid events

**Decision:** If combat is added, it is a raid: ships travel (event), outcome is
a deterministic formula at arrival (attacker strength vs defender level →
loot/losses), with newbie protection and loot caps. No real-time battles, no
land conquest. Not in scope now; the architecture must not block it.

- *Consequences:* Cross-world transactions, server-driven event firing and
  world-map distance are required — all already required by trading.

## D-006 Session rhythm: Anno pace, resource-gated ("Option D")

**Decision:** Construction is near-instant; goods flow continuously at Anno-like
rates; pacing comes from accumulating materials/gold and from population
growth — never from construction timers. Real time is used only where
thematically earned: ship travel between islands (minutes), player-to-player
travel and expeditions (hours), population growth (minutes).

- *Rationale:* Target player plays 1–2 h/day plus short check-ins and must never
  be blocked on building. Timer games are unfun (waiting walls, obligation,
  shallow decisions, pay-to-skip).
- *Consequences:* Content is consumed faster than in timer games → steep cost
  scaling, depth per tier, multiple islands; launch content ≈ weeks, not months.
  No pause, no speed control, no save/load.
- *Rejected:* Slow timer economy (B); fast goods + slow construction (C).

## D-007 Ship build times 2–10 min, material-gated

**Decision:** Shipyard timers are short and visible (~2 min starter ship, up
to ~8–10 min largest), matching modern Anno (verified: Anno 1800 schooner
3 min, ship-of-the-line 12 min; Anno 117 penteconter 5 min, quinquereme
10 min). The real gate is materials (planks, sails/cloth, later cannons) and
gold.

## D-008 Warehouse capacity caps offline accumulation

**Decision:** Production of a good stops when the island's capacity for it is
reached. Capacity = sum of warehouse capacities. This bounds offline gain and
makes storage a progression decision.

## D-009 Offline rule: stall, don't ruin

**Decision:** While unmet needs persist, population stops growing and
happiness drops, but inhabitants never leave below a floor and nothing is
destroyed. An unattended city converges to a stable, poorer state.

## D-010 Four tiers at launch, regions as a first-class concept

**Decision:** Launch with four population tiers in one home region:
**Settlers → Citizens → Merchants → Patricians**. Additional regions
(Anno 1404/117 style, with their own tiers/resources/buildings) are planned for
later; the content model has `region` as a first-class entity from day one.

- *Rationale:* Four tiers ≈ a month of casual content; manageable catalogue
  (~40–50 buildings). Names read as social ascent in the chosen era and are not
  Anno Online's.

## D-011 Setting: age of sail, roughly 16th–18th century, never a named year

**Decision:** Europe-inspired home region with an invented name; no electricity,
trains or other modern technology; goods like tobacco/sugar/coffee are reserved
for later colonial regions.

## D-012 Goods are global, production is regional; tier unlocks are data

**Decision:** A good has one global ID; where it can be produced is a property
of buildings/islands in a region. Any tier in any region may consume any good.
Tier unlock conditions are content data (`population`, `buildings`,
`goods_delivered`), not code. A future 5th home tier may require goods only
produced in a new region.

- *Guardrail:* Never add new **mandatory** needs to an existing tier after
  launch. New-region goods become needs of **new** tiers or **optional luxury**
  needs (bonus only) of existing tiers.

## D-013 Needs model: consumption-rate goods needs + radius building needs

**Decision:** Anno 1404/1800 style. Each house consumes goods at a rate per
need; partial supply → partial satisfaction. Public buildings satisfy
"building needs" within a radius and require road connection. No tax slider at
launch.

- *Rejected:* Binary per-need satisfaction (Anno Online); tax slider (defer).

## D-014 On-island logistics: road connection + island-wide shared stock

**Decision:** A producer must be road-connected to a warehouse; it is assigned
to the nearest connected warehouse and road distance gives a transfer delay.
Each warehouse has a throughput (units/min, upgradeable); producers assigned to
it share it proportionally when oversubscribed. All warehouses on an island
read/write one island inventory. Carts on screen are visual, derived from
transfer timers.

- *Rejected:* Warehouse radius only (weaker spatial puzzle); per-warehouse stock
  (tedious).

## D-015 Inter-island transport: Anno 1800-style looping routes

**Decision:** A route is an ordered list of stops with per-good load/unload
rules; ships assigned to it loop forever. One-off manual shipments use the same
ship UI. Lazy form: ship = `{route, stopIndex, legDepartAt, legArriveAt}`;
arrival is a scheduled event. Ships have cargo slots and speed by type.

## D-016 Whole archipelago visible; islands differ in fertilities/deposits

**Decision:** No fog of war in the player's own archipelago. Exploration fantasy
is served by the world map and expeditions. Island choice is meaningful through
fertilities and deposits.

## D-017 Money: taxes − upkeep; floor at zero with deterministic auto-pause

**Decision:** Gold is earned from taxes (per inhabitant, by tier, only when
needs are met) and spent on construction and per-building upkeep. The balance
never goes negative: when it would, buildings are auto-paused one at a time in
a fixed order (see MECHANICS.md) and auto-resumed with hysteresis. Players can
manually pause any building.

- *Rejected:* Game over (impossible without reload); negative balance/debt
  (unbounded while offline).

## D-018 No NPC trader, no auto-sell

**Decision:** Surplus goods have no gold value except through player trade and
contracts (D-023). Gold enters the game only via taxes.

## D-019 Demolish refund 50 % materials, 0 % gold; tunable starting stock

**Decision:** Generous refunds because no reload exists. Starting stock is a
content value (enough for warehouse + ~8 houses + fisher + lumberjack + roads
and ~15 min upkeep slack), tuned in playtesting.

## D-020 World map unlock and trading model

**Decision:** The **Harbourmaster's Office** (tier 3, Merchants) unlocks the
world map. Trading is **barter only**: offer board (async) and direct requests
share one escrow + shipping mechanic. Goods are escrowed at posting; the
player's own ship carries the trade (hours of travel, from world-map distance).
Visits (read-only), gifts (one-way), and expeditions (hours; discover
neighbours/bonuses) are included. Trades only between players within ±1 tier;
gifts rate-limited.

- *Rejected for now (Revisit):* Gold-based market — sells progress, alt/RMT
  risk, no price discovery, inflation, must stay separate from premium
  currency. Offer schema `{give: [...], want: [...]}` keeps gold as a future
  entry type.

## D-021 Monetisation: strictly cosmetic shop, two decoupled currencies

**Decision:** **Gold** (in-game, never purchasable, never transferable) and
**Doubloons** (premium, bought with real money, spent on decorations, ship
skins and building visual variants with zero gameplay effect). No free
Doubloons at start. No time skips, resources, extra slots or premium buildings
with effects. No loot boxes. Web payments via Stripe first; store IAP with the
native apps; provider-agnostic entitlement ledger.

- **Revisit:** Doubloons → Gold conversion is deferred, to be reconsidered with
  launch data. The ledger must make it a policy change, not a schema change.

## D-022 Guidance: quest chain as tutorial and long-tail goals

**Decision:** Data-driven advisor quests (first ~10 act as the tutorial), plus
achievements, periodic Harbourmaster **contracts** (deliver goods for
gold/decoration rewards — a bounded sink, not a market), and neighbour
leaderboards.

## D-023 No loss condition; inactivity archive; display-name identity

**Decision:** The archipelago cannot be lost. Worlds inactive > 3 months are
archived (removed from matchmaking, restorable on login). Players have a
display name and coat of arms/portrait; no real names.

## D-024 Presentation: low-poly 3D, fixed orthographic camera, HTML UI

**Decision:** Babylon.js (WebGL baseline), stylised low-poly 3D, fixed
isometric-style orthographic camera, React HTML/CSS overlay. Three views:
island view, archipelago view (routes), world map (2D/HTML screen). Mobile uses
bottom sheets and touch gestures.

- *Rejected:* 2D sprites (asset pipeline cost, inconsistent AI output); 3D
  rendered to sprites (two pipelines).

## D-025 Backend: Go + PostgreSQL + Redis; static client

**Decision:** Plain Go service (`net/http`), PostgreSQL as the only source of
truth (world state as versioned JSONB per world + relational tables),
in-process scheduled-event worker using `FOR UPDATE SKIP LOCKED`, Redis for
pub/sub to WebSocket instances, rate limiting and presence. JSON over HTTP for
commands/queries; WebSocket for server push. Docker Compose on one VPS first,
Kubernetes later. OpenTelemetry + Prometheus from day one.

- *Rejected:* PocketBase/SQLite (single writer, CRUD model, pre-1.0 for a game
  server); Nakama (over-featured, sandboxed runtime).

## D-026 Multi-instance concurrency via per-world row locks

**Decision:** Every command and event handler runs in one Postgres transaction
that locks the involved world rows (`SELECT … FOR UPDATE`, ascending world ID),
advances them to the relevant time, applies the change and commits. Events are
applied at their **due time**, not processing time. No leader election or
distributed locks.

## D-027 Client prediction by linear extrapolation only ("A′")

**Decision:** The server returns authoritative state plus current rates, cycle
timers, ship legs and `next_change_at`. The client extrapolates linearly and
re-fetches at `next_change_at` or on push. **No game rules in the client.**
WASM compilation of the Go simulation is explicitly out of scope.

## D-028 Delivery: web first, Capacitor apps later

**Decision:** Desktop + mobile web (PWA) first. iOS/Android via Capacitor, with
store IAP, after the web version is stable.

## D-029 First playable scope

**Decision:** See FIRST_PLAYABLE.md: 2 islands, tier 1 + start of tier 2, five
chains including one forced trade route, full money/pause rules, offline
catch-up, auth, events worker, WebSocket push, multi-instance test, Babylon
placeholders, React HUD, touch + mouse. World map, trading, shop, tiers 3–4 and
Capacitor are excluded.

## D-030 Repository layout and documentation set

**Decision:** Monorepo: `server/` (Go), `client/` (Vite + React + Babylon.js),
`content/` (JSON content validated in Go, TS types generated from JSON Schema),
`docs/`. Documents: GAME_DESIGN, MECHANICS, CONTENT, ONLINE, MONETIZATION, UI,
ARCHITECTURE, FIRST_PLAYABLE, DECISIONS, plus README and AGENTS.md.

---

## Content design session (post-first-playable catalogue)

Decisions D-031 – D-040 shape the full launch catalogue. Only the mechanics
among them (D-031, D-035, D-036) affect the first playable; the content itself
is authored after the slice (D-040).

## D-031 Needs are categories with alternative goods and a variety bonus

**Decision:** A goods need is a **category** (food, drink, clothing, comfort,
luxury) with 1–3 acceptable goods. Any one good fills the category to 100 %
(growth and base tax are never blocked by the choice); each **additional**
distinct good supplied adds a bonus to that house's tax and growth rate
(provisional +10 % per extra good, max 2 extras). Fulfilment =
`min(1, Σ supply/demand across the category's goods)`.

- *Rationale:* Anno 117 model. Islands differ (D-016) and trade is barter
  (D-020): alternatives make archipelagos play differently and neighbours
  complementary. Completionists keep a goal (full variety) without a gate.
- *Rejected:* fixed single goods per need (Anno 1404/Online); partial coverage
  per good (forces two chains, punishes archipelagos lacking a fertility).
- Supersedes the goods-need shape in D-013; building needs are unchanged.

## D-032 Alternatives start at Citizens; Settlers stay fixed

**Decision:** Tier 1 has one good per category (fish, wool garments) as the
teachable set. Categories with 2–3 alternatives begin at Citizens.

## D-033 Category structure per tier

**Decision:** Settlers: food, clothing (1 option each). Citizens: food, drink,
clothing (2 each). Merchants: + comfort (2–3 each). Patricians: + luxury
(2–3 each). Lower-tier goods do **not** satisfy higher tiers' categories.
At tiers ≤ 2 each category has one fertility-free option; from tier 3 the
rule relaxes to "one option whose resources the generator guarantees
somewhere in the archipelago" because trade is available.

## D-034 Chain depth grows with tier; shared intermediates

**Decision:** 1–2 steps at Settlers/Citizens, 2–3 at Merchants, 3–4 at
Patricians. Shared intermediates: charcoal (the deliberate "energy"
bottleneck, with a coal mine as late alternative), salt (with pans-vs-mine
alternative), clay, flour, iron, tallow, honey, barrels, brass, glass.

## D-035 Workforce per island by tier

**Decision:** Production buildings require a number of inhabitants of a given
tier on the **same island**; shortfall reduces efficiency proportionally
(`min(1, available/required)`), never to zero below the house floor dynamics.
Tiers coexist by necessity; outposts need their own housing.

- *Rationale:* Anno 1800/117. Largest source of ongoing optimisation; reuses
  the tier/house system; rate-based and lazy-friendly.
- *Rejected:* no workforce (1404/Online); archipelago-wide pool.

## D-036 Infinite deposits, limited slots; harbour area as a slot

**Decision:** Islands have fixed **deposit slots** (typed: stone, iron, clay,
salt, quartz, copper, gold, coal) and a finite **harbour area**; mines, quarries
and coastal buildings occupy slots. Deposits never deplete. Fertilities remain
island-wide tags; buildable area is the second scarcity.

- *Rejected:* unlimited mines (logistics stop growing); depleting deposits
  (loss while offline conflicts with D-009).

## D-037 Construction materials: one per tier; bricks at Merchants; materials are regional

**Decision:** planks (Settlers) → stone (Citizens; tools also unlock here for
the iron route) → **bricks** (Merchants; clay slot + charcoal) → **glass**
(Patricians; quartz slot + charcoal). Verified against Anno 117 (planks →
bricks → concrete → marble per tier, regional sets). Future regions bring
their own material sets rather than importing the home region's.

## D-038 Launch catalogue goods per tier

**Decision:** See CONTENT.md. Citizens: bread | cheese; cider | mead; linen
garments | leather jerkins. Merchants: sausages | pies; beer | brandy; coats |
dyed garments | fur coats; books | tableware | soap. Patricians: roast beef |
oysters | confectionery; wine | grain spirit; fine garments | lace; candles |
spectacles; jewellery | paintings | instruments. Candles use tallow (pigs),
apiaries produce honey only; pigs feed tannery, butcher and rendering house.
Colonial goods remain reserved for later regions (D-011).

## D-039 Island count and gating

**Decision:** Archipelagos have 6–8 islands of varied size. The start island
plus one are settleable immediately; further islands unlock at tier
milestones (data-driven). The generator guarantees that resources required
by a tier are reachable with the islands unlocked at that tier.

- *Rejected:* settle freely (archipelago "done" in week one); islands via
  expeditions (core progression behind RNG timers).

## D-040 Sequencing

**Decision:** D-031 (categories + variety) and D-035 (workforce) are
implemented in the next simulation task (houses/needs/taxes) with tier-1
numbers, since retrofitting them later would rewrite the needs code and
migrate worlds. D-036 slots land with island generation (M4). All tier 2–4
content (D-033, D-034, D-037–D-039) is authored after the first playable.
