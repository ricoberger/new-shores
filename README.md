# New Shores

A persistent online city-builder in the spirit of the Anno series: settle a
private archipelago in an age-of-sail world, build production chains, ship
goods between islands, grow a population through four tiers, and trade with
other players on a shared world map. Anno's pace — build instantly, be gated by
what you produce — with an economy that keeps running on the server while you
are away. Cosmetic-only monetisation.

Status: **M1b — the tier-1 simulation runs headless and one island is
playable in the browser against an in-memory dev server** (no persistence
or accounts yet; see [docs/FIRST_PLAYABLE.md](docs/FIRST_PLAYABLE.md)).

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

## Repository layout

| Path | Contents |
|---|---|
| [server/](server/README.md) | Go game server: simulation, content loading, HTTP API, dev server |
| [server/api/openapi.yaml](server/api/openapi.yaml) | OpenAPI description of the HTTP API (the contract; client types are generated from it) |
| `client/` | Vite + React + Babylon.js browser client |
| `content/` | Game content (JSON) and its JSON Schemas |
| `docs/` | Design documents |

## Run locally

Prerequisites: Go 1.27, Node 22 (LTS) with npm, and `golangci-lint` for
`make check`.

```sh
make client-install   # npm ci in client/
make dev              # dev server on :8080 + Vite on :5173; Ctrl-C stops both
```

Open <http://localhost:5173> (or <http://127.0.0.1:5173>, the address Vite
prints on some systems; both are allowed). The server (`go run ./cmd/server --dev` in
`server/`) holds **one in-memory world** seeded on a fixed start island;
restarting it resets the world — this is expected until persistence lands
(M2). The API is at <http://localhost:8080/api/v1> (`/healthz` for
readiness).

- Faster world time for testing: `make dev TIME_SCALE=10` (server
  `--time-scale 10`, client `VITE_TIME_SCALE=10` so its extrapolation keeps
  up). Without the client setting the display lags between re-fetches.
- Other server flags: `--addr` (default `:8080`), `--content` (region
  directory), `--cors-origin` (comma-separated browser origins allowed to
  call the API; default `http://localhost:5173,http://127.0.0.1:5173`),
  `--log-format text|json`. If you open the client from another origin
  (another host or port), add it there.
- Checks: `make check` (server, content and client: lint, typecheck,
  Vitest). Browser smoke test: `cd client && npx playwright install
  chromium`, then `make client-e2e`.

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
