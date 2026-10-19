package scenario

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
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
	c, err := s.LoadContent(repoRoot(t))
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
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
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

func TestOversizedStockStepFails(t *testing.T) {
	s, err := Parse([]byte(`{
		"name": "huge", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": ["~~~~~~", "~cccc~", "~....~", "~....~", "~~~~~~"]},
		"seed": {"warehouse": {"x": 1, "y": 1}},
		"steps": [{"stock": {"good": "wood", "amount": 9223372036854775.807}}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	_, err = Run(s, loadCatalogue(t))
	if !errors.Is(err, sim.ErrOverCapacity) || !strings.Contains(err.Error(), "step 0 (stock)") {
		t.Fatalf("err = %v", err)
	}
}

func houses(rep *Report) []sim.BuildingDisplay {
	var out []sim.BuildingDisplay
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Residents != nil {
			out = append(out, b)
		}
	}
	return out
}

func checkGoldNonNegative(t *testing.T, rep *Report) {
	t.Helper()
	for _, s := range rep.Snapshots {
		if s.Gold < 0 {
			t.Errorf("%s: gold %d < 0", s.At, s.Gold)
		}
	}
	if rep.Final.Gold < 0 {
		t.Errorf("final gold %d < 0", rep.Final.Gold)
	}
}

// bestAdvance runs a scenario four times and returns the best Advance wall
// time of the last three runs and the last report.
func bestAdvance(t *testing.T, s *Scenario) (time.Duration, *Report) {
	t.Helper()
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	best := time.Duration(1<<63 - 1)
	var rep *Report
	for i := range 4 {
		if rep, err = Run(s, c); err != nil {
			t.Fatal(err)
		}
		if i > 0 {
			best = min(best, rep.AdvanceDuration())
		}
	}
	return best, rep
}

// TestSettlersGrow checks scenario (f): every house reaches satisfaction 1
// and its maximum, gold never goes negative and the balance ends positive.
func TestSettlersGrow(t *testing.T) {
	rep := runScenario(t, "settlers_grow")
	hs := houses(rep)
	if len(hs) != 8 {
		t.Fatalf("houses = %d", len(hs))
	}
	for _, h := range hs {
		if *h.Residents != *h.ResidentsMax || *h.SatisfactionPermille != 1000 || *h.GrowthRatePerMin != 0 {
			t.Errorf("house %d: residents %d satisfaction %d", h.ID, *h.Residents, *h.SatisfactionPermille)
		}
	}
	checkGoldNonNegative(t, rep)
	if rep.Final.BalanceRatePerMin < 0 || len(rep.PauseEvents) != 0 {
		t.Errorf("balance %d, pauses %v", rep.Final.BalanceRatePerMin, rep.PauseEvents)
	}
	if got := rep.Snapshots[len(rep.Snapshots)-1].Population["settlers"]; got != 64_000 {
		t.Errorf("population = %d", got)
	}
}

// TestFishShort checks scenario (g): without market and fish, residents
// decline to their floor and stay there; nothing is destroyed (D-009).
func TestFishShort(t *testing.T) {
	rep := runScenario(t, "fish_short")
	prev := int64(1 << 62)
	for i, s := range rep.Snapshots {
		pop := s.Population["settlers"]
		if pop < 8*2_000 {
			t.Errorf("%s: population %d below the floor of 8 houses", s.At, pop)
		}
		if i > 0 && pop > prev {
			t.Errorf("%s: population grew %d -> %d", s.At, prev, pop)
		}
		prev = pop
	}
	if first := rep.Snapshots[0].Population["settlers"]; first != 64_000 {
		t.Errorf("population before the shortage = %d", first)
	}
	hs := houses(rep)
	if len(hs) != 8 || len(rep.Final.Islands[0].Buildings) != 9 {
		t.Fatalf("buildings = %d, houses %d", len(rep.Final.Islands[0].Buildings), len(hs))
	}
	for _, h := range hs {
		if *h.Residents != *h.ResidentsFloor || *h.GrowthRatePerMin != 0 || *h.SatisfactionPermille >= 500 {
			t.Errorf("house %d: residents %d rate %d satisfaction %d", h.ID, *h.Residents, *h.GrowthRatePerMin, *h.SatisfactionPermille)
		}
	}
	// The last day changes nothing but gold.
	n := len(rep.Snapshots)
	if a, b := rep.Snapshots[n-2].Population["settlers"], rep.Snapshots[n-1].Population["settlers"]; a != 16_000 || b != 16_000 {
		t.Errorf("population over the long advance %d -> %d", a, b)
	}
	checkGoldNonNegative(t, rep)
}

// TestInsolvency checks scenario (h): pause order (MECHANICS §7), resume in
// reverse order, unpaid status and gold >= 0.
func TestInsolvency(t *testing.T) {
	rep := runScenario(t, "insolvency")
	var pauses, resumes []string
	for _, e := range rep.PauseEvents {
		if e.Action == "auto_pause" {
			pauses = append(pauses, e.Type)
		} else {
			resumes = append(resumes, e.Type)
		}
	}
	want := []string{"weaver_wool", "lumberjack", "sawmill", "sheep_farm", "fisher"}
	if strings.Join(pauses, ",") != strings.Join(want, ",") {
		t.Errorf("pauses = %v, want %v", pauses, want)
	}
	slices.Reverse(want)
	if strings.Join(resumes, ",") != strings.Join(want, ",") {
		t.Errorf("resumes = %v, want %v", resumes, want)
	}
	for i := 1; i < 5; i++ {
		if rep.PauseEvents[i].At != rep.PauseEvents[0].At {
			t.Errorf("cascade not at one instant: %v", rep.PauseEvents[:5])
		}
	}
	// At 3 minutes all five are paused for insolvency and gold is zero.
	s := rep.Snapshots[1]
	if s.StatusesCount[sim.StatusPaused] != 5 || s.Gold != 0 {
		t.Errorf("snapshot %s: %+v gold %d", s.At, s.StatusesCount, s.Gold)
	}
	checkGoldNonNegative(t, rep)
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Paused {
			t.Errorf("%s still paused", b.Type)
		}
	}
	if rep.Final.BalanceRatePerMin < 0 {
		t.Errorf("final balance %d", rep.Final.BalanceRatePerMin)
	}
}

// TestWorkforceShort checks scenario (i): the workforce factor is
// pool/required for every producer and rises as houses are added.
func TestWorkforceShort(t *testing.T) {
	s := loadScenario(t, "workforce_short")
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	// Run the scenario up to each advance and inspect the display there.
	want := []int64{333, 666, 1000}
	k := 0
	for i, st := range s.Steps {
		if st.Advance == nil {
			continue
		}
		part := *s
		part.Steps = s.Steps[:i+1]
		rep, err := Run(&part, c)
		if err != nil {
			t.Fatal(err)
		}
		wf := rep.Final.Islands[0].Workforce["settlers"]
		if wf.Required != 12_000 || wf.Available != int64(4_000*(k+1)) || wf.FactorPermille != want[k] {
			t.Errorf("advance %d: workforce %+v", k, wf)
		}
		for _, b := range rep.Final.Islands[0].Buildings {
			if b.Workforce == nil {
				continue
			}
			if *b.WorkforceFactorPermille != want[k] {
				t.Errorf("advance %d: %s factor %d", k, b.Type, *b.WorkforceFactorPermille)
			}
			if b.Type == "sheep_farm" && (want[k] < 1000) != (b.Status == sim.StatusShortOfWorkers) {
				t.Errorf("advance %d: sheep farm status %s", k, b.Status)
			}
		}
		k++
	}
	rep := runScenario(t, "workforce_short")
	if got := rep.Snapshots[0].StatusesCount[sim.StatusShortOfWorkers]; got != 2 {
		t.Errorf("short_of_workers producers = %d", got)
	}
}

// TestOffline12hStalled checks scenario (j): one 12-hour Advance with a
// stalled food need keeps houses at their floor, gold at >= 0 and every good
// within capacity, without coarse mode and within the 50 ms budget.
func TestOffline12hStalled(t *testing.T) {
	rep := runScenario(t, "offline_12h_stalled")
	for _, h := range houses(rep) {
		if *h.Residents != *h.ResidentsFloor {
			t.Errorf("house %d residents %d", h.ID, *h.Residents)
		}
	}
	checkGoldNonNegative(t, rep)
	for good, g := range rep.Final.Islands[0].Inventory {
		if g.Stock+g.InTransit > g.Capacity || g.Stock < 0 {
			t.Errorf("%s = %+v", good, g)
		}
	}
	if rep.BoundaryCount > 50 {
		t.Errorf("%d boundaries", rep.BoundaryCount)
	}
	best, rep := bestAdvance(t, loadScenario(t, "offline_12h_stalled"))
	t.Logf("12h stalled advance: best of 3 = %s, boundaries = %d", best, rep.BoundaryCount)
	if best >= 50*time.Millisecond {
		t.Errorf("12h advance took %s, budget 50ms", best)
	}
}

// TestCitizensUnlock checks scenario (k): Citizens unlock exactly when the
// population reaches 120 and stay unlocked after the chapel is demolished.
func TestCitizensUnlock(t *testing.T) {
	rep := runScenario(t, "citizens_unlock")
	before, at := rep.Snapshots[1], rep.Snapshots[2]
	if before.Population["settlers"] != 105_000 || slices.Contains(before.UnlockedTiers, "citizens") {
		t.Errorf("before: %s population %d unlocked %v", before.At, before.Population["settlers"], before.UnlockedTiers)
	}
	if at.Population["settlers"] != 120_000 || !slices.Contains(at.UnlockedTiers, "citizens") || at.At != "2026-01-01T00:06:00.000Z" {
		t.Errorf("at: %s population %d unlocked %v", at.At, at.Population["settlers"], at.UnlockedTiers)
	}
	last := rep.Snapshots[len(rep.Snapshots)-1]
	cit := rep.Final.Tiers[1]
	if !slices.Contains(last.UnlockedTiers, "citizens") || cit.ID != "citizens" || !cit.Unlocked || cit.Buildings["chapel"] {
		t.Errorf("after demolishing the chapel: %v %+v", last.UnlockedTiers, cit)
	}
	checkGoldNonNegative(t, rep)
}

// TestTwelveHoursFifteenHouses measures one 12-hour Advance of the
// citizens_unlock town (15 growing houses, fisher, wool chain): boundary
// count and wall time (best of 3) within the 50 ms budget.
func TestTwelveHoursFifteenHouses(t *testing.T) {
	s := loadScenario(t, "citizens_unlock")
	var steps []Step
	for _, st := range s.Steps {
		if st.Advance == nil && st.Demolish == nil {
			steps = append(steps, st)
		}
	}
	s.Steps = append(steps, Step{Advance: &AdvanceStep{Duration: "12h"}})
	best, rep := bestAdvance(t, s)
	t.Logf("12h with 15 houses: best of 3 = %s, boundaries = %d", best, rep.BoundaryCount)
	if best >= 50*time.Millisecond || rep.BoundaryCount >= 10_000 {
		t.Errorf("12h advance took %s with %d boundaries, budget 50ms", best, rep.BoundaryCount)
	}
	if !slices.Contains(rep.Snapshots[0].UnlockedTiers, "citizens") {
		t.Error("citizens not unlocked")
	}
}

// TestBootstrapSettlers checks the tier-1 bootstrap from the content
// starting stock: Citizens unlock without deadlock and gold stays >= 0.
func TestBootstrapSettlers(t *testing.T) {
	s := loadScenario(t, "bootstrap_settlers")
	if !s.Seed.Start || s.Seed.Gold != "" || len(s.Seed.Stock) != 0 {
		t.Fatalf("seed = %+v, want the content starting stock only", s.Seed)
	}
	rep := runScenario(t, "bootstrap_settlers")
	if last := rep.Snapshots[len(rep.Snapshots)-1]; !slices.Contains(last.UnlockedTiers, "citizens") {
		t.Errorf("unlocked = %v", last.UnlockedTiers)
	}
	if g := rep.Totals["main"]["sails"].Granted; g != 10_000 {
		t.Errorf("sails granted = %d", g)
	}
	checkGoldNonNegative(t, rep)
}

func TestSeedStartExcludesGoldAndStock(t *testing.T) {
	s, err := Parse([]byte(`{
		"name": "bad", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": ["~~~~~~", "~cccc~", "~....~", "~....~", "~~~~~~"]},
		"seed": {"warehouse": {"x": 1, "y": 1}, "start": true, "gold": 5},
		"steps": []
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Run(s, loadCatalogue(t)); err == nil || !strings.Contains(err.Error(), "start excludes") {
		t.Fatalf("err = %v", err)
	}
}

// TestWorkforceGrantSeedOnly (R28a): workforce can be granted in the seed
// only. A step that tries to grant workforce does not parse, the Step type
// has no workforce field, and only BuildWorld (the seed) calls
// sim.GrantWorkforce.
func TestWorkforceGrantSeedOnly(t *testing.T) {
	_, err := Parse([]byte(`{
		"name": "bad", "start": "2026-01-01T00:00:00Z",
		"island": {"rows": ["~~~~~~", "~cccc~", "~....~", "~....~", "~~~~~~"]},
		"seed": {"warehouse": {"x": 1, "y": 1}},
		"steps": [{"workforce": {"settlers": 100}}]
	}`))
	if err == nil || !strings.Contains(err.Error(), "workforce") {
		t.Errorf("step with workforce parsed: %v", err)
	}
	if _, err := Parse([]byte(`{"name": "bad", "start": "2026-01-01T00:00:00Z", "island": {"rows": ["~"]},
		"seed": {"workforce": {"settlers": 1.5}}, "steps": []}`)); err == nil {
		t.Error("fractional workforce grant parsed")
	}
	st := reflect.TypeFor[Step]()
	for i := range st.NumField() {
		if f := st.Field(i); strings.Contains(strings.ToLower(f.Name+f.Tag.Get("json")), "workforce") {
			t.Errorf("Step has a workforce field %s", f.Name)
		}
	}
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, filepath.Join(repoRoot(t), "server", "internal", "sim", "scenario", "scenario.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		ast.Inspect(fn, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok && sel.Sel.Name == "GrantWorkforce" && fn.Name.Name != "BuildWorld" {
				t.Errorf("%s calls sim.GrantWorkforce", fn.Name.Name)
			}
			return true
		})
	}

	// The legacy scenarios use the shipped content plus the seed grant.
	for _, name := range []string{"chain_planks", "chain_planks_12h", "throttled_warehouse", "unconnected_producer", "warehouse_full"} {
		s := loadScenario(t, name)
		if s.Content != DefaultContent || s.Seed.Workforce["settlers"] != 1000 {
			t.Errorf("%s: content %s workforce %v", name, s.Content, s.Seed.Workforce)
		}
	}
}
