# AGENTS.md — Instructions for AI coding agents

This repository is developed primarily with AI assistance. Read this file and
the referenced documents before changing anything.

## 1. Start here

1. `docs/STATUS.md` — one page: what exists, the binding rules, current
   decisions, next tasks, how to run. Read this first.
2. `README.md` — what the game is and the document index.
3. `docs/DECISIONS.md` — **binding** design decisions (D-xxx). Do not
   implement anything that contradicts an accepted decision. If a task seems to
   require it, stop and raise the conflict instead of working around it.
4. The document for the area you touch: `docs/MECHANICS.md` for simulation
   rules, `docs/CONTENT.md` for content, `docs/ARCHITECTURE.md` for server/
   client structure, `docs/UI.md` for interface, `docs/ART_DIRECTION.md`
   for visuals and assets, `docs/ONLINE.md` and
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
- **Translation (D-061):** player-facing text in `client/src/ui` and
  `client/src/almanac` comes from the catalogue (`t("key")`, English in
  `i18n/en.ts`, German in `i18n/de.ts`); content text goes into the locale
  files `content/<region>/i18n/<lang>.json` in the same change. The server
  sends codes, IDs and numbers, never prose. The lint rule enforces it.
- **Pacing rules (D-006 – D-009):** no construction timers, warehouse
  capacity caps production, gold never negative (auto-pause order in
  MECHANICS §7), offline stall-don't-ruin.
- **Monetisation (D-021):** nothing with gameplay effect may be purchasable;
  gold and Doubloons never convert or transfer. Do not add such code even
  behind a flag without an explicit decision update.
- **Security:** authorise every request by the session's `player_id`;
  validate all inputs in Go against content and state; never log emails,
  tokens or payment details; never commit secrets.
- **Art is procedural voxels (D-057):** every model (buildings, fields,
  ships, decor, life props) comes from a Python recipe in
  `assets/voxel/recipes` or the build's automatic placeholder. No kits, no
  Blender, no bought or hand-made model files. Regenerate with
  `make assets` and commit the output in `client/public/models`.
- **Out of scope unless a decision says otherwise:** WASM builds of the sim,
  NPC traders, pause/speed controls, save/load, free camera elevation
  (azimuth rotation is in, D-051).

## 3. Working conventions

- Make the smallest coherent change. No unrelated refactors or formatting
  churn. Follow existing structure in `docs/ARCHITECTURE.md §3`.
- **Go:** latest stable toolchain; `gofmt`, `goimports` (local prefix
  `github.com/ricoberger/new-shores`), `go vet`, `golangci-lint` with the repo
  config must pass. Tabs per `.editorconfig`. Standard library first; justify
  every new dependency in the PR description.
- **TypeScript:** strict mode, `eslint`, `tsc --noEmit`, Vitest. Two-space
  indentation. Generated API types are not edited by hand.
- **Asset build (Python):** standard library only (`assets/voxel`); four-space
  indentation; budgets and limits live in `assets/voxel/nsvoxel/config.py`.
- **Content:** JSON, two-space indentation, validated by `content/schema`.
  Balance numbers are provisional — change them freely but update
  `docs/CONTENT.md` tables in the same change.
- **Tests are required** for behaviour changes: sim rules → golden fixture or
  property test; API/store → integration test against real Postgres;
  client display → Vitest against shared fixtures in `server/testdata`.
  There are no e2e, visual or perf suites (D-052); a change that alters
  the look attaches `make shots` PNGs (and `make model-sheet` for models)
  to its report instead.
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
# assets (models)
make assets-test && make assets-check
```

State clearly which checks ran, passed, failed or were skipped. CI does not
run automatically: it runs once when a pull request gets the `ci` label (the
workflow removes the label afterwards). Do not add the label yourself; report
that local checks passed and leave triggering CI to the user.

## 5. When unsure

Prefer asking over guessing when a choice affects a `D-xxx` decision, a public
API shape, the database schema, or the content format. Otherwise follow the
documents and state the assumption in your summary.
