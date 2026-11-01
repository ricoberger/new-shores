package content

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// settlersServicesBuildings is the building list of the settlers' services
// need (content/old_coast/needs.json); the chain tests replace it by a
// chain need.
const settlersServicesBuildings = `"buildings": [{ "building": "market" }, { "building": "chapel" }]`

// TestLoadServiceChains (D-065): the chain buildings declare chain, rank
// and one radius; the categories of the security group carry the group.
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
	for _, id := range []string{"safety", "fire_protection", "health"} {
		if g := c.NeedCategoryByID[id].Group; g != "security" {
			t.Errorf("category %s group = %q, want security", id, g)
		}
	}
	if g := c.NeedCategoryByID["food"].Group; g != "" {
		t.Errorf("category food group = %q, want none", g)
	}
}

// TestLoadChainNeed: a chain need loads with chain and minimum rank and is a
// building need without alternatives.
func TestLoadChainNeed(t *testing.T) {
	dir := copyContent(t, FileNeeds, settlersServicesBuildings, `"chain": "faith", "min_rank": 1`)
	c, err := LoadWithSchemas(dir, filepath.Join(repoRoot(t), "content", "schema"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var found bool
	for _, n := range c.NeedsByTier["settlers"] {
		if n.ID == "settlers_services" {
			found = true
			if !n.IsChain() || !n.IsBuilding() || n.IsGoods() || n.Chain != "faith" || n.MinRank != 1 || len(n.Buildings) != 0 {
				t.Errorf("need = %+v", n)
			}
		}
	}
	if !found {
		t.Fatal("no settlers_services need")
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
			[]string{settlersServicesBuildings, `"chain": "faith", "min_rank": 4`},
			[]string{FileNeeds, `need "settlers_services"`, "min_rank", "1..3"},
		},
		{
			"unknown chain", FileNeeds,
			[]string{settlersServicesBuildings, `"chain": "choir", "min_rank": 1`},
			[]string{FileNeeds, `need "settlers_services"`, `unknown service chain "choir"`},
		},
		{
			"min-rank building above the need's tier", FileNeeds,
			[]string{settlersServicesBuildings, `"chain": "faith", "min_rank": 3`},
			[]string{FileNeeds, `need "settlers_services"`, `"cathedral" is of tier "patricians"`},
		},
		{
			"chain with buildings", FileNeeds,
			[]string{settlersServicesBuildings, `"chain": "faith", "min_rank": 1, ` + settlersServicesBuildings},
			[]string{FileNeeds, "schema violation"},
		},
		{
			"chain without min_rank", FileNeeds,
			[]string{settlersServicesBuildings, `"chain": "faith"`},
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
