package api

import (
	"testing"

	"github.com/ricoberger/new-shores/server/internal/content"
)

func TestD062ContentAndTranslation(t *testing.T) {
	c := shippedCatalogue(t)
	for _, lang := range []string{"en", "de"} {
		p := newContentPayload(c, lang)
		byID := map[string]buildingJSON{}
		for _, b := range p.Buildings {
			byID[b.ID] = b
		}
		if _, ok := byID["theatre"]; ok {
			t.Fatal("retired theatre served")
		}
		b := byID["playhouse"]
		want := "Playhouse"
		if lang == "de" {
			want = "Schauspielhaus"
		}
		if b.Name != want || b.Description == "" || b.Width != 11 || b.Height != 14 || b.Service.Radius != 24 {
			t.Fatalf("%s playhouse %+v", lang, b)
		}
		if lang == "de" && b.Description == c.BuildingByID["playhouse"].Description {
			t.Fatal("description not translated")
		}
		surgery := byID["surgery"]
		if surgery.Tier != "patricians" || surgery.Service.Radius != 20 || len(surgery.Service.Levels) != 1 || surgery.Cost.Materials["glass"] != 5000 {
			t.Fatal("surgery mismatch")
		}
		tp := byID["trading_post"]
		if tp.Width != 6 || tp.Height != 6 || *tp.WaterRows != (content.WaterRows{Min: 1, Max: 2}) {
			t.Fatal("Trading Post mismatch")
		}
	}
}
