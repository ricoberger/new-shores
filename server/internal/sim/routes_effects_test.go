package sim

import (
	"reflect"
	"testing"
)

// TestRouteEffectsFormula pins the per-loop estimate of RouteDisplay.effects:
// top-up to min(max, hold), unload before load, carry-over settled by a
// first pass, ordering by first stop of the island then by good.
func TestRouteEffectsFormula(t *testing.T) {
	for _, tt := range []struct {
		name  string
		stops []Stop
		hold  Qty
		want  []routeEffect
	}{
		{
			name: "two stops",
			stops: []Stop{
				{IslandID: "a", Unload: []string{"fish"}},
				{IslandID: "b", Load: []LoadRule{{"fish", 50_000}}},
			},
			hold: 100_000,
			want: []routeEffect{{"a", "fish", 50_000}, {"b", "fish", -50_000}},
		},
		{
			name: "cap by hold",
			stops: []Stop{
				{IslandID: "a", Load: []LoadRule{{"wood", 200_000}}},
				{IslandID: "b", Unload: []string{"wood"}},
			},
			hold: 100_000,
			want: []routeEffect{{"a", "wood", -100_000}, {"b", "wood", 100_000}},
		},
		{
			// wood is loaded at a and topped up at b before it is
			// unloaded at c; the hold keeps nothing across the loop.
			name: "carry-over",
			stops: []Stop{
				{IslandID: "a", Load: []LoadRule{{"wood", 30_000}}, Unload: []string{"fish"}},
				{IslandID: "b", Load: []LoadRule{{"wood", 50_000}, {"fish", 10_000}}},
				{IslandID: "c", Unload: []string{"wood"}},
			},
			hold: 100_000,
			want: []routeEffect{
				{"a", "fish", 10_000}, {"a", "wood", -30_000},
				{"b", "fish", -10_000}, {"b", "wood", -20_000},
				{"c", "wood", 50_000},
			},
		},
		{
			// Fish loaded at b is never unloaded: the first pass fills
			// the hold, the second loads nothing (zero entries omitted).
			name: "never unloaded",
			stops: []Stop{
				{IslandID: "a"},
				{IslandID: "b", Load: []LoadRule{{"fish", 20_000}}},
			},
			hold: 100_000,
			want: nil,
		},
		{
			// Carry-over across the loop: wood loaded at b is unloaded at
			// a (stop 0) only in the next loop.
			name: "carry across loop",
			stops: []Stop{
				{IslandID: "a", Unload: []string{"wood"}},
				{IslandID: "b", Load: []LoadRule{{"wood", 40_000}}},
				{IslandID: "c", Load: []LoadRule{{"wood", 60_000}}},
			},
			hold: 50_000,
			want: []routeEffect{{"a", "wood", 50_000}, {"b", "wood", -40_000}, {"c", "wood", -10_000}},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := routeEffects(&Route{Stops: tt.stops}, tt.hold)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("routeEffects = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// TestRouteEffectsDisplay: fish up to 50 from island b, unloaded at a.
// per_min is 0 without ships, per_loop × ships × 60 000 / loop_ms with one
// and two sloops; the hold falls back to the catalogue's smallest ship.
func TestRouteEffectsDisplay(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	mustApply(t, w, c, CreateRoute{Stops: []Stop{
		{IslandID: "a", Unload: []string{"fish"}},
		{IslandID: "b", Load: []LoadRule{{"fish", 50_000}}},
	}})
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "a"}, {IslandID: "b"}}})
	check := func(label string, perMin Qty) {
		t.Helper()
		ds := display(t, w, c)
		r := ds.Routes[0]
		want := []RouteEffectDisplay{{"a", "fish", 50_000, perMin}, {"b", "fish", -50_000, -perMin}}
		if !reflect.DeepEqual(r.Effects, want) {
			t.Errorf("%s: effects = %+v, want %+v (loop %d ms)", label, r.Effects, want, r.LoopMs)
		}
		if e := ds.Routes[1].Effects; e == nil || len(e) != 0 {
			t.Errorf("%s: empty route effects = %#v, want []", label, e)
		}
	}
	loopMs := display(t, w, c).Routes[0].LoopMs
	check("no ship", 0)
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	check("one sloop", 50_000*60_000/loopMs)
	s2 := builtSloop(t, w, c)
	mustApply(t, w, c, AssignShip{ShipID: s2.ID, RouteID: 1})
	check("two sloops", 2*50_000*60_000/loopMs)
	if got := routePerMin(-50_000, 1, 70_000); got != -42_857 {
		t.Errorf("routePerMin truncation = %d, want -42857", got)
	}
	if got := routePerMin(50_000, 1, 0); got != 0 {
		t.Errorf("routePerMin without loop time = %d", got)
	}
}

// TestRouteHold: the smallest assigned ship's hold, else the catalogue's
// smallest ship type.
func TestRouteHold(t *testing.T) {
	c := catalogue(t)
	w, s := routeWorld(t, c)
	mustApply(t, w, c, CreateRoute{Stops: []Stop{{IslandID: "a"}, {IslandID: "b"}}})
	r := w.Route(1)
	if h, n := routeHold(w, c, r); h != 200_000 || n != 0 {
		t.Errorf("unassigned hold = %d, %d ships", h, n)
	}
	mustApply(t, w, c, AssignShip{ShipID: s.ID, RouteID: 1})
	if h, n := routeHold(w, c, r); h != 200_000 || n != 1 {
		t.Errorf("assigned hold = %d, %d ships", h, n)
	}
}
