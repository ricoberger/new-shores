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
  launch. New-region goods become needs of **new** tiers or **`optional`**
  needs (bonus only, MECHANICS §6.2) of existing tiers.

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
- *Bootstrap rule:* producers of a tier's construction materials (and of the
  goods needed to upgrade into that tier) are staffed by the previous tier,
  so the first houses of a tier can always be built (MECHANICS §4). This is
  why quarry, iron mine, charcoal burner, smelter and toolmaker are
  Settler-staffed although they unlock at Citizens.

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
by a tier are reachable with the islands unlocked at that tier. Refines
D-016: all islands stay visible; only *settling* is gated.

- *Rejected:* settle freely (archipelago "done" in week one); islands via
  expeditions (core progression behind RNG timers).

## D-040 Sequencing

**Decision:** D-031 (categories + variety) and D-035 (workforce) are
implemented in the next simulation task (houses/needs/taxes) with tier-1
numbers, since retrofitting them later would rewrite the needs code and
migrate worlds. D-036 slots land with island generation (M4). All tier 2–4
content (D-033, D-034, D-037–D-039) is authored after the first playable.

## D-041 One recipe per building; selectable recipes deferred

**Decision:** A production building has exactly one recipe at launch. Where
the catalogue wants two outputs from similar inputs (tannery → leather
jerkins vs leather for the tailor), two building types are used
(`tannery`, `leather_works`). Player-selectable recipes per building are a
new mechanic (command, display state, UI control) and are deferred; the
content format keeps `recipes[]` as an array so enabling them later is
additive.

- *Rationale:* keeps the first needs/production implementation small; two
  building types cost one content entry, selectable recipes cost sim + UI
  work and a decision about switching costs/buffers.
- *Refines:* D-034.

## D-042 Placement without roads, edge connection, free move

**Decision:** Buildings can be placed without a road (they are simply
`not_connected` until one reaches them); a building is road-adjacent when
*any* road tile touches *any* footprint tile — there is no entrance tile and
rotation is visual only; any building except roads can be **moved** for free
to another valid position on the same island, keeping its ID and full state
while goods in transit keep arriving (MECHANICS §2, §3; UI.md §3).

- *Rationale:* playtesting the first visible island (PR #4) showed the
  entrance rule as the main source of confusing placement errors ("no road
  at entrance (9,5)") and forced a road-first build order. Anno 1404 uses
  edge adjacency; Anno 1800 allows free moving — both are the clearer,
  friendlier behaviour and fit touch input (D-024).
- *Consequences:* road distance is measured from the nearest adjacent road
  tile; building-need radius is footprint-to-footprint; one connectivity
  rule for all buildings — a road path to a warehouse; houses on a detached
  road stub are not connected; the `MoveBuilding`
  command is added to the API; the client's placement ghost turns yellow,
  not red, without a road.
- *Rejected:* keeping an entrance tile (layout puzzle not worth the
  friction); move as demolish + place (loses state and refunds); a gold fee
  for moving (nothing to exploit, since transit is preserved).
- *Supersedes* the entrance wording of D-014 and MECHANICS §2 as
  implemented in PR #2/#4.

## D-043 Database clock after the row lock; pending events bound requests

**Decision:** In persistent mode the time a world is advanced to is read
from PostgreSQL once per Update, **after** the world row lock is held
(`statement_timestamp()` truncated to milliseconds). A request advances a
world only up to the `due_at` of its earliest pending scheduled event and
leaves the event to the worker; `failed` events do not hold a world back.
Worlds are unique per `(player_id, region)`.

- *Rationale:* one clock for all instances avoids false `ErrTimeBackwards`
  between replicas; `now()` is frozen at transaction start — before the
  lock wait — so the second of two concurrent commands could observe a
  time earlier than the first one committed (reproduced by a test).
  Bounding requests by the next due event keeps "events apply exactly at
  `due_at`" (D-026) without processing events inside request transactions
  (which would need cross-world locks on the request path).
- *Consequences:* a world can appear frozen for up to about a second around
  a due time; the events worker reads any "now" it needs after its locks
  as well. Region-scoped uniqueness keeps D-010 (regions first-class)
  migration-free.
- *Rejected:* server clocks per request (skew between instances);
  transaction `now()` (the race above); processing due events inline on
  requests (lock-order complexity).

## D-044 Accounts: guest device tokens, cookie/bearer sessions, Origin-based CSRF

**Decision:** Guest play creates a player + world and returns a session plus
a device token; registering upgrades the guest in place (device token
revoked) or, without a session, creates a new player. Passwords use
argon2id (t = 2, m = 19 MiB, p = 1, PHC format; raised by re-hashing on
login). Sessions live in PostgreSQL with hashed tokens and a 30-day sliding
expiry; the `transport` field selects an HttpOnly SameSite cookie (browser)
or a bearer token (apps). Cookie requests are CSRF-protected by the
`Origin` header (must be in `ALLOWED_ORIGINS`), with `Sec-Fetch-Site`
same-origin/same-site accepted when `Origin` is absent and rejection
otherwise; `Referer` is never consulted. Auth endpoints are rate-limited
per IP and per email via Redis and **fail open** when Redis is down.
Metrics are served on a separate listener that is never proxied.

- *Rationale:* lets players start without an account (GAME_DESIGN) while
  keeping one session model for web and Capacitor; Postgres-backed
  sessions keep Redis ephemeral (D-025); Origin/Sec-Fetch-Site is the
  modern CSRF check and avoids Referer leakage; failing open on the rate
  limiter degrades gracefully instead of taking login down with Redis.
- *Rejected:* cookie-only sessions (blocks the apps); Referer fallback;
  returning 503 when Redis is unavailable; stateless JWT sessions (no
  revocation).

## D-045 Single-world due moments are simulation boundaries

**Decision:** Effects that concern one world and are known in advance by
the simulation — a ship finishing at the shipyard, a ship arriving at a
stop — are applied by `advance` itself as boundaries at exactly their due
millisecond. Scheduled events for these moments still exist: they make an
offline player's world advance on time, trigger the push and schedule
follow-ups, but their handlers are no-ops when the effect has already
happened. The store reconciles pending events against the simulation's
due moments inside every transaction, so each due moment has exactly one
pending event. Cross-world effects (trades, gifts, raids) remain
handler-only.

- *Rationale:* a world that is advanced for any reason (a request, a
  resume from insolvency during catch-up, a missed or late event) must
  never leave a ship overdue; the piecewise model already treats "a timer
  fires" as a boundary, so this is the natural place. It also removes the
  need for tests to imitate the worker.
- *Consequences:* a request capped at a pending ship event (D-043) applies
  the effect and the worker only reconciles follow-ups; ship departures
  are not boundaries (no rate changes) but are included in
  `next_change_at`; the dev server needs an in-process scheduler that runs
  the same handlers at due time.
- *Rejected:* handler-only application (overdue ships after offline
  resumes or missed events).

## D-046 Never-pausable buildings carry no upkeep

**Decision:** Buildings that the insolvency cascade never pauses (houses,
warehouses, roads, shipyard, harbourmaster, decorations, tier-1 market and
chapel) have zero upkeep; their running cost is folded into their
construction price. Pausable public buildings (tavern and up) keep upkeep.

- *Rationale:* D-009 promises "stall, don't ruin". With unpausable upkeep a
  fully stalled city could sit at gold 0 with a negative balance forever
  and never accumulate the reserve needed to resume anything; with this
  rule the floor-level taxes always leave `balance_rate ≥ 0` once
  everything pausable is paused.
- *Consequences:* prices of warehouse, market, chapel and shipyard rose
  (200 / 225 / 275 / 225 gold); the reference-game timings still hold.
- *Rejected:* a flat subsidy income (hides the economy); lowering unpausable
  upkeep without removing it (only moves the threshold).

## D-047 Trial resume of unpaid buildings

**Decision:** An auto-paused building whose recomputed balance would still
be negative is nevertheless resumed once gold reaches
`trial_resume_upkeep_minutes` (30) of its upkeep. If the balance stays
negative the gold-zero cascade pauses it again and the next trial needs
the reserve to refill. Trials are independent per building; at most one
resume of any kind per millisecond.

- *Rationale:* the resume check (MECHANICS §7 b) counts taxes but cannot
  know the goods a paused producer would make; with no food in stock or in
  transit the check can never pass, so the only recovery was manual. The
  trial is general (works for any tier and layout), bounded (one attempt
  per window of at least the trial reserve's burn time) and keeps the
  normal rule as the fast path. Measured: stalled tier-1 city restarts in
  ≈ 54 min; 24 h alone → 4 trials.
- *Rejected:* making the fisher unpausable (special case; recurs at tier
  2 with bread); counting the candidate's own output in the resume check
  (changes every decision, flapping risk); serialising trials (slower
  recovery for no safety gain, since each trial already paid its reserve).

## D-048 Art direction: light and colour first, one continuous world

**Decision:** The visual target is Anno 1404's warm golden-hour feeling,
carried by light, colour and animated life rather than textured detail
(flat-shaded, one palette, no photo textures). The client renders **one
continuous world**: all islands in one scene at their archipelago
positions with sea between, free pan and continuous zoom with zoom-based
LOD, a minimap, four 90° camera rotation steps; the separate archipelago
view is removed and routes are edited in a panel (clicking islands stays
a shortcut). Terrain is continuous with the grid shown only while a tool
is active; the HUD is themed-flat Anno (parchment, dark wood, brass, icon
set, CSS-only ornament); buildings and ships are kit-bashed by data
recipes from CC0 Quaternius kits through a Blender script with enforced
footprint and triangle budgets; every animation encodes a game state.
Full brief: docs/ART_DIRECTION.md.

- *Rationale:* mechanics are stable, so visuals will not be redone; a
  flat-shaded kit with strong light and colour reads "Anno-like at a
  glance" within the mobile budget, while textured detail would fight the
  kit and the phones. The continuous world is how Anno plays, removes a
  concept (two views), and reuses the PR #10 silhouettes, ship
  interpolation and route ribbons as the far LOD.
- *Refines:* D-024 (the "three views" become one 3D world scene plus the
  2D world-map screen; rotation in 90° steps is now allowed) and the
  asset-pipeline section of ARCHITECTURE.
- *Rejected:* textured/painterly materials (artist-bound, texture memory);
  AI mesh generation as the default pipeline (style drift, licences);
  keeping the archipelago view as a mode; day/night cycle and seasons.

## D-049 Explicit fields for farms

**Decision:** Farms need **fields**: 1×1 placeables of a per-crop type
(`pasture`, `pig_pen`, `wheat_field`, `orchard_plot`, `hemp_field`,
`hop_field`, `woad_field`, `vineyard_row`, `meadow`), free or near-free, no
upkeep, no road, never auto-paused, placed only on matching terrain (and
fertility) inside the work radius of a farm that accepts the type. A field
belongs to the nearest accepting farm (ties by ID); the farm's efficiency is
`min(1, assigned_fields / required)` (provisional 16 on a radius-4 disc).
Fields occupy tiles, can be moved and demolished, and are placed by tap or
by dragging a rectangle (preview on valid free tiles, one command on
release); there is no auto-fill. Lumberjack, fisher and trapper keep the
implicit terrain rule. Supersedes the implicit "free matching tiles /
required_tiles" rule of MECHANICS §2 for farms.

- *Rationale:* Anno's farms are a spatial puzzle and make islands look
  farmed; the implicit disc gave neither. Shared field types (pasture for
  sheep, dairy and cattle) add a small layout decision without new rules.
  Still "efficiency recomputed on placement change" — lazy-model safe.
- *Consequences:* a `fields {type, required}` building block; field
  placeables in content with their own models (asset task); scenario
  runner `fields` step; the tier 1–2 reference games are re-verified with
  fields; farm panels show `n / required` on the radius ring.
- *Rejected:* auto-fill button (hides the puzzle; rectangle drag is enough);
  per-farm private field types (needless content).

## D-050 Chunky stylised look: KayKit lead, baked shading, diorama islands, real models at every zoom

**Decision:** The visual style is **chunky stylised flat-shaded** with
exaggerated silhouettes: KayKit (Medieval Hexagon, Forest Nature; CC0) is
the lead kit for buildings and nature, the Quaternius Pirate Kit supplies
ships and harbour props, the Quaternius Medieval/Nature kits are dropped.
Richness comes from **ambient occlusion and two-tone shading baked into
vertex colours** (one palette, no textures). Islands are **dioramas**: the
coastline is a slab with a layered cliff and sand rim, mountains are
rounded rock plateaus with a moss cap and boulders, scatter is clustered.
**Every zoom level shows real models** — full at near and mid, ≈ 25 %
decimated lite models at far — with no block or treetop stand-ins; all
geometry for an island is built once and only toggled on zoom.
Performance is validated on a **baseline device** (iPhone 15 Pro Max:
60 fps at all LODs on both dense fixtures); the software-WebGL perf
project keeps per-LOD floors at 0.8 × that build's software fps as a
regression tripwire, CI's fps check is a render sanity check, and e2e
specs isolate through a dev-only world reset endpoint.

- *Rationale:* the Quaternius kit-bash came out boxy; KayKit's shape
  language gives the Siedler/1404 charm the owner wants while staying flat
  shaded, which keeps consistency and makes future AI- or agent-generated
  models a cleanup problem (quantise to palette + bake AO), not an art
  problem. Real devices ran at 60 fps with 3–10× headroom over the
  software guard, so designing to SwiftShader was the wrong constraint;
  blocks at far looked bad and lite models keep silhouettes.
- *Refines:* D-048 (its "mid = blocks, far = silhouette" LOD and
  "Quaternius lead" are superseded; light, palette, continuous world,
  HUD rules stay). D-024's "no elevation" still holds for rules; plateaus
  and the slab are render-only.
- *Rejected:* textured/PBR materials (consistency, UV/texture work);
  Anno-Online-style pre-rendered sprites (needs high-detail source art,
  2.5D renderer); hex grid (different game; D-006's rectangular layout
  puzzle); block LOD at far (ugly); thinning the look to satisfy the
  software guard.
- *Update (PR #17):* the Quaternius Pirate Kit is gone too — the KayKit
  SOURCE editions (which add ships, boats, docks, carts and animals) are
  the only kits; the sloop is the KayKit `ship`.

## D-051 Settling at sea, Trading Post and Warehouses, water-edge footprints, fields v2, berths, free camera

**Decision (seven parts):**
1. **Start at sea.** The player's sloop holds the starting stock; no island
   is settled; every island can be settled from the start and nothing is
   gated by tier (supersedes D-039's unlock ladder; the generator's
   resource guarantees stay). The first building is the **Trading Post**,
   placed from the ship.
2. **Trading Post vs Warehouse.** The Trading Post (one per island,
   coastal, levelled) holds the island's capacity, is its pier and the
   endpoint for ships/founding/trades; **Warehouses** are inland
   collectors with throughput only (levelled), never capacity. Producers
   are assigned to the nearest collector by road.
3. **Water-edge footprints:** Trading Post, fisher and shipyard declare
   `water_tiles: n` front rows that must be water (2/4, 1/2, 2/4).
4. **Fields v2** (supersedes the radius/nearest-farm parts of D-049):
   crops 1×1, pastures and pig pens 2×2; placed only from the farm's
   panel; valid when adjacent to the farm or to one of its own fields
   (ownership by chain, orphaning on disconnect); tile totals unchanged.
5. **Berths:** per Trading Post level; arrivals queue for a free berth;
   handling = 10 s + 0.2 s/unit; harbour buildings later add berths.
6. **Camera:** free rotation with soft snap to 45° on release, world-fixed
   sun, compass on the minimap replaces the rotate buttons.
7. **Satisfaction stays per house**; the HUD shows island aggregates.
   Rivers and real elevation are deferred, not rejected.

- *Rationale:* the original brief ("start with a ship and choose the
  island") and the Anno 1404 Kontor/market split make storage and
  collection two distinct decisions; adjacency fields read as farms and
  make ownership trivial; berths give harbours a reason to grow; free
  rotation suits a true 3D scene and the compass is the Anno idiom.
- *Consequences:* content renames (`warehouse` → `trading_post`; new inland
  `warehouse`), a schema bump (4) — no migration, the game was not
  deployed and old worlds fail to load; reference games re-verified with
  the sail-and-found opening, new e2e fixture `seafaring`; D-049's
  `required` becomes a field count.
- *Status:* parts 1, 2, 3, 5 (settling, Trading Post/Warehouse,
  water_tiles, berths) shipped in PR #19; parts 6, 7 in PR #17; part 4
  (fields v2) open. As built: founding from afar is two commands
  (`sail_ship`, then `found_island` on arrival); berths gate arrivals only
  (loading holds no berth; an island without a Trading Post has no pier
  and handles at once); ship legs are straight and may cross land
  (follow-up: routing around islands).
- *Rejected:* a pre-settled tutorial island (contradicts the brief);
  warehouses adding capacity (storage spam); island-wide satisfaction
  (kills the public-building radius puzzle); rotation without snapping.
