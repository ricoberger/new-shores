package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func contentRoot(t *testing.T) string {
	t.Helper()
	return filepath.Join(repoRoot(t), "content")
}

// TestShippedRegions: the shipped content root lists the one home region
// old_coast with prefix "oc", no gate and no passages (D-076 §6).
func TestShippedRegions(t *testing.T) {
	c, err := Load(contentRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Regions) != 1 {
		t.Fatalf("regions %d, want 1", len(c.Regions))
	}
	r := c.Regions[0]
	if r.ID != "old_coast" || r.Prefix != "oc" || !r.Home || r.Gate != "" || r.Catalogue != c {
		t.Fatalf("home region %+v", r)
	}
	if c.HomeRegion() != r || c.RegionEntry("old_coast") != r || c.RegionEntry("south") != nil {
		t.Fatal("region lookups")
	}
	if c.Region.Prefix != "oc" || len(c.Passages) != 0 {
		t.Fatalf("prefix %q, passages %v", c.Region.Prefix, c.Passages)
	}
	if _, ok := c.PassageMs("old_coast", "south"); ok {
		t.Fatal("passage without a second region")
	}
}

// TestRegionDirDefaultPrefix: a region directory without regions.json is
// its catalogue's only region, prefixed by its ID's initials.
func TestRegionDirDefaultPrefix(t *testing.T) {
	c, err := Load(filepath.Join(contentRoot(t), "old_coast"))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Regions) != 1 || c.Region.Prefix != "oc" || !c.Regions[0].Home {
		t.Fatalf("regions %+v prefix %q", c.Regions, c.Region.Prefix)
	}
	if got := defaultPrefix("north_sea_isles"); got != "nsi" {
		t.Fatalf("defaultPrefix %q", got)
	}
}

func loadTestRegions(t *testing.T, root string) (*Catalogue, error) {
	t.Helper()
	return LoadWithSchemas(root, filepath.Join(contentRoot(t), "schema"))
}

// TestRegionsMergeGoods: a second region's goods join the home
// catalogue's goods (one ID space, D-076 §3); every region keeps its own
// catalogue and the passage time is in milliseconds.
func TestRegionsMergeGoods(t *testing.T) {
	c, err := loadTestRegions(t, filepath.Join("testdata", "regions"))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Regions) != 2 || c.Regions[1].ID != "south" || c.Regions[1].Prefix != "so" || c.Regions[1].Gate != "sawmill" {
		t.Fatalf("regions %+v", c.Regions)
	}
	south := c.Regions[1].Catalogue
	if south.Region.ID != "south" || south.Region.Prefix != "so" || len(south.Regions) != 2 {
		t.Fatalf("south catalogue %+v", south.Region)
	}
	if c.GoodByID["wood"] == nil || c.GoodByID["wood_s"] == nil || len(c.Goods) != 14 {
		t.Fatalf("merged goods %d", len(c.Goods))
	}
	if ms, ok := c.PassageMs("south", "old_coast"); !ok || ms != 600_000 {
		t.Fatalf("passage %d %v", ms, ok)
	}
}

// copyTree copies the test region tree into a temporary directory.
func copyTree(t *testing.T, src string) string {
	t.Helper()
	dst := t.TempDir()
	if err := os.CopyFS(dst, os.DirFS(src)); err != nil {
		t.Fatal(err)
	}
	return dst
}

// TestRegionsErrors: a good ID in two regions, a missing region folder,
// an unknown gate and a passage to an unlisted region are content errors.
func TestRegionsErrors(t *testing.T) {
	cases := []struct {
		name, want string
		edit       func(root string)
	}{
		{"duplicate good", `south/goods.json: good "wood": id: duplicate good ID: also a good of region "old_coast"`, func(root string) {
			files, _ := filepath.Glob(filepath.Join(root, "south", "*.json"))
			for _, f := range files {
				data, _ := os.ReadFile(f)                                                                  // #nosec G304 -- test data
				_ = os.WriteFile(f, []byte(strings.ReplaceAll(string(data), `"wood_s"`, `"wood"`)), 0o600) // #nosec G703 -- test data
			}
		}},
		{"missing folder", `regions.json: region "south": id: no region folder south`, func(root string) {
			_ = os.RemoveAll(filepath.Join(root, "south"))
		}},
		{"unknown gate", `regions.json: region "south": gate: unknown building "kontor"`, func(root string) {
			rewrite(t, filepath.Join(root, FileRegions), `"sawmill"`, `"kontor"`)
		}},
		{"passage", `regions.json: passage old_coast-east: a passage joins two different listed regions`, func(root string) {
			rewrite(t, filepath.Join(root, FileRegions), `"to": "south"`, `"to": "east"`)
		}},
		{"two homes", `regions.json: region "south": home: the first region is the home region, and only it`, func(root string) {
			rewrite(t, filepath.Join(root, FileRegions), `"home": false`, `"home": true`)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := copyTree(t, filepath.Join("testdata", "regions"))
			tc.edit(root)
			_, err := loadTestRegions(t, root)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %v, want %q", err, tc.want)
			}
		})
	}
}

func rewrite(t *testing.T, path, old, repl string) {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- test data
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Replace(string(data), old, repl, 1)), 0o600); err != nil { // #nosec G703 -- test data
		t.Fatal(err)
	}
}
