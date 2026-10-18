# New Shores — Online Features

Status: **Agreed design** (D-003, D-004, D-005, D-020, D-022, D-023). Not part
of the first playable; the data model must exist from the start so it can be
added without migration pain.

## 1. Model

- Each player owns exactly one **world** (archipelago) per region at launch.
- The **world map** is a social and marketplace layer, not a shared geography.
  It stores: neighbour relations, positions, offers, shipments, expeditions,
  contracts, leaderboards.
- Positions are **stable fake coordinates** assigned at matchmaking;
  `distance(a, b)` on these coordinates defines all player-to-player travel
  times. Positions never change unless a player is archived.

## 2. Unlock

The **Harbourmaster's Office** (tier 3) unlocks the world map screen, the
first expedition and contracts. Before that, the world map button shows a
teaser with the unlock requirement.

## 3. Neighbours and matchmaking

- On unlock, the server assigns **5 neighbours** from active players within
  ±1 tier whose neighbour list is not full (max 20), preferring players with
  the fewest neighbours. Each gets a position within a ring around the new
  player.
- Further neighbours are found via **expeditions** (one per successful
  "discovery" result) up to the cap.
- Archived players (D-023) are removed from neighbour lists; they are replaced
  on the next expedition.
- Players may **hide** a neighbour (no offers shown, not matchmade again) and
  **report** display names/coats of arms.

## 4. Trading (barter only)

### 4.1 Offer board

```
offer: { id, poster, give: [{good, amount}], want: [{good, amount}],
         min_tier, expires_at, status: open|accepted|shipped|completed|cancelled }
```

- Posting **escrows** the `give` goods from the poster's chosen island
  inventory immediately; cancellation refunds instantly. Expiry (default 48 h)
  auto-cancels and refunds.
- Visible to all current neighbours within ±1 tier of the poster.
- Accepting requires the acceptor to have the `want` goods on an island with a
  free ship of sufficient capacity. The acceptor's goods are escrowed; the ship
  departs (`manual_leg` to world map); travel time = `distance / ship speed`
  (provisional 1–6 h).
- Arrival: `trade_shipment_arrived` event locks both worlds, credits `want` to
  the poster's chosen island (capacity permitting; excess stays aboard and is
  retried on the next evaluation — the UI warns at posting if capacity is
  tight), loads `give` onto the ship, schedules the return leg. On return the
  acceptor's island is credited.
- Each side pays only ship upkeep; no fees at launch.

### 4.2 Direct requests

Same object with a `target` player; only visible to that player; expires in
24 h. Identical escrow/shipping flow.

### 4.3 Gifts

`give` without `want`, targeted. One-way trip. Rate-limited to 3 per day and
to ≤ 10 % of the sender's capacity per good, to curb alt feeding.

### 4.4 Anti-abuse

- ±1 tier restriction on all offers (D-020).
- Rate limits: 10 open offers per player, 20 accepts/day.
- Server-side logging of all transfers; anomaly flags (same-IP pairs, one-way
  flows) for manual review. No automated bans at launch.
- Gold is never tradeable (D-021). Schema keeps `{type: gold}` as a possible
  future entry (revisit).

## 5. Visits

A neighbour's islands can be viewed read-only. The server returns a
**display snapshot** (same payload as the owner gets, minus private data such
as gold and offers) advanced in memory without persisting. Visitors cannot
issue commands. Cached per world for 60 s to avoid repeated evaluation.

## 6. Expeditions

- Dispatch a ship from the Harbourmaster for 1 / 4 / 8 h. The ship is
  unavailable; no cargo needed.
- Result (seeded RNG at `expedition_done`): discover a neighbour (weighted by
  how few you have), goods bundle (scaled to tier), a decoration (rare), or
  nothing of note (flavour text). Longer expeditions have better odds.
- One expedition per Harbourmaster at a time; the office can be upgraded later
  to allow two.

## 7. Contracts (surplus sink)

- The Harbourmaster offers 2–3 contracts per week per player: "deliver N units
  of good X within 7 days" for gold or a decoration. Goods are taken from a
  chosen island inventory on acceptance of delivery (no ship needed — the
  Harbourmaster's own vessel is fiction).
- Contracts are generated server-side from the player's tier and current
  production, never require goods the player cannot produce, and reward below
  what trading the same goods would be worth, so they are a floor, not a
  market.

## 8. Leaderboards and achievements

- Leaderboards among neighbours only: total population, Patrician count,
  "prestige" (weighted population + decorations placed count — cosmetic items
  count for prestige but prestige has no effect).
- Achievements are data-driven predicates over world state and event history;
  rewards are gold, materials or a decoration.

## 9. Identity and moderation

- Display name (unique, filtered), coat of arms (from a fixed set + colours),
  optional motto (filtered). No free-text chat at launch; offers carry no
  message field. This avoids moderation load and COPPA/GDPR issues with minors.
- Report → hidden from reporter immediately, queued for review.

## 10. Inactivity

- 3 months without login → world archived: removed from neighbour lists and
  matchmaking, open offers cancelled and refunded, state retained. Login
  restores it and triggers a fresh matchmaking round.
- Deletion on request (GDPR) removes the account and anonymises transfer logs.

## 11. Future: raids (D-005)

Not in scope. When designed, a raid is a scheduled event: war ships travel
(distance-based), outcome at arrival is a deterministic formula of attacker
strength vs defender defence level, loot capped at a percentage of stock,
newbie protection, cooldowns. Defender's world is advanced to arrival time
before loot is computed. Nothing in the current model prevents this.

## 12. Data model (server)

| Table | Key fields |
|---|---|
| `players` | id, display_name, coat_of_arms, created_at, last_login_at, archived_at |
| `worlds` | id, player_id, region, state (JSONB), version, last_evaluated_at |
| `map_positions` | player_id, x, y |
| `neighbours` | player_id, neighbour_id, hidden, discovered_at |
| `offers` | id, poster_id, target_id?, give, want, min_tier, status, expires_at, escrow_island |
| `shipments` | id, offer_id, ship_id, leg, depart_at, arrive_at |
| `expeditions` | id, world_id, ship_id, duration, due_at, result |
| `contracts` | id, player_id, good, amount, reward, expires_at, status |
| `achievements` | player_id, achievement_id, unlocked_at |
| `transfer_log` | id, from_player, to_player, goods, kind, at |
| `scheduled_events` | id, due_at, kind, world_ids, payload, status |
