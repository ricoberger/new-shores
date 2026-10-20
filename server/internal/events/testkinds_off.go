//go:build !testevents

package events

// TestKindsCompiled reports whether the test-only event kinds are compiled
// in (build tag testevents).
const TestKindsCompiled = false

func registerTestKinds(*Registry) {}
