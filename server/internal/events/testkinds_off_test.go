//go:build !testevents

package events

import "testing"

// TestNoTestKindsInProductionBuilds: without -tags testevents the
// test-only kinds do not exist.
func TestNoTestKindsInProductionBuilds(t *testing.T) {
	if TestKindsCompiled {
		t.Fatal("test kinds compiled without the testevents tag")
	}
	if _, ok := DefaultRegistry(DefaultPollInterval).Handler("test_credit"); ok {
		t.Fatal("test_credit is registered in a production build")
	}
}
