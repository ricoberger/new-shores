package sim

import (
	"errors"
	"fmt"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Sentinel errors of the archipelago commands (D-053).
var (
	ErrRerollNotAllowed = errors.New("archipelago can no longer be rerolled")
	ErrInvalidName      = errors.New("invalid name")
)

// RerollArchipelago replaces the archipelago of a generated world by its
// next roll (reroll_archipelago, D-053): Islands and Spawn are the
// generated archipelago of the world seed's roll Roll, which must be the
// world's roll plus one. Only the server builds it (archipelago.Reroll);
// it is allowed while CanReroll holds. Every ship returns to Spawn.
type RerollArchipelago struct {
	Roll    int
	Islands []*Island
	Spawn   Pos
}

// RenameIsland renames a settled island; the name is trimmed and must
// then have 1 to content.MaxIslandNameRunes printable runes.
type RenameIsland struct {
	IslandID string
	Name     string
}

func (RerollArchipelago) isCommand() {}
func (RenameIsland) isCommand()      {}

// CanReroll reports why the archipelago can no longer be rerolled (nil
// when it can): the world must be generated (a seed), no island settled
// and every ship idle without a route, cargo handling or leg.
func CanReroll(w *World, c *content.Catalogue) error {
	if w.Seed == 0 {
		return fmt.Errorf("%w: the archipelago is not generated", ErrRerollNotAllowed)
	}
	for _, is := range w.Islands {
		if settled(is, c) {
			return fmt.Errorf("%w: island %q is settled", ErrRerollNotAllowed, is.ID)
		}
	}
	for _, s := range w.Ships {
		if s.Leg != nil || s.State != ShipIdle || s.RouteID != 0 || s.BerthUntilMs != 0 || s.QueuedAtMs != 0 {
			return fmt.Errorf("%w: ship %d is under way", ErrRerollNotAllowed, s.ID)
		}
	}
	return nil
}

func rerollArchipelago(w *World, c *content.Catalogue, cmd RerollArchipelago) error {
	if err := CanReroll(w, c); err != nil {
		return err
	}
	if cmd.Roll != w.ArchipelagoRoll+1 || len(cmd.Islands) == 0 {
		return fmt.Errorf("%w: roll %d of %d islands after roll %d", ErrInvalidCommand, cmd.Roll, len(cmd.Islands), w.ArchipelagoRoll)
	}
	w.Islands = cmd.Islands
	w.ArchipelagoRoll = cmd.Roll
	for _, s := range w.Ships {
		s.IslandID = ""
		s.AtSea = &Pos{X: cmd.Spawn.X, Y: cmd.Spawn.Y}
	}
	return nil
}

func renameIsland(w *World, c *content.Catalogue, cmd RenameIsland) error {
	is := w.Island(cmd.IslandID)
	if is == nil {
		return fmt.Errorf("%w: %q", ErrUnknownIsland, cmd.IslandID)
	}
	if !settled(is, c) {
		return fmt.Errorf("%w: %q", ErrIslandNotSettled, is.ID)
	}
	name := strings.TrimSpace(cmd.Name)
	if err := content.CheckIslandName(name); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidName, err)
	}
	is.Name = name
	return nil
}
