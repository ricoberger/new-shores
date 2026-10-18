package content

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"

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
)

var contentFiles = []string{FileRegion, FileTiers, FileGoods, FileBuildings, FileNeeds}

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
	} `json:"rules"`
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
		Population     map[string]int64 `json:"population"`
		Buildings      []string         `json:"buildings"`
		GoodsDelivered []string         `json:"goods_delivered"`
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

type rawBuilding struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Region        string                 `json:"region"`
	Tier          string                 `json:"tier"`
	Footprint     []int                  `json:"footprint"`
	Coastal       bool                   `json:"coastal"`
	RequiresRoad  bool                   `json:"requires_road"`
	Cost          map[string]json.Number `json:"cost"`
	Upkeep        json.Number            `json:"upkeep_per_min"`
	PauseCategory string                 `json:"pause_category"`
	Recipe        *struct {
		Inputs       []rawGoodAmount `json:"inputs"`
		Outputs      []rawGoodAmount `json:"outputs"`
		CycleSeconds json.Number     `json:"cycle_seconds"`
	} `json:"recipe"`
	House     *House `json:"house"`
	Warehouse *struct {
		Levels []struct {
			Capacity   json.Number `json:"capacity"`
			Throughput json.Number `json:"throughput_per_min"`
		} `json:"levels"`
	} `json:"warehouse"`
	Road *struct {
		SecondsPerTile json.Number `json:"seconds_per_tile"`
	} `json:"road"`
	Service *struct {
		Radius int `json:"radius"`
	} `json:"service"`
	WorkArea *struct {
		Radius        int      `json:"radius"`
		Terrain       []string `json:"terrain"`
		RequiredTiles int      `json:"required_tiles"`
	} `json:"work_area"`
}

type rawNeed struct {
	ID                string      `json:"id"`
	Tier              string      `json:"tier"`
	Good              string      `json:"good"`
	PerResidentPerMin json.Number `json:"per_resident_per_min"`
	Building          string      `json:"building"`
	Radius            int         `json:"radius"`
	Weight            json.Number `json:"weight"`
	Category          string      `json:"category"`
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
	)
	for name, v := range map[string]any{
		FileRegion: &region, FileTiers: &tiers, FileGoods: &goods, FileBuildings: &buildings, FileNeeds: &needs,
	} {
		if err := unmarshal(raw[name], v); err != nil {
			return nil, &Error{File: name, Msg: fmt.Sprintf("decode: %v", err)}
		}
	}

	col := &collector{}
	cat := &Catalogue{
		TierByID:     map[string]*Tier{},
		GoodByID:     map[string]*Good{},
		BuildingByID: map[string]*Building{},
		NeedsByTier:  map[string][]*Need{},
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
		},
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
				Population:     t.Unlock.Population,
				Buildings:      t.Unlock.Buildings,
				GoodsDelivered: t.Unlock.GoodsDelivered,
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
		b := decodeBuilding(col, ent, rb)
		cat.Buildings = append(cat.Buildings, b)
		cat.BuildingByID[b.ID] = b
	}

	seenNeeds := map[string]bool{}
	for _, rn := range needs {
		ent := fmt.Sprintf("need %q", rn.ID)
		if seenNeeds[rn.ID] {
			col.add(FileNeeds, ent, "id", "duplicate ID")
			continue
		}
		seenNeeds[rn.ID] = true
		n := &Need{
			ID:       rn.ID,
			Tier:     rn.Tier,
			Good:     rn.Good,
			Building: rn.Building,
			Radius:   rn.Radius,
			Weight:   col.fixed(FileNeeds, ent, "weight", rn.Weight, 6),
			Category: rn.Category,
		}
		n.PerResidentPerMin = col.fixed(FileNeeds, ent, "per_resident_per_min", rn.PerResidentPerMin, 3)
		cat.NeedsByTier[n.Tier] = append(cat.NeedsByTier[n.Tier], n)
	}

	if err := col.err(); err != nil {
		return nil, err
	}
	return cat, nil
}

func decodeBuilding(col *collector, ent string, rb rawBuilding) *Building {
	const file = FileBuildings
	b := &Building{
		ID:            rb.ID,
		Name:          rb.Name,
		Region:        rb.Region,
		Tier:          rb.Tier,
		Coastal:       rb.Coastal,
		RequiresRoad:  rb.RequiresRoad,
		UpkeepPerMin:  col.fixed(file, ent, "upkeep_per_min", rb.Upkeep, 3),
		PauseCategory: rb.PauseCategory,
		House:         rb.House,
	}
	if len(rb.Footprint) == 2 {
		b.Width, b.Height = rb.Footprint[0], rb.Footprint[1]
	}
	if b.Width < 1 || b.Height < 1 {
		col.add(file, ent, "footprint", "must be at least 1x1")
	}

	keys := make([]string, 0, len(rb.Cost))
	for k := range rb.Cost {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		v := col.fixed(file, ent, "cost."+k, rb.Cost[k], 3)
		if k == "gold" {
			b.Cost.Gold = v
			continue
		}
		if v > 0 {
			b.Cost.Materials = append(b.Cost.Materials, GoodAmount{Good: k, Amount: v})
		}
	}

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
			rec.Inputs = append(rec.Inputs, GoodAmount{Good: in.Good, Amount: a})
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
	if w := rb.Warehouse; w != nil {
		wh := &Warehouse{}
		for i, l := range w.Levels {
			wh.Levels = append(wh.Levels, WarehouseLevel{
				Capacity:         col.fixed(file, ent, fmt.Sprintf("warehouse.levels[%d].capacity", i), l.Capacity, 3),
				ThroughputPerMin: col.fixed(file, ent, fmt.Sprintf("warehouse.levels[%d].throughput_per_min", i), l.Throughput, 3),
			})
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
		b.Service = &Service{Radius: s.Radius}
	}
	if wa := rb.WorkArea; wa != nil {
		b.WorkArea = &WorkArea{Radius: wa.Radius, Terrain: wa.Terrain, RequiredTiles: wa.RequiredTiles}
		if wa.RequiredTiles < 1 {
			col.add(file, ent, "work_area.required_tiles", "must be >= 1")
		}
	}
	return b
}
