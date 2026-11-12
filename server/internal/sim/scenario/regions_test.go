package scenario

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// TestReferenceGamesOneRegion: the reference games (D-067, generated from
// the plans) play in the home region of D-076 — the final payload lists
// the one region old_coast with the archipelago's seed, and every island, ship and
// route stop names it; the replayed scenarios and goldens use only
// region-prefixed generated island IDs.
func TestReferenceGamesOneRegion(t *testing.T) {
	generated := regexp.MustCompile(`"[a-z]+-\d\d"`)
	for _, name := range []string{"bootstrap_settlers", "bootstrap_citizens", "bootstrap_citizens_quests", "bootstrap_merchants", "bootstrap_patricians"} {
		t.Run(name, func(t *testing.T) {
			for _, f := range []string{name + ".json", name + ".golden.json"} {
				data, err := os.ReadFile(filepath.Join(scenarioDir(t), f)) // #nosec G304 -- test fixture path.
				if err != nil {
					t.Fatal(err)
				}
				for _, id := range generated.FindAll(data, -1) {
					if !regexp.MustCompile(`^"oc-\d\d"$`).Match(id) {
						t.Fatalf("%s: island ID %s without the old_coast prefix", f, id)
					}
				}
				if f == name+".json" {
					continue
				}
				var rep struct {
					Final struct {
						Archipelago struct {
							Seed uint64 `json:"seed"`
						} `json:"archipelago"`
						Regions []struct {
							ID       string `json:"id"`
							Unlocked bool   `json:"unlocked"`
							Seed     uint64 `json:"seed"`
						} `json:"regions"`
						Islands []struct {
							ID       string `json:"id"`
							RegionID string `json:"region_id"`
						} `json:"islands"`
						Ships []struct {
							ID       int64   `json:"id"`
							RegionID *string `json:"region_id"`
						} `json:"ships"`
						Routes []struct {
							Stops []struct {
								RegionID string `json:"region_id"`
							} `json:"stops"`
						} `json:"routes"`
					} `json:"final"`
				}
				if err := json.Unmarshal(data, &rep); err != nil {
					t.Fatal(err)
				}
				fin := rep.Final
				if len(fin.Regions) != 1 || fin.Regions[0].ID != "old_coast" || !fin.Regions[0].Unlocked || fin.Regions[0].Seed != fin.Archipelago.Seed {
					t.Fatalf("regions %+v", fin.Regions)
				}
				for _, is := range fin.Islands {
					if is.RegionID != "old_coast" {
						t.Fatalf("island %s in region %q", is.ID, is.RegionID)
					}
				}
				for _, s := range fin.Ships {
					if s.RegionID == nil || *s.RegionID != "old_coast" {
						t.Fatalf("ship %d in region %v", s.ID, s.RegionID)
					}
				}
				for _, r := range fin.Routes {
					for _, st := range r.Stops {
						if st.RegionID != "old_coast" {
							t.Fatalf("route stop in region %q", st.RegionID)
						}
					}
				}
			}
		})
	}
}
