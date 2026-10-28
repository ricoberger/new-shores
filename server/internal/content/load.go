package content

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"unicode"
	"unicode/utf8"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Content file names inside a region directory. The schema for file
// "<name>.json" is "<name>.schema.json" in the schema directory.
const (
	FileRegion    = "region.json"
	FileTiers     = "tiers.json"
	FileGoods     = "goods.json"
	FileBuildings = "buildings.json"
	FileNeeds     = "needs.json"
	FileStart     = "start.json"
	FileShips     = "ships.json"
	FileQuests    = "quests.json"
	// FileNeedCategories lists the goods-need categories with their
	// display name and HUD icon (display data only).
	FileNeedCategories = "need_categories.json"
)

var contentFiles = []string{FileRegion, FileTiers, FileGoods, FileBuildings, FileNeedCategories, FileNeeds, FileStart, FileShips, FileQuests, FileIslands, FileIslandNames}

// Error describes one content problem. It names the file, the offending
// entity (if any) and the field.
type Error struct {
	File   string
	Entity string
	Field  string
	Msg    string
}

func (e *Error) Error() string {
	s := e.File
	if e.Entity != "" {
		s += ": " + e.Entity
	}
	if e.Field != "" {
		s += ": " + e.Field
	}
	return s + ": " + e.Msg
}

// Load reads and validates the region directory dir (e.g.
// "content/old_coast"). The JSON Schemas are read from the sibling directory
// "schema" (i.e. filepath.Join(dir, "..", "schema")), so the result does not
// depend on the working directory beyond dir itself.
func Load(dir string) (*Catalogue, error) {
	return LoadWithSchemas(dir, filepath.Join(filepath.Dir(filepath.Clean(dir)), "schema"))
}

// LoadWithSchemas is Load with an explicit schema directory.
func LoadWithSchemas(dir, schemaDir string) (*Catalogue, error) {
	raw := make(map[string][]byte, len(contentFiles))
	var errs []error
	for _, name := range contentFiles {
		data, err := os.ReadFile(filepath.Join(dir, name)) // #nosec G304 -- content paths come from trusted configuration.
		if err != nil {
			return nil, fmt.Errorf("content: %w", err)
		}
		raw[name] = data
		if err := validateSchema(schemaDir, name, data); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return nil, errors.Join(errs...)
	}

	c, err := decode(raw)
	if err != nil {
		return nil, err
	}
	if err := checkReferences(c); err != nil {
		return nil, err
	}
	normaliseNeedWeights(c)
	return c, nil
}

func validateSchema(schemaDir, name string, data []byte) error {
	schemaName := name[:len(name)-len(".json")] + ".schema.json"
	schemaPath, err := filepath.Abs(filepath.Join(schemaDir, schemaName))
	if err != nil {
		return &Error{File: name, Msg: err.Error()}
	}
	schemaData, err := os.ReadFile(schemaPath) // #nosec G304 -- schema paths come from trusted configuration.
	if err != nil {
		return &Error{File: name, Msg: fmt.Sprintf("read schema: %v", err)}
	}
	schemaDoc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaData))
	if err != nil {
		return &Error{File: schemaName, Msg: fmt.Sprintf("parse schema: %v", err)}
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	url := "file://" + filepath.ToSlash(schemaPath)
	if err := compiler.AddResource(url, schemaDoc); err != nil {
		return &Error{File: schemaName, Msg: fmt.Sprintf("add schema: %v", err)}
	}
	schema, err := compiler.Compile(url)
	if err != nil {
		return &Error{File: schemaName, Msg: fmt.Sprintf("compile schema: %v", err)}
	}

	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return &Error{File: name, Msg: fmt.Sprintf("invalid JSON: %v", err)}
	}
	if err := schema.Validate(inst); err != nil {
		var verr *jsonschema.ValidationError
		if !errors.As(err, &verr) {
			return &Error{File: name, Msg: err.Error()}
		}
		loc := firstLeafLocation(verr)
		return &Error{File: name, Entity: entityAt(entityKind(name), inst, loc), Field: fieldPath(inst, loc), Msg: "schema violation: " + verr.Error()}
	}
	return nil
}

// firstLeafLocation returns the instance location of the deepest first cause.
func firstLeafLocation(e *jsonschema.ValidationError) []string {
	for len(e.Causes) > 0 {
		e = e.Causes[0]
	}
	return e.InstanceLocation
}

// entityAt names the entity that contains the instance location: for array
// files the element at the first path segment, for single-object files the
// object itself.
func entityAt(kind string, inst any, loc []string) string {
	switch v := inst.(type) {
	case []any:
		if len(loc) == 0 {
			return ""
		}
		i, err := strconv.Atoi(loc[0])
		if err != nil || i < 0 || i >= len(v) {
			return ""
		}
		return describeEntity(kind, v[i], i)
	case map[string]any:
		return describeEntity(kind, v, -1)
	}
	return ""
}

func describeEntity(kind string, v any, index int) string {
	if obj, ok := v.(map[string]any); ok {
		if id, ok := obj["id"].(string); ok {
			return fmt.Sprintf("%s %q", kind, id)
		}
	}
	if index >= 0 {
		return fmt.Sprintf("%s #%d", kind, index)
	}
	return ""
}

// entityKind maps a content file name to the singular entity name used in
// error messages ("buildings.json" -> "building").
func entityKind(file string) string {
	switch file {
	case FileRegion:
		return "region"
	case FileTiers:
		return "tier"
	case FileGoods:
		return "good"
	case FileBuildings:
		return "building"
	case FileNeeds:
		return "need"
	case FileNeedCategories:
		return "need category"
	case FileStart:
		return "start"
	case FileShips:
		return "ship"
	case FileQuests:
		return "quest"
	case FileIslandNames:
		return "island name"
	}
	return "entity"
}

func fieldPath(inst any, loc []string) string {
	if _, ok := inst.([]any); ok && len(loc) > 0 {
		loc = loc[1:]
	}
	s := ""
	for i, p := range loc {
		if _, err := strconv.Atoi(p); err == nil {
			s += "[" + p + "]"
			continue
		}
		if i > 0 {
			s += "."
		}
		s += p
	}
	return s
}

// Raw JSON shapes (after schema validation).

type rawRegion struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Rules   struct {
		TransferBaseSeconds    json.Number `json:"transfer_base_seconds"`
		UnconnectedBufferUnits json.Number `json:"unconnected_buffer_units"`
		IterationCap           int         `json:"iteration_cap"`
		CoarseStepSeconds      json.Number `json:"coarse_step_seconds"`
		GrowthPerMin           json.Number `json:"growth_per_min"`
		DeclinePerMin          json.Number `json:"decline_per_min"`
		GrowthThreshold        json.Number `json:"growth_satisfaction_threshold"`
		AutoResumeMinutes      json.Number `json:"auto_resume_upkeep_minutes"`
		ShipHandlingBase       json.Number `json:"ship_handling_base_seconds"`
		ShipHandlingPerUnit    json.Number `json:"ship_handling_seconds_per_unit"`
		ShipSpeedTilesPerMin   json.Number `json:"ship_speed_tiles_per_min"`
		AwaySummaryMinutes     int64       `json:"away_summary_minutes"`
		TrialResumeMinutes     json.Number `json:"trial_resume_upkeep_minutes"`
	} `json:"rules"`
	Camera struct {
		MaxHalfExtent int `json:"max_half_extent"`
	} `json:"camera"`
}

type rawTier struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Residents struct {
		Floor int64 `json:"floor"`
		Max   int64 `json:"max"`
	} `json:"residents"`
	Tax    json.Number `json:"tax_per_resident_per_min"`
	House  string      `json:"house"`
	Unlock struct {
		Population map[string]int64 `json:"population"`
		Buildings  []string         `json:"buildings"`
	} `json:"unlock"`
}

type rawGood struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type rawGoodAmount struct {
	Good   string      `json:"good"`
	Amount json.Number `json:"amount"`
}

// rawRecipeInput is a recipe input whose good is one ID or a list of
// alternatives in preference order (D-056 §7).
type rawRecipeInput struct {
	Good   json.RawMessage `json:"good"`
	Amount json.Number     `json:"amount"`
}

type rawBuilding struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Region        string                 `json:"region"`
	Tier          string                 `json:"tier"`
	Footprint     []int                  `json:"footprint"`
	Coastal       bool                   `json:"coastal"`
	WaterTiles    int                    `json:"water_tiles"`
	RequiresRoad  bool                   `json:"requires_road"`
	Cost          map[string]json.Number `json:"cost"`
	Upkeep        json.Number            `json:"upkeep_per_min"`
	PauseCategory string                 `json:"pause_category"`
	Recipe        *struct {
		Inputs       []rawRecipeInput `json:"inputs"`
		Outputs      []rawGoodAmount  `json:"outputs"`
		CycleSeconds json.Number      `json:"cycle_seconds"`
	} `json:"recipe"`
	House       *House `json:"house"`
	TradingPost *struct {
		Levels []struct {
			Capacity   json.Number            `json:"capacity"`
			Throughput json.Number            `json:"throughput_per_min"`
			Berths     int                    `json:"berths"`
			Cost       map[string]json.Number `json:"cost"`
		} `json:"levels"`
	} `json:"trading_post"`
	Warehouse *struct {
		Levels []struct {
			Throughput json.Number            `json:"throughput_per_min"`
			Cost       map[string]json.Number `json:"cost"`
		} `json:"levels"`
	} `json:"warehouse"`
	Road *struct {
		SecondsPerTile json.Number `json:"seconds_per_tile"`
	} `json:"road"`
	Service *struct {
		Radius int `json:"radius"`
		Levels []struct {
			Radius int                    `json:"radius"`
			Tier   string                 `json:"tier"`
			Cost   map[string]json.Number `json:"cost"`
		} `json:"levels"`
	} `json:"service"`
	WorkArea *struct {
		Radius        int      `json:"radius"`
		Terrain       []string `json:"terrain"`
		RequiredTiles int      `json:"required_tiles"`
		Fertility     string   `json:"fertility"`
	} `json:"work_area"`
	Workforce *struct {
		Tier   string `json:"tier"`
		Amount int64  `json:"amount"`
	} `json:"workforce"`
	Fields *struct {
		Type     string `json:"type"`
		Required int    `json:"required"`
		Max      int    `json:"max"`
	} `json:"fields"`
	Field *struct {
		Type      string          `json:"type"`
		Farm      json.RawMessage `json:"farm"`
		Terrain   []string        `json:"terrain"`
		Fertility string          `json:"fertility"`
	} `json:"field"`
	Shipyard *struct {
		Ships []string `json:"ships"`
	} `json:"shipyard"`
	RequiresDeposit string `json:"requires_deposit"`
	Smoke           bool   `json:"smoke"`
	Boat            bool   `json:"boat"`
}

type rawShip struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Region       string                 `json:"region"`
	Tier         string                 `json:"tier"`
	Slots        int                    `json:"slots"`
	SlotSize     json.Number            `json:"slot_size"`
	Speed        json.Number            `json:"speed"`
	BuildSeconds json.Number            `json:"build_seconds"`
	Cost         map[string]json.Number `json:"cost"`
	Upkeep       json.Number            `json:"upkeep_per_min"`
	LengthTiles  json.Number            `json:"length_tiles"`
}

type rawNeedCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type rawNeed struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Tier     string      `json:"tier"`
	Kind     string      `json:"kind"`
	Weight   json.Number `json:"weight"`
	Category string      `json:"category"`
	FromTier string      `json:"from_tier"`
	Goods    []struct {
		Good              string      `json:"good"`
		PerResidentPerMin json.Number `json:"per_resident_per_min"`
		Share             json.Number `json:"share"`
	} `json:"goods"`
	Buildings []struct {
		Building string      `json:"building"`
		Share    json.Number `json:"share"`
	} `json:"buildings"`
}

type rawQuest struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Text       string `json:"text"`
	Objectives []struct {
		Kind   string      `json:"kind"`
		Type   string      `json:"type"`
		Good   string      `json:"good"`
		Tier   string      `json:"tier"`
		Island string      `json:"island"`
		Min    json.Number `json:"min"`
		Count  int64       `json:"count"`
	} `json:"objectives"`
	Rewards struct {
		Gold        int64            `json:"gold"`
		Goods       map[string]int64 `json:"goods"`
		Decorations []string         `json:"decorations"`
	} `json:"rewards"`
	Prerequisites []string `json:"prerequisites"`
}

type rawStart struct {
	Gold  json.Number            `json:"gold"`
	Goods map[string]json.Number `json:"goods"`
}

func unmarshal(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// collector gathers content errors.
type collector struct{ errs []error }

func (c *collector) add(file, entity, field, format string, args ...any) {
	c.errs = append(c.errs, &Error{File: file, Entity: entity, Field: field, Msg: fmt.Sprintf(format, args...)})
}

func (c *collector) fixed(file, entity, field string, n json.Number, places int) int64 {
	if n == "" {
		return 0
	}
	v, err := ParseFixed(n, places)
	if err != nil {
		c.add(file, entity, field, "%v", err)
	}
	return v
}

// maxWhole bounds whole-number content values that are scaled to fixed
// point (quest thresholds and rewards, the away-summary minutes): even a
// stock threshold in sub-milli units (x 1000 x SubPerMilli) stays far from
// int64 overflow.
const maxWhole = 1_000_000

// whole checks that v is a whole number in [1, maxWhole] and returns it
// (0 after an error).
func (c *collector) whole(file, entity, field string, v int64) int64 {
	if v < 1 || v > maxWhole {
		c.add(file, entity, field, "must be in [1, %d]", maxWhole)
		return 0
	}
	return v
}

// maxNameRunes bounds player-facing content names (need and need category
// names): 1 to 32 printable runes.
const maxNameRunes = 32

// displayName checks a player-facing name: 1 to maxNameRunes printable
// runes (the schema checks the length too; this also covers printability).
func (c *collector) displayName(file, entity, name string) {
	n := 0
	for _, r := range name {
		n++
		if !unicode.IsPrint(r) {
			c.add(file, entity, "name", "must consist of printable characters")
			return
		}
	}
	if n < 1 || n > maxNameRunes || !utf8.ValidString(name) {
		c.add(file, entity, "name", "must be 1 to %d printable characters", maxNameRunes)
	}
}

func (c *collector) err() error {
	if len(c.errs) == 0 {
		return nil
	}
	return errors.Join(c.errs...)
}

func decode(raw map[string][]byte) (*Catalogue, error) {
	var (
		region    rawRegion
		tiers     []rawTier
		goods     []rawGood
		buildings []rawBuilding
		needs     []rawNeed
		needCats  []rawNeedCategory
		start     rawStart
		ships     []rawShip
		quests    []rawQuest
		islands   rawIslands
		names     []string
	)
	for name, v := range map[string]any{
		FileRegion: &region, FileTiers: &tiers, FileGoods: &goods, FileBuildings: &buildings, FileNeeds: &needs, FileStart: &start,
		FileShips: &ships, FileQuests: &quests, FileNeedCategories: &needCats, FileIslands: &islands, FileIslandNames: &names,
	} {
		if err := unmarshal(raw[name], v); err != nil {
			return nil, &Error{File: name, Msg: fmt.Sprintf("decode: %v", err)}
		}
	}

	col := &collector{}
	cat := &Catalogue{
		TierByID:         map[string]*Tier{},
		GoodByID:         map[string]*Good{},
		BuildingByID:     map[string]*Building{},
		FieldByType:      map[string]*Building{},
		NeedsByTier:      map[string][]*Need{},
		NeedCategoryByID: map[string]*NeedCategory{},
		ShipByID:         map[string]*Ship{},
		QuestByID:        map[string]*Quest{},
	}

	ent := fmt.Sprintf("region %q", region.ID)
	cat.Region = Region{
		ID:      region.ID,
		Name:    region.Name,
		Version: region.Version,
		Rules: Rules{
			TransferBaseMs:    col.fixed(FileRegion, ent, "rules.transfer_base_seconds", region.Rules.TransferBaseSeconds, 3),
			UnconnectedBuffer: col.fixed(FileRegion, ent, "rules.unconnected_buffer_units", region.Rules.UnconnectedBufferUnits, 3),
			IterationCap:      region.Rules.IterationCap,
			CoarseStepMs:      col.fixed(FileRegion, ent, "rules.coarse_step_seconds", region.Rules.CoarseStepSeconds, 3),
			GrowthPerMin:      col.fixed(FileRegion, ent, "rules.growth_per_min", region.Rules.GrowthPerMin, 3),
			DeclinePerMin:     col.fixed(FileRegion, ent, "rules.decline_per_min", region.Rules.DeclinePerMin, 3),
			// Ratios have at most 3 decimal places and are kept in ppm.
			GrowthThreshold: col.fixed(FileRegion, ent, "rules.growth_satisfaction_threshold", region.Rules.GrowthThreshold, 3) * 1000,
			// Minutes with 3 decimal places are milli-minutes; x60 gives ms.
			AutoResumeMs:          col.fixed(FileRegion, ent, "rules.auto_resume_upkeep_minutes", region.Rules.AutoResumeMinutes, 3) * 60,
			TrialResumeMs:         col.fixed(FileRegion, ent, "rules.trial_resume_upkeep_minutes", region.Rules.TrialResumeMinutes, 3) * 60,
			ShipHandlingBaseMs:    col.fixed(FileRegion, ent, "rules.ship_handling_base_seconds", region.Rules.ShipHandlingBase, 3),
			ShipHandlingMsPerUnit: col.fixed(FileRegion, ent, "rules.ship_handling_seconds_per_unit", region.Rules.ShipHandlingPerUnit, 3),
			// Tiles per minute with 3 decimal places are milli-tiles per minute.
			ShipSpeedMilliTilesPerMin: col.fixed(FileRegion, ent, "rules.ship_speed_tiles_per_min", region.Rules.ShipSpeedTilesPerMin, 3),
			AwaySummaryMs:             col.whole(FileRegion, ent, "rules.away_summary_minutes", region.Rules.AwaySummaryMinutes) * 60_000,
		},
		Camera: Camera{MaxHalfExtent: region.Camera.MaxHalfExtent},
	}

	for i, t := range tiers {
		ent := fmt.Sprintf("tier %q", t.ID)
		if _, dup := cat.TierByID[t.ID]; dup {
			col.add(FileTiers, ent, "id", "duplicate ID")
			continue
		}
		tier := &Tier{
			ID:                   t.ID,
			Name:                 t.Name,
			Index:                i,
			ResidentsFloor:       t.Residents.Floor * MilliPerUnit,
			ResidentsMax:         t.Residents.Max * MilliPerUnit,
			TaxPerResidentPerMin: col.fixed(FileTiers, ent, "tax_per_resident_per_min", t.Tax, 3),
			House:                t.House,
			Unlock: Unlock{
				Population: t.Unlock.Population,
				Buildings:  t.Unlock.Buildings,
			},
		}
		if tier.ResidentsFloor > tier.ResidentsMax {
			col.add(FileTiers, ent, "residents", "floor %d exceeds max %d", t.Residents.Floor, t.Residents.Max)
		}
		cat.Tiers = append(cat.Tiers, tier)
		cat.TierByID[t.ID] = tier
	}

	for _, g := range goods {
		if _, dup := cat.GoodByID[g.ID]; dup {
			col.add(FileGoods, fmt.Sprintf("good %q", g.ID), "id", "duplicate ID")
			continue
		}
		good := &Good{ID: g.ID, Name: g.Name, Type: g.Type}
		cat.Goods = append(cat.Goods, good)
		cat.GoodByID[g.ID] = good
	}

	for _, rb := range buildings {
		ent := fmt.Sprintf("building %q", rb.ID)
		if _, dup := cat.BuildingByID[rb.ID]; dup {
			col.add(FileBuildings, ent, "id", "duplicate ID")
			continue
		}
		b := decodeBuilding(col, ent, rb, cat.GoodByID)
		cat.Buildings = append(cat.Buildings, b)
		cat.BuildingByID[b.ID] = b
		// The first declaration of a field type wins; checkReferences
		// reports later duplicates.
		if f := b.Field; f != nil && cat.FieldByType[f.Type] == nil {
			cat.FieldByType[f.Type] = b
		}
	}

	for _, rc := range needCats {
		ent := fmt.Sprintf("need category %q", rc.ID)
		if _, dup := cat.NeedCategoryByID[rc.ID]; dup {
			col.add(FileNeedCategories, ent, "id", "duplicate ID")
			continue
		}
		col.displayName(FileNeedCategories, ent, rc.Name)
		nc := &NeedCategory{ID: rc.ID, Name: rc.Name, Icon: rc.Icon}
		cat.NeedCategories = append(cat.NeedCategories, nc)
		cat.NeedCategoryByID[nc.ID] = nc
	}

	seenNeeds := map[string]bool{}
	for _, rn := range needs {
		ent := fmt.Sprintf("need %q", rn.ID)
		if seenNeeds[rn.ID] {
			col.add(FileNeeds, ent, "id", "duplicate ID")
			continue
		}
		seenNeeds[rn.ID] = true
		col.displayName(FileNeeds, ent, rn.Name)
		n := &Need{
			ID:       rn.ID,
			Name:     rn.Name,
			Tier:     rn.Tier,
			Kind:     rn.Kind,
			Weight:   col.fixed(FileNeeds, ent, "weight", rn.Weight, 6),
			Category: rn.Category,
			FromTier: rn.FromTier,
		}
		for i, rb := range rn.Buildings {
			// Shares have at most 3 decimal places and are kept in ppm.
			nb := NeedBuilding{Building: rb.Building, Share: col.fixed(FileNeeds, ent, fmt.Sprintf("buildings[%d].share", i), rb.Share, 3) * 1000}
			if rb.Share == "" {
				nb.Share = defaultShare(len(rn.Buildings))
			}
			n.Buildings = append(n.Buildings, nb)
		}
		for i, g := range rn.Goods {
			n.Goods = append(n.Goods, NeedGood{
				Good:              g.Good,
				PerResidentPerMin: col.fixed(FileNeeds, ent, fmt.Sprintf("goods[%d].per_resident_per_min", i), g.PerResidentPerMin, 6),
				Share:             col.fixed(FileNeeds, ent, fmt.Sprintf("goods[%d].share", i), g.Share, 3) * 1000,
			})
			if g.Share == "" {
				n.Goods[i].Share = defaultShare(len(rn.Goods))
			}
		}
		cat.NeedsByTier[n.Tier] = append(cat.NeedsByTier[n.Tier], n)
	}

	for _, rs := range ships {
		ent := fmt.Sprintf("ship %q", rs.ID)
		if _, dup := cat.ShipByID[rs.ID]; dup {
			col.add(FileShips, ent, "id", "duplicate ID")
			continue
		}
		sh := &Ship{
			ID: rs.ID, Name: rs.Name, Region: rs.Region, Tier: rs.Tier, Slots: rs.Slots,
			SlotSize:      col.fixed(FileShips, ent, "slot_size", rs.SlotSize, 3),
			SpeedPermille: col.fixed(FileShips, ent, "speed", rs.Speed, 3),
			BuildMs:       col.fixed(FileShips, ent, "build_seconds", rs.BuildSeconds, 3),
			UpkeepPerMin:  col.fixed(FileShips, ent, "upkeep_per_min", rs.Upkeep, 3),
			Cost:          decodeCost(col, FileShips, ent, rs.Cost, cat.GoodByID),
		}
		if rs.LengthTiles != "" {
			sh.LengthMilliTiles = col.fixed(FileShips, ent, "length_tiles", rs.LengthTiles, 3)
		}
		cat.Ships = append(cat.Ships, sh)
		cat.ShipByID[sh.ID] = sh
	}

	for i, rq := range quests {
		ent := fmt.Sprintf("quest %q", rq.ID)
		if _, dup := cat.QuestByID[rq.ID]; dup {
			col.add(FileQuests, ent, "id", "duplicate ID")
			continue
		}
		q := &Quest{ID: rq.ID, Title: rq.Title, Text: rq.Text, Index: i, Prerequisites: append([]string{}, rq.Prerequisites...)}
		for j, ro := range rq.Objectives {
			o := Objective{Kind: ro.Kind, Building: ro.Type, Good: ro.Good, Tier: ro.Tier, Island: ro.Island}
			field := fmt.Sprintf("objectives[%d].min", j)
			switch ro.Kind {
			case ObjectiveIslandSettled:
				o.Min = col.whole(FileQuests, ent, fmt.Sprintf("objectives[%d].count", j), ro.Count)
			case ObjectivePopulation, ObjectiveStock:
				o.Min = col.whole(FileQuests, ent, field, col.fixed(FileQuests, ent, field, ro.Min, 0)) * MilliPerUnit
			case ObjectiveSatisfaction:
				// A fraction with at most 3 decimals, kept in ppm.
				o.Min = col.fixed(FileQuests, ent, field, ro.Min, 3) * 1000
			case ObjectiveBuildingCount, ObjectiveShipCount:
				o.Min = col.whole(FileQuests, ent, field, col.fixed(FileQuests, ent, field, ro.Min, 0))
			}
			if ro.Kind == ObjectiveShipCount {
				o.Ship, o.Building = ro.Type, ""
			}
			q.Objectives = append(q.Objectives, o)
		}
		if rq.Rewards.Gold != 0 {
			q.Rewards.Gold = col.whole(FileQuests, ent, "rewards.gold", rq.Rewards.Gold) * MilliPerUnit
		}
		for _, good := range slices.Sorted(maps.Keys(rq.Rewards.Goods)) {
			v := col.whole(FileQuests, ent, "rewards.goods."+good, rq.Rewards.Goods[good])
			q.Rewards.Goods = append(q.Rewards.Goods, GoodAmount{Good: good, Amount: v * MilliPerUnit})
		}
		cat.Quests = append(cat.Quests, q)
		cat.QuestByID[q.ID] = q
	}

	cat.Start.Gold = col.fixed(FileStart, "", "gold", start.Gold, 3)
	for _, good := range slices.Sorted(maps.Keys(start.Goods)) {
		v := col.fixed(FileStart, "", "goods."+good, start.Goods[good], 3)
		if cat.GoodByID[good] == nil {
			col.add(FileStart, "", "goods."+good, "unknown good %q", good)
			continue
		}
		if v > 0 {
			cat.Start.Goods = append(cat.Start.Goods, GoodAmount{Good: good, Amount: v})
		}
	}

	cat.Islands, cat.IslandNames = decodeIslands(col, islands, names)

	if err := col.err(); err != nil {
		return nil, err
	}
	return cat, nil
}

func decodeBuilding(col *collector, ent string, rb rawBuilding, goods map[string]*Good) *Building {
	const file = FileBuildings
	b := &Building{
		ID:            rb.ID,
		Name:          rb.Name,
		Region:        rb.Region,
		Tier:          rb.Tier,
		Coastal:       rb.Coastal,
		WaterTiles:    rb.WaterTiles,
		RequiresRoad:  rb.RequiresRoad,
		UpkeepPerMin:  col.fixed(file, ent, "upkeep_per_min", rb.Upkeep, 3),
		PauseCategory: rb.PauseCategory,
		House:         rb.House,

		RequiresDeposit: rb.RequiresDeposit,
		Smoke:           rb.Smoke,
		Boat:            rb.Boat,
	}
	if len(rb.Footprint) == 2 {
		b.Width, b.Height = rb.Footprint[0], rb.Footprint[1]
	}
	if b.Width < 1 || b.Height < 1 {
		col.add(file, ent, "footprint", "must be at least 1x1")
	}

	b.Cost = decodeCost(col, file, ent, rb.Cost, goods)

	if r := rb.Recipe; r != nil {
		rec := &Recipe{CycleMs: col.fixed(file, ent, "recipe.cycle_seconds", r.CycleSeconds, 3)}
		if rec.CycleMs <= 0 {
			col.add(file, ent, "recipe.cycle_seconds", "must be > 0")
		}
		for i, in := range r.Inputs {
			field := fmt.Sprintf("recipe.inputs[%d].amount", i)
			a := col.fixed(file, ent, field, in.Amount, 3)
			if a <= 0 {
				col.add(file, ent, field, "must be > 0")
			}
			var goods []string
			var one string
			if err := json.Unmarshal(in.Good, &one); err == nil {
				goods = []string{one}
			} else if err := json.Unmarshal(in.Good, &goods); err != nil || len(goods) == 0 {
				col.add(file, ent, fmt.Sprintf("recipe.inputs[%d].good", i), "must be a good ID or a non-empty list of good IDs")
				goods = []string{""}
			}
			rec.Inputs = append(rec.Inputs, RecipeInput{GoodAmount: GoodAmount{Good: goods[0], Amount: a}, Goods: goods})
		}
		for i, out := range r.Outputs {
			field := fmt.Sprintf("recipe.outputs[%d].amount", i)
			a := col.fixed(file, ent, field, out.Amount, 3)
			if a <= 0 {
				col.add(file, ent, field, "must be > 0")
			}
			rec.Outputs = append(rec.Outputs, GoodAmount{Good: out.Good, Amount: a})
		}
		if len(rec.Outputs) == 0 {
			col.add(file, ent, "recipe.outputs", "must not be empty")
		}
		b.Recipe = rec
	}
	if tp := rb.TradingPost; tp != nil {
		t := &TradingPost{}
		for i, l := range tp.Levels {
			lvl := TradingPostLevel{
				Capacity:         col.fixed(file, ent, fmt.Sprintf("trading_post.levels[%d].capacity", i), l.Capacity, 3),
				ThroughputPerMin: col.fixed(file, ent, fmt.Sprintf("trading_post.levels[%d].throughput_per_min", i), l.Throughput, 3),
				Berths:           l.Berths,
			}
			if l.Cost != nil {
				cost := decodeCost(col, file, ent, l.Cost, goods)
				lvl.Cost = &cost
			}
			t.Levels = append(t.Levels, lvl)
		}
		if len(t.Levels) == 0 {
			col.add(file, ent, "trading_post.levels", "must not be empty")
		}
		b.TradingPost = t
	}
	if w := rb.Warehouse; w != nil {
		wh := &Warehouse{}
		for i, l := range w.Levels {
			lvl := WarehouseLevel{
				ThroughputPerMin: col.fixed(file, ent, fmt.Sprintf("warehouse.levels[%d].throughput_per_min", i), l.Throughput, 3),
			}
			if l.Cost != nil {
				cost := decodeCost(col, file, ent, l.Cost, goods)
				lvl.Cost = &cost
			}
			wh.Levels = append(wh.Levels, lvl)
		}
		if len(wh.Levels) == 0 {
			col.add(file, ent, "warehouse.levels", "must not be empty")
		}
		b.Warehouse = wh
	}
	if r := rb.Road; r != nil {
		b.Road = &Road{MsPerTile: col.fixed(file, ent, "road.seconds_per_tile", r.SecondsPerTile, 3)}
	}
	if s := rb.Service; s != nil {
		// A service has either one radius or levels (schema); the radius
		// is the single level.
		b.Service = &Service{}
		if len(s.Levels) == 0 {
			b.Service.Levels = []ServiceLevel{{Radius: s.Radius}}
		}
		for _, l := range s.Levels {
			lvl := ServiceLevel{Radius: l.Radius, Tier: l.Tier}
			if l.Cost != nil {
				cost := decodeCost(col, file, ent, l.Cost, goods)
				lvl.Cost = &cost
			}
			b.Service.Levels = append(b.Service.Levels, lvl)
		}
	}
	if wf := rb.Workforce; wf != nil {
		b.Workforce = &Workforce{Tier: wf.Tier, Amount: wf.Amount * MilliPerUnit}
	}
	if sy := rb.Shipyard; sy != nil {
		b.Shipyard = &Shipyard{Ships: append([]string(nil), sy.Ships...)}
	}
	if wa := rb.WorkArea; wa != nil {
		b.WorkArea = &WorkArea{Radius: wa.Radius, Terrain: wa.Terrain, RequiredTiles: wa.RequiredTiles, Fertility: wa.Fertility}
		// A farm with a fields block has no implicit terrain rule: its
		// work area only bounds its fields (D-049).
		if rb.Fields == nil && wa.RequiredTiles < 1 {
			col.add(file, ent, "work_area.required_tiles", "must be >= 1")
		}
	}
	if f := rb.Fields; f != nil {
		b.Fields = &FarmFields{Type: f.Type, Required: f.Required, Max: f.Max}
		if f.Required < 1 {
			col.add(file, ent, "fields.required", "must be >= 1")
		}
		if f.Max < f.Required {
			col.add(file, ent, "fields.max", "must be >= fields.required")
		}
	}
	if f := rb.Field; f != nil {
		var farms []string
		var one string
		if err := json.Unmarshal(f.Farm, &one); err == nil {
			farms = []string{one}
		} else if err := json.Unmarshal(f.Farm, &farms); err != nil || len(farms) == 0 {
			col.add(file, ent, "field.farm", "must be a farm ID or a non-empty list of farm IDs")
			farms = []string{""}
		}
		b.Field = &Field{Type: f.Type, Farm: farms[0], Farms: farms, Terrain: append([]string(nil), f.Terrain...), Fertility: f.Fertility}
	}
	return b
}

// decodeCost converts a cost object ("gold" plus materials by good ID) of a
// building or ship. Materials are sorted by good ID.
func decodeCost(col *collector, file, ent string, raw map[string]json.Number, goods map[string]*Good) Cost {
	var cost Cost
	for _, k := range slices.Sorted(maps.Keys(raw)) {
		v := col.fixed(file, ent, "cost."+k, raw[k], 3)
		if k == "gold" {
			cost.Gold = v
			continue
		}
		// Every cost key is a good reference, including zero amounts, which
		// are validated here because they are not kept in Materials.
		if goods[k] == nil {
			col.add(file, ent, "cost."+k, "unknown good %q", k)
			continue
		}
		if v > 0 {
			cost.Materials = append(cost.Materials, GoodAmount{Good: k, Amount: v})
		}
	}
	return cost
}

// normaliseNeedWeights turns the authored need weights into the
// satisfaction weights (D-056 cumulative tiers): in a tier that carries
// lower-tier categories its own required needs (weights summing to 1)
// share OwnTierWeight, and every lower tier an equal part of the rest,
// split by the authored weights of its categories. Rounding goes to the
// last required need, so the required weights sum to exactly WeightScale.
// Optional needs keep their weights (they have no effect).
func normaliseNeedWeights(c *Catalogue) {
	for _, needs := range c.NeedsByTier {
		lowerSum := map[string]int64{}
		var lowerTiers []string
		for _, n := range needs {
			if n.Kind != NeedRequired || n.FromTier == "" {
				continue
			}
			if _, ok := lowerSum[n.FromTier]; !ok {
				lowerTiers = append(lowerTiers, n.FromTier)
			}
			lowerSum[n.FromTier] += n.Weight
		}
		if len(lowerTiers) == 0 {
			continue
		}
		perTier := (WeightScale - OwnTierWeight) / int64(len(lowerTiers))
		var total int64
		var last *Need
		for _, n := range needs {
			if n.Kind != NeedRequired {
				continue
			}
			if n.FromTier == "" {
				n.Weight = n.Weight * OwnTierWeight / WeightScale
			} else {
				n.Weight = n.Weight * perTier / lowerSum[n.FromTier]
			}
			total += n.Weight
			last = n
		}
		last.Weight += WeightScale - total
	}
}

// defaultShare is the share of an alternative without an authored one
// (D-056 amendment): 1.0 for a lone alternative, 0.6 for each of two or
// more.
func defaultShare(alternatives int) int64 {
	if alternatives == 1 {
		return ShareLone
	}
	return ShareAlternative
}
