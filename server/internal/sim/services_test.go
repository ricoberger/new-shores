package sim

import (
	"maps"
	"slices"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// servicesCatalogue returns the test catalogue with the Settlers' market
// need replaced by a services category of market and chapel (D-056, 0.6
// each) and a two-level market: radius 12, then 16 once Citizens are
// unlocked for 100 gold and 5 planks.
func servicesCatalogue(t *testing.T) *content.Catalogue {
	t.Helper()
	base := catalogue(t)
	c := *base
	c.NeedsByTier = maps.Clone(base.NeedsByTier)
	var needs []*content.Need
	for _, n := range base.NeedsByTier["settlers"] {
		if n.ID == "settlers_market_small" {
			n = &content.Need{
				ID: "settlers_services", Name: "Services", Tier: "settlers", Kind: content.NeedRequired, Weight: n.Weight, Category: "services",
				Buildings: []content.NeedBuilding{{Building: "market_small", Share: content.ShareAlternative}, {Building: "chapel", Share: content.ShareAlternative}},
			}
		}
		needs = append(needs, n)
	}
	c.NeedsByTier["settlers"] = needs
	c.BuildingByID = maps.Clone(base.BuildingByID)
	market := *base.BuildingByID["market_small"]
	market.Service = &content.Service{Levels: []content.ServiceLevel{
		{Radius: 12},
		{Radius: 16, Tier: "citizens", Cost: &content.Cost{Gold: 100_000, Materials: []content.GoodAmount{{Good: "planks", Amount: 5_000}}}},
	}}
	c.BuildingByID["market_small"] = &market
	return &c
}

func serviceNeed(t *testing.T, w *World, c *content.Catalogue, h int64) NeedDisplay {
	t.Helper()
	for _, n := range buildingDisplay(t, display(t, w, c), h).Needs {
		if n.ID == "settlers_services" {
			return n
		}
	}
	t.Fatal("no services need")
	return NeedDisplay{}
}

// TestServicesCategory (D-056 §3): every public building of the category
// that serves the house adds its share (0.6), coverage = min(1, sum); a
// building out of range adds nothing; the reason is ok as soon as one
// alternative serves.
func TestServicesCategory(t *testing.T) {
	c := withPauseCategory(servicesCatalogue(t), "chapel", "public")
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0] // footprint x 9..10, y 2..3

	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 0 || n.Reason != NeedOutOfRange || n.Category != "services" || n.Building != "" {
		t.Errorf("no service: %+v", n)
	}
	// Market x 22..24 at distance 12: one alternative, 0.6.
	m := placeFree(t, w, c, "market_small", 22, 1, 0)
	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 600 || n.Reason != NeedOK {
		t.Errorf("market only: %+v", n)
	}
	// Without goods: satisfaction = services weight 0.3 x 0.6.
	if b := buildingDisplay(t, display(t, w, c), h); *b.SatisfactionPermille != 180 || !slices.Equal(b.ServedBy, []int64{m}) {
		t.Errorf("market only: satisfaction %d served_by %v", *b.SatisfactionPermille, b.ServedBy)
	}
	// Chapel south of the road (x 20..21, y 5..6): both serve, 1.2 -> 1.
	ch := placeFree(t, w, c, "chapel", 20, 5, 0)
	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 1000 || n.Reason != NeedOK {
		t.Errorf("market and chapel: %+v", n)
	}
	if b := buildingDisplay(t, display(t, w, c), h); *b.SatisfactionPermille != 300 || !slices.Equal(b.ServedBy, []int64{m, ch}) {
		t.Errorf("market and chapel: satisfaction %d served_by %v", *b.SatisfactionPermille, b.ServedBy)
	}
	// A paused chapel no longer serves; the market alone gives 0.6.
	mustApply(t, w, c, SetPaused{IslandID: "main", BuildingID: ch, Paused: true})
	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 600 || n.Reason != NeedOK {
		t.Errorf("paused chapel: %+v", n)
	}
	// Without the market the paused chapel is the reason.
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: m})
	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 0 || n.Reason != NeedPaused {
		t.Errorf("paused chapel only: %+v", n)
	}
}

// TestUpgradeBuildingServiceLevels (D-056 §3): upgrade_building raises a
// public building with levels to its next level (its tier must be
// unlocked, its cost is charged), which widens the service radius; it
// upgrades houses like upgrade_house and fails for buildings without a
// next level.
func TestUpgradeBuildingServiceLevels(t *testing.T) {
	c := servicesCatalogue(t)
	w := newTown(t, c, 1_000)
	h := placeHouses(t, w, c, 1)[0]
	// Market x 24..26: distance 14, out of the level-1 radius 12.
	m := placeFree(t, w, c, "market_small", 24, 1, 0)
	if n := serviceNeed(t, w, c, h); n.Reason != NeedOutOfRange {
		t.Fatalf("level 1 at distance 14: %+v", n)
	}
	if d := buildingDisplay(t, display(t, w, c), m); d.Level == nil || *d.Level != 1 {
		t.Errorf("level display %v", d.Level)
	}

	cmd := UpgradeBuilding{IslandID: "main", BuildingID: m}
	expectApplyErr(t, w, c, cmd, ErrTierLocked)
	w.UnlockedTiers = append(w.UnlockedTiers, "citizens")
	gold := w.Gold
	w.Gold = 99_999
	expectApplyErr(t, w, c, cmd, ErrInsufficientGold)
	w.Gold = gold
	planks := w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, cmd)
	if b := w.Islands[0].Building(m); b.Level != 2 || w.Gold != gold-100_000 || w.Islands[0].Inventory.Stock["planks"] != planks-5_000 {
		t.Errorf("after upgrade: level %d gold %d planks %d", b.Level, w.Gold, w.Islands[0].Inventory.Stock["planks"])
	}
	if n := serviceNeed(t, w, c, h); n.FulfilmentPermille != 600 || n.Reason != NeedOK {
		t.Errorf("level 2 (radius 16) at distance 14: %+v", n)
	}
	if d := buildingDisplay(t, display(t, w, c), m); *d.Level != 2 {
		t.Errorf("level display %d", *d.Level)
	}
	expectApplyErr(t, w, c, cmd, ErrUpgradeUnavailable)

	// Demolishing refunds the placement and the paid level (D-019).
	planks = w.Islands[0].Inventory.Stock["planks"]
	mustApply(t, w, c, Demolish{IslandID: "main", BuildingID: m})
	if got, want := w.Islands[0].Inventory.Stock["planks"]-planks, refundAmount(15_000)+refundAmount(5_000); got != want {
		t.Errorf("refund %d, want %d", got, want)
	}

	// Other buildings: a chapel has no levels; a house goes the
	// upgrade_house way (not full yet); a Trading Post upgrades as with
	// upgrade_trading_post.
	ch := placeFree(t, w, c, "chapel", 20, 5, 0)
	expectApplyErr(t, w, c, UpgradeBuilding{IslandID: "main", BuildingID: ch}, ErrUpgradeUnavailable)
	expectApplyErr(t, w, c, UpgradeBuilding{IslandID: "main", BuildingID: h}, ErrHouseNotFull)
	expectApplyErr(t, w, c, UpgradeBuilding{IslandID: "main", BuildingID: 99}, ErrBuildingNotFound)
	w2 := w.Clone()
	err1 := Apply(w, c, UpgradeBuilding{IslandID: "main", BuildingID: 1})
	err2 := Apply(w2, c, UpgradeTradingPost{IslandID: "main", BuildingID: 1})
	if (err1 == nil) != (err2 == nil) || w.Islands[0].Building(1).Level != w2.Islands[0].Building(1).Level || w.Gold != w2.Gold {
		t.Errorf("upgrade_building on the Trading Post: %v vs %v", err1, err2)
	}
}
