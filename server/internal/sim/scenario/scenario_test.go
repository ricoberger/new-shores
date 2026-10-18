package scenario

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

var update = flag.Bool("update", false, "regenerate golden reports")

func repoRoot(t testing.TB) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// file = <root>/server/internal/sim/scenario/scenario_test.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..")
}

func scenarioDir(t testing.TB) string {
	return filepath.Join(repoRoot(t), "server", "testdata", "scenarios")
}

func loadCatalogue(t testing.TB) *content.Catalogue {
	t.Helper()
	c, err := content.Load(filepath.Join(repoRoot(t), DefaultContent))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func loadScenario(t testing.TB, name string) *Scenario {
	t.Helper()
	s, err := Load(os.DirFS(scenarioDir(t)), name+".json")
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return s
}

func runScenario(t testing.TB, name string) *Report {
	t.Helper()
	s := loadScenario(t, name)
	c, err := content.Load(s.ContentDir(repoRoot(t)))
	if err != nil {
		t.Fatal(err)
	}
	rep, err := Run(s, c)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return rep
}

func encodeReport(t testing.TB, rep *Report) []byte {
	t.Helper()
	rep.ClearTiming()
	data, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return append(data, '\n')
}

// TestGolden runs every scenario and compares its report byte for byte with
// the committed golden file. Run with -update to regenerate.
func TestGolden(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(scenarioDir(t), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, f := range files {
		if strings.HasSuffix(f, ".golden.json") {
			continue
		}
		n++
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			got := encodeReport(t, runScenario(t, name))
			golden := filepath.Join(scenarioDir(t), name+".golden.json")
			if *update {
				if err := os.WriteFile(golden, got, 0o600); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(golden) // #nosec G304 -- test fixture path.
			if err != nil {
				t.Fatalf("read golden (run with -update): %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("report differs from %s (run with -update and review the diff)", golden)
			}
		})
	}
	if n < 5 {
		t.Fatalf("found %d scenarios, want at least 5", n)
	}
}

func building(t *testing.T, rep *Report, typ string) sim.BuildingDisplay {
	t.Helper()
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Type == typ {
			return b
		}
	}
	t.Fatalf("no %s in report", typ)
	return sim.BuildingDisplay{}
}

// TestChainPlanksPlausibility checks scenario (a) against the closed-form
// expectation of the fluid model.
func TestChainPlanksPlausibility(t *testing.T) {
	rep := runScenario(t, "chain_planks")
	lj, sm := building(t, rep, "lumberjack"), building(t, rep, "sawmill")
	dLJ, dSM := int64(*lj.RoadDistance), int64(*sm.RoadDistance)
	if dLJ != 7 || dSM != 13 || *lj.TransferDelayMs != 17_000 || *sm.TransferDelayMs != 23_000 {
		t.Fatalf("distances lj=%d sm=%d delays %d/%d", dLJ, dSM, *lj.TransferDelayMs, *sm.TransferDelayMs)
	}
	inv := rep.Final.Islands[0].Inventory
	// planks = (600 - 20 - d_lj - d_sm) / 30 units, in milli-units rounded
	// to the nearest milli-unit like every display quantity.
	roundDiv := func(a, b int64) int64 { return (2*a + b) / (2 * b) }
	wantPlanks := roundDiv((600-20-dLJ-dSM)*1000, 30)
	if got := inv["planks"].Stock; got != wantPlanks {
		t.Errorf("planks = %d, want %d", got, wantPlanks)
	}
	if got := inv["wood"].Stock; got != 0 {
		t.Errorf("wood stock = %d, want 0", got)
	}
	if got, want := inv["wood"].InTransit, roundDiv((10+dLJ)*1000, 30); got != want {
		t.Errorf("wood in transit = %d, want %d", got, want)
	}
	// Snapshots: wood arrives only after 10 + d_lj seconds (17 s), planks
	// after a further 10 + d_sm seconds (40 s).
	snap := func(i int) map[string]GoodAmount { return rep.Snapshots[i].Inventory["main"] }
	if snap(0)["planks"].Stock != 0 || snap(0)["wood"].InTransit == 0 { // t = 16 s
		t.Errorf("t=16s: %+v", snap(0))
	}
	if snap(2)["planks"].Stock != 0 || snap(2)["planks"].InTransit == 0 { // t = 40 s
		t.Errorf("t=40s: %+v", snap(2))
	}
	if snap(3)["planks"].Stock == 0 { // t = 41 s
		t.Errorf("t=41s: %+v", snap(3))
	}
}

func TestThrottledWarehouse(t *testing.T) {
	rep := runScenario(t, "throttled_warehouse")
	n := 0
	for _, b := range rep.Final.Islands[0].Buildings {
		switch b.Type {
		case "lumberjack":
			n++
			if b.Status != sim.StatusThrottled || b.ThroughputFactorPermille != 937 || b.EfficiencyPermille != 1000 {
				t.Errorf("lumberjack %d: status %s factor %d eff %d", b.ID, b.Status, b.ThroughputFactorPermille, b.EfficiencyPermille)
			}
			if got := b.Rates.Outputs["wood"]; got != 1875 { // 2/min * 60/64
				t.Errorf("lumberjack %d rate = %d", b.ID, got)
			}
		case "warehouse":
			if *b.LoadPermille != 1066 {
				t.Errorf("warehouse load = %d, want 1066", *b.LoadPermille)
			}
		}
	}
	if n != 32 {
		t.Errorf("lumberjacks = %d", n)
	}
}

func TestWarehouseFull(t *testing.T) {
	rep := runScenario(t, "warehouse_full")
	fisher := building(t, rep, "fisher")
	if fisher.Status != sim.StatusWarehouseFull || fisher.Rates.Outputs["fish"] != 0 {
		t.Errorf("fisher status %s rate %d", fisher.Status, fisher.Rates.Outputs["fish"])
	}
	fish := rep.Final.Islands[0].Inventory["fish"]
	if fish.Stock != 300_000 || fish.InTransit != 0 || fish.Capacity != 300_000 {
		t.Errorf("fish = %+v", fish)
	}
	// After 3h20m (= 300 units * 40 s) stock + in-transit is exactly 300.
	first := rep.Snapshots[0].Inventory["main"]["fish"]
	if first.Stock+first.InTransit != 300_000 {
		t.Errorf("t=3h20m: %+v", first)
	}
	if lost := rep.Totals["main"]["fish"].Lost; lost != 0 {
		t.Errorf("lost = %d", lost)
	}
}

func TestUnconnectedProducer(t *testing.T) {
	rep := runScenario(t, "unconnected_producer")
	lj := building(t, rep, "lumberjack")
	if lj.Status != sim.StatusNotConnected || lj.Buffer == nil || lj.Buffer.Stock["wood"] != 5000 || lj.Rates.Outputs["wood"] != 0 {
		t.Errorf("lumberjack = %+v buffer %+v", lj.Status, lj.Buffer)
	}
	for _, s := range rep.Snapshots {
		if len(s.Inventory["main"]) != 0 {
			t.Errorf("island stock changed: %+v", s.Inventory)
		}
	}
}

// TestChainPlanks12h checks scenario (e): a 12-hour catch-up in one Advance
// ends with both goods at capacity and stays within the 50 ms budget.
func TestChainPlanks12h(t *testing.T) {
	rep := runScenario(t, "chain_planks_12h")
	inv := rep.Final.Islands[0].Inventory
	for _, good := range []string{"wood", "planks"} {
		if g := inv[good]; g.Stock != g.Capacity || g.InTransit != 0 {
			t.Errorf("%s = %+v, want stock at capacity", good, g)
		}
	}
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Rates != nil && (b.Status != sim.StatusWarehouseFull || b.Rates.Outputs[firstKey(b.Rates.Outputs)] != 0) {
			t.Errorf("%s still producing: %s", b.Type, b.Status)
		}
	}

	// Timing: one warm-up run, best of three.
	s := loadScenario(t, "chain_planks_12h")
	c := loadCatalogue(t)
	best := time.Duration(1<<63 - 1)
	for i := range 4 {
		rep, err := Run(s, c)
		if err != nil {
			t.Fatal(err)
		}
		if i > 0 {
			best = min(best, rep.AdvanceDuration())
		}
	}
	t.Logf("12h advance: best of 3 = %s, boundaries = %d", best, rep.BoundaryCount)
	if best >= 50*time.Millisecond {
		t.Errorf("12h advance took %s, budget 50ms", best)
	}
}

func firstKey(m map[string]int64) string {
	for k := range m {
		return k
	}
	return ""
}

func TestDeterministicReports(t *testing.T) {
	a := encodeReport(t, runScenario(t, "chain_planks"))
	b := encodeReport(t, runScenario(t, "chain_planks"))
	if !bytes.Equal(a, b) {
		t.Error("same scenario produced different reports")
	}
}

func TestStepErrorsCarryIndex(t *testing.T) {
	s, err := Parse([]byte(`{
		"name": "bad", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": ["~~~~", "~..~", "~~~~"]},
		"steps": [{"advance": {"duration": "1s"}}, {"place": {"type": "lumberjack", "x": 0, "y": 0}}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	_, err = Run(s, loadCatalogue(t))
	if err == nil || !strings.Contains(err.Error(), "step 1 (place)") {
		t.Fatalf("err = %v", err)
	}
}
