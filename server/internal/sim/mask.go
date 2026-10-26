package sim

import (
	"strings"

	"github.com/ricoberger/new-shores/server/internal/content"
)

// MaskBlock is the side of the square tile block one character of the
// terrain mask stands for (1:4 downsampling).
const MaskBlock = 4

// maskChars are the characters of the mask's terrains in tie-break
// order: on a tie for the majority the earlier terrain wins, so water wins
// every tie (the outline never grows), then coast, mountain, forest,
// grass (maskIndex maps a terrain to its position).
const maskChars = "wcmfg"

// TerrainMask is the island's terrain downsampled 1:4 for the far view and
// the minimap: one character per MaskBlock × MaskBlock block of tiles,
// row-major over ceil(Width/4) × ceil(Height/4) blocks, the block's
// majority terrain ('w' water, 'c' coast, 'm' mountain, 'f' forest,
// 'g' grass; ties: maskChars). Edge blocks count only the tiles inside the
// island. Unknown terrain counts as water. Pure; render data only, no rule
// reads it.
func TerrainMask(is *Island) string {
	mw := (is.Width + MaskBlock - 1) / MaskBlock
	mh := (is.Height + MaskBlock - 1) / MaskBlock
	var b strings.Builder
	b.Grow(mw * mh)
	for by := range mh {
		for bx := range mw {
			var counts [len(maskChars)]int
			for y := by * MaskBlock; y < min(is.Height, (by+1)*MaskBlock); y++ {
				for x := bx * MaskBlock; x < min(is.Width, (bx+1)*MaskBlock); x++ {
					t := content.TerrainWater
					if i := y*is.Width + x; i < len(is.Tiles) {
						t = is.Tiles[i].Terrain
					}
					counts[maskIndex(t)]++
				}
			}
			best := 0
			for i := 1; i < len(counts); i++ {
				if counts[i] > counts[best] {
					best = i
				}
			}
			b.WriteByte(maskChars[best])
		}
	}
	return b.String()
}

func maskIndex(terrain string) int {
	switch terrain {
	case content.TerrainCoast:
		return 1
	case content.TerrainMountain:
		return 2
	case content.TerrainForest:
		return 3
	case content.TerrainGrass:
		return 4
	default:
		return 0 // water and unknown terrain
	}
}
