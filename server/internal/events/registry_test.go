package events

import (
	"slices"
	"testing"
	"time"
)

// TestDefaultRegistry: production builds (without the testevents tag)
// contain advance_to only; test_credit is compiled in only with the tag.
func TestDefaultRegistry(t *testing.T) {
	kinds := DefaultRegistry(time.Hour).Kinds()
	want := []string{KindAdvanceTo}
	if TestKindsCompiled {
		want = append(want, "test_credit")
	}
	if !slices.Equal(kinds, want) {
		t.Fatalf("kinds = %v, want %v (testevents tag: %v)", kinds, want, TestKindsCompiled)
	}
	if _, ok := DefaultRegistry(time.Hour).Handler("test_credit"); ok != TestKindsCompiled {
		t.Fatalf("test_credit registered = %v, want %v", ok, TestKindsCompiled)
	}
}

func TestRegisterTwicePanics(t *testing.T) {
	r := NewRegistry()
	r.Register("x", nil)
	defer func() {
		if recover() == nil {
			t.Fatal("no panic")
		}
	}()
	r.Register("x", nil)
}
