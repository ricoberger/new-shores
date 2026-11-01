package plan

import (
	"fmt"
	"io"
	"maps"
	"os"
	"slices"
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
	"github.com/ricoberger/new-shores/server/internal/layout"
)

// debugMap writes the reservations around a quarter when the environment
// sets REPLAY_PLAN_MAP (generator development aid).
func (g *gen) debugMap(q *quarter, out io.Writer) {
	if out == nil || os.Getenv("REPLAY_PLAN_MAP") == "" {
		return
	}
	is := g.world().Island(q.spec.Island)
	letters := map[int]byte{}
	k := 0
	for _, key := range slices.Sorted(maps.Keys(q.plots)) {
		pl := q.plots[key]
		def := g.c.BuildingByID[pl.typ]
		w, h := layout.Dims(def, pl.rot)
		for y := pl.y; y < pl.y+h; y++ {
			for x := pl.x; x < pl.x+w; x++ {
				letters[y*is.Width+x] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[k]
			}
		}
		fmt.Fprintf(out, "  %c=%s", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[k], key)
		k++
	}
	fmt.Fprintln(out)
	g.dumpRect(out, is.ID, letters, q.index, max(0, q.centre.Y-40), min(is.Height, q.centre.Y+40), max(0, q.centre.X-60), min(is.Width, q.centre.X+60))
}

// dumpIsland writes a whole island (REPLAY_PLAN_MAP).
func (g *gen) dumpIsland(out io.Writer, island string) {
	if out == nil || os.Getenv("REPLAY_PLAN_MAP") == "" {
		return
	}
	is := g.world().Island(island)
	if is == nil {
		return
	}
	fmt.Fprintf(out, "island %s (%dx%d)\n", island, is.Width, is.Height)
	g.dumpRect(out, island, nil, -1, 0, is.Height, 0, is.Width)
}

func (g *gen) dumpRect(out io.Writer, island string, letters map[int]byte, own, y0, y1, x0, x1 int) {
	is := g.world().Island(island)
	cl := g.cellsOf(is)
	occ := is.Occupancy(g.c)
	for y := y0; y < y1; y++ {
		var b strings.Builder
		for x := x0; x < x1; x++ {
			i := y*is.Width + x
			var c byte
			switch {
			case letters[i] != 0:
				c = letters[i]
			case occ[i] != 0:
				c = '#'
				if bb := is.Building(occ[i]); bb != nil {
					if def := g.c.BuildingByID[bb.Type]; def != nil && def.House != nil {
						c = 'h'
					} else if def != nil && def.Field != nil {
						c = ','
					}
				}
			case cl.kind[i] == cellPlot:
				c = 'P'
			case is.RoadAt(x, y) != "":
				c = '+'
			case cl.kind[i] == cellRoad:
				c = '='
			case cl.kind[i] == cellRegion && (own < 0 || cl.owner[i] == own):
				c = 'o'
			case cl.kind[i] == cellRegion:
				c = 'x'
			default:
				switch is.Tile(x, y).Terrain {
				case content.TerrainWater:
					c = '~'
				case content.TerrainRiver:
					c = 'r'
				case content.TerrainForest:
					c = 'f'
				case content.TerrainGrass:
					c = '.'
				case content.TerrainCoast:
					c = ':'
				default:
					c = '^'
				}
			}
			b.WriteByte(c)
		}
		fmt.Fprintln(out, b.String())
	}
}
