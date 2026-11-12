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

*Refinement (PR #26, D-053 scale):* the camera's maximum zoom-out is a
content constant (120 tiles half-extent — about one large island) rather
than "fit the archipelago"; the minimap is the overview, as in Anno. The
far view is per-chunk culled with one simplified tree mesh per island;
islands without loaded tiles and non-focused islands at far draw a
merged mesh from a 1:4 terrain mask. Landmarks of settled neighbours are
not visible on the mask mesh (follow-up).

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
- *Refinement (PR #30, owner's playtest):* unsettled islands are **no
  longer desaturated** at far or on the minimap — the grey made the
  archipelago look dead; labels, settled badges and the far landmarks
  (Trading Post, shipyards as lite models on mask-drawn islands) tell
  settled from unsettled. The `unsettled` palette role is unused (art
  follow-up). Island detail is built **incrementally** under a per-frame
  time budget (6 ms desktop / 4 ms phone) from a queue ordered focused
  island → visible chunks → distance; the mask mesh draws the island
  until complete, nothing is built before the first rendered frame.

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
- *Status:* **all parts shipped** — 1, 2, 3, 5 in PR #19; 6, 7 in PR
  #17; 4 (fields v2) in PR #20 (schema 5; edge adjacency, fields bound to
  a farm instance, unmovable, small gold cost; pasture 15 gold / 0 planks
  because 2 planks missed the §12 reference targets; `cattle_pasture`,
  `pig_pen`, `meadow` reserved until their farms get recipes; PR #24 set
  `fields.max = fields.required` for every farm until a mechanic gives
  extra fields a meaning — open question). As built: founding from afar is two commands
  (`sail_ship`, then `found_island` on arrival); berths gate arrivals only
  (loading holds no berth; an island without a Trading Post has no pier
  and handles at once); ship legs are straight and may cross land
  (follow-up: routing around islands).
- *Rejected:* a pre-settled tutorial island (contradicts the brief);
  warehouses adding capacity (storage spam); island-wide satisfaction
  (kills the public-building radius puzzle); rotation without snapping.

## D-052 Flows and performance are validated by playtest; automated e2e, visual and perf suites suspended

**Decision:** during the polish and content phase the owner validates
client flows and performance by playing on the baseline device (iPhone
15 Pro Max, `make preview HOST=<lan-ip>`, `?stats=1`) and on the desktop.
The Playwright suites (flows, touch, PWA, visual baselines, perf
tripwire, Lighthouse, ttfi) were removed in PR #23 and stay in git
history. `make shots` and `make model-sheet` are the review instruments:
their PNGs go into every PR report that changes the look. The dev reset
endpoint, the dev fixtures and the `window.__newShores` hook remain for
them.

- *Why:* the suites' catch record was small compared with their cost —
  every art change broke the scene baselines by design, the full run
  took 20 minutes per agent session, and the perf floors on software
  WebGL only ever confirmed what the device already showed. Reviewer
  rounds and goldens found the real bugs. Agent sessions must iterate
  cheaply now.
- *Still binding:* Go goldens, property tests, `TestPurity`, the API and
  store integration tests, Vitest for display and render maths, the
  asset build checks. D-050's perf requirement stands — it is checked on
  the device at each art gate, not in CI.
- *Revisit:* before the first public deployment, restore a small core
  flow set (start at sea → found → build → route; touch sheet) in CI;
  the removed specs are the starting point.
- *Supersedes:* the perf-guard and e2e consequences of D-050 and the
  M3 acceptance text in FIRST_PLAYABLE §3.

## D-053 Seeded archipelago generator: ~12 islands, fixed composition, re-roll before founding

**Decision:** every world gets a generated archipelago from a seed stored
on the world; generation is a pure function of (seed, content) in
`internal/sim` (goldens and `TestPurity` apply). The hand-written
two-island `devworld` archipelago is retired; `--dev`, fixtures and the
reference games use fixed seeds.

1. **Composition is fixed, the layout is random.** 12 habitable islands:
   3 large (≈ 48×48), 5 medium (≈ 32×32), 4 small (≈ 20×20); plus 0–2
   **resource rocks** (≈ 10×10, mountain and coast only, room for a
   Trading Post and mines) that do not count toward the 12. *(Rocks
   removed by D-073; they never generated.)* Every
   fertility and deposit of the region's pool appears within a fixed
   count range; total buildable area within ±10 % of a target; one
   **home candidate** (large; forest, grass, stone and wheat or apple;
   never iron or hemp) is guaranteed. Archipelagos therefore differ in
   shape, not in odds.
2. **Re-roll** ("Another archipelago") is allowed until the first island
   is founded; afterwards the archipelago is final.
3. **Shapes:** blobby outlines, a one-tile coast ring, 1–2 mountain
   clusters carrying the deposit slots, 1–3 forest patches, grass
   elsewhere; every habitable island has ≥ 2 valid Trading Post sites and
   ≥ 1 shipyard site (verified, retry otherwise). No rivers, lakes or
   plateaus yet (plateaus may follow once the islands are seen).
4. **Spacing:** islands ≥ 60 tiles apart, nearest neighbour ≤ 150 tiles;
   the start ship spawns at the archipelago's centre with the whole map
   visible at far zoom.
5. **Names** come from a content word list, unique per archipelago; the
   owner of a settled island may **rename** it (server-validated, 1–24
   printable runes).
6. Pools, counts, sizes and the name list are content
   (`region.json` / `islands.json` / `island_names.json`), not code.

- *Why:* two fixed islands made every world identical; a fixed
  composition keeps the game fair across re-rolls while the first choice
  (which island to found on) stays meaningful; rocks give mining outposts
  a reason to exist.
- *Consequences:* schema 6, no migration; a `reroll_archipelago` and a
  `rename_island` command; MECHANICS §10 and CONTENT §9 updated; the far
  view, minimap, camera fit, first load and ship legs across land are
  re-judged in polish round 3 on the larger world. Supersedes the island
  count and the generator text of D-039 and MECHANICS §10 (6–8 islands).
- *Rejected:* fully random composition (unfair re-rolls); a fixed
  hand-made archipelago for everyone (no discovery); 6–8 islands (too few
  for 12 settle-anywhere players' worth of variety).
- *As built (PR #25):* `internal/sim/archipelago` with its own integer
  PRNG; `content/old_coast/islands.json` (size classes 48/32/20, rock 10;
  fertilities wheat/apple/hemp 3–5, hops/woad/grapes 2–5; stone 3–6, iron
  2–4; buildable area 6 550 ± 10 %; spacing 60 / nearest ≤ 150; 64
  archipelago and 64 shape retries) and `island_names.json` (48 names);
  dev seed 1053001 (`--seed`); goldens for seeds 1053001, 1, 42 and
  200-seed property tests; `reroll_archipelago` (409
  `reroll_not_allowed`) and `rename_island` (400 `invalid_name`);
  `size_classes` in the content payload; the ship spawns ≥ 10 tiles from
  land. Reference timings 99 / 136 min. **Sizes are provisional:** the
  footprint rework (D-054 candidate, Anno-117 footprints) decides the
  final area target; the client needs chunked terrain and per-island
  loading before large islands grow past ~100 tiles (far draw calls were
  already 3.7× the two-island baseline at 48×48).

## D-054 Building footprints, costs and fields follow Anno 117 Latium

**Decision:** every building's footprint is taken from its Anno 117
Latium counterpart (or the nearest same-role Latium building; no Albion
sizes), construction materials and upkeep are derived from Anno's by
fixed rules (CONTENT §7 header), gold, workforce, cycle times and ratios
stay ours. Field counts and per-tile prices are Anno's: crops 60–160
one-tile fields painted by rectangle drag, animal farms 3–5 pasture
modules (`pasture` 3×3, `pig_pen` 3×4, `cattle_pasture` 4×7). Specific
points: houses 3×3 at every tier; Trading Post 6×9 with 3 water rows;
shipyard 8×12 with 4 water rows (a once-per-island landmark); warehouse
6×6 with radius and throughput per level; chapel stays a 3×3 shrine, the
6×10 church arrives at tier 3; mines and quarries are 3×8 strips on a
mountain slot; mill, glass smelter and clay pit sit on plain land or a
deposit slot (we have no rivers). The full table is CONTENT §7.

- *Why:* uniform 2×2/3×3 boxes made towns look samey and islands tiny;
  Anno's sizes carry information (a fishery is a pier, a quarry a strip,
  a theatre a landmark) and give the island area target a basis. One
  reference (Latium, ~83 economy buildings — the size of our catalogue)
  keeps future content consistent without reopening the discussion.
- *Consequences:* fields are **painted**: a `place_fields` batch command
  validates every tile and applies the valid ones atomically, returning
  the rejected ones; the ghost shows per-tile validity while dragging;
  demolish gets the same rectangle. `fields.max = fields.required` stays
  (D-051). The island area target rises to ≈ 16–20 k buildable per full
  four-tier island (large ≈ 192×192, after the client scaling task).
  Every recipe in `assets/build` is re-fitted; dense fixtures, scenarios,
  goldens and the reference games are regenerated; CONTENT §12 targets
  hold; MECHANICS §4 (fields) and UI §3 (painting) update with the
  implementation. Schema bump, no migration.
- *Parked (own decisions later):* Anno's shrines (set bonuses → our
  variety mechanic, D-031), marvels (prestige goals, Doubloon-free),
  city watch / amenities (a risk mechanic; conflicts with D-009 unless a
  soft efficiency effect); military, aqueducts and river slots are out.
- *Rejected:* footprint classes (a second table for a number already in
  the row); Anno's absolute rates and costs (tuned for a real-time game;
  our pacing is D-006/D-009); 1:1 copy of Albion sizes.
- *As built (PR #27 server/content, PR #28 models):* content
  `old_coast-0.10.0`, schema 7. Gold rule corrected: Anno's gold ÷ 3 for
  producers and harbour buildings (shipyard 300 g / 45 planks, lumberjack
  60, sawmill 120), public buildings keep Anno's gold; roads 1 g / 3 g +
  1 stone; upkeep 0 for never-pausing buildings (D-046); quarry costs no
  stone. Fields 140/60/160 and 3 pastures 3×3, `max = required`;
  `place_fields`/`demolish_fields` batch commands. Islands 192/112/64/16,
  area target 91 000 (**provisional until the tier-3/4 populations are
  known; raise by adding mediums, not by enlarging**), spacing 100/300,
  dev seed 1053001 (87 797 buildable). Reference games hold all §12
  targets (59/62/88/141; quests 44/70). Terrain in `world_terrain`,
  generator 65 ms. Models: triangle budgets scale with footprint area
  (1 500 tris per tile for buildings, 625 for houses, 75 for fields; cap
  72 000), all 30 recipes re-fitted with life anchors (carts, berths 1–4,
  boat, gate + sheep positions); the models folder (8 MiB) was the
  binding limit, so the large footprints are mostly yards around a
  modest structure — a "structure, not slab" pass is the first item of
  the client follow-up (B2).

## D-055 Ships have names the player can change

**Decision:** every ship has a **name**, stored with the ship. A new ship
(built at a shipyard or the start ship) is named "<ship type name> <id>"
("Sloop 1"); the owner may rename it in any state with `rename_ship`.
The name is trimmed and follows the island-name rule (1–24 printable
runes, D-053 §5); names need not be unique; an empty name restores the
default. The client shows the name wherever it refers to a ship (ship
panel, Ships list, route editor, toasts, dialogs, the away summary); the
ship panel shows the type below the name, the ID is no longer shown.

- *Why:* "Sloop #2" said nothing about the ship; with several ships on
  routes the player wants to tell them apart, as with islands and routes.
  A stored default name follows the routes ("Route <id>"), so the client
  never composes a ship's label.
- *Consequences:* schema 8 with a 7→8 migration that names the existing
  ships; `name` on the ship display; a `rename_ship` command (400
  `invalid_name`, 404 `ship_not_found`); MECHANICS §9.1 and UI §4 (ship
  panel) updated. Rename is a display change with no gameplay effect.
- *Rejected:* auto-names from a content word list (a second list to
  curate; the type and number are a clear default); unique names (no
  need, unlike island labels on the map); showing "Name (#id)" (the
  number carries no meaning for the player).

## D-056 Content depth: weighted needs, cumulative tiers, services ladder, ship ladder, pacing for tiers 3–4

**Decision (interview 2026-10-27, owner + design lead; inputs: the
Anno 117 Latium need tables and residence caps, Anno 1404's unlock
curve, D-054's footprints):**

1. **Weighted coverage (supersedes D-031's fulfilment and variety
   bonus).** A goods or services need is a **category** with 1–3
   alternatives; every alternative supplied contributes a **share**
   (content; **0.6 for every good and service**, symmetric), category
   coverage = `min(1, Σ shares of supplied alternatives)`. One
   alternative gets a house to 60 % of the category, the second fills
   it. Residents and tax scale with satisfaction as today; there is no
   variety bonus and no per-good residents/gold bonus (the 117 bonus
   layer was considered and parked — it can be added on top later if
   playtests ask for more decisions). Partial supply of a good scales
   its share as before (`consumed / demand`).
2. **Cumulative tiers (supersedes D-033's "lower-tier goods do not
   satisfy higher tiers").** A house has the **required categories of
   its own tier (own goods only)** *plus* the categories of every lower
   tier as separate needs with **lower per-resident rates**, as in Anno
   117 (Patricians still eat fish, a Patrician house of 40 about as much
   as four Settler houses): rate at a higher tier = own-tier rate ×
   (own tier max residents / higher tier max residents) × 0.5^(tier
   distance / 3), rounded in content — roughly the same per-house rate
   as the house it grew from, tapering to half by tier 4 (fish 0.010 →
   0.0042 / 0.0020 / 0.0010). Weights: the own tier's
   categories share **60 %** of satisfaction, all lower tiers together
   **40 %** (provisional). Lower goods therefore matter but can never
   substitute for the tier's own goods.
3. **Services are one cumulative category** per house: every public
   building of the house's tier or below counts with share 0.6 (radius
   rule as today). Ladder: tier 1 `market_small` (levels 1–3 raise the
   radius 12 → 16 → 20; same ID, display "Market") and `chapel`; tier 2
   `tavern` and `school`; tier 3 `church` and `theatre`; tier 4
   `university` and `cathedral`. `market_medium`/`market_large` are
   dropped (never shipped).
4. **Upgrade gate:** the next tier unlocked ∧ every required category
   of the house's *current* tier ≥ 0.6 (one alternative each) ∧ the
   house at `max` residents ∧ the cost. The second alternative is never
   needed to progress.
5. **Tier plan (two alternatives per category from tier 2):**
   Settlers food fish, clothing wool_garments; Citizens food bread |
   cheese, drink cider | mead, clothing linen_garments | leather_jerkins;
   Merchants food sausages | pies, drink beer | brandy, clothing coats |
   dyed_garments, comfort books | soap; Patricians food roast_beef |
   oysters, drink wine | grain_spirit, clothing fine_garments | lace,
   comfort candles | spectacles, luxury jewellery | instruments.
   Residents 8 / 15 / 25 / 40 (floors 2 / 5 / 8 / 12). Construction
   goods stone, tools, bricks (`clay_pit` stays), glass and the
   intermediates salt, coal, barrels, brass, gold_bars as in CONTENT §5.
   **Variety reserve for content updates** (IDs stay reserved):
   fur_coats (`trapper`, `furrier`), tableware (`potter`), confectionery
   (`confectioner`), paintings (`mineral_quarry`, `studio`).
6. **Unlocks** (Anno 1404's doubling): Citizens 120 Settlers +
   `market_small` + `chapel` (as today); Merchants **360 Citizens +
   `tavern`**; Patricians **1 200 Merchants + `church`**. The
   `goods_delivered` and `harbourmaster_office` conditions are dropped
   from the unlocks. Tax per resident per minute 0.2 / 0.48 / 0.9 /
   1.6 (provisional; tuned by the reference games).
7. **Recipe input alternatives**, generalised: a recipe input may list
   several goods in preference order (`["charcoal", "coal"]`); the
   consumer draws whichever is available. Coal replaces charcoal 1:1 in
   every charcoal-burning recipe.
8. **Generator guarantees ≥ 1 gold slot** per archipelago (the single
   gold deposit; jewellery is 0.6 of luxury, so an archipelago without it
   would only be poorer, but we guarantee it anyway).
9. **Ships:** `sloop` **2 slots** (start ship; buildable from tier 2),
   `brig` **4 slots** (tier 3), `galleon` **6 slots** (tier 4); equal
   speed; the **shipyard unlocks at tier 2** without levels and builds
   every unlocked type. (The start ship still carries the founding
   stock; the second ship comes after Citizens.)
10. **Unlock feedback:** a client toast on the `tier_unlocked` boundary
    ("Citizens unlocked — n new buildings", display only) and a **quest
    chain per tier** in content whose first quests point at the new
    infrastructure (shipyard rewarding the sails for the first sloop,
    tavern, school, …).
11. **Pacing targets (CONTENT §12, sim minutes, attentive play, not
    faster):** Merchants unlocked ≤ 240, first Merchant house ≤ 270,
    Merchant chains complete (every category ≥ 0.6) ≤ 420; Patricians
    unlocked ≤ 900, first Patrician house ≤ 960, Patrician chains
    complete ≤ 1 800. Tier 1–2 targets unchanged.
12. **Order of work:** (1) need model + tier-2 completion (server/
    content) with its models session; (2) tier 3; (3) tier 4; playtest
    between tiers; models sessions depend only on §7 footprints and may
    run in parallel. Island area target (D-054) re-checked after tier 3.

- *Why:* the Anno 117 structure (categories with alternatives, bonus for
  the second, cumulative base goods) gives choice and resilience (D-009:
  a stalled chain trims a house to 60 %, never to zero) without a hard
  gate; weighted shares express it with the existing coverage mechanic
  and one number per good instead of a bonus layer. Two alternatives per
  category match 117's shape (26 consumer goods vs 1404's ~22) — depth
  comes from the shared intermediates (pigs, wheat, charcoal, salt,
  barrels) and the fertility/deposit spread, not from a third good.
  The services ladder reads as a town growing up; the ship ladder gives
  routes a reason to upgrade (a three-good supply run needs the brig).
  Pacing follows Anno Online's weeks, not 1404's evening.
- *Rejected:* "every need required, no alternatives" (1404 basic; a
  checklist, dead alternatives); the full 117 bonus layer (residents
  *and* gold per good — two numbers per good and new house-card states
  for a benefit we cannot see yet); three goods per category at tiers
  3–4 (chains, not decisions); keeping D-033 (per-tier goods only —
  simpler, but the base chains would stop mattering for upgraded
  towns); a `bathhouse` as second tier-2 service (school chosen);
  shipyard levels; separate `market_medium`/`market_large` buildings.
- *Consequences:* content format: `needs.json` goods and buildings gain
  `share`; `variety_bonus`/`max_extra_goods`/`optional_tax_bonus` go;
  a tier's need list includes the lower tiers' categories with their
  rates; `market_small` gains `levels`; recipes' `inputs[].good` may be
  a list; `ships.json` slots 2/4/6; `tiers.json` unlocks as above;
  `quests.json` per-tier chains. Sim: coverage formula, cumulative need
  lists, input alternatives, upgrade gate, market levels; schema bump.
  UI: the house card shows every category of every tier as bars (no
  grouping yet — polish item), the toast. CONTENT §2, §5, §6, §7, §8,
  §12 and MECHANICS §6, §12 updated with this decision; MECHANICS §6.2
  describes the implemented formula once the first session lands.
- *Amendment (S1 findings, same day):* (i) **a category with exactly
  one alternative has share 1.0** (a lone alternative fills it; 0.6
  each from two alternatives on) — otherwise Settlers, who have one
  alternative per category by design, could never exceed 0.6; (ii)
  **tax is tuned to the one-alternative baseline**: Citizens 0.8,
  Merchants 1.5, Patricians 2.7 per resident per minute (Settlers 0.2),
  so a town with one chain per category earns what it earned before and
  full coverage earns up to 1.67× — the reward for the second chains;
  (iii) **the founding cargo is exempt from slot limits**: the world
  generator loads the start stock onto the sloop regardless of its two
  slots, slot checks apply to player loading, and the stock moves to the
  Trading Post at founding (D-051) as today.
- *As built (PR #34 S1; PRs #31/#32/#33 models M2/M3/M4):* content
  `old_coast-0.11.0` (the schema bump S1 reported was not committed;
  C3 moved the code from 8 to 10). Weighted shares with the loader default
  (1.0 lone / 0.6 each), cumulative lower-tier categories at the reduced
  rates, one `services` category per tier, `market_small` levels 1–3 via
  the generalised `upgrade_building` (`upgrade_warehouse` /
  `upgrade_trading_post` kept as deprecated aliases), the upgrade gate at
  ≥ 0.6 (a sim constant, counting carried lower-tier needs too), recipe
  input alternatives (charcoal | coal; a slot is never split), the
  cheese / mead / leather_jerkins chains with their modules, `school`,
  sloop 2 slots at tier 2, brig / galleon authored and tier-locked,
  founding cargo exempt, unlock toast (live sessions only; an unlock
  while away is a follow-up for the letter) and a five-quest tier-2
  chain (shipyard → second sloop → tavern → school → cheese). Patricians
  unlock without the church until it is authored; market level 3 costs
  no bricks until bricks exist (C3). Reference game (dev seed): island 2
  52, Citizens 30, first Citizen house 88, tools home 132 (quests 34 / 21
  / 73 / 117) — the earlier unlock comes from the chapel now paying for
  itself as a Settler service (built at 29 instead of 61) and the start
  sloop founding island 2; Settler income is within ±2 % of before once
  market and chapel stand, 15 % lower before the chapel. Models for
  every tier-2/3/4 building and ship exist ahead of their content via
  `assets/build/planned/tier{2,3,4}.json` (read beneath the content;
  content wins); models folder 20.2 MiB of a 24 MiB limit (≈ 64–74
  bytes/triangle; a quantised export is the follow-up).
- *As built (PR #35 C3, tier 3):* sim schema 10, content
  `old_coast-0.12.0`. Every tier-3 chain, good, building, field and
  deposit of CONTENT §5/§7 as written (no number changed), `coal` makes
  the charcoal | coal inputs real, `bricks` price market level 3,
  `house_merchants`, Merchants needs with the carried Settler and
  Citizen categories, `church` + `theatre` in the services ladder, the
  church in the Patricians unlock, brig buildable, `market` level 2;
  content gains `smoke` and `boat` flags (the asset loader derives the
  chimney/boat anchor requirements from them) and ships `length_tiles`
  (sloop 2 / brig 2.6 / galleon 3.2; Trading Post berths spaced by it);
  `market_small` renamed to `market` (old ID retired); tier-3 deposits
  (clay 2–4, salt 1–3, coal 1–3, never on the home island) in their own
  generator pass so tier-1/2 worlds are unchanged; tier-3 quest chain
  (the brig quest asks for three ships — no per-type condition exists;
  the second-food / second-drink quests need both alternatives); dev
  fixture `merchants`. Reference game `bootstrap_merchants`: Merchants
  unlocked 225 (≤ 240), first Merchant house 235 (≤ 270), every
  Merchant category ≥ 0.6 at 283 (≤ 420), build order the only lever;
  the tier-1/2 game is unchanged (52 / 30 / 88 / 132). **Island area:**
  the Merchant town uses 3 102 of 16 387 buildable home tiles (19 %);
  reaching 1 200 Merchants is estimated at 13–16 k tiles, so a
  four-tier city fits the home island only with its chains spread over
  other islands — which is the intended loop; C4 writes its reference
  game that way and `islands.json` stays until that is shown not to
  work (D-054 as built).
- *As built (PR #37 C4, tier 4):* sim schema 11, content
  `old_coast-0.13.0`. Every tier-4 chain, good, building, field and
  deposit of CONTENT §5/§7 as written (`grain_distillery` as its own
  building, fine_garments from dyed_garments + thread), `house_
  patricians`, Patricians needs with three carried tiers, `university`
  + `cathedral` in the ladder, `market` level 3 and Trading Post level 4,
  galleon buildable, quartz / copper / gold deposits (gold exactly one
  per archipelago, never home) in their own generator pass, `field.farm`
  may be a list (the cattle pasture is shared by dairy and cattle
  farms), quests gain `ship_count.type`, tier-4 quest chain ("glass
  produced" = 30 glass in stock), dev fixture `patricians`. Reference
  game `bootstrap_patricians` (extends bootstrap_merchants step for
  step): Patricians unlocked 501 (≤ 900), first Patrician house 798
  (≤ 960), every category ≥ 0.6 at 843 (≤ 1 800); build order and
  island choice the only levers; tiers 1–3 byte-identical. **Island
  area (closes D-054's provisional):** the four-tier city uses 59 % of
  the home island (houses + public 8.8 %), 30 % of island 2 and 18 % of
  the quartz island; nine islands untouched — `islands.json` stays.
  Cost: the golden is 15 MB (0.7 MB in git) and the scenario package
  replays each game once per test binary (`make check` 41 → 81 s); a
  snapshot interval in the scenario format is the follow-up.

## D-057 Art style: procedural voxels replace the kit-bashed look

**Decision (interview 2026-10-28, owner + design lead; evidence: the
voxel prototype PR #36 — side-by-side shots, desktop stats, the owner's
device run at `?voxel=1` on the dense fixtures, the authoring log):**

1. **The whole game is voxel** — buildings, fields, ships, decor,
   terrain and coast, life-layer props, construction stages. D-050's
   *rendering style and asset source* (kit-bashed KayKit, Blender build,
   smooth terrain) is superseded; its other parts stand: real models at
   every zoom with a lite tier at far, **the Anno warm palette** (no
   cold greys as a dominant colour, warm sea), device-validated
   performance, one continuous world.
2. **Everything is generated by code.** Voxel recipes are small Python
   files on a shared parts library (`assets/voxel`), 8 voxels per tile
   for full models, lite = the grid downsampled to 2 voxels per tile,
   greedy-meshed quads with per-vertex colour, baked AO and a baked sun
   term, exported through the existing GLB writer and manifest (the
   client's model contract and the life-layer anchors are unchanged).
   No kits, no Blender, no bought packs; a building without a recipe
   gets an automatic placeholder sized to its footprint, so no island
   ever mixes styles. Footprints come from content as before.
3. **The look to reach** (reference: the owner's standalone experiment
   and dense MagicaVoxel scenes): *lively* — per-voxel colour jitter on
   every material, irregular canopies and bushes, crops as rows of
   plants, ground scatter (tufts, stones, flowers, mushrooms), uneven
   fence posts, stepped rock layers at cliffs and coasts, pixel
   coastline with shallows and foam, roofs as courses with ridge and
   chimney pots, window frames and shutters, warm roof variety per
   building. Tier richness and "reads by its good" rules of
   ART_DIRECTION carry over.
4. **Clean cut, no dual path.** The first restyle PR makes voxel the
   only renderer and deletes the Blender pipeline, kit manifest, kit
   recipes and kit models in the same change; placeholders stand in
   until a tier's recipes land. Models are then ported tier by tier
   (tiers 1–2, 3, 4 + ships and life props), terrain/decor and the
   lively layer in their own sessions, then one polish round in the new
   look. Content and sim work (C4) continue in parallel — they do not
   touch the renderer.
5. **Budgets:** D-048's far budget (≤ 40 draws / ≤ 250 k triangles at
   the zoom cap) remains the hard rule and is met with the 2-voxel
   lite (152 k on the dense island vs 166 k today). Near/mid numbers
   (dense island ≈ 1.3–1.4 M triangles, ~60 % above today) are
   recorded in ART_DIRECTION as targets; the gate is the device run
   (D-052), not CI.
6. **Why:** the look is better at near and mid and equal at far; the
   phone holds 60 fps; voxel terrain is cheaper than the slab terrain;
   authoring is ~5 min and ~45 lines per building with 1-second sheet
   renders and no external tools — three kit-bash review rounds of
   "cottage on a slab" argue that agents produce better voxels than
   kit-bashes; the dependency on third-party kits goes away.

**Rejected:** keeping both renderers until the port is complete (dual
maintenance for months; placeholders are better than mixed styles); a
fresh repository (server, sim, content, API, UI, life logic, chunk
system and tooling are untouched by the restyle); buying voxel packs
(code generation is cheaper and consistent); hand-made `.vox` files
(no artist in the loop; agents iterate faster in code).
- *As built (PR #38 V1):* one renderer, one pipeline. `assets/voxel`
  (standard library only, no numpy) builds every model; the Blender
  build, kit manifest, 124 kit recipes and all kit models are deleted
  (−17.6 k lines net); 28 prototype recipes + 66 automatic placeholders
  ship; budgets per footprint tile full / lite: building 500 / 40,
  house 540 / 45, field 410; ships 2 800 / 6 000 / 7 600; folder 19.1
  of 24 MiB. Client: voxel terrain/decor/far mesh are the code (the
  prototype's half-tile terrain offset fixed), `?voxel=1` gone. Far at
  the cap 66.7 k (8 islands) / 152 k (dense) triangles, pans 17 / 33 ms
  longest frame, no frame > 50 ms; near/mid dense ≈ 1.3–1.4 M (≈ 1.6×
  the kit look). Rough spots handed to V2: roads as smooth ribbons,
  foam on the smooth coastline, per-column ground colour, coarse far
  coast, generic construction stages, cube smoke puffs, lost cloth
  sway, single tier-3/4 house variants, 66 placeholders.
- *As built (PR #40 V3, PR #41 V2):* **V3** — parts library v2
  (`nsvoxel/detail.py`: coursed stone, quoins, half-timber, casements,
  roof courses with ridge and chimney pots, fences, crop rows, ~40
  props, `Building`) and all 40 tier 1–2 recipes at the §3 detail, 3
  variants per house tier, anchors from the content flags; every model
  inside its budget. Finding: **colour jitter baked into geometry
  defeats greedy meshing** (28 MB with full jitter, 21 MB without) — V3
  shipped reduced jitter at 24.8 of 25.2 MB. **V2** — ground colour
  blended across columns, stepped pixel coast with shallows, foam and
  wet sand that follow the steps, cliff/plateau rock bands, roads as
  voxel paths in the terrain mesh (dirt / cobbles), denser decor per
  terrain role with irregular swaying canopies, voxel smoke puffs in
  sizes, construction stages in 2/4/8-tile classes, ship wakes, warmer
  sun/sky/sea, **per-voxel colour jitter in the shader** (`?jitter=0`),
  minimap from the voxel ground roles. Numbers on top of V3: far 78 k /
  154 k (D-048 holds), dense mid 1.69 M (≈ 267 k from V3's buildings),
  settled near 325 k (+33 %, ground detail), no pan frame > 50 ms.
  Decision from both: **recipes export flat colours and the shader
  jitters** (V3b), cloth sway returns via manifest sway groups, the
  24 MiB limit stays.
- *As built (PR #42 V3b/V3c):* recipes export flat colours
  (`colour_jitter` a no-op; authored shade steps that are structure
  stay), shader jitter retuned per class, sway groups on sailmaker /
  linen weaver / warehouse L3 (manifest-driven tests); triangles −14 %
  (dense mid 1.69 → 1.41 M). **Quantised export**: KHR_mesh_quantization
  (int16 positions in voxel units, int8 normals, uint8 colours), loaded
  with Babylon's plugin and dequantised in `parseGlb`; folder 20.5 →
  12.9 MB (−37 %, ≈ 32 bytes/triangle — indices and AO-split vertices
  are the rest), pixel-identical shots. Limit 24 MiB unchanged.
- *As built (PR #43 V4, PR #44 V5):* **every building of all four
  tiers and all three ships has a recipe — no placeholders remain.**
  V4: 27 tier-3 recipes (incl. `grain_distillery`) on `detail_v4.py`
  (townhouse, oriel/balcony, round/still towers, domes, vats, drying
  frames, terraces, hop poles), 3 `house_merchants` variants, church
  and theatre in warm sandstone; sway on dyer, dyer_works, tailor. V5:
  25 tier-4 recipes + ships on `detail_v5.py` (ashlar, palazzo,
  cornices, arcades, towers, buttresses, shared `furnace`), 3
  `house_patricians` variants, university cloister, two-tower
  cathedral; one hull builder for sloop / brig / galleon (1 / 2 / 3
  masts, rigging, sail sway groups, cargo props per 2 / 4 / 6 slots,
  new `wake` anchor — unused by the client yet). Authoring on the v2
  library: ≈ 0.5–1 min per workshop, 2–6 min per house or landmark.
  Review rounds fixed cold roofs (slate → warm tile), a coral plaster,
  roof variety per quarter and a teal woad field. Models folder 16.7
  MB of 24 MiB; all budgets hold (galleon at 99.6 %). Known trade-off:
  signature props face the default camera; back sides are plainer
  (V6 list).

## D-058 Island shapes: skeleton coasts, ridge mountains, rivers with bridges, visual terraces, sea routing

**Decision** (interview 2026-10-29; the Anno 117 Latium island atlas is
the look reference — lobed coasts with bays and peninsulas, a rock
spine, rivers to an estuary, islets, one or two flat plains): the
archipelago generator and the terrain renderer are reworked. Rules stay
flat; everything below is shape, not mechanics, except rivers as
obstacles and sea routing.

1. **Shapes from a skeleton.** An island is a trunk with 1–3 arms
   (random walk / spline), a distance field around it and domain-warped
   multi-octave noise, then the existing smoothing, connectivity and
   site checks. New guarantee: every habitable island keeps **one
   contiguous plain** (large ≈ 40×40, medium ≈ 24×24, small ≈ 14×14
   grass/forest) besides ≥ 2 Trading Post sites and a shipyard site.
   **Islets** (rocks, sand bars) lie inside the island's grid as
   unbuildable water-adjacent land, decor only. No lakes for now.
2. **Mountains as a ridge spine**: a branched polyline; height from the
   distance to the spine (3–4 voxel levels); **cliff coast** where the
   ridge meets the sea (rock, no harbour buildings; the generator
   guarantees beach sites); peaks as crag models at local maxima; mines
   in notches at the foot. Mountain tiles stay unbuildable (D-036). No
   snow.
3. **Rivers as obstacles with bridges.** River tiles are water inside
   the land (1 tile wide, 2 at the mouth), unbuildable; a **road on a
   river tile is a bridge** (same road type, rendered as an arched
   voxel bridge). Source in the mountains, mouth in a bay; 1–2 on
   large, 0–1 on medium, none on small islands. The plain and the
   Trading Post sites stay connected by land or bridges. Fishing is
   sea-only. River production slots (Anno's river buildings) remain a
   later option; the chains do not need them (windmills, not water
   mills).
4. **Visual-only terraces.** The generator emits a `level` 0–2 per land
   tile (coast low, inland higher, rivers stepping down with small
   waterfalls); the client renders stepped terrain with cliffs and
   ramps. **No tile loses buildability and no placement rule changes**:
   a footprint across a level edge gets a stone plinth/cut, a road a
   ramp, a field terraces. Supersedes D-053 §3's "no plateaus" and
   refines D-024/D-036's flat rules (which keep holding for mechanics).
5. **Sea routing.** Ship legs follow a path around land on a coarse sea
   grid (pure, deterministic, computed in the sim; the path length sets
   the ETA). Fisher-boat loops stay on water (client).
6. **Re-roll** stays as D-053 §2 (until the first founding).
7. Parameters (arms, plain sizes, river counts, level counts, islet
   counts) are content in `islands.json`.

- *Why:* the archipelago is the first thing a player sees; round blobs
  with rock lumps read as artificial next to the voxel buildings, and
  bays, ridges and rivers are what make Anno islands memorable without
  touching the economy.
- *Consequences:* schema bump (tile `level`, river and islet terrain,
  no migration while undeployed); every seed's layout changes — goldens
  and the four reference games regenerate and their targets must still
  hold with the existing levers; the client terrain, far mesh, minimap,
  roads (bridges, ramps), fields (terraces) and plateau code are
  rewritten on the level data; an **island atlas** test tool renders
  every island of a seed to PNG so shapes are judged before renderer
  work; MECHANICS §10 and CONTENT §9 updated at "as built".
- *Rejected:* hand-made island templates (no artist, no discovery);
  rule elevation ("one level per building" — harder placement, touches
  validation, fields and the reference games); lakes (later); river
  slots (later option); re-roll after founding (discards the
  settlement).

**As built** (#46, 2026-10-29; refines the decision above, which
stands):

- *Shapes:* skeleton + distance field + domain-warped fbm as decided;
  every large/medium island also gets ≥ 1 bay (depth ≥ 15 % of its
  span) and ≥ 1 peninsula; massifs cover 15–20 % of the land with
  broad plateaus; **cliffs** (10–25 % of the shore) occur wherever
  raised land (level ≥ 1) meets the sea, not only at the ridge;
  rivers span ≥ 40 % of the island with meanders and a **2–3-tile
  estuary** (§3's "1 wide, 2 at the mouth" refined); islets 6–15
  tiles; bridges straight ≤ 2 river tiles, never along a river (no
  separate error code). Rock sites keep their retries.
- *Archipelago spacing* (Anno 117 map comparison): `spacing.min` 50,
  `nearest_max` 120, new `strait_min` 24 (the 4-tile routing grid)
  and `void_max` 150 — map extent ≈ 780×790 tiles (−34 %). New size
  class **`scenic`**: 4–8 skerries of 4–12 tiles, islands of the world
  without name/sites/fertilities, not settleable or a destination,
  land for routing, minimap and far view.
- *Renderer:* `terraces.ts` replaces `plateaus.ts` (bilinear
  tile-centre levels, ½-tile steps, cliffs/ramps by noise zones);
  mountains as tall ragged grey rock with crags, peaks, scree and a
  rock cliff coast; rivers 2 columns wide with banks, sea-shader
  water, waterfalls with foam pools; terrace walls with boulders,
  ramps as beaten earth; plinths/ramps/arched bridges (`_decor.py`
  lengths 1–2); skerry shallows follow the outline. Far view at the
  cap: neighbours keep relief only while the mask layer stays under
  100 k triangles (`MASK_TRIS`), nearest first — worst case 248 k.
  *Superseded by #56 (2026-10-31):* the fixed mask cap is gone; at far
  the fixed cost (home island's lite buildings, far trees, far
  shadows, ships) is counted first and the terrain gets the rest of
  250 k × 0.9 — the home island's full lite terrain (coarse 1-column
  terrain if even that does not fit), then neighbours nearest first,
  flat outline last. Fields are painted ground patches at far, far
  trees capped at 24 k per island, far contact shadows 12 tris per
  building, lite buildings merged per 128-tile group. Guarded by
  `client/src/render/farbudget.test.ts` on captured fixture data
  (`capture.ts` regenerates it after generator or fixture changes).
  `played` 41 / 1.21 M → 16 / 233 k; worst case 247 k at 45°.
  #57: the outline fallback is a flat per-cell mesh with the minimap's
  exact shape (≈ 1.3 k tris per large island, 9 k for the archipelago),
  relief is spent by on-screen area with 10 % hysteresis and never
  withdrawn because tiles streamed in; measured also at `desktop-xl`
  (2992×1700). #58: island tile rows are cached by seed, roll **and
  `archipelago.GeneratorVersion`** (bump by hand whenever generated
  rows change; ARCHITECTURE §4) — a stale browser cache had shown the
  pre-D-058 islands over the new outlines.
- *Routing:* 4-tile sea grid, per-leg waypoint `path` in the display
  and `routes[].paths`; ETA from path length × speed; leg ends are the
  Trading Post's harbour point (2 tiles off the water edge) or the
  shore nearest the other end; the **founding voyage** is routed to
  the site's harbour point (`sail_ship.site`) and docks at the berth,
  and an island without Trading Post or shipyard has no berths; ships
  are never on land (`TestSeaOnly` over the reference games); the
  start ship spawns ≥ 40 tiles from land (first sail ≥ 40 s).
- *Camera:* "Found settlement here" keeps the view if the whole island
  is on screen, else frames the island.
- Content `old_coast-0.14.0`, schema 11; `make island-atlas SEED=|
  STATS=n`; shots targets derived from the settlement. Reference
  games (sim min): citizens 45/29/85/127 (targets 60/90/100/150),
  quests 27/67, merchants 213/262/298, patricians 629/718/788.
- *Handed to V6:* massifs still show their level rims at mid zoom;
  docked founder lies behind the Trading Post rather than along the
  pier; draft route ribbons straight until saved; near/mid draws
  ≈ 49/47; idle founder drawn at the island centre after a reload.

## D-059 Lumberjack plants its trees; ship speeds differ; one fixture list with a played world

**Decision** (2026-10-29):

1. **Lumberjack as a farm.** The lumberjack loses its `work_area`
   (forest within radius 4, 24 tiles) and gets `fields` like every
   other farm: `tree_plot` 1×1 field buildings on grass (no fertility),
   `required = max = 24`, painted like crops. Natural forest stays
   terrain and decor: buildable as today, cleared by whatever is built
   on it, no longer a rule input; the home-island guarantee drops
   `forest` from `terrain`. Cost, rate and upkeep stay (D-054). The
   `tree_plot` recipe shows planted rows (sapling → tree stages like
   crops, LIFE_LAYER growth). Reference games rerun.
2. **Ship speeds.** Sloop 1.2, brig 1.0, galleon 0.85 (content
   `speed`; supersedes D-056's "equal speed"): small and fast for
   founding and short hops, large and slow for bulk. ETA uses the
   per-ship speed over the routed path length (D-058 §5).
3. **Fixtures.** One server-side fixture list; in dev every fixture is
   reachable by `?fixture=<name>` (the client calls `dev/reset` when
   the parameter names a fixture the loaded world is not); client-only
   fixtures are folded in (`dense-2x400` becomes a server fixture) or
   dropped. New fixture **`played`**: a four-tier world produced by
   replaying the `bootstrap_patricians` scenario to its end (routes,
   quests, ships, all tiers — no hand placement), the default for
   shots and playtests of the late game.

- *Why:* a forest requirement makes the lumberjack the one producer
  the player cannot place by plan; equal ship speeds make the galleon
  strictly dominant; two fixture systems confuse everyone.
- *Consequences:* content 0.15.0 (buildings, ships, islands home
  rule), generator forest patches stay as decor, MECHANICS §4/§9/§10
  and CONTENT §5/§8/§9 updated, ARCHITECTURE fixture list, `make
  shots` presets; the `played` fixture depends on the scenario runner.
- *Rejected:* a forester module next to the forest rule (two systems
  for one good); large ships faster (removes the choice); keeping
  client-only fixtures.

**As built** (#49, 2026-10-30): `tree_plot` 1×1 field at 1 gold
(wheat's 3 would be 72 gold per lumberjack at game start), one growth
stage (the pipeline has no per-field stage files); the harvester code
path (`work_area`, `no_work_area`) is kept unused for a mechanical
follow-up — the three pinned test contents still use it. Speeds
1.2/1.0/0.85 as decided; the sloop sits below the 1–5 min travel
target on the dev seed (noted, not tuned). Fixtures: `devworld`
list `default seafaring town settled citizens merchants patricians
played` is the one list; the client-only fixtures are gone and
`?fixture=` resets the dev world; the shots tool keeps its own
argument list; `played` replays `bootstrap_patricians` via the
scenario runner. Content payload `size_classes` carry per-class
fertility/deposit ranges, shape and home guarantees (the
archipelago-wide pools stay unserved). Content `old_coast-0.15.0`,
no schema bump.

## D-060 Civic services and the built harbour: city guard, fire station, surgery; quay, trading pier, depot

**Decision** (2026-10-29):

1. **Civic services are needs**, not incident responders. Three new
   service categories with radius coverage (the D-056 services
   mechanic, no new sim rule): *safety* — **city guard** (Citizens);
   *fire protection* — **fire station** (Merchants); *health* —
   **surgery** (Merchants). Uncovered houses lose satisfaction (and so
   tax and the upgrade gate); nothing burns, nobody dies. Numbers
   (radius, cost, share, upkeep) are content and provisional
   (CONTENT §2/§7 tables).
   *Later refinement, not now:* incidents ("fire in the quarter") as
   seeded, time-bounded, tax-only events that are symmetric online and
   offline — if ever added they must keep D-009.
2. **Quay.** A road type on *shallow* water (water tiles ≤ 3 tiles
   from the island's own land; derived from the tiles, no generator
   field). Carts use it as a road; it counts as coast for water-edge
   footprints, so harbour buildings stand on it; placing a building on
   quay tiles replaces them. Stone cost, Citizens tier. D-036 stands:
   the shallows band bounds the harbour area.
3. **Trading pier** (+2 berths, water-edge, Citizens) and **depot**
   (+island storage, water-edge, Citizens; Merchants level) extend the
   harbour without Trading Post levels.
4. **Repair crane and ship health are deferred** to the expeditions
   decision (ONLINE.md): wear without a damage source is a chore, and
   expeditions and later war ships (D-005) are the natural sources.

- *Why:* the harbour picture the owner wants (Anno 117: quays with
  buildings on them, piers into the bay) needs buildable water, which
  D-051's water-edge rule almost gives; civic buildings give the city
  its public face without random loss.
- *Consequences:* six recipes (guard, fire station, surgery, quay
  pieces straight/corner/end, pier, depot); content additions
  (`needs.json` categories, `buildings.json`, road type `quay`,
  services ladder note), sim: quay placement rule, coast test for
  water-edge footprints, berth and capacity sources; MECHANICS §4/§6/
  §9.3/§10, CONTENT §2/§5/§7, LIFE_LAYER anchors; reference games
  rerun with the new needs in the gates.
- *Rejected:* destructive incidents (D-009); crane with wear per tile
  (chore); quay anywhere on water (unbounded harbours, D-036).

**As built** (#47 models, #48 mooring, #49 content; 2026-10-30):

- *Civic needs:* categories `safety` (city guard, Citizens),
  `fire_protection` (fire station, Merchants), `health` (surgery,
  Merchants), weights taken from `services` within each tier (shares
  still sum to 1), cumulative for higher tiers like every need;
  surgery costs bricks instead of glass (glass is a Patrician good);
  radius 16 at level 1 and a **Merchants-tier level 2 with radius
  20** — the lever that keeps the Patricians reference game inside
  its limits (unlock 815 / first house 837 / gate 925 against
  900 / 960 / 1800; the plan places two civic sets). Icons
  `need:safety|fire_protection|health`.
- *Quay:* road type on shallow water (≤ 3 tiles Chebyshev from the
  island's own land, islets excluded, not on river tiles or the water
  rows of a footprint); Citizens, 5 gold + 2 stone per tile, 0.6 s per
  tile like paved road; land for ship routing; water-edge and
  `coastal` buildings may stand on it (no refund of the replaced
  tiles); a quay that would close the harbour point's 4-connected
  water way to the grid edge is refused with the new error
  `harbour_blocked` (the check runs on every quay placement). Drawn
  as a stone wharf with a timber edge and bollards; the quay tool
  highlights free shallows; the same rule is shared with the client
  through a generated test fixture.
- *Trading pier* 3×4 (3 water rows), +2 berths into the island's one
  berth pool (the server does not say which pier a ship lies at; the
  client fills Trading Post berths first, then piers by ID); berth
  anchors on the pier's long **flanks**, which the client's mooring
  code supports next to front anchors. *Depot* 4×4 (1 water row),
  150 / 300 capacity per good at levels 1 / 2 (level 2 Merchants).
  Pier and depot have upkeep 0 (`never` pause category requires it).
- Models: guard, fire station, surgery, pier, depot l1/l2 and the
  tree plot (#47) in warm sandstone; folder 18.2 MiB. `make shots
  PRESET=harbour` places quay, fisher, pier and depot on `played`.
- *Not done:* repair crane and ship health (deferred as decided);
  incidents of any kind.

## D-061 Translation: English and German from content locale files and a client catalogue

**Decision** (2026-10-29): the game is translatable from the start of
the next UI work. English is the source language and the key; German
is the first translation.

1. **Content:** player-facing text in content (`name`, descriptions,
   quest titles/texts, island names, ship names list) stays English in
   the main JSON and gets locale files `content/<region>/i18n/<lang>.
   json` keyed by content ID and field; the loader validates
   completeness (a missing key is a content error for shipped
   languages) and the content payload carries the requested language
   with English fallback.
2. **Client:** one small message catalogue (own helper, no library
   unless plural or gender rules force one — justify in the PR),
   `client/src/i18n/<lang>.ts`, language from the browser then the
   account setting, English fallback, a switch in the account menu;
   numbers, units and durations formatted per locale. All UI strings
   move to keys in one migration pass; afterwards a lint/test fails on
   a hardcoded string in `client/src/ui` and `client/src/almanac`.
3. **Server:** never sends prose — codes, IDs and numbers only (as
   today); the away letter, quest texts and errors are composed in the
   client.
4. Order: after the almanac and the islands PRs merge, one
   cross-cutting session; new sessions use keys from then on.

- *Rejected:* server-side rendering of texts (one language per
  world); a translation service dependency.

**As built** (#51, 2026-10-30): `content/old_coast/i18n/de.json` with
334 keys (`<file>.<id>.<field>`, island-name list entries zero-based),
loader completeness check, `GET /api/v1/content?lang=` (unknown
language → 400, `Accept-Language` fallback), payload `language`,
`languages[]` and per-ship `source_name`; client catalogue
`client/src/i18n/{en,de}.ts` with 713 keys (German typed against the
English key set), `t()` with `{name}`/`{Name}` placeholders for
mid-sentence German nouns and two-form plurals, language from `?lang=`
→ stored choice → browser → account (`PATCH /api/v1/auth/me
{language}`, `players.language` column, no migration while
undeployed); switch in the account menu, start card and almanac
footer; ESLint rule `no-hardcoded-strings` over `ui/` and `almanac/`
with five `// i18n-ignore` escapes. Island and default ship names
stay stored in English and are mapped client-side by source text (a
rename to an identical source name is translated too — accepted edge
case; storing the list index / type id would be a schema change for a
later decision). German layout fixes: no-break space before `%`,
shorter almanac need-table headings, field names through
`inSentence()`. *Later:* a German read-through of the island-name
list and quest texts.

## D-062 Anno-sized footprints, flexible water rows per column, depots without levels

**Decision** (interview 2026-10-30; the Anno 117 Latium building table
is the size reference, Anno 1404 for the chapel):

1. **Footprints.** Trading Post **6×6** (water rows 1–2; the dock is
   part of the model, as in Anno), chapel **3×5**, city guard
   **4×4**, fire station **4×5**, surgery **4×6**, trading pier
   **6×9** (a jetty: ≈ 6 water rows, berths on both flanks), depot
   **11×4** (11 along the coast, 4 deep, 0–1 water rows). Fisher 3×8,
   market 5×6, tavern 4×6, warehouse 6×6, shipyard 8×12, salt pans
   5×9, oyster beds 6×12 already match and stay. Content IDs stay;
   the recipes are re-fitted (new budgets follow the footprints; the
   24 MiB folder limit and per-tile budgets stay).
2. **Water rows per column.** `water_tiles: n` becomes `water_rows:
   {min, max}`: in **each footprint column** independently, the first
   *k* tiles must be water with `min ≤ k ≤ max` and the remaining
   tiles buildable land; a hall over water is never allowed (the max),
   a pier post on sand is (the min). Harbour point and berth rules
   keep measuring from the front row. Provisional values: Trading
   Post {1,2}, fisher {2,3}, shipyard {3,4}, trading pier {5,6},
   depot {0,1}, salt pans {2,3}, oyster beds {3,4}. Supersedes D-051's
   "first `n` front rows" rule; D-036's harbour band is untouched.
   The ghost colours per tile.
3. **Depot:** any number per island, **no levels** (the finite coast
   is the cap, D-036); the level-2 recipe is removed. Capacity 150 per
   good stays provisional.
4. **Surgery is a Patricians building** (health becomes a Patricians
   need, weight from services; Merchants keep safety and fire
   protection), cost with glass as first intended; one level, radius
   20. The civic level-2 lever (radius 16 → 20 at Merchants) stays
   for city guard and fire station until the reference games say
   otherwise.

- *Why:* a 3×3 civic building and a 4×4 depot read as sheds next to
  the houses; the diagonal coasts of D-058 make a whole-row water rule
  fail on half of the usable shore; levels on a depot duplicate the
  Trading Post's lever.
- *Consequences:* content 0.16.0, schema bump for `water_rows` (no
  migration while undeployed), sim placement rule + tests per column
  and rotation, ghost validity per tile, model re-fits (Trading Post
  ×4 levels, chapel, city guard, fire station, surgery, trading pier,
  depot), fixtures and scenarios re-planned, reference games rerun
  (the Patricians margin of 85 min is the one to watch), MECHANICS §4,
  CONTENT §5, ART_DIRECTION §7, UI.md ghost note. One content + sim
  session and one models session, after V6 part 1.
- *Rejected:* keeping 6×9 for the Trading Post (Anno's 6×6 reads
  better and frees shore); whole-row tolerance of ±1 (fails on
  diagonals, allows halls over water); one depot per island (a rule
  for nothing the coast does not already do).

**As built** (#53 models, #54 content; 2026-10-31): footprints and
`water_rows` as decided (schema 12, content `old_coast-0.16.0`; the
rule is shared with the client through 72 generated cases over all
rotations, the ghost colours offending tiles red); Trading Post
6×6 at all four levels; surgery at Patricians with glass; depot
without levels (two per island tested, 600 capacity); `theatre`
retired, `playhouse` shipped; pipeline `planned/` file removed again
(all IDs shipped). Reference games: citizens 53/33/91/134, quests
38/76, merchants 229/264/297, patricians 855/887/1437 (unlock margin
45 min — the tightest; watch it on any further civic addition).
**Correction to §1:** the Anno depot is a stone platform **jutting
into the water** — 4 tiles along the coast and 11 deep seaward with
three parallel sheds — not a shed along the shore as §1 says and as
#53/#54 built it. Target: footprint **4×11**, `water_rows {7, 9}`;
re-fit in #55: footprint 4×11, `water_rows {7, 9}`, warm-sandstone
platform on piers and piles with three tiled sheds, walkways, cargo at
the seaward end, gatehouse and ramp on the beach; 11.5 k / 22 k tris;
MECHANICS §4 "7–9 rows". Known simplification: building water rows
are not land for ship routing (ships pass through pier and depot
piles), as for the trading pier.
*Found on the way:* `played` far at the zoom cap measures 41 draws /
1.23 M triangles on main (home island stays at full detail) — a
pre-existing breach of the far budget for a large four-tier town;
fixed in #56 (see D-058 as built).

## D-063 Region scope: the Old Coast is temperate Europe; the south is a later region

**Decision** (2026-10-30): every region's content must be plausible
for its climate and building culture, so that regions can be added
later in the Anno manner (a second archipelago zone with its own
chains and public buildings, reached by ship — a future world-
structure decision).

1. **`old_coast` = temperate northern/middle Europe** (Hanse, Rhine,
   Flanders): fish, wool, grain, cider/mead, beer, linen, leather,
   woad, salt, bricks, glass, copper, wine (Rhine/Mosel) stay.
   Reserved for a southern region and not to be added to the Old
   Coast: olives/oil, citrus, silk, spices, marble, figs/dates, sugar,
   purple dye, Mediterranean architecture (whitewash, pale pan-tile,
   flat roofs, arcades, cypresses).
2. **Theatre → playhouse.** The tier-3 service building `theatre` (a
   Roman theatre) is retired and replaced by **`playhouse`** (new ID,
   same 11×14 footprint and ladder position): a timber-framed
   galleried playhouse with a steep roof and banners. The Roman
   theatre recipe is kept out of the build for the southern region.
   University and cathedral are checked to read Gothic/Hanse.
3. **Palette roles are region-scoped.** The base palette stays; the
   south later adds roles (whitewash, travertine, pale terracotta,
   cypress) rather than shifting existing ones. To keep the contrast
   available, **terracotta stays the minority roof of the Old Coast**:
   tier 3–4 quarters mix dark tile / brown slate / terracotta
   ≈ 50 / 30 / 20 and are never terracotta-only. Light stays the one
   golden hour everywhere.

- *Why:* the data model is already region-scoped (`content/<region>`,
  `region` per building, fertilities and deposits per region); the
  only thing that can block a second region is content that spends
  the southern identity early.
- *Consequences:* content 0.16.0 (`playhouse`, `theatre` retired —
  never reused), one recipe (`playhouse`), a roof-share check in the
  next render round, ART_DIRECTION §2 note on region-scoped roles,
  CONTENT §1 region rule, GAME_DESIGN one paragraph. No world or
  online change now.
- *Rejected:* shifting the base palette now (nothing to gain before
  the second region exists); keeping the theatre as "fine for a
  wealthy port" (it is the one building a southern region would own).

**As built** (#53/#54, 2026-10-31): `playhouse` — an octagonal
timber-framed galleried hall with a ring roof, lantern, stage house,
banners; terracotta < 20 % of the roof area (asserted by a test);
Roman theatre recipe parked as `_south_theatre.py`, out of the build.
University and cathedral: ochre → brick and terracotta → dark tile /
slate; the round arcades, pilasters, pedimented hoods and palazzo
massing of the university remain and are a re-fit candidate for a
later models round. Region paragraph in GAME_DESIGN.

## D-064 Palette re-tune to Anno 1404 daylight

- **Status:** accepted (2026-10-31)
- **Context:** a palette review for the Hanse / North-Sea setting
  (D-063) argued that the build reads Mediterranean. Put next to the
  Anno 1404 reference (D-050), the setting is not the problem: 1404 is
  neutral-warm daylight with saturated local colour — teal-grey sea,
  lush mid-green grass, cool grey rock, grey cobble and brown dirt,
  grey-blue shadows. Our build overshoots "warm": an orange grade over
  everything, yellow-green grass with ochre blotches, beige rock,
  sand-coloured roads, cyan shallows over royal-blue deep. A probe
  (variants B terrain + water, C B + light, D half light) confirmed
  the re-tune on `settled` and `played` at every view.
- **Decision:**
  1. **One fixed warm daylight replaces "golden hour".** Sun colour
     and direction unchanged; grade `#FFD9A0` → `#FFEBD4`, fill ratio
     0.35 → 0.42, the sky fill leans less toward the sun
     (`SKY_WARMTH` 0.38 → ≈ 0.25) and the blob-shadow colour moves to
     grey-blue (`#2A2A35` → ≈ `#2A2E3C`). Still no day/night cycle or
     seasons.
  2. **Ground and sea follow the reference:** grass toward mid-green
     (`#6E9E52` / `#84B063`), dry patches browner and half as frequent,
     rock and cliff bands neutral grey with less ochre, dirt roads
     brown, paved roads grey cobble, sand one step less yellow; deep
     water teal (`#22627D`), shallows a step past the probe
     (≈ `#4A9C9F`) without the warming step in `mapcolors.ts`; haze
     cooler. Field colours re-tuned so pasture is not lime on the new
     grass. Shadow tones keep the measured role × (0.58, 0.56, 0.66)
     rule; the rule is documented in `palette.json`.
  3. **Building roles are untouched now** (the model rework comes
     later) but the re-tune names what that rework uses: roofs per
     tier as in 1404 — T1 thatch, T2 orange terracotta (the terracotta
     role moves toward `#C4663A`), T3 a new `tile-dark` role
     (≈ `#6E3A33`, the burgundy tile), T4 slate — plus a `brick` role
     (≈ `#9C4A38`) for industry, warehouses and the depot, whiter
     plaster and less ochre on facades. This keeps D-063 §3's
     terracotta-minority rule for tier 3–4 and makes it concrete.
  4. **The palette stays one global file.** Region overlays for
     water, terrain and light are deferred to the region-2 decision;
     D-063 §3's "light stays the one golden hour everywhere" is
     superseded by "one fixed daylight per region, the Old Coast's is
     this one".
- **Why:** the reference, not realism, is the yardstick (D-050); the
  probe showed the town sits on the ground instead of floating on a
  yellow carpet, and the roofs read better against it. Terrain, water
  and light are runtime values — cheap to tune; only trees, crags and
  shadow tones need `make assets`.
- **Consequences:** `assets/palette.json` version bump, `make assets`
  (manifest `palette_sha256`), `palette.test.ts` pins, ART_DIRECTION §2
  (daylight, fill, shadow) and §4 (terrain colours), CONTENT field
  colour table if listed. Model rework (V7) applies §3.
- **Rejected:** cooling the sea and light to North-Sea grey (moves
  away from the reference); keeping the golden-hour grade and only
  changing terrain (the orange cast is the main overshoot); building
  a region overlay system now (nothing to overlay yet).

**As built** (#60, 2026-11-01): palette v2 — grass `#6E9E52` /
`#84B063`, dry `#A79B62` at half frequency (`smoothstep(0.66, 0.84)`),
mountain `#86888A`, cliff bands at 2/3 saturation, dirt `#96744F`,
cobble `#9FA09B`, sand `#E2D2A6` / rim `#DCC896`, shallows `#4A9C9F`,
deep `#22627D` without the `mapcolors.ts` warming step, haze `#AEC1C4`;
grade `#FFEBD4`, fill ratio 0.42, `SKY_WARMTH` 0.25, blob shadow
`#2A2E3C`; pasture `#8CB665` / `#A4CA7E`, wheat `#CFB04A` / `#B08E30`.
Shadow tones by the measured rule, now written into `palette.json`.
`make assets` re-baked all models (vertex colours only; budgets and the
18.53 MiB folder unchanged). Known: `make shots HUD=0` also hides the
grade overlay (noted in the shots tool); wheat and beach still read a
touch loud on `played` mid/far — V6 part 2 candidates.
Palette v3 (#64): `brick` `#9C4A38`, `tile-dark` `#6E3A33` added,
terracotta → `#C4663A`; 90 models re-baked. The blue-grey back faces of
chapel / Trading Post l2 are the fill-only shaded sides of large pale
stone walls — reference-correct light; the fix is relief on those walls
in the V7 tier sessions, not a `SIDE_TILT` or a warmer fill.
V7 model rework (#66, 2026-11-03): §3 applied to every building —
T1 dark boarded / log walls with a flush pale stone band under
weathered thatch (settlers' 0.8 shade), T2 rubble ground floor +
half-timber + terracotta, T3 tile-dark, T4 ashlar / cream plaster +
slate; `brick` darkened to `#7E4A3C` (weathered Hanse brick, shadow
`#492928`, version unchanged, manifest `palette_sha256` re-baked) and
used as an **accent only** (warehouse l3 piers and arch rings, l4
ground floor and gable field, kiln and smelter stacks), never as a
whole wall; terracotta a minority in tier 3–4 as decided. Yards per
tier: Settlers / Citizens houses on dirt, Merchants / Patricians on
cobbles (D-068 ground maps). Relief instead of light on the large
walls: church, cathedral (kept), university (kept), smelters, mills,
school, warehouse l2–l4 hoist bays. Still at 8 voxels per tile
(folder 23.35 of 24 MiB): playhouse, university, cathedral, shipyard,
depot, trading pier, oyster beds, fields and pens.

## D-065 Ranked public-service chains, a security group, four-level market and warehouse

- **Status:** accepted (2026-11-01)
- **Context:** the `services` need lists every public building of the
  tier and of all lower tiers separately, so a Patrician house needs
  chapel **and** church **and** cathedral, school **and** university,
  tavern **and** playhouse in range. Anno 1404 treats these as chains:
  the higher building also serves the lower need and has the larger
  radius. The redundant buildings clutter the quarters the D-062
  footprints were sized for. Safety, fire protection and health are
  already three separate categories (city guard, fire station,
  surgery) and stay so; they only lack a shared heading.
- **Decision:**
  1. **Service chains with ranks.** Public buildings declare
     `service: {chain, rank, radius}`; three chains in the Old Coast:
     `faith` (chapel 1 < church 2 < cathedral 3), `education` (school 1
     < university 2), `culture` (tavern 1 < playhouse 2). A building
     need names the chain and a **minimum rank**: a house is served
     when any building of that chain with rank ≥ min is within *that
     building's* radius (distance and connection rules of D-042
     unchanged). Required minimum rank per tier: Settlers faith 1;
     Citizens faith 1, education 1, culture 1; Merchants faith 2,
     education 1, culture 2; Patricians faith 3, education 2,
     culture 2. A cathedral therefore serves every house in its
     radius, a chapel only Settlers and Citizens. The market stays its
     own category (`market`, one building, levels as below); `services`
     as a catch-all category is retired.
  2. **Security heading.** *(amended as built — see below: every
     category carries a `group`, Goods / Public buildings; there is no
     Security heading.)* `safety`, `fire_protection` and `health`
     keep their own needs and buildings (a fire station never stands
     in for the city guard) and are shown under one `security` group
     in the HUD and the house card (`need_categories.json` `group`).
  3. **No levels for city guard and fire station** — one radius each
     (16); their level-2 upgrades are retired (model variants never
     reused). Radii of the chains stay as authored: chapel 16, church
     20, cathedral 28; school 16, university 24; tavern 14,
     playhouse 24.
  4. **Market and warehouse have four levels, one per tier.** Market
     radius 12 / 15 / 18 / 21, level *n* needs tier *n* unlocked;
     warehouse throughput 30 / 50 / 70 / 90 per minute, levels 2–4
     gated on Citizens / Merchants / Patricians like the Trading
     Post. Costs are provisional content.
- **Why:** it is the reference's model and the one players expect; it
  frees footprint in tier 3–4 quarters and gives the chain buildings a
  reason to exist beyond a checklist. Separate security needs keep the
  three civic buildings meaningful.
- **Consequences:** content schema bump (`service.chain`/`rank`,
  need `chain`/`min_rank`, `need_categories.group`), content 0.17.0,
  sim rule in MECHANICS §6 (replaces the "services" paragraph),
  display `served_by` unchanged, new golden and scenario fixtures,
  CONTENT ladder and radius tables, HUD grouping with EN/DE strings,
  Almanac. Models: market level 4 and warehouse level 4 (Patricians
  only, may follow in the V7 model round); city guard / fire station
  level-2 recipes retired. Reference targets (citizens 60/90/100/150 …)
  are re-measured by the scenario tests and misses reported, not
  relaxed.
- **Rejected:** keeping the full list and merely hiding lower chain
  members in the UI (does not free the footprint); one combined
  "security" need satisfiable by any of the three (a fire station
  would replace the watch); per-chain radius overrides (nothing to
  tune yet).

**As built** (#63, 2026-11-01): content 0.17.0, schema 13. Chains and
ranks as decided; need weights: the former `services` weight is split
market 40 % / chains equally. §2 amended: the lone "Security" heading
looked odd, so **every** category carries a `group` — `goods` (food,
drink, clothing, comfort, luxury) and `public` (market, faith,
education, culture, safety, fire protection, health); the house card
shows "Goods" / "Public buildings" with the carried lower-tier rows
under Goods. Market levels 12/15/18/21 positional on the tier; warehouse
levels 30/50/70/90 with an explicit `tier`; level 4 of both draws the
level-3 model (recipes `LEVELS = 3`, asserted). Guard / fire station
level-2 models retired. Radius 16 was not the binding constraint of
the reference games — grass for the last wheat farm was (D-067).
Reference results 48/24/82/118 · 32/64 · 224/256/369 · 826/866/1073.

## D-066 Dev world start state and snapshots belong to the server and the Makefile

- **Status:** accepted (2026-11-01)
- **Context:** every `make dev` / `make preview` starts the in-memory
  world at zero or at a fixture chosen by the client (`?fixture=`,
  `ServerFixtureGate`, `POST /api/v1/dev/reset`). Playtesting tiers 2–4
  means replaying hours, and the fixtures are authored states, not the
  owner's own towns. The world already has a versioned, deterministic
  persistence format (`sim.Encode` / `DecodeWith`, ARCHITECTURE §4.1);
  the dev server simply never writes it anywhere.
- **Decision:**
  1. **The server decides the dev start state.** `server --dev` gains
     `--fixture <name>` (any name of `devworld.Fixtures()`) and
     `--snapshot <file>` (an envelope); `make dev` / `make preview`
     pass them through as `FIXTURE=` / `SNAPSHOT=`.
  2. **Snapshots are envelopes.** `GET /api/v1/dev/snapshot` returns
     the current world as the envelope JSON; `POST /api/v1/dev/snapshot`
     replaces the in-memory world with one: normal `DecodeWith`
     migrations, schema or content mismatch answered with a code (409),
     pending events reconciled, world version bumped so open clients
     refetch. `LastEvaluatedAt` is kept (the load plays the away
     summary); `?resume=now` shifts the world to the present. Makefile:
     `make snapshot [OUT=]` (default `.snapshots/<seed>-<timestamp>.json`,
     git-ignored) and `make snapshot-load FILE= [RESUME=now]`.
  3. **The client has no dev-state handling.** `?fixture=`,
     `fixtureFromSearch` and `ServerFixtureGate` are removed;
     `POST /api/v1/dev/reset` stays as a tooling route for `make shots`
     and the e2e specs, which switch fixtures inside one server
     process. The dev routes are `--dev` only and session-less (local
     tooling); production builds have none of them.
  4. **This is developer tooling, not save/load.** Player save/load
     stays out of scope (AGENTS §2); the Compose stack (`make up`,
     PostgreSQL worlds) is not covered — an admin export is a later
     ONLINE task.
- **Why:** one entry point (the Makefile) for fixtures and snapshots,
  the client stays free of dev concepts, and the owner's playtest towns
  survive restarts and schema-neutral content changes.
- **Consequences:** two dev routes and two flags, Makefile targets and
  header, `.snapshots/` in `.gitignore`, Go tests (round trip export →
  reset → import → identical display and pending events, mismatch 409,
  `--snapshot` / `--fixture` start-up), `make makefile-test`; the client
  loses `client/src/dev/fixture.ts` and the fixture gate; README / STATUS
  / ARCHITECTURE `src/dev` line updated in the docs sync. Snapshots
  taken before a schema bump do not load (undeployed: no migrations) —
  hence D-065 ships first.
- **Rejected:** export / load buttons in the dev drawer (the Makefile
  covers it); restarting the server per `make shots` fixture (doubles
  the run); a production save/load.

**As built** (#62, 2026-11-01): as decided. `store.ResumeAt` shifts
every absolute time (`*_ms` / `*_at`, guarded by a test that walks the
encoded world), sets `LastSeenAt` to now and drops the away log and a
pending summary; `GET /dev/snapshot` advances the world to now first
without a version bump; 409 `snapshot_schema_mismatch` /
`snapshot_content_mismatch` (content compares `Region.Version`), 400
for garbage. `postDevReset` client helper and `DEV_HOOKS` removed with
the fixture gate; `/dev/reset` keeps `requireSession` (a no-op in dev).

## D-067 Reference games are generated from declarative plans

- **Status:** accepted (2026-11-01)
- **Context:** the pacing proof of the game is four reference replays
  (`server/testdata/scenarios/bootstrap_{citizens,citizens_quests,
  merchants,patricians}.json`, up to 7 863 hand-authored steps) with
  targets citizens ≤ 60/90/100/150, quests ≤ 45/85, merchants
  ≤ 240/270/420, patricians ≤ 900/960/1800 minutes. Every rule that
  touches placement breaks them: D-062 repaired them by hand (#54) and
  D-065 cannot pass at all — under the old `services` category market +
  chapel already gave coverage 1.0, so the replays never reserved plots
  for schools, taverns, churches, playhouses, universities, cathedrals;
  under binding chains there is no room, and the only way out of the
  session was demolition, which the reference tests forbid.
- **Decision:**
  1. **Plans, not steps, are the source.** A reference game is a
     declarative plan file (`server/testdata/plans/<name>.plan.json`):
     build order with counts and tiers, island assignment, quarters with
     **reserved civic plots** (chain buildings, market, guard, fire
     station, surgery) sized from content footprints, routes, and the
     named checkpoints. A generator (`server/cmd/replay-plan`, logic in
     `server/internal/sim/scenario/plan`) lays out footprints and roads
     against the loaded terrain through the server's own placement
     validation, inserts whole-minute waits where stock is short, and
     emits the step JSON.
  2. **The committed scenario is the generator's output.** A test
     regenerates each plan and asserts byte equality with the checked-in
     scenario (`-update` rewrites it, like the goldens); the existing
     target tests stay unchanged. Editing the JSON by hand is no longer
     a path.
  3. **Reference games never demolish, never grant stock, never pause
     for advantage** — the levers are layout, build order, waits and
     island assignment (as #54 stated). Targets are not relaxed; a miss
     is reported with the generated game as evidence.
  4. `devworld`'s `played` fixture and the display fixtures keep
     replaying `bootstrap_patricians`; nothing else depends on the
     format change.
- **Why:** rule changes should cost one plan edit, not a day of
  patching; the generator makes the "is the pacing still right" question
  answerable after every content change, including D-065 and the V7
  footprints to come.
- **Consequences:** D-065 lands on top of the generator (the chain rule
  needs the reserved plots). First the generator reproduces the current
  targets under the current rules; then the D-065 data and rule are
  applied and the plans gain the chain buildings. STATUS and CONTENT §12
  reference the plans; the temporary repair tools of #54 and the D-065
  session are superseded.
- **Rejected:** hand-patching the replays once more (third time, and it
  does not converge for Patricians); allowing demolition in the
  reference games (hides a layout problem); softening D-065 back to
  shares (contradicts its intent).

**As built** (#63, 2026-11-01): `server/internal/sim/scenario/plan`
(plan format, coverage-based civic reservation from the chain radii,
layout through the server's placement rules via `internal/layout`,
whole-minute waits, emitter), `server/cmd/replay-plan` (`-plan -out`,
`-check`), plans in `server/testdata/plans/`, `plan_test.go` asserts
byte equality with the committed scenarios (`-update`). Reserving a full
chain set per quarter left 1 242 unbuilt tiles and did not fit; by
coverage it leaves 0. Pig farms 11–14 moved to island 6 with an extra
sloop (the home island's grass was the constraint). Plan authoring
levers used: warehouse location hints, stone-route steps around the
cattle farms, land-use heuristics. Under the current rules the
generated games were faster than the hand-patched ones (47/33/79/115 ·
32/64 · 216/243/273 · 793/826/917) before D-065 was applied.

## D-068 Ground cover is texture; models contain only what stands up

- **Status:** accepted (2026-11-02)
- **Context:** every voxel recipe lays a one-voxel ground plate (grass,
  dirt, paved, sand or planks) over its footprint, fields have plates
  too, and roads are sunk one voxel into the terrain (D-057 V2). The
  terrain level is therefore the only surface at "zero": footprints
  stand on raised slabs, roads lie in trenches, and the town reads as a
  patchwork of lifted tiles around sunken paths. Removing only the
  grass plate (V7 pipeline) made the contrast more visible. The island
  already has a per-island ground texture (one texel per terrain
  column, `render/groundshader.ts`) into which field ground and the far
  roads are painted.
- **Decision:**
  1. **Ground cover is painted, not modelled.** Paved yards, dirt
     yards, sand, plank decks on land, field ground and roads are
     colours in the island's ground texture, flush with the terrace.
     Only structures and props are voxels: walls, fences, kerbs that
     really stand up, crops, posts, barrels.
  2. **Recipes declare their yard, the manifest carries it.** `yard()`
     calls become a per-tile ground map in the model's manifest entry
     (`ground: kind per footprint tile`, rotated with the building);
     the exporter derives it from the recipe, so authoring does not
     change. The client paints the footprint's columns when a building
     is placed and restores the terrain colour when it is demolished or
     moved, exactly like fields today. Ground paint never changes
     height.
  3. **Roads are flush.** The near-LOD road is a painted path (dirt
     with worn edges and stones; cobbles in three shades with a kerb
     colour), the terrain height untouched; carts and walkers walk on
     the ground; ramps at terrace edges are the terrace's. Near and far
     roads become the same paint at two resolutions.
  4. **Fields lose their plates**; fences and crops stand on the
     painted field ground (`farfields.ts` colours are the source).
  5. **Water structures keep their decks.** Fisher, shipyard, Trading
     Post pier, trading pier, depot, quays, salt pans, oyster beds
     stand on real deck voxels over water rows; the land part of their
     footprint follows §1–2.
  6. **Ground checker:** a model's voxels start at z = 0 on the
     terrain; the floating-voxel check (V7 pipeline) stays; a new check
     rejects full-footprint plates in land recipes.
- **Why:** one consistent ground plane (the Anno reference has no lifted
  plots); the footprint always reads as the plot (the "up to a tile
  short of the plot edge" gap of 22 models disappears); fewer
  triangles and no per-road-change terrain rebuild near; near and far
  roads from one source.
- **Consequences:** exporter + manifest field + schema test; client
  ground painting on place / demolish / move (display state already
  carries footprints), `roadvoxels.ts` → flat paint, field recipes
  without plates, life layer walking height; all models rebuilt;
  ART_DIRECTION §4 (ground, roads, fields) and §7 (authoring: no
  plates); far budget rule unchanged and re-measured. Part of the V7
  branch before the per-model rework continues.
- **Rejected:** keeping plates and sinking the whole model by one voxel
  (z-fights with the terrain top and keeps the slab edge colour);
  cutting terrain holes under footprints (rebuilds the terrain mesh on
  every placement and still leaves the plate seam); leaving roads sunk
  (the trench is the other half of the problem).

**As built** (#66, 2026-11-03): as decided, with these shapes. `yard()`
/ `path()` record a ground kind per cell (paved / dirt / sand / planks;
a tile takes the kind covering ≥ half of it) and lay no voxels on land;
the exporter writes `ground` (rows = footprint y at rotation 0) into
the manifest entry. Recipes were not rewritten to z = 0: they carry
`GROUND_Z = 1` and the build (`settle_on_terrain`) drops their z = 0
layer — its paved / dirt / sand cells become ground kinds — and lowers
the rest, anchors included; new recipes start at z = 0 and omit it.
The seven water models (`config.WATER_MODELS`, tested against content)
keep their decks over water rows; only their land part settles. Build
checks: *floating voxels* (a 26-connected group never reaching the
ground, `P.tie_floating` closes one-voxel gaps) and *ground plate*
(> 35 % of a land footprint flat at z = 0). Client `render/groundpaint.ts`
paints each tile of the ground map with the model's transform on every
layout change from the bare terrain, so a moved or demolished building
leaves plain terrain; paved = `road-paved` cobbles, dirt = `road-dirt`
with stones and a frayed edge, sand = `sand`, planks = `timber` × 1.62
(no plank role). Fields paint their whole footprint; meadow and tree
plot keep the terrain grass. Roads change no height; path, worn edges,
stones, cobbles and kerb are ground colours shared with the yards and
sampled by the far view; `paintRoads` records its columns so yard and
field paint skip them; terrace ramps and quay decks still rebuild
chunks, a plain road change only repaints the texture; carts and
walkers at ground height. No proud plinths on land (flush one-voxel
stone band), grass tufts and flowers stand on the terrain. Tree plots
are the forest's `decor_tree_a–d` meshes at forest scale, six variants
picked per tile by hash (4 broadleaf, 1 birch, 1 conifer), crowns
overhanging up to half a tile; this needed the first per-model
overrides in `config.py` — `BUDGET_OVERRIDE = {"tree_plot": 450}` and
`SLACK_OVERRIDE = {"tree_plot": 4}`. Folder 18.51 → 16.21 MiB after
the plates (23.35 MiB after the rework); far played 14 draws / 224 k
tris on desktop and desktop-xl.

## D-069 Collector reach, hub upkeep, unlock by population, harbour extensions at Merchants

- **Status:** accepted (2026-11-03)
- **Context:** the owner's tier 2–4 playtest after the V7 rework. A
  producer delivers to the nearest collector by road with no distance
  limit, so one Trading Post and one Warehouse serve an island of any
  size; the collector throughput (Trading Post 30/55/80/110, Warehouse
  30/50/70/90 per minute) is the only limiter and was felt to be very
  high, so warehouses are rarely needed. Market, Warehouse and Trading
  Post have upkeep 0 at every level. Tier unlocks (D-012, D-056) mix a
  population count with named buildings (`market` + `chapel`, `tavern`,
  `church`); the house upgrade gate already enforces those buildings
  through need coverage, so the list reads as arbitrary ("why a tavern
  and not a school?"). All four harbour extensions sit at Citizens.
  CONTENT §7 named a reach rule as "a new decision".
- **Decision:**
  1. **Reach.** Every collector has a **reach** per level, measured
     like a public-building radius (Euclidean from the nearest footprint
     tile, MECHANICS §6): Trading Post **20 / 24 / 28 / 32**, Warehouse
     **14 / 17 / 20 / 23** tiles (provisional). A producer is
     *assignable* to a collector when its **building footprint** (never
     its fields, plots or pastures) lies within the reach and the
     producer is road-connected to it; assignment is the nearest
     assignable collector by road (ties as today). A producer without an
     assignable collector gets the bottleneck **`no_collector_in_reach`**
     and **stalls** — rate 0, buffer kept, nothing lost (D-009); the
     warnings panel and the card show it; the ghost tint of a placed
     collector or producer is exact (reach + road connection are both
     display state, D-027 hint, server result is truth).
  2. **Throughput** per level cut to Trading Post **20 / 40 / 60 / 80**,
     Warehouse **20 / 35 / 50 / 65** per minute (provisional), so that a
     quarter of 8–10 producers wants its own warehouse.
  3. **Hub upkeep** per level: Warehouse 5 / 10 / 15 / 25, Market 5 / 10
     / 20 / 30, Trading Post 0 / 10 / 20 / 30 gold/min (level 1 of the
     Trading Post is the founding building and stays free). Houses keep
     no upkeep; tax is their economy.
  4. **Unlock by population only:** Citizens 120 Settlers, Merchants 360
     Citizens, Patricians 1 200 Merchants, archipelago-wide as before;
     the `buildings` list leaves the unlock conditions (schema keeps the
     key optional for region 2). The intro quests keep leading the
     player to market, chapel, tavern and church.
  5. **Harbour extensions:** `trading_pier` and `depot` move to
     **Merchants**; shipyard and quay stay at Citizens.
  6. **Hub levels** keep their D-065 gate (tier unlocked); the hub card
     shows the lock reason ("Requires Citizens") like the build-menu
     tabs (UI item, no rule change).
  All numbers are settled by the D-067 plan replay: the reference plans
  are re-generated with the new rules (more warehouses, earlier piers
  only from Merchants), the tier targets are reported, never relaxed by
  loosening a rule.
- **Why:** reach makes warehouse placement a real layout decision (Anno
  1404's Kontor / Markthaus reach) and gives the ghost tint something
  exact to show; upkeep makes the hubs felt as infrastructure; a pure
  population ladder is honest (the buildings are already required by
  the upgrade gate); the pier and depot only matter once several routes
  run, which is tier 3 in our pacing.
- **Consequences:** sim schema bump (`reach` per level, `trading_pier` /
  `depot` tier), assignment with reach in `internal/sim` (golden
  fixtures), new bottleneck code in openapi and `display/status.ts`,
  warnings panel entry, ghost tint for collectors and producers
  (`display/served.ts`), hub card lock reason, CONTENT tables (§7
  collectors, unlock table, harbour tiers), MECHANICS §5 and §12,
  plans in `server/testdata/plans` re-generated, almanac shows reach.
  Per-island evaluation of the hub gate was considered and rejected
  (farm islands without houses could never upgrade).
- **Rejected:** a reduced throughput factor instead of a stall for
  unreached producers (hides a placement error); reach along roads
  (Anno 117 / 1800 model — a per-house BFS on the server and a
  connectivity model in the display for the hint; B7 of the same
  interview kept public radii Euclidean for the same reason); a
  four-tier harbour ladder (one toy per tier for its own sake);
  "≥ 1 resident of the tier" as the hub-level gate (equivalent to the
  unlock archipelago-wide, wrong per island); house upkeep.

**As built** (#69, 2026-11-04): content `old_coast-0.18.0`, sim schema
14. Final numbers after the plan replay: Trading Post throughput
20 / 40 / 60 / 80, reach 20 / 24 / 28 / 32, upkeep 0 / 10 / 20 / 30;
Warehouse throughput 20 / 35 / 50 / 65, reach 14 / 17 / 20 / 23,
upkeep **1** / 10 / 15 / 25; Market upkeep **0** / 10 / 20 / 30. Three
deviations from the decision's provisional numbers, all forced by the
reference games (targets were not relaxed): market level 1 upkeep 0
(any upkeep soft-locks the Citizens game), warehouse level 1 upkeep 1
(5 or 2 failed the Merchants game), warehouse level 1 reach 14 (17 let
the Citizens Trading Post load fall below its target) — the tier-1/2
gold margin is thin and is a balance-pass candidate. Assignment and the
`no_collector_in_reach` stall as decided; the plan generator gained a
reach-aware warehouse placement mode (a warehouse follows a remote
producer). **Trading Post levels are tier-gated like the warehouse**
(level 2 Citizens, 3 Merchants, 4 Patricians; `tier` on the level,
`ErrTierLocked`) — the ungated level 4 was bought at minute 720 in the
Patricians plan and its upkeep slowed the game by 23 minutes. Reach
ring (gold, like all rings) on the selected collector and its ghost,
exact ghost tint, reach and upkeep on cards and in the almanac. Plan
timings: 48 / 12 / 85 / 128 · 32 / 68 · 220 / 263 / 397 · 808 / 847 /
1078, all within target.

## D-070 Route stops: unload limits and a keep-minimum when loading

- **Status:** accepted (2026-11-03)
- **Context:** a stop unloads everything listed and loads up to
  `max_amount`; the owner wants to cap what a harbour receives and to
  protect an island's own stock from being emptied by a route.
- **Decision:** `stops[].unload[]` gets an optional **`max_amount`**
  (tonnes unloaded per visit, capacity still applies; the rest stays
  aboard); `stops[].load[]` gets an optional **`keep`** — the stop
  loads only the stock above `keep` tonnes (`load = min(max_amount −
  aboard, stock − keep, slot room)`). Both evaluated at `ship_arrived`
  (§9.2), both default to today's behaviour when absent; the route
  editor shows them as number fields behind the good (`t`); the almanac
  route chapter explains both.
- **Why:** the two levers every Anno route needs (1800 has both);
  without `keep` a stone route starves the quarry island's own
  builders.
- **Consequences:** route schema bump (openapi + `route_invalid` for
  `keep` / `max_amount` < 0), `internal/sim` arrival handling with
  golden fixtures, route editor fields and translations, MECHANICS §9.2.
- **Rejected:** per-good island reserves outside routes (a second place
  for the same setting); percentage-based keep (tonnes are what the
  player sees everywhere).

**As built** (#69, 2026-11-04): as decided; `unload[].max_amount` and
`load[].keep` in the route schema and openapi, golden `route_limits`
(defaults reproduce the previous output), route editor number fields
(`keep`, `max`; empty = none / all), almanac Ships page gained a Routes
chapter.

## D-071 Planning mode: planned placements that are built by hand

- **Status:** accepted (2026-11-04)
- **Context:** the owner wants to lay out a quarter before he can pay
  for it — reach rings (D-069), service radii and fields make layout a
  real decision — and asked for a planning toggle next to the Demolish
  and Move tools.
- **Decision:**
  1. **Planning mode** is a toggle in the build bar. While it is on,
     every placement — buildings, roads, fields — creates a **plan**
     instead of a building; off, placements build directly as today.
     Plans persist across toggling, sessions and devices.
  2. A plan is a **server-side object on the island** in state
     `planned`: its footprint is **reserved** (nothing else can be built
     or moved there), validated at planning time with the full
     placement rules (terrain, water rows, fertility, deposit, coast,
     spacing) **except the tier lock** (planning a locked-tier building
     is allowed) and the cost. It has no cost, upkeep, workforce,
     production, service or reach, is not a collector, not a road for
     connectivity, counts for no quest or unlock — invisible to the sim.
  3. **Building a plan is manual only**: the plan's card offers **Build
     · Move · Demolish**. Build applies the normal placement command at
     that instant (cost, tier, typed errors); Move is free with normal
     validity; Demolish is free. There is no batch build and no
     automatic build.
  4. **Roads and fields**: planned road tiles are reserved like
     buildings; a planned road tile's card covers the connected planned
     segment ("Planned road · N tiles", Build · Demolish). A planned farm
     carries planned fields, built together with it; fields painted on a
     real farm in planning mode are planned fields built from the farm's
     card. A real road placed over a planned road replaces the plan.
     Demolishing a real farm removes its planned fields; the Demolish
     tool removes plans it is dragged over.
  5. **Look**: the ghost material (translucent, untinted) with a thin
     gold footprint outline; no stage, smoke, badge or life-layer
     figures; not drawn in the far mesh or far road layer. The card
     shows the cost in build-menu format (unaffordable parts red, fields
     included for a farm) and the reason Build would fail. A selected
     planned collector or service building shows its gold reach /
     radius ring; plans never count in ghost hints.
  6. Trading Posts (founding) and hub levels cannot be planned. No cap
     on the number of plans.
- **Why:** layout is the game's core decision and should be possible
  before the resources are there; manual build keeps the economy under
  the player's hand — an automatic build-when-affordable would spend
  gold and materials while the player is away, exactly where D-008 /
  D-009 want the world to stall, not to act.
- **Consequences:** sim schema bump (planned state for buildings,
  roads, fields), commands (plan / build / move / demolish plan or a
  `planned` flag on the existing ones — session's choice, documented in
  MECHANICS), footprint reservation in every placement check, display
  payload `planned: true`, openapi; client toggle, ghost look, plan
  cards, planned road segment card, rings on selected plans; snapshots
  and dev fixtures carry plans; D-067 plans unaffected (they never
  plan). MECHANICS §Placement, UI.md tools and cards, almanac note.
- **Rejected:** client-only sketches in local storage (lost across
  devices, no footprint reservation); automatic build-when-affordable
  or a batch "build all affordable" button (gold and material drain
  while away, and the only piece that would have needed scheduled
  events); free sketches without reservation (two plans or a plan and
  a building overlapping).

*As built (#70):* plans are created by the existing placement commands
with `planned: true` (`place_building`, `place_road`, `place_fields`);
`build_plan {island_id, building_id | x, y}` builds a planned building
(a planned farm with its planned fields, a real farm's planned fields)
or the connected planned road segment through a tile; Move and Demolish
use the normal commands on the plan (free). `demolish_roads` is a new
batch command (≤ 512 tiles, per-tile result, 50 % refund per tile) for
the Demolish rectangle, which removes roads, fields and plans but never
a building. Sim schema 15 (no-op migration), content unchanged. The
payload lists `plans` and `planned_roads` apart from buildings, each
buildable unit with its `plan_cost` and the first reason Build would
fail. Public buildings and the market show their gold radius ring on
ghost and selection (hidden at far zoom); the Move tool picks the farm
from a field. Golden fixtures include "advancement with plans equals
without" and `roads_demolish_rect`. Far budget unchanged (15 draws /
211 k triangles, no plan layer in the far mesh).

## D-072 Anno 117 island sizes, a one-island camera cap, Anno 117 service radii, coastal massifs and wider rivers

- **Status:** accepted (2026-11-04)
- **Context:** D-062 took Anno 117's building footprints and D-054 its
  field counts one-to-one, but D-053's islands are about half of their
  Anno 117 counterparts by buildable area (measured over seeds 1–50:
  large 18 590, medium 6 222, small 2 136 tiles against Anno 117's
  31 573 / 13 369 / 5 860 — "total tiles" there is the buildable area,
  12 tiles per house). A farm therefore eats the same area as in Anno
  on an island half the size. The service radii came from the Anno
  1404 pattern (a chapel per block): the Patricians reference game
  needs 7 chapels, 7 markets, 4 churches and 4 schools for 194 houses,
  while Anno 117's quarter of ≈ 300 houses is served by one set of
  public buildings. The far view at the zoom cap (half extent 120)
  shows a whole large island with two or three neighbours; Anno 117's
  farthest camera shows less than one large island, the overview is the
  map. The owner also wants the mountains along the coast rather than
  across the island and rivers a tile wider, as in Anno.
- **Decision:**
  1. **Island sizes = Anno 117 buildable areas**, composition and count
     unchanged: 3 large (≈ 31.6 k buildable, ≈ 250 tiles across), 5
     medium (≈ 13.4 k), 4 small (≈ 5.9 k), 0–2 rocks, skerries;
     archipelago buildable ≈ 185 k ± 10 % (was 91 k). No extra-large
     class now (recorded as an option for a later region: Anno 117's
     38.9 k class). Water gaps unchanged (spacing ≥ 50, nearest ≤ 120,
     straits ≥ 24, open sea ≤ 150); the extent grows with the islands.
     Shape rules scale with √area (plain ≈ 52 / 32 / 19 before item 4).
  2. **Camera cap** `camera.max_half_extent` 120 → **80**: the far view
     shows about one large island; the minimap is the archipelago
     overview. LOD bands unchanged (near < 30, mid 30–54, far 54–cap).
  3. **Service radii after Anno 117** (dirt-road ranges × 0.75 for our
     Euclidean rule, D-065 ranks and D-060 civic needs unchanged):
     market 20 / 24 / 28 / 32 per level; chapel 16 (unchanged), church
     28, cathedral 50; tavern 20, playhouse 38; school 20, university
     46; city guard 26, fire station 22, surgery 28. Costs and upkeep of
     church, cathedral, playhouse, university and market levels 3–4
     rise (×2 as the starting point). **Collector reach** (D-069)
     scales with it: Trading Post 24 / 28 / 32 / 36, Warehouse 18 / 21 /
     24 / 27. All provisional; the D-067 plan replay tunes costs and
     reach, radii stay as listed unless a plan proves one wrong.
  4. **Rim massifs**: the mountain ridge (D-058 §2) becomes **2–4
     compact massifs around the rim** of a large island (1–2 medium,
     0–1 small), on different sides, one dominant; cliffs to the sea on
     the outer flank, a gentle foot inland; the **interior is one
     connected plain**, no massif crosses it, and the coast between
     massifs is beach. Rivers rise in a massif and cross the plain to a
     bay on another side (where the bridges matter). Deposit slots are
     spread over the massifs. Generator heights rise from 1–4 to
     **1–6** (large), 1–5 (medium), 1–3 (small) at the client's 8 steps
     per level, so peaks reach ≈ 6 tiles; mountain share of land stays
     10–19 %; ≥ 2 Trading Post sites per habitable island hold.
  5. **Rivers 2 tiles wide** (3 at the mouth; was 1 / 2); bridges span
     the width (a 2-tile arched bridge model; a road tile per river
     tile as today); small islands keep no rivers.
- **Must hold:** D-048's far budget (≤ 40 draws / 250 k triangles) at
  the new cap on the largest-island fixture and "no pan frame > 50 ms"
  on the dense mid fixture; D-067's tier targets (60 / 90 / 100 / 150 ·
  45 / 85 · 240 / 270 / 420 · 900 / 960 / 1 800), never relaxed — plans
  re-generated on the new islands; a first frame that does not get
  noticeably slower (the large island's payload grows ≈ 1.7×; split the
  payload rather than the island if it does).
- **Why:** one ruler for everything — footprints, fields, islands,
  radii, reach — so balance stops being re-derived; the top of each
  service chain becomes the landmark a city turns around (the Anno 117
  screenshots), while shrines stay small and local; a one-island far
  view keeps the voxel world a world rather than a map and makes the far
  budget scale with the viewport instead of the archipelago; a coastal
  massif leaves the plain whole and reads as Anno's islands do.
- **Consequences:** `islands.json` sizes and shape parameters, generator
  (massif placement, river width, plain targets, buildable target),
  atlas statistics and tests, content version bump, radii / costs /
  reach in `buildings.json`, sim schema bump, every fixture, scenario,
  golden, dev snapshot and reference plan regenerated (existing
  `.snapshots` are invalid), bridge model variant (`make assets`),
  client cap, far-budget fixture re-measured at cap 80 (a LOD step only
  if it is over), minimap as the overview, CONTENT §islands and tables,
  MECHANICS §6 radii, ART_DIRECTION §4 (rivers, bridges, massifs),
  D-053 / D-058 superseded in those points, D-065 / D-060 / D-069
  numbers amended. Two sessions after D-071: server (generator,
  content, plans, fixtures) then client (cap, far budget, first frame,
  bridges).
- **Rejected:** copying the Anno 117 map composition (4 XL + 4 L + 6 M +
  3 S ≈ 380 k buildable — a multiplayer map's worth of land for one
  player, and a rendering rewrite); shrinking farms and fields instead
  (undoes D-054 / D-062 and the model fit); keeping the 1404 radii
  (chapel-per-block on bigger islands); a far-LOD rewrite to keep the
  archipelago-wide far view; paved roads extending the radius by 50 %
  as in Anno 117 (needs road-distance coverage, rejected with D-069 —
  parked as an idea for paved roads).

*As built, part 1 (#71):* `islands.json` sizes 250 / 165 / 110 (plain
52 / 32 / 19, `shape.massifs` replaces `arms`), buildable target
185 000; measured over seeds 1–50: buildable 32 061 / 13 962 / 6 162
(84–91 % of land, mountains 7–13 %), massifs large 2–4, medium 1–2,
small 0–1, highest rock 6, every island with ≥ 2 disjoint Trading Post
sites. Rivers 2 wide, 3 at the mouth (roads cross at most two river
tiles; the estuary has no bridge). Content
`old_coast-0.19.0`: radii and reach as decided; costs ×2 for church,
cathedral, university and market levels 3–4; the playhouse kept
15 000 gold (×2 missed the Merchants 420 target) with materials and
upkeep doubled. Camera cap 80. Reference games 49 / 11 / 86 / 130 ·
32 / 70 · 220 / 264 / 412 · 745 / 782 / 1 082 — all targets hold;
plan changes: isle-02 late pig farms 1 → 3 (sausage shortfall on the
home island), the citizens plan reserves a school per home quarter.
Far budget at cap 80: 13 draws / 198 k triangles (desktop-xl) — no LOD
step needed.

*As built, part 2 (#72):* every deposit slot reserves a footprint of
its largest building (3 × 8, clay pit 4 × 6) on mountain tiles beside a
buildable tile, pairwise disjoint; slots ≥ 16 apart (8 on rocks),
same-kind slots on different massifs — 133 of 600 islands in seeds
1–50 failed this before, none now; plans fixed, not the rule. Founding
and island framing stop at the cap and centre an island too big to fit;
the island name stays visible; far-budget fixture is the home island
(seed 31). The client requests `/world` and `/content` before the
engine is set up: first frame +5–9 % against pre-D-072 (budget +25 %).
Bridges: the deck sits at the lower bank's height on four raised bridge
models, a higher bank slopes its road down; three crossings on the dev
seed keep a one-level step, and the far view hides bridges (≈ 2 px gap
in the road). Almanac shape text lists massifs. Far budget at cap 80:
14 draws / 205 k. Follow-ups: cache the sea-route grid that
`GET /world` rebuilds per request (island tile data is 47 % larger
compressed); resource rocks never generate because no rock has room
for a Trading Post site (pre-existing).

## D-073 No resource rocks; skerries stay scenery

- **Status:** accepted (2026-11-05); supersedes the resource-rock clause
  of D-053 §1 and D-053's `rock` size class.
- **Context:** D-053 promised 0–2 resource rocks (≈ 16 tiles, mountain
  and coast only, a Trading Post site and 2–4 deposit slots) as mining
  outposts. They have never generated: no 16-tile rock fits a Trading
  Post site, and since D-072 part 2 also the deposit footprints. The
  deposit-coverage guarantee is met by the habitable islands alone, so
  no player or plan has missed them. The owner wants small rocky
  islets in the sea for the look — which the `scenic` skerries
  (4–12 tiles, no sites, fertilities, deposits or name) already are —
  and nothing on them to found, mine or build.
- **Decision:** remove the `rock` class and its rules (`rockMinable`,
  rock sites, rock slot spacing); the archipelago is the 12 habitable
  islands plus skerries. Skerries stay unbuildable, unselectable
  scenery with no deposits; their count range may rise (4–8 → 6–12)
  and their size range widen (up to ≈ 16 tiles) for variety, with a
  rock, grass or sand top as today. Spacing rules unchanged.
- **Why:** a mechanic that cannot generate is dead weight in the
  generator and the content format; the gameplay value (extra deposit
  sites) is not needed, and the visual value is already delivered by
  skerries.
- **Consequences:** `islands.json` loses the `rock` class (schema and
  validation), generator and verify code shrink, seed goldens and
  scenarios regenerate, CONTENT §9 and the almanac Islands table drop
  the rock row, D-053 gets an inline pointer. Plans must still hold.
- **Rejected:** a larger rock class (size 24) or a rock-only site rule
  — keeps a feature nobody asked for; mining outposts can return as a
  region-2 island type if a design needs them.

*As built (#73):* `rock` class, `rockMinable` and rock site rules
removed; skerries `size` 5 (5–18 tiles), count 6–12. One rock draw was
kept in the island plan so seeds and the reference plans stay
byte-identical; it goes with the next plan replay. Seed goldens and
display fixtures regenerated; plans hold.

## D-074 Houses fill with satisfaction, residents stay on upgrade, smaller collectors, start stock, group move, lone windmill

- **Status:** accepted (2026-11-06); amends D-013 / D-056 (growth),
  MECHANICS §6.1 (upgrade), D-069 (collector throughput), D-051 (start
  stock), D-054 (mill footprint).
- **Context:** the owner's first playtest on the D-072 world
  (Citizens, snapshot `1053001-20261105-220625`): a Citizen house
  reached 15 / 15 at 54 % satisfaction with no tier-2 good at all,
  because the cumulative tier-1 needs plus three public buildings pass
  the 0.5 growth threshold; an upgraded 8 / 8 Settler house restarted
  at 5 / 15; 24 producers (≈ 28 t/min) never loaded the Trading Post
  and two level-1 warehouses (60 t/min), so collector levels were
  irrelevant before Merchants; the opening spends the 1 000 start gold
  to zero and waits for taxes; the founding sloop carries 10 sails
  that the tier-2 shipyard quest grants again; moving a production
  block means moving every building by hand; the 4 × 6 mill with its
  annex reads poorly.
- **Decision:**
  1. **Capacity follows satisfaction.** A house's target residents are
     `floor + (max − floor) × satisfaction` (rounded down, never below
     `floor`); residents grow towards the target at `growth_per_min ×
     satisfaction` and decline towards it at `decline_per_min ×
     (1 − satisfaction)` when above. `growth_satisfaction_threshold` is
     removed. The upgrade gate (at `max`, every required need served)
     is unchanged.
  2. **Residents stay on upgrade**: the house keeps
     `min(residents, new max)`; the growth accumulator resets; from
     there it follows the new tier's target (which may be below the
     kept count — then it declines gently, never below the floor).
  3. **Collector throughput** per level: Trading Post 8 / 16 / 32 / 64,
     Warehouse 6 / 12 / 24 / 48 t/min (was 20 / 40 / 60 / 80 and
     20 / 35 / 50 / 65). Reach, upkeep and capacity unchanged. The cap
     model stays (a cart model — N carts per level, trip time by road —
     is the recorded alternative if the cap still feels abstract).
  4. **Start**: 2 000 gold (was 1 000); the founding stock is planks
     only, **100 t** (the sloop's two 50-t slots — 150 never fit), the
     10 sails come from the tier-2 shipyard quest; the intro quest text
     names planks only.
  5. **Group move** (accepted scope, scheduled after the balance pass
     and polish 7): the Move tool drags a rectangle; every building,
     field, plot, road tile and plan inside moves by one offset in one
     server transaction (`move_group`: every footprint valid at its
     new site, fields with their farm, roads re-laid, all or nothing,
     free like a single move).
  6. **Mill**: a lone windmill on 3 × 3 (Anno 1404's tower mill; no
     miller's house), cost and recipe unchanged; new V7 recipe.
- **Why:** 1–2 make a house's size the readable mirror of its supply,
  as in Anno — a full house means a supplied house — and stop the
  cliff at an arbitrary threshold; 3 makes collector levels a tier-1/2
  decision (one level-1 warehouse per block of ≈ 5 producers); 4 removes
  the dead wait after the opening and a double grant; 5 is layout
  quality of life the planning mode does not cover; 6 is look.
- **Consequences:** sim rules (growth target, upgrade), region.json
  constants, `buildings.json` collector levels and mill footprint,
  `start.json`, quest text (EN + DE), content version bump, golden
  fixtures (growth, upgrade), all four reference plans replayed against
  the D-067 targets — never relaxed; MECHANICS §5 / §6.1 / §12, CONTENT
  §7 and tables, the almanac's house and collector pages, mill model
  (`make assets`), UI.md house card (target shown as "→ n / max"
  already exists). Group move is a later session (command, openapi,
  rectangle UI, group ghost).
- **Rejected:** raising the growth threshold instead of removing it;
  restarting at the floor on upgrade; the cart model now; cutting
  tier-1 upkeep instead of raising the start gold.

*As built (#74):* sim as decided; the **upgrade gate** reads "at its
target residents" (not `max`): under §1 a house with one alternative
per category never reaches `max`, and D-056 §4 promises that one
alternative is enough to progress — the second half of the gate (every
required need ≥ 0.6) is unchanged. No schema bump. Forests: 48 tree
plots (the owner's 64 stays an option after the next playtest). Mill
recipe: tier-2 tower on a rubble base with lattice sails. Reference
games 53 / 27 / 80 / 135 · 23 / 44 · 230 / 265 / 405 · 719 / 838 /
1 188 — all targets hold, `growth_per_min` untouched; the Citizens
unlock moved from minute 11 to 27 (houses no longer fill on tier-1
goods alone). Found on the way: the auto-pause rule can strand a town
when the paused building is the only producer of an unmet need (the
resume rule never fires while the balance falls) — decision pending.

## D-075 Low shores for piers, collector ramp, look follows the workers, Hanseatic ships, supply chains pause last

- **Status:** accepted (2026-11-08); amends D-062 (water-edge
  placement), D-069 / D-074 (collector numbers), D-063 / D-064 (roof
  ladder), D-051 / D-056 (ship names and IDs), D-008 / MECHANICS §7
  (auto-pause order).
- **Context:** the owner's second playtest (Merchants, snapshot
  `1053001-20261108-175751`): a fisher on a level-1 cliff coast stands
  on a grass block above the beach; one level-1 warehouse (6 t/min) is
  full after a single tier-1 block and the level-2 upgrade costs a
  quarter of a tier-1 town's income; tier-3/4 production buildings wear
  their unlock tier's roofs although they are plain workshops; the ship
  ladder sloop / brig / galleon does not fit the Hanseatic Old Coast;
  and #74 found the auto-pause can strand a town when the paused
  building is the only producer of an unmet need.
- **Decision:**
  1. **Low shore.** A building with `water_rows` needs all its land
     tiles at terrace level 0 (`ErrNeedsLowShore`; ghost tint, almanac
     "needs a low shore"). Generator unchanged.
  2. **Collectors.** Throughput Trading Post 10 / 20 / 40 / 80,
     Warehouse 8 / 16 / 32 / 64 t/min; upkeep Trading Post
     0 / 6 / 12 / 24, Warehouse 1 / 5 / 10 / 20 gold/min. Reach,
     capacity and upgrade costs unchanged.
  3. **Look follows the workers.** Content field `look` ∈ `rural |
     workshop | civic | harbour` (no gameplay effect). `rural` (farms,
     lumberjack, apiary, orchard, hemp, dairy, pig, quarry, mines,
     charcoal burner) wears the tier-1 look — thatch, timber, low walls
     — whatever its tier; `workshop` (sawmill, weavers, mill, bakery,
     cidery, meadery, tannery, sailmaker, smelter, toolmaker and the
     tier-3/4 workshops) the tier-2 look — terracotta, half-timber,
     stone plinth; dark tile allowed on tier-4 workshops; size and props
     tell the tier. `civic` (houses, faith, education, culture,
     security, market) and `harbour` (trading post, warehouse, shipyard,
     pier, depot) keep the unlock-tier ladder of D-063 / D-064.
  4. **Ships.** IDs and names `sloop → cog`, `brig → hulk`,
     `galleon → carrack` (EN Cog / Hulk / Carrack, DE Kogge / Holk /
     Kraweel); stats unchanged; new recipes (cog: one square sail, high
     sides, stern castle; hulk: fore and stern castle; carrack: three
     masts). Renamed before deployment, so no data migration; the old
     IDs are retired, never reused. **Region rule for later:** a ship
     sails at full speed in its home `region` and at × 0.8 elsewhere —
     implemented with region 2.
  5. **Supply chains pause last.** In the auto-pause order a building
     is skipped while it is the island's only running producer of a
     good that a house on the island consumes below 0.6; the pause
     falls on the next candidate. The gold floor of D-008 still holds
     when nothing else is left. Manual resume and the warning stay.
- **Why:** 1 is the cheaper of two fixes and reads naturally (cliffs are
  not pier coasts); 2 makes the first collector upgrade a tier-1/2
  choice; 3 is Anno 1404's rule — production stays humble, the town
  escalates; 4 fits the setting and renaming is free only now; 5 is
  deterministic and explainable, unlike trial resumes.
- **Consequences:** sim (placement check, pause order), content
  0.21.0 (collectors, `look`, ship IDs), schema for `look`, quests /
  start / plans / goldens / fixtures / recipes / GLBs / client fixtures
  renamed, almanac texts, plan replay against D-067 targets (never
  relaxed), ART_DIRECTION §3 look rule, 12–15 production models
  re-dressed in an art session, MECHANICS §7 and §9, CONTENT §7 and
  ship table, UI wording "Maintenance" / "Betriebskosten" for upkeep
  (code and docs keep `upkeep`).
- **Rejected:** generator-forced level-0 shores; throughput or upkeep
  alone; keeping the old ship IDs behind new names; trial resume;
  leaving the strand to the player.

*As built (#75):* §1–§4 as decided (`look` also on fields, plots and
roads as `rural`; quay `harbour`; fisher, salt pans, oyster beds
`rural`; a content test keeps the retired ship IDs out of the repo).
The sea-route bug was a lagoon harbour beyond `approachReach` on seed
1053001 roll 2 (straight-line fallback); now every end walks to a
reachable open cell and a property test over seeds 1–50 checks every
leg. **§5 as built, after three refinements in review:** the guard
protects the island's last running producer of *every* good a house
there consumes, met or not; it is **transitive** over the recipe inputs
(the last producer of each input is guarded too); a producer **loses**
the guard while an input is cut off — no producer of it on the island,
running or paused, and no stock, counting goods in transit (R31) — and
the **resume order skips** such a producer until an input producer or
stock exists again; stock from routes keeps the guard while it lasts.
If nothing pausable is left, gold holds at zero (D-009). Almanac chapter
"When gold runs out" (EN/DE). The low-shore rule lives in MECHANICS §2,
the `look` rule in ART_DIRECTION §7. Reference games 50 / 25 / 71 /
124 · 21 / 38 · 215 / 250 / 387 · 721 / 868 / 1 180, no plan changed.
Test fixtures only: recovery property towns seed wood/wool stock, tax
bonus × 1.6, advances split into ≤ 12 pieces.

## D-076 Regions in one world: separate archipelagos, passages, global goods, the Kontor

- **Status:** accepted (2026-11-09); builds on D-010 (regions first-class),
  D-011 / D-064 §1 (regional identity), D-075 §4 (region speed);
  amends D-053 / D-072 (island IDs, generation per region), D-069
  (population unlocks per region).
- **Context:** before more content is added (ornaments, military,
  warships) the world shape must carry regions so that a second region
  later needs no breaking change. Today everything is implicitly
  `old_coast`: island IDs `isle-NN`, one archipelago per world, one
  catalogue, no notion of a passage.
- **Decision:**
  1. **One world, several regions.** Each region is its own generated
     archipelago with its own camera, minimap and far budget; ships
     cross between regions on a **passage** — an off-map leg with a
     fixed time per region pair (`passages[]` in `content/regions.json`,
     provisional 10 min at scale 1), no path, the ship is "between
     regions" (ship list only, `region_id` null, `leg.passage`); it
     enters a region at that archipelago's **passage point** (generator,
     like the start position) and sails the normal sea route from
     there. Inside a region the D-075 region-speed rule applies.
     Rejected: the south as extra islands of the same map (D-072 cap,
     far budget, two climates in one generator); separate worlds (no
     trade).
  2. **Old Coast is always the home region.** A later region is opened
     at **Patricians** by building the **Kontor** (`kontor`, tier 4
     harbour building, `look: harbour`, one per world — new uniqueness
     scope `world`), then a quest chain ending in an **expedition**:
     a ship with founding materials takes the passage and arrives at
     sea in the new archipelago exactly like the game start (choose,
     re-roll once, found). The region's archipelago is generated at
     that moment from `world seed + region index`. The Kontor is also
     the home of the later online features (market, contracts, visits;
     D-022 contracts) and ships now with the expedition disabled while
     `regions.json` lists one region.
  3. **Goods are global, production is regional.** One ID space across
     `content/<region>/goods.json` (loader merges, duplicates rejected);
     any need may reference any good. A later region may add a need to
     an existing tier only as a further alternative of an existing
     category or as a new category of weight ≤ 0.1, never as a
     retroactive upgrade gate; D-074 handles the satisfaction drop
     (stall, not ruin), shipped with a content bump and an announcing
     quest.
  4. **Fertilities and deposits are per-region lists, not exclusive**:
     each region's `islands.json` names what its islands can roll (the
     south may list `grapes`, `stone`, `clay` beside its own). A building
     has one definition and is placeable wherever its fertility /
     deposit exists; an optional `regions` whitelist binds culture-bound
     buildings (the Kontor stays north). **Per-region model variants**:
     the manifest resolves `<id>.<region>` and falls back to `<id>`; the
     same hook serves cosmetic façade variants later.
  5. **Per world:** gold, premium currency or subscription, ships,
     routes, quests, achievements, the Kontor, warnings and away summary
     (entries name their region). **Per region:** archipelago, islands,
     population and population unlocks (D-069), tiers (D-010), palette
     roles, passage point. Top bar and minimap show the current region;
     region tabs carry a warning badge.
  6. **Shape now, single region.** Island IDs become region-prefixed
     (`oc-01` … `oc-12`); payload `world.regions[]` (`id`, `unlocked`,
     `passage_point`, `seed`) and `region_id` on islands, ships and
     route stops; `/content` returns every region's catalogue; the
     client keeps one scene per region behind a switcher hidden with one
     region; `World.Regions[]` in the sim with islands per region so
     `Advance` is untouched; generator per region; `content/regions.json`
     (order, gate, passages); sim schema bump, no DB change; `sail_ship`
     and routes accept cross-region destinations. The expedition
     command, region-2 content and the Kontor's online features come
     with their own decisions.
- **Why:** separate archipelagos keep D-072's one-island camera and the
  generator per climate; the Kontor turns a tier gate into a building
  the player sees and gives the online features an anchor; global goods
  with regional production are what makes cross-region trade worth
  anything; doing the shape now is cheap (dev worlds reset freely) and
  avoids a migration after deployment.
- **Consequences:** one structural session (server, content, client;
  player-invisible except IDs); plans, goldens, fixtures renamed;
  ARCHITECTURE §4 / payload, MECHANICS §9 (passage), CONTENT §1 / §9
  (regions.json, per-region lists), UI.md (region switcher, Kontor
  card), GAME_DESIGN regions paragraph. The Kontor building itself
  (model, cost) comes with the military / ornaments content session.
- **Rejected:** region 2 at Merchants; generating all regions at world
  creation; exclusive fertilities per region; region-2 goods as hard
  gates for existing tiers.

*As built (#76):* content 0.21.1 (`regions.json`, `oc-NN`), sim schema
16 with a migration that wraps the islands into `regions[0]` and
prefixes IDs (tested on fixtures and the owner's snapshots; the D-066
content-version check still refuses older snapshots before migration —
by design); `GET /content` returns `regions`; cross-region destinations
answer `no_passage` (409) until passage legs exist; the region name
shows only in the switcher (hidden with one region — top bar unchanged);
a migrated world's passage point is set on first use, no fix-up. The
five reference scenarios are byte-identical to the base except island
IDs and content version. Still needed for region 2: region content, the
expedition command, passage legs end to end.

## D-077 Beauty and defence: gold ornaments, military with a dormant defence value, warships and patrol, shore placement, subscription instead of Doubloons, 32 MiB of models

- **Status:** accepted (2026-11-09); amends D-021 / MONETIZATION
  (currency and catalogue), D-005 (prepares raids), D-054 ("military
  out"), D-060 §4 (repair crane), D-062 (water footprints), D-057
  (folder limit), D-076 §2 (Kontor placement).
- **Context:** the owner wants the content shape final before the next
  playtest, which doubles as the screenshot set: ornaments, a walled
  city, a harbour with towers and a crane, warships. Today ornaments
  exist only as the planned Doubloon catalogue and nothing military
  exists.
- **Decision:**
  1. **Monetisation = supporter subscription** (monthly), no Doubloons,
     no per-item shop or balance ledger: an entitlement "active until"
     plus a supporter badge. **Nothing is gated yet** — every item is
     usable without it. Items placed while subscribed always stay.
     Possible later gates (region 2, online features) are content
     access, not advantage — they need their own decision against
     D-021's principle.
  2. **Ornaments are gold buildings**, zero effect, no maintenance
     (price is the sink), `look: civic`, no road needed, movable, new
     build-menu category **Ornaments**: `hedge` 1×1 and `garden_wall`
     1×1 (paint families that auto-join like roads), `tree_ornament`
     1×1 (2–3 voxel variants), `flower_bed` 1×1, `well` 1×1 (Settlers);
     `maypole` 2×2, `pillory` 1×1, `pond` 3×3 (ground kind
     `water_still`) (Citizens); `fountain` 2×2, `statue` 2×2, `cemetery`
     4×4, `square` 1×1 paint (ground kind `cobbles_fine`),
     `harbour_statue` 2×2 shore (Merchants); `gold_statue` 3×3
     (Patricians). Costs 10 → 2 000 gold, provisional.
  3. **Military buildings**, category **Military**, `look: civic`, each
     with a content `defence` value that nothing reads until raids
     (D-005), small maintenance: `city_wall` 1×1 paint family (a road
     across a wall tile renders as an arch; defence 1, 0.1 gold/min per
     tile), `tower` 2×2 (joins a wall line; 5, 2), `gatehouse` 3×3
     (wall on two opposite sides, road through; 5, 3) — Citizens;
     `harbour_tower` 2×2 shore (8, 4) — Merchants; `castle` 8×8 keep +
     curtain + gate (30, 15) — Patricians. The manorial palace stays out
     (possible later as a modular kit).
  4. **Repair crane** `repair_crane` 3×3 shore, Merchants, small
     maintenance, moving arm; `repairs: true`. **Ship health comes with
     raids**, not now (D-060 §4 reasoning stands).
  5. **Shore placement** (`placement: shore`): every footprint tile is
     water (incl. shallows) or level-0 land / quay, at least one water
     tile, the back edge touches land or quay; outside the harbour lane
     and berths; the sea grid treats it as land; the model carries a
     deck under every tile. Applies to trading pier, depot, shipyard,
     repair crane, harbour tower, harbour statue and the **Kontor**.
     Trading Post, fisher, salt pans, oyster beds keep strict
     `water_rows`; quay unchanged.
  6. **Warships**, three, all **Patricians**, built at the existing
     shipyard, **no cargo**, maintenance like cargo ships, `attack`
     read only by the later raid formula: `balinger` (Balinger /
     Balinger; attack 4, speed 1.3; 800 gold, 40 planks, 15 sails, 10
     tools), `war_cog` (War Cog / Friedeschiff; 10, 1.0; 2 500 / 80 /
     30 / 20), `war_carrack` (War Carrack / Kriegskraweel; 20, 0.8;
     6 000 / 150 / 50 / 40). No weapons good now. **Patrol**: ship state
     `patrolling` with `patrol {ship_id, island_id}` — a deterministic
     coast loop from the sea grid, the client lerps it like a leg; stop
     with `unassign`; later adds to the island's defence. No second
     shipyard.
  7. **Models folder limit 24 → 32 MiB** (D-057 amendment); lazy loading
     of rarely used families is the next step if region 2 pushes past
     ~40 MiB.
  8. **Harbour basins** (amends D-060 §2 / D-036; reference: Anno 1404
     harbours with piers, breakwaters and basins — buildings standing
     on the quays, towers at the pier heads). **Shallows band 3 → 8
     tiles** (Chebyshev from own land, river excluded; still bounded).
     **Quays must be connected**: every quay tile has an edge neighbour
     that is land or quay; a demolish that would leave a floating piece
     is rejected. **Harbours stay open**: placing a quay or a shore
     building is rejected when it would cut a harbour point, berth or
     trading pier of the island off from the open sea (the D-075
     reachability test at placement). Berths stay at the Trading Post
     and trading piers (a pier head is where the trading pier goes).
     Cost unchanged (5 gold / 2 stone per tile — the stone sink). Render:
     a quay tile is a level-0 land block in the terrain mesh with a
     stone side face and mooring posts (D-068: terrain, not a model);
     far view a stone-coloured line.
- **Why:** a city-builder's free game must be complete, so beauty is
  paid in gold and the subscription is support, not access; walls,
  towers and warships are the D-005 hooks the owner wants to see before
  raids exist, and a dormant `defence` / `attack` number costs nothing;
  the shore rule turns four special cases into one; the limit raise is
  the cheap way to make room; the wide band with connected quays gives
  the Anno harbour picture for the price of stone.
- **Consequences:** content 0.22.0 (ornaments, military, crane,
  Kontor, warships, `placement: shore`, `defence`, `attack`,
  categories), sim (shore placement, patrol state and loop, wall/hedge
  join as paint families, shallows 8, quay connectivity and open-harbour
  checks), client (two categories, paint tools for
  hedge / wall / square, patrol UI, decks), ≈ 27 recipes + GLBs,
  MONETIZATION.md rewritten for the subscription, MECHANICS §3 / §9,
  CONTENT §7 / §8, UI.md, ART_DIRECTION (castle and wall language,
  warship hulls), plans untouched (nothing affects the economy except
  optional maintenance). Sessions: content + sim + client, then models.
- **Rejected:** Doubloons; gating anything now; ornaments with effects
  or maintenance; the Anno extras (flagpole, shrine, stalls, juggler
  camp — the owner found them weak); a second shipyard; cargo slots on
  warships; ship health now; lazy loading now.

*As built, models part 1 (#77):* folder limit 32 MiB; the look re-dress
of D-075 §3 for all 42 Merchants/Patricians production buildings (kit
`tier` = look; dark tile on fashion_house, goldsmith, optician, luthier,
glass_smelter; terracotta 30–45 % of tile roofs in the tier-3/4 shots);
20 new models — the 11 non-paint ornaments, tower, gatehouse,
harbour_tower, castle, kontor (4 × 11, depot class), repair_crane
(sway group `arm`), balinger, war_cog, war_carrack — built, tested and
sheeted but held (`hold: true` in `planned/d077.json`, ≈ 2.3 MiB) until
the content defines the IDs. Shore decks sit at z = 0 under every tile.
The paint families (hedge, garden wall, city wall, square) and the quay
wall come with the content / sim / client session.

*As built, content / sim / client (#78):* content `old_coast-0.22.0`,
sim schema 17. §5 shore placement as specified (harbour lane = footprint
width × 3 rows in front of a Trading Post / pier, berths = a pier's two
flank columns; a shore footprint blocks ships only once built; planners
keep the D-062 rows so the reference games replay unchanged). §8
shallows 8, `ErrQuayDisconnected` / `ErrQuayWouldFloat` /
`ErrHarbourBlocked`, property test seeds 1–50; quay in deep water
rendered as a level-0 block with stone side face and mooring posts. §2–§3
paint families through the generic batch commands `place_paint` /
`demolish_paint` (per-tile results like fields); join pieces end /
corner / T / cross (+ `arch` for city_wall under a road) published as
`<id>.<piece>`; `square` is the ground kind `cobbles_fine`. `unique`
scopes `island` | `world` (Kontor; `unique_building` error; DE
"Hansekontor"). §6 warships `slots: 0`, attack 4 / 10 / 20, build 5 /
7.5 / 10 min, upkeep 3 / 5 / 8; `patrol {ship_id, island_id}` builds a
deterministic coast loop (string-pulled hull at distance ≥ 2) the client
lerps along; `unassign` stops it. Repair crane: the jib cannot yaw about a
pivot in the merged meshes, so its sway grows with distance from the
root (accepted). `defence`, `attack`, `repairs` are stored and shown,
never read by a rule. MONETIZATION.md rewritten for §1. Fixtures
`harbour-basin`, `castle-town`; far budgets 16 / 224 k, 11 / 198 k,
13 / 201 k.


## D-078 Playtest 3, first pass: harbour lane, military at Patricians, stone harbour plinths, monument-sized castle

- **Date:** 2026-11-12
- **Status:** accepted (amends D-077 §2, §3, §5; D-077 text stays as recorded)
- **Context:** the owner's first look at the `castle-town` and
  `harbour-basin` fixtures after #78: a quay could be built straight in
  front of the Trading Post; the harbour tower read as a lighthouse;
  ornaments were available from Settlers and military from Citizens;
  harbour buildings stood on timber decks; the castle (8 × 8, 5 000
  gold) was smaller and lower than the university and the city wall
  (one tile high) lower than a well.
- **Decision:**
  1. **Harbour lane is a hard rule.** Every berth holder (Trading Post,
     trading pier, depot, shipyard, Kontor, repair crane) owns a lane in
     front of its water edge: footprint width + 1 tile on each side,
     4 rows deep. Neither quays nor shore buildings may occupy lane
     tiles (`ErrHarbourLane`); the lane is shown in the placing ghost.
     The D-077 §8 open-harbour reachability check stays in addition.
  2. **Tiers.** Ornaments: Citizens = hedge, garden wall, ornamental
     tree, flower bed, well, maypole, pillory; Merchants = pond,
     fountain, statue, cemetery, square, harbour statue; Patricians =
     gold statue. Military (wall, tower, gatehouse, harbour tower,
     castle): **Patricians** — defence is dormant until raids, a
     Patricians-era feature.
  3. **Stone plinths.** Harbour-look shore buildings (trading pier,
     depot, shipyard, repair crane, harbour tower, harbour statue,
     Kontor) stand on the quay block (level-0 stone, stone side face,
     mooring posts), not on timber decks. Rural water buildings (fisher,
     salt pans, oyster beds) keep their timber.
  4. **Harbour tower = the tower model on a quay plinth** (no beacon,
     no light). One recipe, two IDs.
  5. **Castle is the third monument** beside university and cathedral:
     12 × 12, keep clearly higher than the university's tower, corner
     towers higher than the curtain; cost 80 000 gold / 200 stone /
     150 bricks, maintenance 40, `defence` 30 unchanged.
  6. **Heights.** City wall footprint stays one tile; height two tiles
     with wall-walk and parapet; tower four tiles; gatehouse three and
     a half. The well (≈ 1.5 tiles) must sit below the wall.
- **Rejected:** all ornaments at Merchants; harbour-tower as its own
  silhouette; keeping the 8 × 8 castle with a taller keep only.
- **Consequences:** content 0.22.1; sim quay / shore placement rule +
  goldens; seven re-plinthed models, castle / wall / tower / gatehouse
  rebuilt; `castle-town` fixture re-laid for 12 × 12; MECHANICS §2–§3,
  CONTENT §7, ART_DIRECTION §7 updated by the implementing session.
