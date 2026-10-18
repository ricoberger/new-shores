// Command server is the New Shores game server. In this milestone it is a
// stub that only reports its version; the HTTP API and the events worker
// follow in later milestones (docs/FIRST_PLAYABLE.md).
package main

import (
	"fmt"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	fmt.Printf("new-shores server %s\n", version)
}
