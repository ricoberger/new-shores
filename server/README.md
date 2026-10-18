# New Shores server

Go module `github.com/ricoberger/new-shores/server`. See
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the design and
[AGENTS.md](../AGENTS.md) for the rules that apply to every change.

| Package | Contents |
|---|---|
| `cmd/server` | server binary (stub: prints its version) |
| `internal/content` | loads and validates `content/<region>` against `content/schema` |
| `internal/sim` | pure, deterministic simulation: `Apply`, `Advance`, `Display`, envelope |
| `internal/sim/scenario` | headless scenario runner used by golden tests and balancing |
| `testdata/scenarios` | scenario documents and their golden reports |

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

`golangci-lint` picks up the repository-root `.golangci.yaml`
(`golangci-lint config path`). golangci-lint v2.13.2 cannot type-check
packages built by go1.27.2; the Makefile and CI therefore run it with
`GOTOOLCHAIN=go1.27.1` (override with `make server-lint
GOLANGCI_LINT_GOTOOLCHAIN=local`).

## Golden scenarios

Each `testdata/scenarios/<name>.json` is run by
`internal/sim/scenario.TestGolden` and its report is compared byte for byte
with `<name>.golden.json`. After an intended change of simulation rules or
content numbers, regenerate the goldens and review the diff:

```sh
cd server && go test ./internal/sim/scenario/ -run TestGolden -update
git diff testdata/scenarios
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
