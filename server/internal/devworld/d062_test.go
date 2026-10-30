package devworld

import (
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
	"github.com/ricoberger/new-shores/server/internal/sim/archipelago"
)

// The site returned to the founding UI is the same content-sized site used
// by the default fixture, not the pre-D-062 6x9 site.
func TestD062FoundingSite(t *testing.T) {
	c := catalogue(t)
	w, err := New(c, DevSeed, start)
	if err != nil {
		t.Fatal(err)
	}
	def := c.BuildingByID["trading_post"]
	if def.Width != 6 || def.Height != 6 {
		t.Fatal("expected shipped 6x6 Trading Post")
	}
	site, ok := HomeTradingPostSite(c, w)
	if !ok {
		t.Fatal("no home site")
	}
	if site.W != 6 || site.H != 6 {
		t.Fatalf("site %+v", site)
	}
	if err := sim.CheckSite(w.Islands[0], c, def, site.X, site.Y, site.Rotation); err != nil {
		t.Fatal(err)
	}
	for _, is := range w.Islands {
		sc := c.Islands.SizeClassByID[is.SizeClass]
		if sc == nil || sc.Scenic || sc.Rock {
			continue
		}
		sites := archipelago.Sites(is, c, def)
		if len(sites) < 2 {
			t.Fatalf("%s: fewer than 2 content-sized sites", is.ID)
		}
	}
	founded, err := NewFixture(c, FixtureDefault, DevSeed, start)
	if err != nil {
		t.Fatal(err)
	}
	b := founded.Islands[0].Buildings[0]
	if b.X != site.X || b.Y != site.Y || b.Rotation != site.Rotation {
		t.Fatalf("default founds %+v, UI site %+v", b, site)
	}
}
