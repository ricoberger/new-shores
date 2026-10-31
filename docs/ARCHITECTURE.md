# New Shores — Architecture and Tech Stack

Status: **Agreed** (D-001, D-002, D-025 – D-028). Supersedes the earlier
PocketBase/client-authoritative draft entirely.

## 1. Overview

| Area | Choice |
|---|---|
| Game server | Go (latest stable), `net/http` with Go 1.22+ routing, stdlib-first |
| Simulation | Pure Go package `internal/sim`, deterministic, no I/O |
| Database | PostgreSQL 16+: world state as versioned JSONB + relational tables |
| Jobs/events | `scheduled_events` table drained by in-process workers (`FOR UPDATE SKIP LOCKED`) |
| Cache / messaging | Redis: pub/sub for WebSocket fan-out, rate limiting, presence |
| API | JSON over HTTPS (OpenAPI described) + WebSocket for push |
| Client | TypeScript, Vite, React (HTML/CSS overlay), Babylon.js (WebGL) |
| Content | JSON in `content/`, JSON Schema, validated by the server at startup |
| Payments | Stripe (web); store IAP via Capacitor later; provider-agnostic ledger |
| Delivery | Static client on a CDN; server + Postgres + Redis via Docker Compose, later Kubernetes |
| Observability | OpenTelemetry traces, Prometheus metrics, structured logs (slog) |
| Testing | `go test` (sim golden fixtures, API, concurrency), Vitest; looks reviewed with `make shots` (D-052) |

```
 Browser / Capacitor app
 ┌───────────────────────────────────────────────┐
 │ React UI  ◄──► display model ◄──► Babylon.js  │
 │                 ▲ extrapolate                 │
 │                 │ state+rates+next_change_at  │
 └─────────────────┼─────────────────────────────┘
          HTTPS JSON │ commands/queries   WebSocket │ "world changed" pushes
 ┌─────────────────▼───────────────────────────────▼──────────────┐
 │ Go game server (N stateless replicas)                          │
 │  api ─► command handlers ─► sim.Advance ─► store (tx, row lock)│
 │  events worker ─► sim.Advance + handlers ─► store              │
 │  ws hub ◄── Redis pub/sub ◄── publish(world_id) after commit    │
 └───────────────┬──────────────────────────────┬─────────────────┘
          PostgreSQL (source of truth)         Redis (ephemeral)
```

## 2. Principles

1. **Server owns the truth.** Clients send commands; the server validates
   against content and state, applies, persists, and returns the new state.
2. **Lazy, deterministic simulation.** `sim.Advance(world, to)` is pure. All
   rules are rates/capacities/events (MECHANICS.md). No server tick loop.
3. **One transaction per change.** Lock the world row(s), advance, apply,
   commit. Events are applied at their due time.
4. **Content is data.** Buildings, goods, needs, tiers, quests are JSON; the
   simulation is content-agnostic.
5. **Client has no rules.** It extrapolates linearly from server-provided
   rates and timestamps (D-027). WASM is out of scope.
6. **Boring infrastructure.** Postgres is the only stateful dependency that
   matters; Redis can be flushed without data loss.

## 3. Repository layout

```
new-shores/
├── server/                     Go module github.com/ricoberger/new-shores/server
│   ├── cmd/server/             main: HTTP + worker in one binary (flags select roles)
│   ├── internal/sim/           pure simulation: types, Advance, placement, routes
│   ├── internal/content/       loading + validation of content JSON, typed catalogue
│   ├── internal/store/         pgx queries (sqlc), migrations (goose or tern)
│   ├── internal/api/           handlers, request validation, OpenAPI
│   ├── internal/events/        scheduled-events worker + handlers
│   ├── internal/ws/            WebSocket hub, Redis pub/sub
│   ├── internal/auth/          sessions, argon2id, email verification
│   ├── internal/payments/      ledger + provider adapters (stripe, appstore, play)
│   ├── internal/devworld/      dev world and dev fixtures (--dev; one list, `Fixtures()`)
│   └── testdata/               golden fixtures (shared with client tests)
├── client/                     Vite + React + Babylon.js
│   ├── src/api/                generated types (openapi-typescript), fetch/ws client
│   ├── src/display/            extrapolation + display model
│   ├── src/render/             Babylon scene, voxel terrain, chunks, instancing, pickers
│   ├── src/ui/                 React HUD, panels, build menu, world map
│   ├── src/dev/                dev/E2E-only synthetic fixtures (dense, showcase, archipelago)
│   ├── public/models/          voxel GLBs + manifest.json + thumbs/ (generated, committed)
│   └── e2e/tools/              `make shots` script (Playwright as a library)
├── assets/
│   ├── palette.json            colour source (client palette, voxel colours)
│   ├── fonts/, icons/          pinned HUD fonts and icons
│   └── voxel/                  voxel asset build (Python stdlib, D-057)
│       ├── build.py            `make assets` / `assets-check` / `model-sheet`
│       ├── nsvoxel/            grid, parts, mesher, GLB writer, placeholders, budgets
│       ├── recipes/            one recipe per model ID; _decor, _life, _ships
│       ├── planned/            footprints of IDs content does not define yet
│       └── tests/              `make assets-test`
├── content/
│   ├── schema/                 JSON Schema per entity
│   └── old_coast/              tiers, goods, buildings, needs, ships, quests, islands, decorations
├── deploy/                     docker-compose.yaml, Dockerfiles, later Helm/Kustomize
├── docs/
├── AGENTS.md
└── README.md
```

**Fixtures after D-062:** server dev fixtures and the four reference games
use shipped content footprints and per-column water rows. The founding UI's
`HomeTradingPostSite` and the default fixture share the same content-sized
6×6 site; the archipelago verifier reads the content footprint through
`Sites`/`CheckSite`, never a hard-coded Trading Post size. Reference commands
are explicit JSON (no free stock), including civic `upgrade_building` and
the deferred Patrician surgeries. Shared display fixtures and schema-12
state/terrain envelopes regenerate through the existing scenario tests;
schema-11 envelopes remain rejected historical inputs. `played` replays the
Patricians game. The synthetic client dense/showcase layouts remain pinned
to pre-D-054 content and do **not** validate shipped-size placement.

## 4. Server

### 4.1 Simulation package (`internal/sim`)

- `type World struct` — islands, buildings, inventories, houses, ships, routes,
  gold, rng state, `LastEvaluatedAt`. Serialises to the JSONB column via a
  versioned envelope `{schema_version, content_version, world}`.
- `func Advance(w *World, c *content.Catalogue, to time.Time) ([]Boundary, error)`
  — pure; returns the boundary list for debugging/UI; `to` before
  `LastEvaluatedAt` is `ErrTimeBackwards`. `AdvanceWithLedger` additionally
  records flows (produced/consumed/lost) for reports and tests.
- `func Apply(w *World, c *content.Catalogue, cmd Command) error` — placement,
  demolish, pause, route edit, upgrade, order ship, etc. Each command
  validates fully before mutating; on error the world is byte-identical.
  Errors are typed sentinels (`ErrNotEnoughGold`, `ErrSurplusLoss`, …).
- `func Display(w *World, c *content.Catalogue, now time.Time) (DisplayState, error)`
  — state + rates + cycle timers + ship legs + `NextChangeAt` (RFC 3339 UTC
  with milliseconds; `null` when nothing changes without a command).
- The scenario runner (`internal/sim/scenario`) loads JSON scenarios (ASCII
  island, free seed step, Apply/Advance steps) and produces reports with
  totals, bottlenecks and snapshots; golden reports live in
  `server/testdata/scenarios` and are the shared fixtures for client display
  tests. A scenario may set `snapshot_every` (simulated minutes, default 1):
  the report then records a snapshot only at the first advance step, at the
  first step reaching each multiple of the interval, at every milestone (a
  tier unlocks, a tier gets its first residents) and at the last advance step
  (boundary counts add up the skipped steps). The replay still advances step
  by step, so the simulated game and every other part of the report are
  unchanged; the long reference games use 10 to keep their goldens small.
  `RunSteps` replays the first n steps without a report (tests, the
  `played` dev fixture).
- Fixed-point integers; no `time.Now()`, no `math/rand` without the stored
  seed.
- Migrations between `schema_version`s live here and are tested against stored
  fixtures from every released version.

### 4.2 Store and transactions

```sql
CREATE TABLE worlds (
  id              uuid PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id),
  region          text NOT NULL,
  state           jsonb NOT NULL,
  schema_version  int  NOT NULL,
  version         bigint NOT NULL DEFAULT 0,        -- optimistic token for clients
  last_evaluated_at timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
```

Command path:

```
BEGIN
  SELECT ... FROM worlds WHERE id = $1 FOR UPDATE
  w := decode(state); Advance(w, now); err := Apply(w, cmd)
  UPDATE worlds SET state=..., version=version+1, last_evaluated_at=now
  INSERT scheduled_events ... (if the command created any)
COMMIT
publish(redis, "world:"+id)
return Display(w, now)
```

- Multi-world handlers lock in ascending world ID to avoid deadlocks.
- **World clock (D-043):** the time a world is advanced to is read from the
  database **once per Update, after the row lock is held**
  (`statement_timestamp()` truncated to milliseconds, UTC). `now()` would
  be frozen at transaction start, i.e. before the lock wait, so the second
  of two concurrent commands could see a time earlier than the first one
  committed. One database clock for all instances means no false
  `ErrTimeBackwards`.
- **Pending events bound the request path (D-043):** a request advances a
  world only up to the `due_at` of its earliest *pending* scheduled event
  and leaves the event to the worker, so events apply exactly at `due_at`.
  The world may appear frozen for up to about a second around a due time;
  `failed` events do not hold a world back.
- Worlds are unique per `(player_id, region)`; world IDs never come from
  the client — the session resolves the player and the region picks the
  world. The world row is stored as the sim envelope `{schema_version,
  content_version, world}`; decoding runs the sim's pure migration hook
  and fails with `ErrSchemaVersion` (HTTP 500, own code) when no migration
  is registered for an older version — never a silent reset. Migrations
  are pure functions over the raw envelope that may take the content
  catalogue and return **notes** (e.g. the 2→3 fields migration reports
  farms whose efficiency could not be preserved); the store logs the
  notes, the sim never does. Current schema: 8; the only registered
  migration is 7→8 (default ship names, D-055) — older versions were
  bumped without a migration (local databases are recreated). **Rule
  while undeployed:** a trivial additive migration (a defaulted field)
  may be written when it is cheaper than a reset; structural changes
  (envelope layout, tiles, islands) bump the schema without a migration
  and the owner recreates the local database.
- Migrations are versioned SQL files embedded in the binary and applied by
  `server migrate` (or `MIGRATE_ON_START`) under an advisory lock, with
  `schema_migrations` bookkeeping; expand/contract only.
- Read-only queries (own world view, visits) advance in memory without
  writing; a write happens at most every N seconds per world to keep
  `last_evaluated_at` fresh (optional optimisation).
- JSONB size budget: measured in PR #26 — 289 kB (7 kB gzip) for the
  committed 48/32/20 archipelago, **2.25 MB** (27 kB gzip) at the D-054
  target sizes, almost all of it tile rows; generation 52 ms vs 1.38 s.
  Done in PR #27 (schema 7): terrain (immutable per seed/roll) lives in
  the `world_terrain` table (gzip, keyed by world and seed/roll), loaded
  with the state; at the final sizes (large 192) the state is ≈ 2.2 kB
  and the terrain ≈ 6.9 kB gzipped per world (≈ 2.8 MB decoded in
  memory); generation 65 ms average, 275 ms worst over 200 seeds.

### 4.3 Scheduled events worker

```sql
CREATE TABLE scheduled_events (
  id         bigserial PRIMARY KEY,
  due_at     timestamptz NOT NULL,
  kind       text NOT NULL,
  world_ids  uuid[] NOT NULL,
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending',  -- pending|done|failed (CHECK)
  attempts   int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,         -- defaults to due_at (trigger); lease + backoff
  last_error text,                              -- truncated to 1000 bytes
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON scheduled_events (next_attempt_at) WHERE status = 'pending';
CREATE INDEX ON scheduled_events USING gin (world_ids) WHERE status = 'pending';
-- AFTER INSERT trigger: pg_notify('scheduled_events')
```

- Every replica runs the loop: claim due events with `FOR UPDATE SKIP
  LOCKED` (ordered by `due_at`, limit 10) and set a 30 s lease on
  `next_attempt_at`; then per event, in its own transaction: re-lock the
  event and re-check its status, lock its worlds in ascending ID,
  `Advance(w, due_at)`, run the handler, schedule follow-ups, set `done`,
  increment the version of every touched world, commit, publish. Exactly-
  once relies on the re-lock + status check, not on the lease; a crashed
  worker's events become claimable when the lease expires.
- Per-world due order: an event is deferred (no attempt counted) while an
  earlier pending event shares one of its worlds, so a retried earlier
  event never finds its world already past its `due_at`.
- Follow-up events may only reference the event's (locked) worlds and may
  not be due before the event itself.
- Failures: increment `attempts`, exponential backoff via
  `next_attempt_at`, `last_error` recorded; after 5 attempts mark `failed`
  and alert.
- Poll interval 1 s with `LISTEN/NOTIFY` wake-up (an insert trigger calls
  `pg_notify`); no leader election.
- Event kinds today: `advance_to` (no-op apart from scheduling the next
  one; every world keeps exactly one pending `advance_to` chained
  `FRESHNESS_INTERVAL` — default 24 h — after its `due_at`, so idle worlds
  stay fresh and the pipeline is exercised), `ship_built` and
  `ship_arrived` (single-world; the sim applies the effect as a boundary at
  `due_at`, the handler is a no-op if it already happened and only
  reconciles follow-ups — D-045), and the test-only `test_credit` (build
  tag `testevents`). Trade and expedition kinds arrive with their features.
- **Due-moment reconciliation (D-045):** the sim exposes `DueEvents(w)`;
  every `Store.Update` (read-only included) and every processed event
  reconciles the world's pending events against it inside the same
  transaction, so each due moment has exactly one pending event and a
  world with a due moment and no event can never be committed.
- **Dev mode:** the in-memory store keeps pending events and a
  `DevScheduler` sleeps until the earliest due time (scaled by
  `--time-scale`), re-arms on every change, processes the event with the
  same handlers and publishes on the in-process hub. It never wakes
  without a pending event (no tick loop).
- Metrics: queue depth (sampled during drains), lag (`now − due_at` at
  processing), handler duration, failures.

### 4.4 API

- REST-ish JSON, versioned under `/api/v1`. The hand-written OpenAPI file
  `server/api/openapi.yaml` is the contract (every object forbids unknown
  properties; every numeric field states its unit and scale);
  `openapi-typescript` generates the client types and CI fails on drift; a
  Go test validates handler responses and all golden payloads against it.
- Implemented (M1b): `GET /world` → `{version, display}`;
  `POST /world/commands` → `{version?, command: {type, …}}` with `type` ∈
  `place_building`, `place_road`, `demolish`, `demolish_road`, `set_paused`,
  `upgrade_house`, `move_building`, and since M4 part 1 `order_ship`,
  `cancel_ship_order`, `found_island`, `manual_shipment`, `assign_ship`,
  `unassign_ship`, `scrap_ship`, `create_route`, `update_route`,
  `delete_route` (list bounds: ≤ 8 stops, ≤ 32 load/unload entries per
  stop, ≤ 16 cargo entries), `claim_quest`, `ack_summary`, `place_fields` / `demolish_fields`
  (batch, bound to a `farm_id`, per-tile results; `place_field` one-tile
  alias), `sail_ship`, `found_island`, `upgrade_trading_post`,
  `upgrade_warehouse`, returning `{version, display}`; the display
  payload includes `ships`, `routes` (with `loop_ms` and the estimated
  `effects[]`, MECHANICS §9.2), shipyard `ship_order`, per-island `name`,
  `settled`, `position`, `quests`, `away_summary`, `insolvency`,
  per-island `bounds`, `size_class`, `rock`, fertilities, deposit slots
  and a 1:4 terrain `mask` (PR #26; tile rows are **not** in the world
  payload); `GET /world/islands/{id}/tiles?v=<seed>-<roll>` → the full
  rows, `ETag` = sha256(seed, roll, island id), `Cache-Control: private,
  max-age=31536000, immutable`, 304 on `If-None-Match`, `no-store` when
  `v` names another roll; `GET /content[?lang=<code>]` → catalogue in the same fixed-point units
  as the display payload, with its text fields in the requested language
  (D-061: `lang` or `Accept-Language`, an unknown `lang` is 400; the
  payload names `language`, `languages`, `island_names` and carries
  `Content-Language`); `GET /healthz`.
- Errors: `{error: {code, message}}`; `code` is a stable snake_case
  enumeration listed in the OpenAPI file (one per sim sentinel error plus
  `bad_request`, `not_found`, `method_not_allowed`, `internal`); malformed
  input 400 (also `route_invalid`), unknown entity 404 (also
  `ship_not_found`, `route_not_found`), state conflicts 409 (e.g.
  `shipyard_busy`, `ship_not_idle`, `route_in_use`, `island_not_settled`,
  `cargo_insufficient`, `last_warehouse`), internal-only sim errors 500.
- Implemented (M2): `POST /auth/guest`, `/auth/register`, `/auth/login`,
  `/auth/logout`, `GET /auth/me`, `PATCH /auth/me {language}` (D-061), `POST /auth/verify-email`,
  `/auth/password-reset/request`, `/auth/password-reset/confirm`;
  `GET /ws` (101). `/healthz` reports `version`, `instance`, `postgres`,
  `redis`. Security schemes `cookieAuth` (`ns_session`) and `bearerAuth`.
- Planned: `GET /map/*`, `POST /offers`, …, `GET /shop`,
  `POST /payments/stripe/webhook`.
- Modes: `--dev` serves one in-memory world behind the same handlers with
  a fixed dev player (`/auth/me`, `/auth/guest` succeed, other auth
  endpoints 404, in-process push hub, no metrics listener); default mode
  requires `DATABASE_URL` and `REDIS_URL`. Only the API layer reads the
  wall clock (`--time-scale` scales it in dev for tests).
- Commands carry the client's last seen `version`; a mismatch is not an
  error (server state wins) but is logged for diagnostics.
- Validation: content-aware in Go; never trust client types; strict JSON
  (unknown fields rejected), bodies ≤ 64 KiB. Rate limits on auth
  endpoints per client IP and per email (Redis token bucket, `Retry-After`
  on 429); client IP from the TCP peer or the right-most untrusted
  `X-Forwarded-For` entry when the peer is in `TRUSTED_PROXIES`.

### 4.5 WebSocket push

- `/api/v1/ws` authenticated (cookie or bearer); after every committed
  Update and every processed event the server publishes `world:<id>` on
  Redis; the hub forwards `{type: "world_changed", world_id}` to that
  player's sockets (later also small notifications such as
  `trade_accepted`, `expedition_done`). Payloads carry no game state; the
  client re-fetches `GET /world`.
- Missing a push only costs freshness: the client also re-fetches at
  `next_change_at`, on focus/visibility change and on socket reconnect
  (backoff). The "unreachable" banner shows after an HTTP network error or
  > 3 s without a socket and clears on any success.
- Redis is ephemeral: if it is down, pushes stop (error log + metric, the
  request still succeeds), rate limiting **fails open** (logged and
  counted), `/healthz` reports `redis: unavailable` but stays 200. Sessions,
  tokens and game state never depend on Redis.

### 4.6 Auth and accounts (D-044)

- **Guest play:** `POST /auth/guest` creates a player and its world and
  returns a session plus a **device token** the client stores to come back;
  `register` upgrades the guest (same world; device token revoked) or, without
  a session, creates a new player and world. Email + password with argon2id
  (t = 2, m = 19 MiB, p = 1, PHC format; parameters are raised by
  re-hashing on next login); verification and password reset behind a
  `Mailer` interface (log sender in dev; links point at `PUBLIC_URL`).
- **Sessions** live in PostgreSQL (hashed tokens, 30-day sliding expiry).
  The request field `transport: "cookie" | "bearer"` selects an HttpOnly
  SameSite cookie (browser) or a bearer token in the body (Capacitor);
  bearer requests are exempt from CSRF.
- **CSRF** for cookie requests (every non-safe method, the WebSocket
  upgrade, and `guest`/`register`/`login` with cookie transport): `Origin`
  present → must be in `ALLOWED_ORIGINS`; absent → `Sec-Fetch-Site`
  `same-origin`/`same-site` is accepted; otherwise rejected
  (`csrf_rejected`). `Referer` is never consulted.
- Enumeration resistance: unknown-email logins verify a dummy hash;
  password-reset requests always return 204 and send in the background.
- Ownership: every `/world` and `/ws` request resolves the player from the
  session; another player's world is simply not addressable (404).
- **Language (D-061):** `players.language` (nullable text, a served content
  language) is set by `PATCH /auth/me {language}` (400 for an unknown one)
  and returned as `player.language` once chosen, so every device of the
  account starts in it. It is a column of `0001_init.sql`, not a migration:
  recreate a development database with `make down VOLUMES=1 && make up`.
- Optional later: Sign in with Apple / Google (required by App Store if any
  third-party login exists).

### 4.7 Payments

See MONETIZATION.md §4. Adapters implement `Provider interface { Verify(ref)
(Entitlement, error) }`; the ledger is append-only and idempotent on
`provider_ref`.

## 5. Client

- **Display model:** `display = extrapolate(serverDisplayState, now)`; linear
  for stocks (clamped to capacity), modulo for cycle progress, lerp for ship
  legs; refreshed at 4 Hz, interpolated per frame.
- **Renderer:** Babylon.js scene; chunked terrain; instanced meshes per
  content ID; procedural placeholder meshes first, GLB later via an asset
  manifest `{content_id → mesh, footprint offset, animations}`.
- **UI:** React, CSS Modules, small store (Zustand) for UI state; subscribes
  to display-model slices. Strict Mode-safe engine lifecycle.
- **Input:** pointer events only (an eslint rule bans touch/mouse
  listeners); a pure, clock-free gesture recogniser (`render/gestures.ts`)
  emits tap, long-press, drag, pinch, rotate, hover and wheel; the DOM
  adapter feeds it; the UI layer stops propagation.
- **Language (D-061):** `client/src/i18n/` is the message catalogue (own
  helper, no library: placeholders, `one`/`other` plurals via
  Intl.PluralRules, rich text). Content text arrives in the requested
  language from the server's locale files; everything else is a client
  key, enforced by the `i18n/no-hardcoded-strings` ESLint rule (UI.md §10).
- **Layout:** a pure `layoutMode(width, height, coarsePointer)` picks
  desktop / tablet / phone-portrait / phone-landscape (UI.md §6).
- **PWA:** web manifest and placeholder icons; a hand-written service
  worker caches the **app shell only** (never `/api/*`, never other
  origins, GET only), shows an "update available" toast on a new deploy
  and offers an install action; Caddy serves `sw.js` and the manifest with
  `no-cache`. The game itself requires connectivity.
- **Theme and assets:** `assets/palette.json` is the single colour source;
  `npm run gen:palette` writes `client/src/theme/palette.{ts,css}` and CI
  fails on drift (like `schema.d.ts`). Fonts and icons are pinned files
  under `assets/` with licences and checksums; nothing is loaded from a
  CDN. Looks are not asserted automatically (D-052): `make shots`
  (fixed camera and clock, desktop + phone, fixtures and presets →
  `.experiment/shots/`) and `make model-sheet RECIPE=<id>`
  (single-recipe contact sheet → `.experiment/sheets/`) are the review
  tools; their PNGs go into PR reports.
- **Performance** is validated on the baseline device at each art gate
  (ART_DIRECTION §8, `?stats=1`); there is no CI perf guard (D-052).
- **Dev reset:** `POST /api/v1/dev/reset` (dev mode only; 404 otherwise;
  not in the OpenAPI contract) reseeds the in-memory world from a named
  fixture of the one list `devworld.Fixtures()` (`default`, `town`,
  `settled`, `seafaring`, `citizens`, `merchants`, `patricians`,
  `played`), clears pending dev events and publishes; `make shots` uses
  it for the server fixtures. In dev and E2E builds `?fixture=<name>`
  posts it from the page for any name that is not a synthetic client
  fixture (`dense-2x400`, `dense-archipelago-8`, `archipelago-8x20`,
  `showcase`; those render without a server), then opens the game.
  `played` (D-059) replays `server/testdata/scenarios/
  bootstrap_patricians.json` (dev server flag `--scenarios`, default
  `testdata/scenarios`) so that it ends at now; the ~40 s replay is
  cached per process and later resets advance the cached world to their
  now (the dev server's write timeout is 3 min for the first one).

## 5a. Asset pipeline (D-057)

See ART_DIRECTION for the rules. Mechanically: `assets/voxel/recipes/
<id>.py` (procedural voxel recipes on the shared parts library in
`assets/voxel/nsvoxel`, 8 voxels per tile) + `assets/voxel/build.py`
(Python 3 standard library only — no Blender, no kits, no numpy) →
greedy-meshed quads with per-vertex colour, baked AO and sun →
`client/public/models/*.glb` + `manifest.json` + thumbnails (committed)
→ the client's model registry (`client/src/render/models.ts`,
`@babylonjs/loaders` glTF) builds merged per-chunk meshes (full and
lite — the lite is the grid downsampled to 2 voxels per tile — toggled
by LOD; the lite ones merge per 4 × 4 chunks, `display/chunks.ts`
`LITE_GROUP`) with variant selection by building ID. A content building
without a recipe gets an automatic voxel placeholder sized to its
footprint (walls + roof), so no island mixes styles; footprints come
from content, or from `assets/voxel/planned/` for buildings content
does not define yet (content wins). `make assets` builds, `make
assets-check` rebuilds into a temp dir and compares (deterministic; CI
runs it — no Blender needed), `make assets-test` runs the Python tests
(budgets per footprint tile, folder limit 24 MiB, anchors incl. the
content `smoke`/`boat` flags, determinism), `make model-sheet RECIPE=`
renders a sheet in about a second.

**Far budget (D-048, D-057 §5).** At the zoom cap (`max_half_extent`
120) the far LOD stays within 250 k triangles and 40 draw calls (target
30) on desktop and phone. The asset budgets above bound a model; the
client bounds the far view: fields are painted into the lite ground
(`render/farfields.ts`), an island's far trees are thinned to
`FAR_TREE_TRIS`, contact shadows use `FAR_SHADOW_TRIS` outlines, and
the terrain gets the headroom the rest leaves of 250 k less a 10 %
reserve (`farmesh.ts` `allocateFarTerrain`: the focused island's relief
first, fine or coarse, then the other islands' relief nearest first,
their flat outline the last resort). `client/src/render/farbudget.test.ts`
enforces it on the `make shots` fixtures settled, patricians and played
(display and tiles captured from the dev server into
`client/src/render/testdata/farbudget`, regenerated with its
`capture.ts`): it builds the islands as the renderer does with the
committed models, runs the renderer's allocation for the far view at
every heading on desktop and phone, fails above 250 k triangles, and
asserts the allocation (the home island always in relief; on settled
and patricians every island in view in relief in the shots' view). A new
model, layer or budget constant that breaks it must find its triangles
elsewhere; `make shots STATS=2` attributes a real view per layer.

## 6. Content pipeline

- `content/schema/*.schema.json` → Go types (hand-written structs, validated
  with a JSON Schema library at startup) and TS types (`json-schema-to-typescript`).
- Reference checks: every good/building/need/tier ID referenced must exist;
  recipes balanced per the checklist in CONTENT.md §10 (a `go test` runs the
  balance checks over the catalogue).
- `content_version` is embedded in worlds; content changes that alter rules
  for existing worlds must be backward compatible or ship with a world
  migration.

## 7. Deployment

- **Phase 1 (implemented in `deploy/`):** Docker Compose with `postgres`,
  `redis`, a `migrate` step that must complete before the servers,
  `server-1`/`server-2` (health-checked, Alpine runtime image) and `caddy`
  serving the built client and proxying `/api` round-robin to both
  instances on `http://localhost:8000`; `make up` / `make down`. Metrics
  listeners (`METRICS_ADDR`, default `:9090`) are published on
  `127.0.0.1` only and never proxied. `TRUSTED_PROXIES` is the Compose
  subnet so rate limits see client IPs behind Caddy. Production additions
  still to do: TLS on a real host, nightly `pg_dump` + WAL archiving to
  object storage, restore rehearsal.
- **Phase 2:** Kubernetes (Helm chart in `deploy/`), managed Postgres or
  CloudNativePG, Redis, HPA on the server. Server replicas are stateless.
- Config via environment variables; secrets via the platform's secret store;
  never in the repo.
- Migrations run as a job before rollout; backward-compatible schema changes
  only (expand/contract).

## 8. Observability

- Traces per request and per event with world ID attributes; spans for
  `Advance` with boundary count.
- Metrics: request latency, `advance` duration histogram, boundaries per
  advance, event queue depth and lag, WebSocket connections, Redis publish
  errors, payment webhook outcomes.
- Logs: structured `slog`, request ID, player ID (never emails or tokens).
- Alerts: event lag > 60 s, failed events, 5xx rate, DB connection saturation,
  backup failure.

## 9. Security

- All authorisation server-side by `player_id` from the session; world IDs in
  URLs are checked for ownership on every request.
- Commands validated against content and state; sizes bounded; JSON depth
  limited.
- Rate limits on auth, commands, offers; CSRF protection for cookie sessions.
- Transfer log for all player-to-player movements (ONLINE.md §4.4).
- Dependencies pinned; `govulncheck` and `npm audit` in CI.

## 10. Testing strategy

| Layer | Tool | Must cover |
|---|---|---|
| Simulation | `go test`, golden fixtures, property tests | invariants (MECHANICS §13), determinism, `Advance` composition, pause order, migrations |
| Content | `go test` | reference integrity, balance checklist |
| Store/API | `go test` with a real Postgres (testcontainers) | ownership denial, row-lock serialisation, event idempotency, retries, two-world locking |
| Multi-instance | integration test running 2 server processes | same event never processed twice; commands from both instances serialise |
| Client display | Vitest | extrapolation matches server fixtures at sampled times |
| Client flows, looks, perf | playtest on the baseline device + `make shots` (D-052) | start → found → build → route, touch, fps, heat |
| Devices | manual | mid-range Android + iPhone: fps, memory, resume, thermal |

CI runs `gofmt`, `go vet`, `golangci-lint` (config in repo), `go test ./...`,
`tsc`, `eslint`, Vitest, the client build and `assets-check` on every
labelled PR.

## 11. Alternatives considered

| Option | Why not |
|---|---|
| PocketBase + SQLite | single-writer DB, CRUD-shaped API, pre-1.0 — unsuitable as a game server |
| Nakama | over-featured for async play; sandboxed logic runtime fights a custom economy |
| Continuous server tick | cost scales with registered players; no gameplay return offline |
| Go → WASM shared sim in client | solves a problem A′ makes moot; bundle size on mobile |
| Full TS rule port in client | duplication/drift; unnecessary with server-provided rates |
| ConnectRPC/protobuf | fine, but one more toolchain; OpenAPI + generated TS types suffice |
| Three.js / 2D sprites | see D-024 |
