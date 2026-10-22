# New Shores

A persistent online city-builder in the spirit of the Anno series: settle a
private archipelago in an age-of-sail world, build production chains, ship
goods between islands, grow a population through four tiers, and trade with
other players on a shared world map. Anno's pace — build instantly, be gated by
what you produce — with an economy that keeps running on the server while you
are away. Cosmetic-only monetisation.

Status: **M4 part 2b done — tiers 1–2 playable end to end**: two islands,
ships, routes and settling, Citizens with balanced tier 1–2 content, intro
quests, "while you were away", automatic stall recovery, one continuous
3D world (every island at its archipelago position, free pan and zoom
with level of detail, four camera rotation steps, a minimap) with a route
editor panel (D-048), all persisted in PostgreSQL with
accounts, a scheduled-events worker, WebSocket push and two stateless
server instances (see [docs/FIRST_PLAYABLE.md](docs/FIRST_PLAYABLE.md)).
M3 (touch input, mobile layout, PWA shell, mobile performance budget)
is in place with emulated measurements; a check on a real phone is still
open. The in-memory `--dev` server remains for quick local work.

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
| [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) | Visual target: light and palette, continuous world, terrain and water, life layer, HUD theme, kit-bash asset pipeline, task breakdown |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Numbered log of every design decision with rationale and "revisit" markers |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents working in this repository |

## Repository layout

| Path | Contents |
|---|---|
| [server/](server/README.md) | Go game server: simulation, content loading, HTTP API, dev server |
| [server/api/openapi.yaml](server/api/openapi.yaml) | OpenAPI description of the HTTP API (the contract; client types are generated from it) |
| `client/` | Vite + React + Babylon.js browser client |
| `deploy/` | Dockerfiles, Caddyfile and `docker-compose.yaml` of the local stack |
| `content/` | Game content (JSON) and its JSON Schemas |
| `assets/` | Art sources: `palette.json` (generates the client palette, `npm run gen:palette`), pinned fonts and HUD icons (`npm run gen:hud-icons`) |
| `docs/` | Design documents |

## Run locally

Prerequisites: Go 1.27, Node 22 (LTS) with npm, and `golangci-lint` for
`make check`; Docker with Compose for `make up`.

### Full stack (PostgreSQL, Redis, two servers)

```sh
make up      # build and start; waits until the stack answers through Caddy
make logs    # follow the logs
make down    # stop and keep the database
make down VOLUMES=1   # stop and delete the database volume (only 1 deletes)
```

Open <http://localhost:8000>: play as guest (the island persists across
reloads), register from the account menu (keeps the island), log out and
log in again. Compose runs `postgres` (16), `redis` (7), a one-shot
`migrate` (`server migrate`), `server-1` and `server-2` (default mode) and
`caddy`, which serves the built client and proxies `/api/` (including the
WebSocket) round-robin to both servers. Prometheus metrics are on the
servers' separate metrics port, published as <http://127.0.0.1:9090/metrics>
(server-1) and <http://127.0.0.1:9091/metrics> (server-2), not through
Caddy. The Compose file sets local-only default credentials; override them
(and `HTTP_PORT`, `PUBLIC_URL`, `SMTP_URL`, …) in `deploy/.env`
(gitignored). `HTTP_PORT` (default 8000; also `make up HTTP_PORT=8123`)
moves the stack's port, and the default `ALLOWED_ORIGINS` and `PUBLIC_URL`
follow it; `make up` waits on and prints the port Compose actually
published. Without `SMTP_URL` verification and reset mails are only
logged (subject and token hash).

### Dev server (in-memory, no database)

```sh
make client-install   # npm ci in client/
make dev              # dev server on :8080 + Vite on :5173; Ctrl-C stops both
```

Open <http://localhost:5173> (or <http://127.0.0.1:5173>, the address Vite
prints on some systems; both are allowed). The server (`go run ./cmd/server --dev` in
`server/`) holds **one in-memory world**: the start island with its
warehouse and starting stock plus the unsettled island 2 (no dev-only
bonus: since the tier 1–2 balancing pass the starting stock covers the
first settlement flow); restarting it resets the world. Ship builds and arrivals are applied by an
in-process scheduler at their due time (scaled by `--time-scale`). There are no accounts: the client is logged
in as the fixed player "Developer". The API is at
<http://localhost:8080/api/v1> (`/healthz` for readiness).

- Faster world time for testing: `make dev TIME_SCALE=10` (server
  `--time-scale 10`, client `VITE_TIME_SCALE=10` so its extrapolation keeps
  up). Without the client setting the display lags between re-fetches.
  `--time-scale` is only accepted with `--dev`.
- Other server flags: `--addr` (default `:8080`), `--content` (region
  directory), `--cors-origin` (comma-separated browser origins allowed to
  call the API; default `http://localhost:5173,http://127.0.0.1:5173`),
  `--log-format text|json`. If you open the client from another origin
  (another host or port), add it there.

### Server configuration (default mode)

`server` without `--dev` needs PostgreSQL and Redis. Flags win over
environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL URL (`postgres://user:pass@host:5432/db`) |
| `REDIS_URL` | — (required) | Redis URL (`redis://host:6379/0`); push and rate limits degrade without a reachable Redis |
| `LISTEN_ADDR` | `:8080` | API listen address (flag `--addr`) |
| `METRICS_ADDR` | `:9090` | separate listener for `/metrics` (Prometheus) |
| `CONTENT_DIR` | `../content/old_coast` | region content directory (flag `--content`) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | browser origins for CORS, the CSRF check and the WebSocket (flag `--cors-origin`) |
| `COOKIE_SECURE` | `false` | `Secure` attribute of the session cookie (set `true` behind HTTPS) |
| `SESSION_TTL` | `720h` | idle session lifetime (sliding, at least `1h`) |
| `FRESHNESS_INTERVAL` | `24h` | interval of each world's `advance_to` event (at least `1m`) |
| `MIGRATE_ON_START` | `false` | apply migrations before serving (otherwise the server refuses an outdated schema) |
| `TRUSTED_PROXIES` | — | comma-separated IPs/CIDRs whose `X-Forwarded-For` is trusted (rate limits by client IP) |
| `SMTP_URL` | — | `smtp://user:pass@host:587`; unset: mails are logged (subject and token hash only) |
| `MAIL_FROM` | — | sender address (required with `SMTP_URL`) |
| `PUBLIC_URL` | `http://localhost:8000` | base URL of links in mails |
| `INSTANCE_ID` | host name | instance name in logs, `/healthz` and the `X-Instance` header |
| `LOG_FORMAT` | `text` | `text` or `json` (flag `--log-format`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | enables OTLP/HTTP trace export (standard `OTEL_*` variables apply); unset: no tracing |

Migrations are SQL files embedded in the binary: `server migrate` applies
the pending ones and exits (running it again is a no-op); concurrent runs
are serialised by an advisory lock. Compose runs it as the `migrate`
service before the servers start.

### Checks and tests

- `make check` (server, content and client: gofmt, vet, golangci-lint,
  `go test`, eslint, typecheck, Vitest). Browser tests against the dev
  server: `cd client && npx playwright install chromium webkit`, then
  `make client-e2e` (all Playwright projects, see "Mobile" below).
- PostgreSQL/Redis integration tests (store, events worker, auth,
  two-instance test): `make server-integration`. They use
  `TEST_DATABASE_URL` (a server where the tests may create databases) and
  `TEST_REDIS_URL`, or start containers with testcontainers when Docker is
  available; otherwise they are skipped (in CI a skip fails).
- Persistence e2e against the default-mode server:
  `E2E_DATABASE_URL=… E2E_REDIS_URL=… make client-e2e-pg`.
- **CI runs on demand only** (cost control for a private repository):
  add the `ci` label to a pull request to run all jobs once; the workflow
  removes the label when it finishes, so after pushing new commits add it
  again. Nothing runs on push to `main`; `workflow_dispatch` is available
  for manual runs. Run `make check` locally before asking for CI.

### Mobile, fixtures and measurements

- **Mobile:** the same client works by touch alone on phones and tablets
  (minimum 360 × 640, portrait and landscape): one-finger pan, pinch zoom
  (from a single house to the whole archipelago), tap to select,
  long-press to inspect, tap + Confirm to place, a two-finger twist or the
  Rotate button to rotate the ghost (without a tool the twist turns the
  camera), one-finger road drawing, ship drag-to-send. Phones get bottom
  sheets, a scrolling build bar, a collapsible minimap and a collapsed top
  bar; the mouse keeps click-to-place.
- **Fixtures** (dev and E2E builds only, no server needed):
  `?fixture=archipelago-8x20` (8 islands, 20 ships; whole archipelago in
  view), `?fixture=dense-2x400` (two islands, ≈ 400 buildings, 63 carts,
  2 ships on legs; near the dense island) and
  `?fixture=dense-archipelago-8` (8 islands, two of them dense, ships on
  legs and 2 routes; the far and mid LOD budget), e.g.
  <http://localhost:5173/?fixture=dense-2x400> under `make dev`.
  `?quality=high|low` overrides the render quality the layout selects
  (desktop: high — shadow map, grading, FXAA, the latter not on software
  WebGL such as headless Chromium unless `?fxaa=1` forces it; touch
  layouts: low).
- **Playwright projects** (`npm run test:e2e` runs all of them):
  `chromium`, `archipelago` and `away` (desktop, shared dev world), then
  `touch-chromium` (Pixel 5 profile at 412 × 915, incl. the PWA
  installability check) and `touch-webkit` (iPhone 12; needs
  `npx playwright install webkit`), and `perf` (the dense fixtures at
  near, mid and far LOD under 4× CPU throttling; logs fps, frame times,
  draw calls, JS heap, WebGL renderer and bundle size and asserts an fps
  threshold: the `PERF_MIN_FPS` environment variable, default 27 from
  `client/e2e/perf.spec.ts`), and `visual` (screenshot baselines of the
  fixtures on desktop and a Pixel 5, per platform: a missing baseline is
  written and its test skipped with a notice; plus the grid overlay,
  palette, render quality and credits rules). `perf` and `visual` run
  last, after the shared-world projects. Single projects:
  `npx playwright test --project=perf --no-deps` (`--no-deps` skips the
  projects a project depends on). Headless Chromium renders
  with SwiftShader (software); `PERF_GPU=1` runs the perf project with
  hardware WebGL flags for comparison (its fps threshold is not asserted).
- **Perf threshold on slower machines:** software WebGL is CPU-bound, so
  the default 27 fps (Apple M4 Pro) can be too high elsewhere. Do not
  disable the check; read the lowest `"fps"` of the `PERF … 412x915@2.625`
  lines of a run and set `PERF_MIN_FPS` to that fps × 0.8, rounded down —
  locally `PERF_MIN_FPS=20 npm run test:e2e`, in CI the `PERF_MIN_FPS` value of
  the e2e step in `.github/workflows/ci.yaml` (a one-line change).
- **Opt-in measurements:** `MEASURE_TTFI=1 npx playwright test e2e/ttfi.spec.ts`
  (time to first interaction) and
  `MEASURE_LIGHTHOUSE=1 npx playwright test e2e/lighthouse.spec.ts`
  (Lighthouse accessibility of the dense fixture, desktop and 412 × 915,
  with the project-local `lighthouse` devDependency).
- **PWA:** production builds register a service worker that caches the
  app shell only (installable, starts fast); the game itself always needs
  connectivity and `/api/` is never cached. A new version shows an
  "Update available" toast with Reload; "Install app" appears in the
  account menu when the browser offers installation.

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

## Credits / attribution

- **Icons:** the HUD icons come from [game-icons.net](https://game-icons.net)
  by Delapouite, Guard13007, Lorc and Sbed, licensed under
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (licence text
  in `assets/icons/LICENSE.txt`); recoloured and with coordinates rounded.
  The pinned files and the author of each are listed in
  `assets/icons/icons.json`.
- **Fonts:** [Cinzel](https://github.com/NDISCOVER/Cinzel) by Natanael Gama
  and [Source Sans 3](https://github.com/adobe-fonts/source-sans) by Paul
  D. Hunt (Adobe), both under the SIL Open Font License 1.1
  (`assets/fonts/*/OFL.txt`, origins and checksums in `SOURCES.md`).

The same credits are in the game's account menu (Credits).
