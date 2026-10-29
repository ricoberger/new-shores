package sim

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// Terrain persistence (D-054). The tile rows of the islands are the bulk of
// a world at the final island sizes and never change after the world was
// generated (only a re-roll replaces them), so the store keeps them apart
// from the state envelope: EncodeState writes the envelope without tiles
// and the gzip-compressed terrain, keyed by the world's TerrainKey;
// DecodeState joins them again. The simulation always works on full
// islands. Encode and Decode keep the full envelope (scenarios, fixtures).

// TerrainKey identifies the terrain of a world: the archipelago seed and
// re-roll count (D-053); {0, 0} for a hand-made world.
type TerrainKey struct {
	Seed uint64
	Roll int
}

// TerrainKey returns the key of the world's current terrain.
func (w *World) TerrainKey() TerrainKey {
	return TerrainKey{Seed: w.Seed, Roll: w.ArchipelagoRoll}
}

// terrainDoc is the uncompressed terrain: per island one byte per tile
// (row-major), the levels and heights as one digit per tile (omitted
// when all are zero, D-058) and the deposits by tile index.
type terrainDoc struct {
	Islands []terrainIsland `json:"islands"`
}

type terrainIsland struct {
	ID       string           `json:"id"`
	Width    int              `json:"width"`
	Height   int              `json:"height"`
	Rows     string           `json:"rows"`
	Levels   string           `json:"levels,omitempty"`
	Heights  string           `json:"heights,omitempty"`
	Deposits []terrainDeposit `json:"deposits,omitempty"`
}

type terrainDeposit struct {
	Index int `json:"i"`
	Deposit
}

// terrainCode returns the one-byte code of a terrain (the codes of the
// ASCII island rows of the scenarios).
func terrainCode(name string) (byte, bool) {
	switch name {
	case content.TerrainWater:
		return '~', true
	case content.TerrainCoast:
		return 'c', true
	case content.TerrainGrass:
		return '.', true
	case content.TerrainForest:
		return 'f', true
	case content.TerrainMountain:
		return 'm', true
	case content.TerrainRiver:
		return 'r', true
	case content.TerrainIslet:
		return 'i', true
	case content.TerrainCliff:
		return 'k', true
	}
	return 0, false
}

// terrainName is the inverse of terrainCode.
func terrainName(code byte) (string, bool) {
	switch code {
	case '~':
		return content.TerrainWater, true
	case 'c':
		return content.TerrainCoast, true
	case '.':
		return content.TerrainGrass, true
	case 'f':
		return content.TerrainForest, true
	case 'm':
		return content.TerrainMountain, true
	case 'r':
		return content.TerrainRiver, true
	case 'i':
		return content.TerrainIslet, true
	case 'k':
		return content.TerrainCliff, true
	}
	return "", false
}

// digit decodes one level or height digit.
func digit(b byte) (int, bool) {
	if b < '0' || b > '9' {
		return 0, false
	}
	return int(b - '0'), true
}

// EncodeTerrain returns the gzip-compressed terrain of the world's islands.
// The output is deterministic.
func EncodeTerrain(w *World) ([]byte, error) {
	var doc terrainDoc
	for _, is := range w.Islands {
		if len(is.Tiles) != is.Width*is.Height {
			return nil, fmt.Errorf("encode terrain: island %q has %d tiles for %dx%d", is.ID, len(is.Tiles), is.Width, is.Height)
		}
		rows := make([]byte, len(is.Tiles))
		levels := make([]byte, len(is.Tiles))
		heights := make([]byte, len(is.Tiles))
		var anyLevel, anyHeight bool
		ti := terrainIsland{ID: is.ID, Width: is.Width, Height: is.Height}
		for i, t := range is.Tiles {
			code, ok := terrainCode(t.Terrain)
			if !ok {
				return nil, fmt.Errorf("encode terrain: island %q tile %d has unknown terrain %q", is.ID, i, t.Terrain)
			}
			if t.Level < 0 || t.Level > 9 || t.Height < 0 || t.Height > 9 {
				return nil, fmt.Errorf("encode terrain: island %q tile %d has level %d height %d outside 0-9", is.ID, i, t.Level, t.Height)
			}
			rows[i] = code
			levels[i], heights[i] = '0'+byte(t.Level), '0'+byte(t.Height) // #nosec G115 -- 0-9
			anyLevel, anyHeight = anyLevel || t.Level != 0, anyHeight || t.Height != 0
			if t.Deposit != nil {
				ti.Deposits = append(ti.Deposits, terrainDeposit{Index: i, Deposit: *t.Deposit})
			}
		}
		ti.Rows = string(rows)
		if anyLevel {
			ti.Levels = string(levels)
		}
		if anyHeight {
			ti.Heights = string(heights)
		}
		doc.Islands = append(doc.Islands, ti)
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("encode terrain: %w", err)
	}
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("encode terrain: %w", err)
	}
	if _, err := zw.Write(data); err != nil {
		return nil, fmt.Errorf("encode terrain: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("encode terrain: %w", err)
	}
	return buf.Bytes(), nil
}

// AttachTerrain sets the tiles of the world's islands from an EncodeTerrain
// output. Every island of the world must have its terrain with matching
// dimensions; terrain of islands the world does not have is an error.
func AttachTerrain(w *World, data []byte) error {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode terrain: %w", err)
	}
	var raw bytes.Buffer
	if _, err := raw.ReadFrom(zr); err != nil {
		return fmt.Errorf("decode terrain: %w", err)
	}
	var doc terrainDoc
	if err := json.Unmarshal(raw.Bytes(), &doc); err != nil {
		return fmt.Errorf("decode terrain: %w", err)
	}
	if len(doc.Islands) != len(w.Islands) {
		return fmt.Errorf("decode terrain: %d islands for a world of %d", len(doc.Islands), len(w.Islands))
	}
	for k, ti := range doc.Islands {
		is := w.Islands[k]
		if ti.ID != is.ID || ti.Width != is.Width || ti.Height != is.Height || len(ti.Rows) != ti.Width*ti.Height {
			return fmt.Errorf("decode terrain: island %q %dx%d (%d tiles) does not match %q %dx%d",
				ti.ID, ti.Width, ti.Height, len(ti.Rows), is.ID, is.Width, is.Height)
		}
		if (ti.Levels != "" && len(ti.Levels) != len(ti.Rows)) || (ti.Heights != "" && len(ti.Heights) != len(ti.Rows)) {
			return fmt.Errorf("decode terrain: island %q levels or heights do not match its %d tiles", ti.ID, len(ti.Rows))
		}
		tiles := make([]Tile, len(ti.Rows))
		for i := range len(ti.Rows) {
			name, ok := terrainName(ti.Rows[i])
			if !ok {
				return fmt.Errorf("decode terrain: island %q tile %d has unknown code %q", ti.ID, i, ti.Rows[i])
			}
			tiles[i].Terrain = name
			if ti.Levels != "" {
				if tiles[i].Level, ok = digit(ti.Levels[i]); !ok {
					return fmt.Errorf("decode terrain: island %q tile %d has level %q", ti.ID, i, ti.Levels[i])
				}
			}
			if ti.Heights != "" {
				if tiles[i].Height, ok = digit(ti.Heights[i]); !ok {
					return fmt.Errorf("decode terrain: island %q tile %d has height %q", ti.ID, i, ti.Heights[i])
				}
			}
		}
		for _, d := range ti.Deposits {
			if d.Index < 0 || d.Index >= len(tiles) {
				return fmt.Errorf("decode terrain: island %q deposit at %d out of range", ti.ID, d.Index)
			}
			dep := d.Deposit
			tiles[d.Index].Deposit = &dep
		}
		is.Tiles = tiles
	}
	return nil
}

// EncodeState returns the state envelope of the world without the island
// tiles and the world's terrain (EncodeTerrain).
func EncodeState(w *World, contentVersion string) (state, terrain []byte, err error) {
	terrain, err = EncodeTerrain(w)
	if err != nil {
		return nil, nil, err
	}
	bare := *w
	bare.Islands = make([]*Island, len(w.Islands))
	for i, is := range w.Islands {
		c := *is
		c.Tiles = nil
		bare.Islands[i] = &c
	}
	state, err = Encode(&bare, contentVersion)
	if err != nil {
		return nil, nil, err
	}
	return state, terrain, nil
}

// DecodeState decodes a state envelope (Decode) and attaches its terrain.
// A state that still carries tiles (an envelope of Encode) keeps them when
// terrain is nil.
func DecodeState(state, terrain []byte, c *content.Catalogue) (*World, string, MigrationNotes, error) {
	w, cv, notes, err := Decode(state, c)
	if err != nil {
		return nil, "", notes, err
	}
	if terrain == nil {
		if slices.ContainsFunc(w.Islands, func(is *Island) bool { return len(is.Tiles) != is.Width*is.Height }) {
			return nil, "", notes, fmt.Errorf("decode state: islands without terrain")
		}
		return w, cv, notes, nil
	}
	if err := AttachTerrain(w, terrain); err != nil {
		return nil, "", notes, err
	}
	return w, cv, notes, nil
}
