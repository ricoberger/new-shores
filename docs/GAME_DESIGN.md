# New Shores — Game Design

Status: **Agreed design.** Decisions referenced as `D-xxx` are recorded with
rationale in [DECISIONS.md](DECISIONS.md). Exact rules live in
[MECHANICS.md](MECHANICS.md), content in [CONTENT.md](CONTENT.md), online
features in [ONLINE.md](ONLINE.md).

## One-paragraph pitch

New Shores is a persistent online city-builder in the spirit of the Anno series
and Anno Online. Each player owns a private archipelago in an age-of-sail world,
settles islands, builds production chains, ships goods between islands and
grows a population through four tiers. A world map connects players for barter
trade, visits and expeditions. The economy runs in real time on the server, but
the pace is Anno's — you build instantly and are gated by what you produce, not
by timers. Monetisation is cosmetic only.

## Design pillars

1. **Anno pace, never blocked.** Buildings appear in seconds. The only thing
   between you and your next expansion is planks, stone, tools and gold — and
   that is the puzzle. (D-006)
2. **A living economy that keeps going.** The world runs while you are away,
   bounded by your warehouses. Coming back is "see what accumulated, spend it,
   fix the bottleneck" — never "see what broke". (D-008, D-009)
3. **Islands, ships and chains.** Multi-island logistics is the heart of the
   mid-game: resources are distributed unevenly, so you must settle, connect
   and route. (D-014 – D-016)
4. **Fair online.** Other players are partners, not threats: barter, visits,
   gifts, leaderboards. Nothing that affects the game can be bought. (D-020,
   D-021)
5. **Readable systems.** Every shortage has a visible cause and a visible fix.
   The UI explains rates, bottlenecks and needs in plain numbers.

## Setting

- **Era:** age of sail, roughly 16th–18th century. No year is ever named; no
  electricity, steam or rail. (D-011)
- **Home region:** Europe-inspired temperate coast with an invented name
  (working title *the Old Coast*). Half-timbered and brick architecture in
  early tiers, baroque stone and slate in later ones. Caravels and galleons.
- **Player role:** a chartered settler sent to found new colonies for a
  trading company. The company's advisor is the quest-giver voice.
- **Later regions** (not in launch scope): tropical or arid regions with their
  own tiers, goods and architecture, linked to the home region by long trade
  routes (D-010, D-012). Colonial goods (sugar, tobacco, coffee, spices,
  indigo, silk) are reserved for them.
- **Tone:** relaxed, warm, optimistic; no slavery, no religious conflict, no
  real nations or historical figures.

## Target player and session rhythm

- Fans of Anno 1404/1800/117 and of economy builders who want the Anno
  experience in a browser or on a phone, persistent across devices.
- Typical pattern (D-006): **1–2 h sessions** on some days for deep building
  and optimisation; **10-minute check-ins** several times a day to spend what
  accumulated, start an expedition or accept a trade.
- Both patterns must be rewarding. Long sessions are never idle (there is
  always a chain to improve or an island to settle). Short sessions always
  have something to spend and a timer that just finished.

## Core loop

```
settle an island ─► build houses + chains ─► meet needs ─► population grows
      ▲                                                          │
      │                                                          ▼
 new island needed ◄── new tier unlocks buildings ◄── taxes + materials
 (resources elsewhere)        │
      │                       ▼
      └──── ships + trade routes connect islands (and later, players)
```

Recurring decisions the player makes:

- Which island to found first (fertilities, deposits, building space).
- Which chain to expand to fix the current bottleneck (production vs transfer
  throughput vs storage capacity).
- Where to place warehouses and roads (distance = transfer delay).
- When to spend scarce construction materials on growth vs infrastructure.
- Which goods to import from which island, and how many ships to dedicate.
- Later: what to offer neighbours for the goods you lack.

## Progression

Four tiers in the home region (D-010): **Settlers → Citizens → Merchants →
Patricians**. Each tier adds need categories, building needs, one new
construction material and new production buildings. From Citizens upward,
each need category offers **2–3 alternative goods** (D-031): one is enough,
more give a variety bonus — so archipelagos with different fertilities play
differently and neighbours have complementary surpluses. Tier advancement
requires a population threshold of the previous tier and specific buildings
(details in [CONTENT.md](CONTENT.md)). Houses upgrade individually when their
needs are met, and production buildings need **workforce of a specific tier
on the same island** (D-035), so tiers coexist in every city by necessity.
Further islands unlock at tier milestones (D-039).

Expected progression for a casual player: Citizens within the first session,
Merchants in the first week (unlocking the world map), Patricians in weeks
three to four. Content after that is driven by leaderboards, contracts,
achievements and — later — new regions.

## Time model as experienced by the player

| Thing | Duration | Why |
|---|---|---|
| Construct a building | ~2–5 s (animation) | never blocking (D-006) |
| Production cycle | 30 s – 2 min | watchable, Anno-like |
| Cart producer → warehouse | 10 s + ~1 s/tile | road layout matters (D-014) |
| House fills / upgrades | 1–5 min after needs are met | the natural slow clock |
| Ship build | 2–10 min by type | material-gated, visible (D-007) |
| Ship travel inside archipelago | 1–5 min | logistics has weight (D-015) |
| Expedition on world map | 1–8 h | the check-in hook (D-020) |
| Trade shipment to a neighbour | 1–several h | distance on world map |

There is **no pause, no speed control, no save/load** (D-006). Irreversible
actions (demolish, scrap ship, cancel trade) require confirmation and have
generous refunds (D-019).

## Offline behaviour (what happens while you are away)

- Production continues until each good hits its island capacity, then stops
  (D-008). Taxes continue; upkeep continues; if gold would go negative,
  buildings pause in a fixed order (D-017).
- Houses fill up to their current level if needs were met; unmet needs stall
  growth and reduce happiness but never empty a house below its floor (D-009).
- Ships complete their current leg and keep looping routes; trades and
  expeditions resolve at their due time.
- On return after ≥ 15 min, a **"while you were away"** summary lists what
  accumulated, what stopped (full warehouse, missing input, paused for
  upkeep) and what arrived; it is shown once per absence on whichever
  device dismisses it first (MECHANICS §12b).
- A city that runs out of gold never dies: never-pausable buildings have no
  upkeep (D-046), so gold keeps trickling in, and paused producers are
  retried from a larger reserve (D-047) — a fully stalled tier-1 city
  restarts on its own within about an hour, faster if the player steps in.

## Guidance and goals (D-022, D-023)

- **Advisor quests:** a data-driven chain; the first 12 are the intro
  ("connect a lumberjack and a sawmill", "reach 120 Settlers", "settle a
  second island"). Optional: nothing requires them, but their rewards
  (small gold and plank grants) give the early game ≈ 15–28 min of
  headroom. Rewards are claimed by the player; later: decorations.
- **Achievements:** population, chains completed, islands settled, routes,
  trades, expeditions.
- **Contracts:** periodic Harbourmaster requests ("deliver 200 bread this week")
  rewarding gold or decorations. The only sink for surplus besides trade.
- **Leaderboards:** population and prestige among neighbours.
- **No loss condition.** Inactive worlds are archived after 3 months and
  restored on login.

## Monetisation summary (D-021)

Cosmetic only, via a premium currency (Doubloons) fully decoupled from gold:
decorations, ship skins, building visual variants. No time skips, resources or
power. Details in [MONETIZATION.md](MONETIZATION.md).

## Future features (explicitly out of launch scope)

- New regions with own tiers/goods (D-010).
- Gold trading between players (D-020, revisit).
- Raids/combat as scheduled events (D-005).
- Tax slider (D-013), fog-of-war exploration, terrain elevation, free camera.
- Native apps (after web is stable, D-028).

## Non-goals

- Reproducing Anno's art, cultures or exact content.
- Real-time shared islands or co-op building.
- Competitive PvP as a core loop.
