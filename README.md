# New Shores

A persistent online city-builder in the spirit of the Anno series: settle a
private archipelago in an age-of-sail world, build production chains, ship
goods between islands, grow a population through four tiers, and trade with
other players on a shared world map. Anno's pace — build instantly, be gated by
what you produce — with an economy that keeps running on the server while you
are away. Cosmetic-only monetisation.

Status: **design complete, implementation not started.**

## Documents

| Document | Contents |
|---|---|
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Pitch, pillars, setting, player, session rhythm, core loop, progression, offline behaviour, goals |
| [docs/MECHANICS.md](docs/MECHANICS.md) | Authoritative rules: lazy time model, placement, roads, production, warehouses, needs, taxes, insolvency, ships, routes, invariants |
| [docs/CONTENT.md](docs/CONTENT.md) | Tiers, goods, buildings, production chains, ships, islands, decorations, content data format (numbers provisional) |
| [docs/ONLINE.md](docs/ONLINE.md) | World map, neighbours, barter trading, visits, gifts, expeditions, contracts, leaderboards, inactivity, future raids |
| [docs/MONETIZATION.md](docs/MONETIZATION.md) | Gold vs Doubloons, cosmetic catalogue, pricing, payments, legal, deferred items |
| [docs/UI.md](docs/UI.md) | Views, HUD, placement, info panels, world map screen, mobile, feedback rules |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, repository layout, server design, concurrency, API, client, content pipeline, deployment, testing |
| [docs/FIRST_PLAYABLE.md](docs/FIRST_PLAYABLE.md) | Scope, milestones and acceptance criteria of the first vertical slice |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Numbered log of every design decision with rationale and "revisit" markers |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repository |

## Tech stack at a glance

Go game server · PostgreSQL · Redis · TypeScript/Vite/React/Babylon.js client ·
JSON content with JSON Schema · Stripe (web) / store IAP (apps) · Docker
Compose → Kubernetes.

## Key decisions

- Server-authoritative, persistent world; event-driven lazy simulation, no
  server tick loop (D-001, D-002).
- Anno pacing: instant construction, resource-gated progression, warehouse
  caps bound offline gain, "stall don't ruin" (D-006 – D-009).
- Private archipelago per player; matchmade neighbours on a social world map;
  barter-only trading (D-003, D-004, D-020).
- Strictly cosmetic shop; two decoupled currencies (D-021).
- Client extrapolates from server rates; no game rules in the client (D-027).
