package content

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Archipelago generator content (D-053): islands.json and island_names.json.
const (
	FileIslands     = "islands.json"
	FileIslandNames = "island_names.json"
)

// MaxIslandNameRunes bounds island names, from the word list and from
// rename_island (D-053 part 5): 1 to 24 printable runes.
const MaxIslandNameRunes = 24

// Range is an inclusive integer range.
type Range struct {
	Min int
	Max int
}

// Contains reports whether v lies in the range.
func (r Range) Contains(v int) bool { return v >= r.Min && v <= r.Max }

// SizeClass is one island size class of the archipelago (islands.json).
type SizeClass struct {
	ID   string
	Name string
	// Size is the land extent in tiles (the island is about Size x Size).
	Size int
	// Rock marks resource rocks: mountain and coast only, no fertility.
	Rock bool
	// Count is the number of islands of the class per archipelago.
	Count Range
	// Fertilities and Deposits are the per-island ranges of fertility tags
	// and deposit slots.
	Fertilities Range
	Deposits    Range
}

// PoolEntry is a fertility or deposit of the generator's pool with the
// number of times it appears per archipelago (fertility: islands carrying
// the tag; deposit: slots).
type PoolEntry struct {
	ID    string
	Count Range
}

// HomeRule describes the guaranteed home candidate (D-053 part 1).
type HomeRule struct {
	SizeClass string
	// Terrain lists terrain the island must have (forest, grass).
	Terrain []string
	// Deposits lists deposit kinds the island must have.
	Deposits []string
	// FertilitiesAny: the island has at least one of them (empty: no rule).
	FertilitiesAny  []string
	FertilitiesNone []string
	DepositsNone    []string
}

// IslandRules are the archipelago generator rules of a region.
type IslandRules struct {
	// SizeClasses in file order.
	SizeClasses   []*SizeClass
	SizeClassByID map[string]*SizeClass
	Fertilities   []PoolEntry
	Deposits      []PoolEntry
	// BuildableTarget is the target number of buildable tiles (coast,
	// grass, forest) of the archipelago; BuildableTolerance the allowed
	// relative deviation in per-mille.
	BuildableTarget    int
	BuildableTolerance int64
	// SpacingMin is the minimum gap between the grids of two islands,
	// NearestMax the maximum gap from every island to its nearest one.
	SpacingMin int
	NearestMax int
	Home       HomeRule
}

// BuildableRange returns the inclusive range of buildable tiles allowed
// by the target and tolerance.
func (r *IslandRules) BuildableRange() Range {
	d := int64(r.BuildableTarget) * r.BuildableTolerance / 1000
	return Range{Min: r.BuildableTarget - int(d), Max: r.BuildableTarget + int(d)}
}

type rawRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type rawPoolEntry struct {
	ID    string   `json:"id"`
	Count rawRange `json:"count"`
}

type rawIslands struct {
	SizeClasses []struct {
		ID          string   `json:"id"`
		Name        string   `json:"name"`
		Size        int      `json:"size"`
		Rock        bool     `json:"rock"`
		Count       rawRange `json:"count"`
		Fertilities rawRange `json:"fertilities"`
		Deposits    rawRange `json:"deposits"`
	} `json:"size_classes"`
	Fertilities   []rawPoolEntry `json:"fertilities"`
	Deposits      []rawPoolEntry `json:"deposits"`
	BuildableArea struct {
		Target    int         `json:"target"`
		Tolerance json.Number `json:"tolerance"`
	} `json:"buildable_area"`
	Spacing struct {
		Min        int `json:"min"`
		NearestMax int `json:"nearest_max"`
	} `json:"spacing"`
	Home struct {
		SizeClass       string   `json:"size_class"`
		Terrain         []string `json:"terrain"`
		Deposits        []string `json:"deposits"`
		FertilitiesAny  []string `json:"fertilities_any"`
		FertilitiesNone []string `json:"fertilities_none"`
		DepositsNone    []string `json:"deposits_none"`
	} `json:"home"`
}

func decodeIslands(col *collector, raw rawIslands, names []string) (IslandRules, []string) {
	const file = FileIslands
	r := IslandRules{SizeClassByID: map[string]*SizeClass{}}
	for _, sc := range raw.SizeClasses {
		ent := fmt.Sprintf("size class %q", sc.ID)
		if r.SizeClassByID[sc.ID] != nil {
			col.add(file, ent, "id", "duplicate ID")
			continue
		}
		c := &SizeClass{
			ID: sc.ID, Name: sc.Name, Size: sc.Size, Rock: sc.Rock,
			Count:       Range(sc.Count),
			Fertilities: Range(sc.Fertilities),
			Deposits:    Range(sc.Deposits),
		}
		r.SizeClasses = append(r.SizeClasses, c)
		r.SizeClassByID[c.ID] = c
	}
	pool := func(field string, entries []rawPoolEntry) []PoolEntry {
		var out []PoolEntry
		seen := map[string]bool{}
		for i, e := range entries {
			if seen[e.ID] {
				col.add(file, "", fmt.Sprintf("%s[%d].id", field, i), "duplicate ID %q", e.ID)
				continue
			}
			seen[e.ID] = true
			out = append(out, PoolEntry{ID: e.ID, Count: Range(e.Count)})
		}
		return out
	}
	r.Fertilities = pool("fertilities", raw.Fertilities)
	r.Deposits = pool("deposits", raw.Deposits)
	r.BuildableTarget = raw.BuildableArea.Target
	r.BuildableTolerance = col.fixed(file, "", "buildable_area.tolerance", raw.BuildableArea.Tolerance, 3)
	r.SpacingMin, r.NearestMax = raw.Spacing.Min, raw.Spacing.NearestMax
	r.Home = HomeRule{
		SizeClass:       raw.Home.SizeClass,
		Terrain:         slices.Clone(raw.Home.Terrain),
		Deposits:        slices.Clone(raw.Home.Deposits),
		FertilitiesAny:  slices.Clone(raw.Home.FertilitiesAny),
		FertilitiesNone: slices.Clone(raw.Home.FertilitiesNone),
		DepositsNone:    slices.Clone(raw.Home.DepositsNone),
	}
	var out []string
	seen := map[string]bool{}
	for i, n := range names {
		field := fmt.Sprintf("[%d]", i)
		if err := CheckIslandName(n); err != nil {
			col.add(FileIslandNames, "", field, "%v", err)
			continue
		}
		if seen[n] {
			col.add(FileIslandNames, "", field, "duplicate name %q", n)
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return r, out
}

// MaxShipNameRunes bounds ship names (rename_ship): the island names' rule.
const MaxShipNameRunes = MaxIslandNameRunes

// CheckIslandName validates an island name (word list and rename_island):
// 1 to MaxIslandNameRunes printable runes, valid UTF-8, without leading or
// trailing white space.
func CheckIslandName(name string) error { return checkName(name, MaxIslandNameRunes) }

// CheckShipName validates a ship name (rename_ship) like an island's: 1 to
// MaxShipNameRunes printable runes, valid UTF-8, without leading or
// trailing white space.
func CheckShipName(name string) error { return checkName(name, MaxShipNameRunes) }

func checkName(name string, maxRunes int) error {
	if !utf8.ValidString(name) {
		return fmt.Errorf("name is not valid UTF-8")
	}
	if strings.TrimSpace(name) != name {
		return fmt.Errorf("name has leading or trailing white space")
	}
	n := 0
	for _, r := range name {
		n++
		if !unicode.IsPrint(r) {
			return fmt.Errorf("name contains a non-printable character")
		}
	}
	if n < 1 || n > maxRunes {
		return fmt.Errorf("name must have 1 to %d characters", maxRunes)
	}
	return nil
}

// checkIslands validates the generator rules beyond the schema: ranges
// are ordered, references exist and the composition is satisfiable
// (CONTENT §9): the per-island ranges and the pool ranges intersect, no
// fertility is needed on more islands than can carry it, every deposit
// and fertility a building requires is in the pool, the home rule is
// consistent and the name list covers the largest archipelago.
func checkIslands(c *Catalogue, col *collector) {
	const file = FileIslands
	r := &c.Islands
	order := func(ent, field string, rg Range) {
		if rg.Min < 0 || rg.Max < rg.Min {
			col.add(file, ent, field, "range [%d, %d] is empty or negative", rg.Min, rg.Max)
		}
	}
	if len(r.SizeClasses) == 0 {
		col.add(file, "", "size_classes", "at least one size class is required")
	}
	var maxIslands, habitableMax int
	var fertMin, fertMax, depMin, depMax int
	for _, sc := range r.SizeClasses {
		ent := fmt.Sprintf("size class %q", sc.ID)
		order(ent, "count", sc.Count)
		order(ent, "fertilities", sc.Fertilities)
		order(ent, "deposits", sc.Deposits)
		if sc.Rock && sc.Fertilities.Max > 0 {
			col.add(file, ent, "fertilities", "a resource rock carries no fertility (max must be 0)")
		}
		if sc.Size < 8 {
			col.add(file, ent, "size", "must be >= 8")
		}
		if sc.Fertilities.Max > len(r.Fertilities) {
			col.add(file, ent, "fertilities.max", "exceeds the %d entries of the fertility pool", len(r.Fertilities))
		}
		maxIslands += sc.Count.Max
		if sc.Fertilities.Max > 0 {
			habitableMax += sc.Count.Max
		}
		fertMin += sc.Count.Min * sc.Fertilities.Min
		fertMax += sc.Count.Max * sc.Fertilities.Max
		depMin += sc.Count.Min * sc.Deposits.Min
		depMax += sc.Count.Max * sc.Deposits.Max
	}
	if maxIslands < 1 {
		col.add(file, "", "size_classes", "the archipelago has no island")
	}
	poolSum := func(field string, entries []PoolEntry) (int, int) {
		lo, hi := 0, 0
		for i, e := range entries {
			order("", fmt.Sprintf("%s[%d].count", field, i), e.Count)
			lo += e.Count.Min
			hi += e.Count.Max
		}
		return lo, hi
	}
	pfMin, pfMax := poolSum("fertilities", r.Fertilities)
	pdMin, pdMax := poolSum("deposits", r.Deposits)
	if fertMax < pfMin || pfMax < fertMin {
		col.add(file, "", "fertilities", "unsatisfiable: islands carry %d to %d fertility tags, the pool needs %d to %d", fertMin, fertMax, pfMin, pfMax)
	}
	if depMax < pdMin || pdMax < depMin {
		col.add(file, "", "deposits", "unsatisfiable: islands carry %d to %d deposit slots, the pool needs %d to %d", depMin, depMax, pdMin, pdMax)
	}
	for i, e := range r.Fertilities {
		if e.Count.Min > habitableMax {
			col.add(file, "", fmt.Sprintf("fertilities[%d].count.min", i), "%q is needed on %d islands, only %d can carry fertilities", e.ID, e.Count.Min, habitableMax)
		}
	}
	inPool := func(entries []PoolEntry, id string) bool {
		return slices.ContainsFunc(entries, func(e PoolEntry) bool { return e.ID == id })
	}
	for _, b := range c.Buildings {
		ent := fmt.Sprintf("building %q", b.ID)
		if b.RequiresDeposit != "" && !inPool(r.Deposits, b.RequiresDeposit) {
			col.add(FileBuildings, ent, "requires_deposit", "deposit %q is not in the deposit pool of %s", b.RequiresDeposit, file)
		}
		if b.WorkArea != nil && b.WorkArea.Fertility != "" && !inPool(r.Fertilities, b.WorkArea.Fertility) {
			col.add(FileBuildings, ent, "work_area.fertility", "fertility %q is not in the fertility pool of %s", b.WorkArea.Fertility, file)
		}
		if b.Field != nil && b.Field.Fertility != "" && !inPool(r.Fertilities, b.Field.Fertility) {
			col.add(FileBuildings, ent, "field.fertility", "fertility %q is not in the fertility pool of %s", b.Field.Fertility, file)
		}
	}
	if r.BuildableTarget < 1 {
		col.add(file, "", "buildable_area.target", "must be >= 1")
	}
	if r.BuildableTolerance < 0 || r.BuildableTolerance > 1000 {
		col.add(file, "", "buildable_area.tolerance", "must be in [0, 1]")
	}
	if r.SpacingMin < 1 || r.NearestMax < r.SpacingMin {
		col.add(file, "", "spacing", "need 1 <= min <= nearest_max, got %d and %d", r.SpacingMin, r.NearestMax)
	}

	h := r.Home
	sc := r.SizeClassByID[h.SizeClass]
	switch {
	case sc == nil:
		col.add(file, "", "home.size_class", "unknown size class %q", h.SizeClass)
	case sc.Count.Min < 1:
		col.add(file, "", "home.size_class", "size class %q must have at least one island (count.min >= 1)", h.SizeClass)
	case sc.Rock:
		col.add(file, "", "home.size_class", "the home candidate cannot be a resource rock")
	case len(h.FertilitiesAny) > 0 && sc.Fertilities.Max < 1:
		col.add(file, "", "home.fertilities_any", "size class %q carries no fertility", h.SizeClass)
	case len(h.Deposits) > sc.Deposits.Max:
		col.add(file, "", "home.deposits", "size class %q carries at most %d deposit slots", h.SizeClass, sc.Deposits.Max)
	}
	for _, t := range h.Terrain {
		if t != TerrainForest && t != TerrainGrass {
			col.add(file, "", "home.terrain", "unknown terrain %q (forest or grass)", t)
		}
	}
	for field, ids := range map[string][]string{"home.fertilities_any": h.FertilitiesAny, "home.fertilities_none": h.FertilitiesNone} {
		for _, id := range ids {
			if !inPool(r.Fertilities, id) {
				col.add(file, "", field, "fertility %q is not in the pool", id)
			}
		}
	}
	for field, ids := range map[string][]string{"home.deposits": h.Deposits, "home.deposits_none": h.DepositsNone} {
		for _, id := range ids {
			if !inPool(r.Deposits, id) {
				col.add(file, "", field, "deposit %q is not in the pool", id)
			}
		}
	}
	for _, id := range h.Deposits {
		if slices.Contains(h.DepositsNone, id) {
			col.add(file, "", "home.deposits_none", "deposit %q is both required and excluded", id)
		}
	}
	if len(h.FertilitiesAny) > 0 && !slices.ContainsFunc(h.FertilitiesAny, func(f string) bool { return !slices.Contains(h.FertilitiesNone, f) }) {
		col.add(file, "", "home.fertilities_none", "excludes every fertility of fertilities_any")
	}
	if len(c.IslandNames) < maxIslands {
		col.add(FileIslandNames, "", "", "%d names for up to %d islands", len(c.IslandNames), maxIslands)
	}
}
