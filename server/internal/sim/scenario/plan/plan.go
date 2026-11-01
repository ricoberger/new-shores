// Package plan generates the reference games (D-067): a declarative plan
// (build order with counts and tiers, island assignment, quarters with
// reserved civic plots, routes, checkpoints) is laid out on the loaded
// terrain through the server's own placement validation, scheduled with
// whole-minute waits where stock or gold is short, and emitted as a
// scenario. The committed scenario is the generator's output; plans, not
// steps, are the source.
package plan

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ricoberger/new-shores/server/internal/sim/scenario"
)

// Plan is a reference-game plan file (server/testdata/plans).
type Plan struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Content, Start and Seed become the scenario's header.
	Content       string        `json:"content"`
	Start         time.Time     `json:"start"`
	Seed          scenario.Seed `json:"seed"`
	SnapshotEvery int           `json:"snapshot_every,omitempty"`
	// Continues names a plan file (same directory) this plan continues:
	// its actions run first, without its final wait.
	Continues string `json:"continues,omitempty"`
	// ActionsOf names a plan file (same directory) whose quarters and
	// actions this plan runs instead of its own (with other claims or
	// waits).
	ActionsOf string `json:"actions_of,omitempty"`
	// ClaimQuests is the island that receives quest rewards: every
	// completed quest is claimed right after the step that completed it.
	// Empty: no claims.
	ClaimQuests string `json:"claim_quests,omitempty"`
	// Road is the road type the generator lays.
	Road string `json:"road,omitempty"`
	// MaxWait bounds the wait for one action (default 240m).
	MaxWait string `json:"max_wait,omitempty"`
	// Chains are the ranked public-service chains (D-065) the quarters'
	// served tiers need: the generator reserves their plots by coverage.
	Chains   *Chains   `json:"chains,omitempty"`
	Quarters []Quarter `json:"quarters,omitempty"`
	Actions  []Action  `json:"actions,omitempty"`
}

// Quarter is a residential quarter: civic plots reserved when its island
// is founded (or when the plan starts, if it already is), and the houses
// placed within the first-level service radius of every civic plot.
type Quarter struct {
	ID     string `json:"id"`
	Island string `json:"island"`
	// At is the anchor (island tile); default: the roomiest land within
	// reach of Near, or else of the Trading Post.
	At *[2]int `json:"at,omitempty"`
	// Near (island tile) narrows the roomiest land to anchorNear tiles
	// around it.
	Near *[2]int `json:"near,omitempty"`
	// Civic lists the reserved public buildings in layout order; the first
	// is the quarter's centre.
	Civic []string `json:"civic"`
	// Reach lists public buildings reserved outside the house land, each
	// where its first-level radius covers the most of it: the buildings
	// only upgraded houses need (upgrades prefer the houses most of them
	// cover).
	Reach []string `json:"reach,omitempty"`
	// Houses is the number of houses the quarter must hold.
	Houses int `json:"houses"`
	// Serves counts the quarter's houses per tier (above the first) that
	// the chains must cover; the plan's upgrades may not exceed it.
	Serves map[string]int `json:"serves,omitempty"`
	// Rings let some of them stand where only the first civic plots
	// cover them.
	Rings []Ring `json:"rings,omitempty"`
	Note  string `json:"note,omitempty"`
}

// Chains declares the ranked service chains (D-065).
type Chains struct {
	// Buildings lists each chain's public buildings by rank (rank 1
	// first).
	Buildings map[string][]string `json:"buildings"`
	// MinRank is the lowest rank of each chain a tier's houses need.
	MinRank map[string]map[string]int `json:"min_rank"`
}

// Ring is an outer ring of a quarter: at most Houses of its houses need
// only the first Civic civic plots (houses that are upgraded less;
// upgrades prefer the houses most plots cover).
type Ring struct {
	Houses int `json:"houses"`
	Civic  int `json:"civic"`
}

// Action is one entry of a plan's build order: exactly one operation,
// with an optional note.
type Action struct {
	Note string `json:"note,omitempty"`

	// Found settles an island with an idle ship at its island.
	Found *Found `json:"found,omitempty"`
	// Build places production buildings (a farm with its fields).
	Build *Build `json:"build,omitempty"`
	// Houses places houses in a quarter.
	Houses *Houses `json:"houses,omitempty"`
	// Civic places a quarter's reserved public building.
	Civic *Civic `json:"civic,omitempty"`
	// Upgrade upgrades the oldest houses of a type in a quarter.
	Upgrade *Upgrade `json:"upgrade,omitempty"`
	// UpgradeCivic upgrades a quarter's public building one level.
	UpgradeCivic *Civic `json:"upgrade_civic,omitempty"`
	// UpgradeWarehouse upgrades the island's lowest-level warehouse.
	UpgradeWarehouse *IslandRef `json:"upgrade_warehouse,omitempty"`
	// UpgradeTradingPost upgrades the island's Trading Post.
	UpgradeTradingPost *IslandRef `json:"upgrade_trading_post,omitempty"`
	// OrderShip orders a ship at the island's shipyard.
	OrderShip *OrderShip `json:"order_ship,omitempty"`
	// Step is a scenario step run as is (ships, shipments, routes).
	Step *scenario.Step `json:"step,omitempty"`
	// Wait advances by a duration (at least a minute).
	Wait string `json:"wait,omitempty"`
	// Checkpoint waits (whole minutes) until a condition holds.
	Checkpoint *Checkpoint `json:"checkpoint,omitempty"`
}

// Found settles an island; At is the Trading Post site (x, y, rotation),
// default the roomiest site.
type Found struct {
	Ship   int64   `json:"ship"`
	Island string  `json:"island"`
	At     *[3]int `json:"at,omitempty"`
}

// Build places Count buildings of a type on an island, nearest to At
// (default: the forest for a lumberjack, open land for a farm, the
// Trading Post otherwise).
type Build struct {
	Island string `json:"island"`
	Type   string `json:"type"`
	Count  int    `json:"count,omitempty"`
	// Near "forest" anchors at the nearest forest a road reaches.
	Near string  `json:"near,omitempty"`
	At   *[2]int `json:"at,omitempty"`
}

// Houses places Count settler houses in a quarter.
type Houses struct {
	Quarter string `json:"quarter"`
	Count   int    `json:"count"`
}

// Civic names a quarter's reserved public building.
type Civic struct {
	Quarter string `json:"quarter"`
	Type    string `json:"type"`
}

// Upgrade upgrades the Count oldest houses of type From in a quarter.
type Upgrade struct {
	Quarter string `json:"quarter"`
	From    string `json:"from"`
	Count   int    `json:"count"`
}

// IslandRef names an island.
type IslandRef struct {
	Island string `json:"island"`
}

// OrderShip orders a ship type at the island's shipyard.
type OrderShip struct {
	Island   string `json:"island"`
	ShipType string `json:"ship_type"`
}

// Checkpoint waits until a condition holds, at most Max.
type Checkpoint struct {
	Name string `json:"name"`
	// Needs holds when at least one house of the type exists and every
	// need of every such house is at least MinPermille fulfilled.
	Needs *NeedsCheck `json:"needs,omitempty"`
	// Stock holds when the island has stock of the good.
	Stock *StockCheck `json:"stock,omitempty"`
	Max   string      `json:"max"`
}

// NeedsCheck is a Checkpoint condition on houses.
type NeedsCheck struct {
	House       string `json:"house"`
	MinPermille int64  `json:"min_permille"`
}

// StockCheck is a Checkpoint condition on stock.
type StockCheck struct {
	Island string `json:"island"`
	Good   string `json:"good"`
}

// Load reads and validates a plan file.
func Load(path string) (*Plan, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- plan path given by the caller.
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var p Plan
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("plan %s: %w", filepath.Base(path), err)
	}
	if err := p.validate(); err != nil {
		return nil, fmt.Errorf("plan %s: %w", filepath.Base(path), err)
	}
	return &p, nil
}

func (p *Plan) validate() error {
	if p.Name == "" {
		return errors.New("name is required")
	}
	if p.Continues != "" && p.ActionsOf != "" {
		return errors.New("set at most one of continues and actions_of")
	}
	if p.ActionsOf != "" && (len(p.Actions) > 0 || len(p.Quarters) > 0) {
		return errors.New("actions_of replaces the plan's quarters and actions")
	}
	if p.Chains != nil {
		for tier, ranks := range p.Chains.MinRank {
			for chain, r := range ranks {
				if r < 0 || r > len(p.Chains.Buildings[chain]) {
					return fmt.Errorf("chains: tier %q needs rank %d of %q, which has %d", tier, r, chain, len(p.Chains.Buildings[chain]))
				}
			}
		}
	}
	ids := map[string]bool{}
	for _, q := range p.Quarters {
		if q.ID == "" || q.Island == "" || len(q.Civic) == 0 {
			return fmt.Errorf("quarter %q: id, island and civic are required", q.ID)
		}
		for i, r := range q.Rings {
			if r.Houses < 1 || r.Civic < 1 || r.Civic >= len(q.Civic) || (i > 0 && r.Civic <= q.Rings[i-1].Civic) {
				return fmt.Errorf("quarter %q: rings need houses and 1 <= civic < %d, ascending", q.ID, len(q.Civic))
			}
		}
		for tier := range q.Serves {
			if p.Chains == nil || p.Chains.MinRank[tier] == nil {
				return fmt.Errorf("quarter %q serves %q, which the chains do not rank", q.ID, tier)
			}
		}
		if ids[q.ID] {
			return fmt.Errorf("quarter %q declared twice", q.ID)
		}
		ids[q.ID] = true
	}
	for i, a := range p.Actions {
		if n := a.ops(); n > 1 || (n == 0 && a.Note == "") {
			return fmt.Errorf("action %d: set exactly one operation (or only a note)", i)
		}
	}
	if p.MaxWait != "" {
		if _, err := time.ParseDuration(p.MaxWait); err != nil {
			return fmt.Errorf("max_wait: %w", err)
		}
	}
	return nil
}

// ops counts the operations an action sets.
func (a Action) ops() int {
	n := 0
	for _, set := range []bool{
		a.Found != nil, a.Build != nil, a.Houses != nil, a.Civic != nil, a.Upgrade != nil,
		a.UpgradeCivic != nil, a.UpgradeWarehouse != nil, a.UpgradeTradingPost != nil,
		a.OrderShip != nil, a.Step != nil, a.Wait != "", a.Checkpoint != nil,
	} {
		if set {
			n++
		}
	}
	return n
}
