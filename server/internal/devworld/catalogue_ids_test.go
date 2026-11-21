package devworld

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestFixturesUseCatalogueIDs (D-083): every dev fixture, the played one
// included, names only building, good, ship and quest IDs of the current
// catalogue in its stored world — buildings, plans, stock, cargo, routes,
// transit and quests — so that no fixture still holds a retired ID such
// as tools or the toolmaker. The decoder does not check this (a world of
// the current content version is trusted), so a fixture with a retired ID
// would load and only show the wrong world.
func TestFixturesUseCatalogueIDs(t *testing.T) {
	c := catalogue(t)
	// The walk finds a retired ID in each place it checks.
	var retired any
	if err := json.Unmarshal([]byte(`{"islands":[{"buildings":[{"type":"toolmaker","transit":[{"good":"tools"}]}],
		"inventory":{"stock":{"tools":1},"stock_sub":{"tools":1},"starved":{"tools":true}}}],
		"ships":[{"type":"no_such_ship","cargo":[{"good":"tools"}]}],"routes":[{"stops":[{"unload":["tools"]}]}],
		"quests":{"intro_tools":{}}}`), &retired); err != nil {
		t.Fatal(err)
	}
	if got, want := fmt.Sprint(unknownIDs(retired, "", c)), "[building toolmaker good tools quest intro_tools ship no_such_ship]"; got != want {
		t.Fatalf("unknownIDs of retired IDs = %s, want %s", got, want)
	}
	now := start.Add(48 * time.Hour).Truncate(time.Millisecond)
	for _, name := range Fixtures() {
		t.Run(name, func(t *testing.T) {
			opts := Options{}
			if name == FixturePlayed {
				if testing.Short() {
					t.Skip("replays the Patricians reference game")
				}
				opts.Scenarios = os.DirFS(scenarioDir(t))
			}
			w, err := NewFixtureWith(c, name, DevSeed, now, opts)
			if err != nil {
				t.Fatal(err)
			}
			data, err := sim.Encode(w, c.Region.Version)
			if err != nil {
				t.Fatal(err)
			}
			var env struct {
				World any `json:"world"`
			}
			if err := json.Unmarshal(data, &env); err != nil {
				t.Fatal(err)
			}
			if bad := unknownIDs(env.World, "", c); len(bad) > 0 {
				t.Errorf("IDs outside the catalogue: %v", bad)
			}
		})
	}
}

// unknownIDs walks a stored world's JSON and returns the content IDs that
// the catalogue does not define, as "kind id" (sorted, once each). parent
// is the key of the enclosing object or array.
func unknownIDs(v any, parent string, c *content.Catalogue) []string {
	seen := map[string]bool{}
	var walk func(v any, parent string)
	check := func(kind, id string) {
		ok := false
		switch kind {
		case "building":
			_, ok = c.BuildingByID[id]
		case "good":
			_, ok = c.GoodByID[id]
		case "ship":
			_, ok = c.ShipByID[id]
		case "quest":
			_, ok = c.QuestByID[id]
		}
		if !ok {
			seen[fmt.Sprintf("%s %s", kind, id)] = true
		}
	}
	walk = func(v any, parent string) {
		switch x := v.(type) {
		case map[string]any:
			for k, e := range x {
				switch {
				case k == "type" && (parent == "buildings" || parent == "plans"):
					if s, ok := e.(string); ok {
						check("building", s)
					}
				case k == "type" && parent == "ships":
					if s, ok := e.(string); ok {
						check("ship", s)
					}
				case k == "good":
					if s, ok := e.(string); ok {
						check("good", s)
					}
				case parent == "stock" || parent == "stock_sub" || parent == "starved":
					check("good", k)
				case parent == "quests":
					check("quest", k)
				case k == "unload":
					if a, ok := e.([]any); ok {
						for _, g := range a {
							if s, ok := g.(string); ok {
								check("good", s)
							}
						}
					}
				}
				walk(e, k)
			}
		case []any:
			for _, e := range x {
				walk(e, parent)
			}
		}
	}
	walk(v, parent)
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
