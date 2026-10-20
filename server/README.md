# New Shores server

Go module `github.com/ricoberger/new-shores/server`. See
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the design and
[AGENTS.md](../AGENTS.md) for the rules that apply to every change.

| Package | Contents |
|---|---|
| `cmd/server` | server binary: `--dev` serves one in-memory world; default mode runs on PostgreSQL + Redis (API, events worker, WebSocket push, `/metrics`); `server migrate` applies migrations |
| `api` | `openapi.yaml`: the HTTP API contract (hand-written; validated by `internal/api` tests) |
| `internal/api` | `/api/v1` handlers, sessions, CSRF, auth endpoints, command/error mapping, content payload, CORS, request logging and tracing |
| `internal/auth` | accounts: guests and device tokens, argon2id passwords, sessions, email verification, password reset, mailer, Redis rate limiter |
| `internal/events` | scheduled-events worker, handler registry, `advance_to`, `ship_built`, `ship_arrived` (and `test_credit` with `-tags testevents`), in-process scheduler of the dev server |
| `internal/ws` | WebSocket hub and Redis pub/sub fan-out of `world_changed` |
| `internal/store` | `Store` interface, the one-world in-memory store of the dev server (with its pending events) and the payloads of due-moment events |
| `internal/store/postgres` | PostgreSQL store (row-locked `Update`, DB clock, pending-event cap), account/event queries, embedded migrations |
| `internal/telemetry` | Prometheus metrics and OpenTelemetry tracing setup |
| `internal/testenv` | PostgreSQL/Redis for integration tests (tag `integration`; testcontainers fallback) |
| `internal/devworld` | embedded archipelago (start island + island 2; scenario document without steps) built with the scenario runner for the dev world (`NewDev`, no bonus since the tier 1–2 balancing pass) and new player worlds (`New`) |
| `internal/content` | loads and validates `content/<region>` against `content/schema` |
| `internal/sim` | pure, deterministic simulation: `Apply`, `Advance`, `Display`, envelope |
| `internal/sim/scenario` | headless scenario runner used by golden tests and balancing |
| `testdata/scenarios` | scenario documents and their golden reports |
| `testdata/display` | client extrapolation fixtures (`TestDisplayFixtures`, regenerate with `-update`) |

## Checks

From the repository root:

```sh
make check          # gofmt, go vet, golangci-lint, go test, content tests
make server-test    # go test ./... only
make content-test   # go test ./internal/content/...
```

or directly (AGENTS.md §4):

```sh
cd server && gofmt -l . && go vet ./... && golangci-lint run && go test ./...
```

`golangci-lint` (v2.15.0, pinned in CI) picks up the repository-root
`.golangci.yaml` (`golangci-lint config path`).

## Integration tests

Store, events, auth and multi-instance tests need PostgreSQL and Redis and
carry the build tags `integration` (and `testevents` for the test-only
event kind):

```sh
make server-integration   # go test -tags 'integration testevents' ./...
```

They use `TEST_DATABASE_URL` (a server where the test may create and drop
databases) and `TEST_REDIS_URL`; when unset they start containers with
testcontainers if Docker is available and skip otherwise — in CI (`CI` set)
a skip is a failure.

## Golden scenarios

Each `testdata/scenarios/<name>.json` is run by
`internal/sim/scenario.TestGolden` and its report is compared byte for byte
with `<name>.golden.json`. After an intended change of simulation rules or
content numbers, regenerate the goldens and review the diff:

```sh
cd server && go test ./internal/sim/scenario/ -run TestGolden -update
git diff testdata/scenarios
```

The client extrapolation fixtures in `testdata/display` derive from the same
scenarios; regenerate them together with the goldens:

```sh
cd server && go test ./internal/sim/scenario/ -run 'TestGolden|TestDisplayFixtures' -update
```

Scenario format (all quantities in units, durations in Go syntax):

```json
{
  "name": "chain_planks",
  "content": "content/old_coast",
  "start": "2026-01-01T00:00:00Z",
  "island": { "id": "main", "rows": ["~~~~", "~cc~", "~..~", "~~~~"] },
  "seed": { "warehouse": { "x": 1, "y": 1, "rotation": 0 }, "gold": 130, "stock": { "planks": 13 } },
  "steps": [
    { "road": { "type": "road_dirt", "from": [2, 4], "to": [17, 4] } },
    { "place": { "type": "lumberjack", "x": 8, "y": 2, "rotation": 0 } },
    { "place_grid": { "type": "lumberjack", "x": 9, "y": 3, "rotation": 0, "count": 32, "dx": 2, "dy": 0 } },
    { "pause": { "x": 8, "y": 2 } },
    { "resume": { "x": 8, "y": 2 } },
    { "demolish": { "x": 8, "y": 2, "accept_surplus_loss": false } },
    { "demolish_road": { "from": [2, 4], "to": [3, 4] } },
    { "stock": { "good": "wood", "amount": 10 } },
    { "upgrade_warehouse": { "x": 1, "y": 1 } },
    { "place": { "type": "house_citizens", "x": 9, "y": 2 }, "expect_error": "upgrade_only" },
    { "advance": { "duration": "10m" } }
  ]
}
```

Island legend: `~` water, `c` coast, `.` grass, `f` forest, `m` mountain,
`I` mountain with an infinite iron deposit, `S` mountain with an infinite
stone deposit. An island may list its fertility tags
(`"fertilities": ["wheat", "apple"]`).
The seed is granted free of charge; every step goes through `sim.Apply` or
`sim.Advance`, and a failing step fails the run with its index. A step
with `expect_error` (a sentinel's snake_case name, the API error code) must
fail with that sentinel and leave the world byte-identical; the report
lists these steps under `expected_errors`.

Archipelagos use `islands` instead of `island` (exactly one of the two):
`[{"id": "start", "name": "Start", "x": 0, "y": 0, "rows": [...]}, ...]`
with archipelago positions in tiles (ship travel times); the seed applies
to the first island and every island-addressing step takes an optional
`"island"` (default: the first island). Ship and route steps address ships
and routes by their sequential IDs:

```json
{ "order_ship": { "x": 6, "y": 1, "ship_type": "sloop" } },
{ "cancel_ship_order": { "x": 6, "y": 1 } },
{ "manual_shipment": { "ship": 1, "to": "island2", "cargo": { "planks": 50 } } },
{ "found_island": { "ship": 1, "island": "island2", "x": 1, "y": 1, "rotation": 0 } },
{ "create_route": { "name": "Wood out", "stops": [
  { "island": "start", "load": { "wood": 100 }, "unload": ["planks"] },
  { "island": "island2", "load": { "planks": 40 }, "unload": ["wood"] } ] } },
{ "update_route": { "route": 1, "stops": [...] } },
{ "delete_route": { "route": 1 } },
{ "assign_ship": { "ship": 1, "route": 1 } },
{ "unassign_ship": { "ship": 1 } },
{ "scrap_ship": { "ship": 1 } }
```

`dev_bonus` (`{"gold": …, "goods": {…}}`) is only applied by
`devworld.NewDev`; the dev archipelago has none since the tier 1–2
balancing pass.
