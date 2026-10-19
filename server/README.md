# New Shores server

Go module `github.com/ricoberger/new-shores/server`. See
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the design and
[AGENTS.md](../AGENTS.md) for the rules that apply to every change.

| Package | Contents |
|---|---|
| `cmd/server` | server binary; `--dev` serves one in-memory world, otherwise it prints its version |
| `api` | `openapi.yaml`: the HTTP API contract (hand-written; validated by `internal/api` tests) |
| `internal/api` | `/api/v1` handlers, command/error mapping, content payload, CORS, request logging, clock |
| `internal/store` | `Store` interface (M2: PostgreSQL) and the one-world in-memory store of the dev server |
| `internal/devworld` | embedded dev island (scenario document without steps) built with the scenario runner |
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
    { "advance": { "duration": "10m" } }
  ]
}
```

Island legend: `~` water, `c` coast, `.` grass, `f` forest, `m` mountain.
The seed is granted free of charge; every step goes through `sim.Apply` or
`sim.Advance`, and a failing step fails the run with its index.
