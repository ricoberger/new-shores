package content

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FileRegions is the region list at the content root (D-076): the
// regions in order, the home region first, and the passages between
// them.
const FileRegions = "regions.json"

// RegionEntry is one region of regions.json (D-076).
type RegionEntry struct {
	ID string
	// Prefix is the island ID prefix of the region's archipelago
	// (<prefix>-NN).
	Prefix string
	// Home marks the home region: every world starts there (the first
	// entry, exactly one).
	Home bool
	// Gate is the building that opens the region (D-076 §2), "" for the
	// home region.
	Gate string
	// Catalogue is the region's own catalogue (its folder); the home
	// entry's is the catalogue Load returns.
	Catalogue *Catalogue
}

// Passage is the off-map leg between two regions (D-076 §1): a fixed
// time in both directions, no path.
type Passage struct {
	From, To string
	// Ms is the passage time in milliseconds at scale 1.
	Ms int64
}

// RegionEntry returns the region entry with the given ID or nil.
func (c *Catalogue) RegionEntry(id string) *RegionEntry {
	for _, r := range c.Regions {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// HomeRegion returns the home region's entry (the first).
func (c *Catalogue) HomeRegion() *RegionEntry { return c.Regions[0] }

// PassageMs returns the passage time between the regions a and b (either
// direction) and whether a passage exists.
func (c *Catalogue) PassageMs(a, b string) (int64, bool) {
	for _, p := range c.Passages {
		if (p.From == a && p.To == b) || (p.From == b && p.To == a) {
			return p.Ms, true
		}
	}
	return 0, false
}

// defaultPrefix is the island ID prefix of a region loaded without a
// regions.json (a single region directory): the initials of its ID's
// words ("old_coast" -> "oc").
func defaultPrefix(id string) string {
	var b strings.Builder
	for w := range strings.SplitSeq(id, "_") {
		if w != "" {
			b.WriteByte(w[0])
		}
	}
	return b.String()
}

type rawRegions struct {
	Regions []struct {
		ID     string  `json:"id"`
		Prefix string  `json:"prefix"`
		Home   bool    `json:"home"`
		Gate   *string `json:"gate"`
	} `json:"regions"`
	Passages []struct {
		From    string      `json:"from"`
		To      string      `json:"to"`
		Minutes json.Number `json:"minutes"`
	} `json:"passages"`
}

// loadRoot loads a content root: regions.json, then every region folder
// it names (each validated on its own), then the merged goods (one ID
// space across the regions, D-076 §3: a good ID in two regions is an
// error). It returns the home region's catalogue.
func loadRoot(root, schemaDir string) (*Catalogue, error) {
	data, err := os.ReadFile(filepath.Join(root, FileRegions)) // #nosec G304 -- content paths come from trusted configuration.
	if err != nil {
		return nil, fmt.Errorf("content: %w", err)
	}
	if err := validateSchema(schemaDir, FileRegions, data); err != nil {
		return nil, err
	}
	var raw rawRegions
	if err := unmarshal(data, &raw); err != nil {
		return nil, &Error{File: FileRegions, Msg: fmt.Sprintf("decode: %v", err)}
	}
	col := &collector{}
	ids := map[string]bool{}
	prefixes := map[string]string{}
	var regions []*RegionEntry
	for i, r := range raw.Regions {
		ent := fmt.Sprintf("region %q", r.ID)
		if ids[r.ID] {
			col.add(FileRegions, ent, "id", "duplicate region ID")
			continue
		}
		ids[r.ID] = true
		if other, ok := prefixes[r.Prefix]; ok {
			col.add(FileRegions, ent, "prefix", "prefix %q is also region %q's", r.Prefix, other)
		}
		prefixes[r.Prefix] = r.ID
		if r.Home != (i == 0) {
			col.add(FileRegions, ent, "home", "the first region is the home region, and only it")
		}
		gate := ""
		if r.Gate != nil {
			gate = *r.Gate
		}
		if (gate == "") != r.Home {
			col.add(FileRegions, ent, "gate", "the home region has no gate, every other region has one")
		}
		dir := filepath.Join(root, r.ID)
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			col.add(FileRegions, ent, "id", "no region folder %s", r.ID)
			continue
		}
		regions = append(regions, &RegionEntry{ID: r.ID, Prefix: r.Prefix, Home: r.Home, Gate: gate})
	}
	var passages []Passage
	for _, p := range raw.Passages {
		ent := fmt.Sprintf("passage %s-%s", p.From, p.To)
		if !ids[p.From] || !ids[p.To] || p.From == p.To {
			col.add(FileRegions, ent, "", "a passage joins two different listed regions")
		}
		for _, q := range passages {
			if (q.From == p.From && q.To == p.To) || (q.From == p.To && q.To == p.From) {
				col.add(FileRegions, ent, "", "duplicate passage")
			}
		}
		ms := col.fixed(FileRegions, ent, "minutes", p.Minutes, 3) * 60
		passages = append(passages, Passage{From: p.From, To: p.To, Ms: ms})
	}
	if err := col.err(); err != nil {
		return nil, err
	}

	var errs []error
	for _, r := range regions {
		c, err := loadRegion(filepath.Join(root, r.ID), schemaDir)
		if err != nil {
			errs = append(errs, fmt.Errorf("region %s: %w", r.ID, err))
			continue
		}
		if c.Region.ID != r.ID {
			errs = append(errs, &Error{File: r.ID + "/" + FileRegion, Entity: fmt.Sprintf("region %q", c.Region.ID), Field: "id", Msg: fmt.Sprintf("must be %q (its folder)", r.ID)})
			continue
		}
		c.Region.Prefix = r.Prefix
		r.Catalogue = c
	}
	if len(errs) > 0 {
		return nil, errors.Join(errs...)
	}

	home := regions[0].Catalogue
	owner := map[string]string{}
	for _, g := range home.Goods {
		owner[g.ID] = home.Region.ID
	}
	for _, r := range regions[1:] {
		for _, g := range r.Catalogue.Goods {
			if other, ok := owner[g.ID]; ok {
				col.add(r.ID+"/"+FileGoods, fmt.Sprintf("good %q", g.ID), "id", "duplicate good ID: also a good of region %q (goods are global, D-076)", other)
				continue
			}
			owner[g.ID] = r.ID
			home.Goods = append(home.Goods, g)
			home.GoodByID[g.ID] = g
		}
	}
	for _, r := range regions {
		if r.Gate == "" {
			continue
		}
		found := false
		for _, o := range regions {
			if o.Catalogue.BuildingByID[r.Gate] != nil {
				found = true
			}
		}
		if !found {
			col.add(FileRegions, fmt.Sprintf("region %q", r.ID), "gate", "unknown building %q", r.Gate)
		}
	}
	if err := col.err(); err != nil {
		return nil, err
	}
	for _, r := range regions {
		r.Catalogue.Regions = regions
		r.Catalogue.Passages = passages
	}
	return home, nil
}
