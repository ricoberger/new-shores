package scenario

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"go/ast"
	"go/parser"
	"go/token"
	"maps"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
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
	if dLJ != 5 || dSM != 11 || *lj.TransferDelayMs != 15_000 || *sm.TransferDelayMs != 21_000 {
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
	// Snapshots: wood arrives only after 10 + d_lj seconds (15 s), planks
	// after a further 10 + d_sm seconds (36 s).
	snap := func(i int) map[string]GoodAmount { return rep.Snapshots[i].Inventory["main"] }
	if snap(0)["planks"].Stock != 0 || snap(0)["wood"].InTransit == 0 { // t = 14 s
		t.Errorf("t=14s: %+v", snap(0))
	}
	if snap(2)["planks"].Stock != 0 || snap(2)["planks"].InTransit == 0 { // t = 36 s
		t.Errorf("t=36s: %+v", snap(2))
	}
	if snap(3)["planks"].Stock == 0 { // t = 37 s
		t.Errorf("t=37s: %+v", snap(3))
	}
}

func TestThrottledWarehouse(t *testing.T) {
	rep := runScenario(t, "throttled_warehouse")
	// R = 32 lumberjacks x 2 wood/min = 64/min over the level-1
	// throughput T: factor T/R, load R/T (per-mille, rounded down).
	const r = 64_000
	tp := loadCatalogue(t).BuildingByID["warehouse"].Warehouse.Levels[0].ThroughputPerMin
	n := 0
	for _, b := range rep.Final.Islands[0].Buildings {
		switch b.Type {
		case "lumberjack":
			n++
			if b.Status != sim.StatusThrottled || b.ThroughputFactorPermille != tp*1000/r || b.EfficiencyPermille != 1000 {
				t.Errorf("lumberjack %d: status %s factor %d eff %d", b.ID, b.Status, b.ThroughputFactorPermille, b.EfficiencyPermille)
			}
			if got := b.Rates.Outputs["wood"]; got != 2000*tp/r {
				t.Errorf("lumberjack %d rate = %d", b.ID, got)
			}
		case "warehouse":
			if *b.LoadPermille != r*1000/tp {
				t.Errorf("warehouse load = %d, want %d", *b.LoadPermille, r*1000/tp)
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

// runUntilAdvance runs a scenario up to and including its k-th advance step
// (0-based) and returns the report, whose final display is the state there.
func runUntilAdvance(t *testing.T, name string, k int) *Report {
	t.Helper()
	s := loadScenario(t, name)
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	for i, st := range s.Steps {
		if st.Advance == nil {
			continue
		}
		if k == 0 {
			s.Steps = s.Steps[:i+1]
			rep, err := Run(s, c)
			if err != nil {
				t.Fatal(err)
			}
			return rep
		}
		k--
	}
	t.Fatalf("%s has too few advance steps", name)
	return nil
}

func foodNeed(t *testing.T, h sim.BuildingDisplay) sim.NeedDisplay {
	t.Helper()
	for _, n := range h.Needs {
		if n.Category == "food" {
			return n
		}
	}
	t.Fatalf("house %d has no food need", h.ID)
	return sim.NeedDisplay{}
}

// TestFishShort checks scenario (g): with the markets gone, a fisher that
// covers only part of the fish demand leaves food fulfilment between 0 and 1
// and satisfaction below 0.5, so residents decline; without the fisher
// fulfilment is 0 and residents decline to their floor and stay there;
// nothing but the demolished buildings disappears (D-009).
func TestFishShort(t *testing.T) {
	rep := runScenario(t, "fish_short")
	pops := make([]int64, len(rep.Snapshots))
	for i, s := range rep.Snapshots {
		pops[i] = s.Population["settlers"]
		if pops[i] < 24*2_000 {
			t.Errorf("%s: population %d below the floor of 24 houses", s.At, pops[i])
		}
		if i > 0 && pops[i] > pops[i-1] {
			t.Errorf("%s: population grew %d -> %d", s.At, pops[i-1], pops[i])
		}
	}
	if pops[0] != 192_000 {
		t.Errorf("population before the shortage = %d", pops[0])
	}

	// Phase 1 (after 1h10m): fish starved with arrivals, partial supply.
	p1 := runUntilAdvance(t, "fish_short", 1)
	fish := p1.Final.Islands[0].Inventory["fish"]
	if fish.Stock != 0 || fish.InTransit == 0 {
		t.Errorf("phase 1 fish = %+v, want empty stock with arrivals", fish)
	}
	for _, h := range houses(p1) {
		food := foodNeed(t, h)
		if food.FulfilmentPermille <= 0 || food.FulfilmentPermille >= 1000 || food.Reason != sim.NeedShortSupply || food.Goods["fish"] <= 0 {
			t.Errorf("phase 1 house %d food = %+v", h.ID, food)
		}
		if *h.SatisfactionPermille >= 500 || *h.GrowthRatePerMin >= 0 {
			t.Errorf("phase 1 house %d: satisfaction %d growth %d", h.ID, *h.SatisfactionPermille, *h.GrowthRatePerMin)
		}
	}
	if pops[2] >= pops[1] {
		t.Errorf("no decline during partial supply: %d -> %d", pops[1], pops[2])
	}

	// Phase 2: no fish at all; residents at the floor and staying there.
	n := len(rep.Snapshots)
	if pops[n-2] != 48_000 || pops[n-1] != 48_000 {
		t.Errorf("phase 2 population %d -> %d, want the floor 48000", pops[n-2], pops[n-1])
	}
	hs := houses(rep)
	if len(hs) != 24 || len(rep.Final.Islands[0].Buildings) != 25 {
		t.Fatalf("buildings = %d, houses %d", len(rep.Final.Islands[0].Buildings), len(hs))
	}
	for _, h := range hs {
		food := foodNeed(t, h)
		if *h.Residents != *h.ResidentsFloor || *h.GrowthRatePerMin != 0 || food.FulfilmentPermille != 0 || food.Reason != sim.NeedNoSupply {
			t.Errorf("phase 2 house %d: residents %d rate %d food %+v", h.ID, *h.Residents, *h.GrowthRatePerMin, food)
		}
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
	// Need goods first, then intermediates by upkeep (lumberjack and sheep
	// farm 1 gold/min by ID, sawmill 2), then tier-1 food.
	want := []string{"weaver_wool", "lumberjack", "sheep_farm", "sawmill", "fisher"}
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
	// At 3 minutes all five are paused for insolvency; nothing that still
	// runs has upkeep, so the balance is not negative and gold grows again
	// from the floor taxes.
	s := rep.Snapshots[1]
	if s.StatusesCount[sim.StatusPaused] != 5 || s.Gold <= 0 || s.BalanceRatePerMin < 0 {
		t.Errorf("snapshot %s: %+v gold %d balance %d", s.At, s.StatusesCount, s.Gold, s.BalanceRatePerMin)
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

// TestSeedWorkforceBounds (R28a, R34): seed.workforce is validated in whole
// residents before conversion to milli-residents; negative counts and
// counts whose milli-resident value does not fit into an int64 are rejected
// with sim.ErrInvalidCommand instead of wrapping around.
func TestSeedWorkforceBounds(t *testing.T) {
	c := loadCatalogue(t)
	build := func(n string) (*sim.World, error) {
		t.Helper()
		s, err := Parse([]byte(`{"name": "grant", "start": "2026-01-01T00:00:00Z",
			"island": {"rows": ["~~~~~~", "~cccc~", "~....~", "~....~", "~~~~~~"]},
			"seed": {"warehouse": {"x": 1, "y": 1}, "workforce": {"settlers": ` + n + `}}, "steps": []}`))
		if err != nil {
			t.Fatalf("parse %s: %v", n, err)
		}
		return BuildWorld(s, c, nil)
	}
	limit := int64(math.MaxInt64 / 1000)
	for _, n := range []string{"-9223372036854775808", "-1", strconv.FormatInt(limit+1, 10), "9223372036854775807"} {
		if w, err := build(n); !errors.Is(err, sim.ErrInvalidCommand) || w != nil {
			t.Errorf("workforce %s: world %v err %v, want ErrInvalidCommand", n, w != nil, err)
		}
	}
	w, err := build(strconv.FormatInt(limit, 10))
	if err != nil || w.Islands[0].WorkforceGrant["settlers"] != limit*1000 {
		t.Fatalf("largest grant: %v %v", err, w)
	}
	// A further grant that would overflow is rejected and changes nothing.
	before, _ := sim.Encode(w, "x")
	if err := sim.GrantWorkforce(w, c, w.Islands[0].ID, "settlers", 1000*1000); !errors.Is(err, sim.ErrInvalidCommand) {
		t.Errorf("overflowing grant: %v", err)
	}
	if after, _ := sim.Encode(w, "x"); !bytes.Equal(before, after) {
		t.Error("world changed on error")
	}
	// The saturated pool still yields a valid display.
	if ds, err := sim.Display(w, c, w.LastEvaluatedAt); err != nil || ds.Islands[0].Workforce["settlers"].FactorPermille != 1000 {
		t.Errorf("display: %v %+v", err, ds.Islands[0].Workforce)
	}
	if w, err := build("0"); err != nil || len(w.Islands[0].WorkforceGrant) != 0 {
		t.Errorf("zero grant: %v %v", err, w.Islands[0].WorkforceGrant)
	}
}

// stepRunner returns a runner for a scenario before its first step, so
// that tests can inspect the world between steps.
func stepRunner(t *testing.T, name string) *runner {
	t.Helper()
	s := loadScenario(t, name)
	c, err := s.LoadContent(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	l := sim.NewLedger()
	w, err := BuildWorld(s, c, l)
	if err != nil {
		t.Fatal(err)
	}
	return &runner{s: s, c: c, w: w, l: l, report: &Report{Name: s.Name}}
}

// runSteps executes the steps [from, to) of the runner's scenario.
func (r *runner) runSteps(t *testing.T, from, to int) {
	t.Helper()
	for i := from; i < to; i++ {
		if err := r.step(i, r.s.Steps[i]); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}
}

func (r *runner) mustDisplay(t *testing.T) sim.DisplayState {
	t.Helper()
	ds, err := r.display()
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

// TestPlaceThenRoad checks scenario (l): a producer placed without a road
// is not connected and buffers its output; once a road reaches its
// footprint edge it is assigned, the buffer drains and nothing is lost.
func TestPlaceThenRoad(t *testing.T) {
	r := stepRunner(t, "place_then_road")
	r.runSteps(t, 0, 2) // place without road, advance 2 min
	lj := r.island().Building(2)
	if lj == nil || lj.Type != "lumberjack" || lj.AssignedWarehouseID != 0 || lj.Buffer["wood"] <= 0 {
		t.Fatalf("before the road: %+v", lj)
	}
	if b := r.mustDisplay(t).Islands[0].Buildings[1]; b.Status != sim.StatusNotConnected || *b.AssignedWarehouseID != 0 {
		t.Errorf("before the road: status %s assigned %d", b.Status, *b.AssignedWarehouseID)
	}
	r.runSteps(t, 2, 3) // road to the west edge of the footprint
	if lj.AssignedWarehouseID != 1 || lj.RoadDistance != 7 {
		t.Fatalf("after the road: assigned %d distance %d", lj.AssignedWarehouseID, lj.RoadDistance)
	}
	r.runSteps(t, 3, len(r.s.Steps))
	if lj.Buffer != nil || lj.BufferSub != nil {
		t.Errorf("buffer not drained: %v %v", lj.Buffer, lj.BufferSub)
	}
	f := r.l.Flow("main", "wood")
	if f.Lost != 0 {
		t.Errorf("lost %d", f.Lost)
	}
	// Produced (sub-milli) = island stock + in transit: compare via the
	// rounded display, which rounds each part to the nearest milli-unit.
	rep := runScenario(t, "place_then_road")
	wood := rep.Final.Islands[0].Inventory["wood"]
	if got, want := wood.Stock+wood.InTransit, rep.Totals["main"]["wood"].Produced; got < want-1 || got > want+1 || want == 0 {
		t.Errorf("stock %d + in transit %d, produced %d", wood.Stock, wood.InTransit, want)
	}
}

// TestMoveWithTransit checks scenario (m): moving a connected producer
// keeps its ID, cycle progress, buffer and goods in transit, which still
// arrive in full; the producer is connected at the new position with the
// new road distance and delay.
func TestMoveWithTransit(t *testing.T) {
	r := stepRunner(t, "move_with_transit")
	r.runSteps(t, 0, 3) // road, place, advance 30 s
	lj := r.island().Building(2)
	if lj == nil || lj.Type != "lumberjack" || lj.RoadDistance != 5 || lj.TransferDelayMs != 15_000 {
		t.Fatalf("before the move: %+v", lj)
	}
	progress, transit := lj.Progress, slices.Clone(lj.Transit)
	buffer := maps.Clone(lj.Buffer)
	before := r.mustDisplay(t).Islands[0].Inventory["wood"]
	if before.InTransit == 0 {
		t.Fatal("nothing in transit before the move")
	}
	gold := r.w.Gold

	r.runSteps(t, 3, 4) // move
	moved := r.island().Building(2)
	if moved != lj || lj.X != 9 || lj.Y != 5 || lj.Rotation != 90 || lj.Progress != progress ||
		!reflect.DeepEqual(lj.Transit, transit) || !maps.Equal(lj.Buffer, buffer) || len(r.island().Buildings) != 2 {
		t.Fatalf("after the move: %+v", lj)
	}
	if after := r.mustDisplay(t).Islands[0].Inventory["wood"]; after != before || r.w.Gold != gold {
		t.Errorf("move changed wood %+v -> %+v or gold %d -> %d", before, after, gold, r.w.Gold)
	}
	if lj.AssignedWarehouseID != 1 || lj.RoadDistance != 6 || lj.TransferDelayMs != 16_000 {
		t.Errorf("connection after the move: %d d %d delay %d", lj.AssignedWarehouseID, lj.RoadDistance, lj.TransferDelayMs)
	}

	r.runSteps(t, 4, len(r.s.Steps))
	final := r.mustDisplay(t)
	if got := final.Islands[0].Inventory["wood"].Stock - before.Stock; got < before.InTransit {
		t.Errorf("stock increased by %d, want >= %d in transit at the move", got, before.InTransit)
	}
	if b := final.Islands[0].Buildings[1]; b.Status == sim.StatusNotConnected || *b.AssignedWarehouseID != 1 {
		t.Errorf("final lumberjack: %s assigned %d", b.Status, *b.AssignedWarehouseID)
	}
	if f := r.l.Flow("main", "wood"); f.Lost != 0 {
		t.Errorf("lost %d", f.Lost)
	}
}
