package content

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// settlersFaith is the chain part of the settlers' faith need
// (content/old_coast/needs.json); the chain tests vary it.
const settlersFaith = `"chain": "faith",
    "min_rank": 1`

// TestLoadServiceChains (D-065): the chain buildings declare chain, rank
// and one radius; every category carries its display group (goods or
// public buildings).
func TestLoadServiceChains(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := map[string]struct {
		chain  string
		rank   int
		radius int
	}{
		"chapel": {"faith", 1, 16}, "church": {"faith", 2, 20}, "cathedral": {"faith", 3, 28},
		"school": {"education", 1, 16}, "university": {"education", 2, 24},
		"tavern": {"culture", 1, 14}, "playhouse": {"culture", 2, 24},
	}
	for id, w := range want {
		s := c.BuildingByID[id].Service
		if s == nil || s.Chain != w.chain || s.Rank != w.rank || len(s.Levels) != 1 || s.RadiusAt(1) != w.radius {
			t.Errorf("%s service = %+v, want %+v", id, s, w)
		}
	}
	groups := map[string]string{
		"food": "goods", "drink": "goods", "clothing": "goods", "comfort": "goods", "luxury": "goods",
		"market": "public", "faith": "public", "education": "public", "culture": "public",
		"safety": "public", "fire_protection": "public", "health": "public",
	}
	if len(c.NeedCategories) != len(groups) {
		t.Errorf("%d need categories, want %d", len(c.NeedCategories), len(groups))
	}
	for id, want := range groups {
		if g := c.NeedCategoryByID[id].Group; g != want {
			t.Errorf("category %s group = %q, want %s", id, g, want)
		}
	}
}

// TestLoadChainNeed: the chain needs load with chain and minimum rank, as a
// building need without alternatives; D-065 ladder per tier.
func TestLoadChainNeed(t *testing.T) {
	c, err := Load(filepath.Join(repoRoot(t), "content", "old_coast"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := map[string]string{
		"settlers_faith": "faith>=1",
		"citizens_faith": "faith>=1", "citizens_education": "education>=1", "citizens_culture": "culture>=1",
		"merchants_faith": "faith>=2", "merchants_education": "education>=1", "merchants_culture": "culture>=2",
		"patricians_faith": "faith>=3", "patricians_education": "education>=2", "patricians_culture": "culture>=2",
	}
	seen := 0
	for _, needs := range c.NeedsByTier {
		for _, n := range needs {
			if !n.IsChain() {
				continue
			}
			seen++
			if got := needBuildings(n); got != want[n.ID] || !n.IsBuilding() || n.IsGoods() || len(n.Buildings) != 0 || n.Chain != n.Category {
				t.Errorf("%s = %s (category %s), want %s", n.ID, got, n.Category, want[n.ID])
			}
		}
	}
	if seen != len(want) {
		t.Errorf("%d chain needs, want %d", seen, len(want))
	}
}

// TestLoadRejectsInvalidChains (D-065): rank, chain and min_rank rules of
// the loader and the schemas.
func TestLoadRejectsInvalidChains(t *testing.T) {
	schemaDir := filepath.Join(repoRoot(t), "content", "schema")
	chain := func(c string, rank, radius int) string {
		return `"service": { "chain": "` + c + `", "rank": ` + strconv.Itoa(rank) + `, "radius": ` + strconv.Itoa(radius) + ` }`
	}
	tests := []struct {
		name    string
		file    string
		replace []string
		want    []string
	}{
		{
			"duplicate rank", FileBuildings,
			[]string{chain("faith", 2, 20), chain("faith", 1, 20)},
			[]string{FileBuildings, `building "church"`, "rank 1 of chain \"faith\" is already taken"},
		},
		{
			"rank gap", FileBuildings,
			[]string{chain("faith", 3, 28), chain("faith", 4, 28)},
			[]string{FileBuildings, `chain "faith"`, "contiguous from 1: rank 3 is missing"},
		},
		{
			"chain starts at 2", FileBuildings,
			[]string{chain("culture", 1, 14), chain("culture", 3, 14)},
			[]string{FileBuildings, `chain "culture"`, "rank 1 is missing"},
		},
		{
			"rank without chain", FileBuildings,
			[]string{chain("culture", 1, 14), `"service": { "rank": 1, "radius": 14 }`},
			[]string{FileBuildings, "schema violation"},
		},
		{
			"chain with levels", FileBuildings,
			[]string{chain("culture", 1, 14), `"service": { "chain": "culture", "rank": 1, "levels": [{ "radius": 14 }] }`},
			[]string{FileBuildings, "schema violation"},
		},
		{
			"min_rank beyond the chain", FileNeeds,
			[]string{settlersFaith, `"chain": "faith", "min_rank": 4`},
			[]string{FileNeeds, `need "settlers_faith"`, "min_rank", "1..3"},
		},
		{
			"unknown chain", FileNeeds,
			[]string{settlersFaith, `"chain": "choir", "min_rank": 1`},
			[]string{FileNeeds, `need "settlers_faith"`, `unknown service chain "choir"`},
		},
		{
			"min-rank building above the need's tier", FileNeeds,
			[]string{settlersFaith, `"chain": "faith", "min_rank": 3`},
			[]string{FileNeeds, `need "settlers_faith"`, `"cathedral" is of tier "patricians"`},
		},
		{
			"chain with buildings", FileNeeds,
			[]string{settlersFaith, settlersFaith + `, "buildings": [{ "building": "market" }]`},
			[]string{FileNeeds, "schema violation"},
		},
		{
			"chain without min_rank", FileNeeds,
			[]string{settlersFaith, `"chain": "faith"`},
			[]string{FileNeeds, "schema violation"},
		},
		{
			"unknown warehouse tier", FileBuildings,
			[]string{`"cost": { "gold": 150, "planks": 10, "stone": 5 }`, `"tier": "dukes", "cost": { "gold": 150, "planks": 10, "stone": 5 }`},
			[]string{FileBuildings, `building "warehouse"`, "warehouse.levels[1].tier"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := copyContent(t, tt.file, tt.replace...)
			_, err := LoadWithSchemas(dir, schemaDir)
			if err == nil {
				t.Fatal("Load succeeded, want error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not contain %q", err, w)
				}
			}
		})
	}
}
