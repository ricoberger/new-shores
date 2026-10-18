# AGENTS.md — Instructions for AI coding agents

This repository is developed primarily with AI assistance. Read this file and
the referenced documents before changing anything.

## 1. Start here

1. `README.md` — what the game is and the document index.
2. `docs/DECISIONS.md` — **binding** design decisions (D-xxx). Do not
   implement anything that contradicts an accepted decision. If a task seems to
   require it, stop and raise the conflict instead of working around it.
3. The document for the area you touch: `docs/MECHANICS.md` for simulation
   rules, `docs/CONTENT.md` for content, `docs/ARCHITECTURE.md` for server/
   client structure, `docs/UI.md` for interface, `docs/ONLINE.md` and
   `docs/MONETIZATION.md` for those features, `docs/FIRST_PLAYABLE.md` for
   current scope.

## 2. Non-negotiable constraints

- **Server owns the truth.** All game state changes happen in Go on the
  server inside one database transaction per change (D-001, D-026). The client
  never computes a game rule; it only extrapolates from server-provided rates
  and timestamps (D-027). Do not add rule logic to `client/`.
- **No tick loop.** The simulation is lazy and event-driven (D-002). Never add
  a goroutine that periodically advances worlds. Time-triggered effects go
  through `scheduled_events`.
- **`internal/sim` is pure.** No I/O, no `time.Now()`, no unseeded randomness,
  no database or network access, no logging with side effects. `Advance` must
  be deterministic; every rule must be a rate, capacity or timed event
  (MECHANICS §1). Use fixed-point integers for quantities.
- **Events apply at `due_at`**, not at processing time.
- **Content is data.** New buildings/goods/needs/tiers go into `content/`,
  validated by schema; code changes only for new mechanics. Never reuse a
  content ID.
- **Pacing rules (D-006 – D-009):** no construction timers, warehouse
  capacity caps production, gold never negative (auto-pause order in
  MECHANICS §7), offline stall-don't-ruin.
- **Monetisation (D-021):** nothing with gameplay effect may be purchasable;
  gold and Doubloons never convert or transfer. Do not add such code even
  behind a flag without an explicit decision update.
- **Security:** authorise every request by the session's `player_id`;
  validate all inputs in Go against content and state; never log emails,
  tokens or payment details; never commit secrets.
- **Out of scope unless a decision says otherwise:** WASM builds of the sim,
  NPC traders, pause/speed controls, save/load, free camera rotation.

## 3. Working conventions

- Make the smallest coherent change. No unrelated refactors or formatting
  churn. Follow existing structure in `docs/ARCHITECTURE.md §3`.
- **Go:** latest stable toolchain; `gofmt`, `goimports` (local prefix
  `github.com/ricoberger/new-shores`), `go vet`, `golangci-lint` with the repo
  config must pass. Tabs per `.editorconfig`. Standard library first; justify
  every new dependency in the PR description.
- **TypeScript:** strict mode, `eslint`, `tsc --noEmit`, Vitest. Two-space
  indentation. Generated API types are not edited by hand.
- **Content:** JSON, two-space indentation, validated by `content/schema`.
  Balance numbers are provisional — change them freely but update
  `docs/CONTENT.md` tables in the same change.
- **Tests are required** for behaviour changes: sim rules → golden fixture or
  property test; API/store → integration test against real Postgres;
  client display → Vitest against shared fixtures in `server/testdata`.
- Keep `docs/` in sync: a mechanic change updates `MECHANICS.md`; a new
  decision appends to `DECISIONS.md` (never rewrite an accepted entry;
  supersede it).
- Commits follow Conventional Commits. Do not commit, push or open PRs unless
  asked.

## 4. Verification before you report done

```sh
# server
cd server && gofmt -l . && go vet ./... && golangci-lint run && go test ./...
# client
cd client && npm run lint && npm run typecheck && npm test
# content
cd server && go test ./internal/content/...
```

State clearly which checks ran, passed, failed or were skipped.

## 5. When unsure

Prefer asking over guessing when a choice affects a `D-xxx` decision, a public
API shape, the database schema, or the content format. Otherwise follow the
documents and state the assumption in your summary.
