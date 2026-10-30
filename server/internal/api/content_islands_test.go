package api

import "testing"

// The size classes of the content payload carry the generator's numbers:
// size, count, the per-island pool ranges, the shape and the home class.
func TestSizeClassPayload(t *testing.T) {
	p := newContentPayload(shippedCatalogue(t))
	if len(p.SizeClasses) == 0 {
		t.Fatal("no size classes")
	}
	large := p.SizeClasses[0]
	want := sizeClassJSON{
		ID: "large", Name: "Large", Size: 192,
		Count: rangeJSON{3, 3}, Fertilities: rangeJSON{2, 4}, Deposits: rangeJSON{0, 4},
		Shape: shapeJSON{Arms: rangeJSON{1, 3}, Plain: 40, Rivers: rangeJSON{1, 2}, Levels: 2, Islets: rangeJSON{3, 6}},
		Home:  true,
	}
	if large != want {
		t.Errorf("large = %+v, want %+v", large, want)
	}
	for _, sc := range p.SizeClasses[1:] {
		if sc.Home {
			t.Errorf("%s is marked as the home class", sc.ID)
		}
	}
}
