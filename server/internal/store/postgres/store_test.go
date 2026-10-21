package postgres

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// TestLogMigrationNotes: every farm whose efficiency the fields migration
// could not keep is logged at warning level with the world, island,
// building and counts; nothing is logged without shortfalls.
func TestLogMigrationNotes(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	LogMigrationNotes(logger, "w1", sim.MigrationNotes{})
	if buf.Len() != 0 {
		t.Fatalf("logged without shortfalls: %s", buf.String())
	}
	LogMigrationNotes(logger, "w1", sim.MigrationNotes{FieldShortfalls: []sim.FieldShortfall{
		{IslandID: "main", BuildingID: 2, Type: "sheep_farm", Placed: 2, Required: 16, OldEfficiency: 1000, NewEfficiency: 125},
		{IslandID: "isle", BuildingID: 9, Type: "wheat_farm", Placed: 0, Required: 16, OldEfficiency: 500, NewEfficiency: 0},
	}})
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("%d lines: %s", len(lines), buf.String())
	}
	for _, want := range []string{"level=WARN", "world_id=w1", "island_id=main", "building_id=2", "type=sheep_farm", "fields_placed=2",
		"fields_required=16", "old_efficiency_permille=1000", "new_efficiency_permille=125"} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("%q missing in %s", want, lines[0])
		}
	}
}
