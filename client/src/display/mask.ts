// Terrain mask of an island (render data only, no rule reads it): the
// server's 1:4 downsampling of the terrain rows that the world payload
// carries for every island (`terrain_mask`). One character per 4 × 4 block,
// row-major over ceil(width / 4) × ceil(height / 4) blocks, the block's
// majority terrain; ties go to the earlier letter of MASK_CHARS (water wins
// every tie); edge blocks count only the island's tiles. encodeMask mirrors
// the server's sim.TerrainMask for fixtures, which build their masks from
// their rows.
import type { Terrain } from "../api/client";

/** Side of the tile block one mask cell stands for. */
export const MASK_BLOCK = 4;

/** Mask characters in tie-break order. */
export const MASK_CHARS = "wcmfg";

/** Terrain of each mask character, in MASK_CHARS order. */
export const MASK_TERRAINS: readonly Terrain[] = ["water", "coast", "mountain", "forest", "grass"];

/** Mask cell codes (indices into MASK_TERRAINS). */
export const MASK_WATER = 0;
export const MASK_COAST = 1;
export const MASK_MOUNTAIN = 2;
export const MASK_FOREST = 3;
export const MASK_GRASS = 4;

/** A decoded mask: cells of ceil(width/4) × ceil(height/4), codes MASK_*. */
export interface DecodedMask {
  /** Columns of mask cells. */
  width: number;
  /** Rows of mask cells. */
  height: number;
  cells: Uint8Array;
}

/** Mask dimensions of an island of width × height tiles. */
export function maskSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.ceil(width / MASK_BLOCK), height: Math.ceil(height / MASK_BLOCK) };
}

function code(t: string): number {
  const i = MASK_TERRAINS.indexOf(t as Terrain);
  return i < 0 ? MASK_WATER : i;
}

/** The mask of terrain rows (the server's sim.TerrainMask). */
export function encodeMask(island: { width: number; height: number; terrain: readonly string[] }): string {
  const { width: mw, height: mh } = maskSize(island.width, island.height);
  let out = "";
  const counts = [0, 0, 0, 0, 0];
  for (let by = 0; by < mh; by++) {
    for (let bx = 0; bx < mw; bx++) {
      counts.fill(0);
      for (let y = by * MASK_BLOCK; y < Math.min(island.height, (by + 1) * MASK_BLOCK); y++) {
        for (let x = bx * MASK_BLOCK; x < Math.min(island.width, (bx + 1) * MASK_BLOCK); x++) {
          counts[code(island.terrain[y * island.width + x] ?? "water")]!++;
        }
      }
      let best = 0;
      for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[best]!) best = i;
      out += MASK_CHARS[best];
    }
  }
  return out;
}

/**
 * Decodes an island's mask. A mask of the wrong length (an older server)
 * or an unknown character reads as water where it is missing.
 */
export function decodeMask(mask: string, width: number, height: number): DecodedMask {
  const size = maskSize(width, height);
  const cells = new Uint8Array(size.width * size.height);
  const n = Math.min(cells.length, mask.length);
  for (let i = 0; i < n; i++) {
    const c = MASK_CHARS.indexOf(mask[i]!);
    cells[i] = c < 0 ? MASK_WATER : c;
  }
  return { ...size, cells };
}

/** The mask cell code at tile (x, y) of the island (water outside). */
export function maskAt(m: DecodedMask, x: number, y: number): number {
  const mx = Math.floor(x / MASK_BLOCK);
  const my = Math.floor(y / MASK_BLOCK);
  if (mx < 0 || my < 0 || mx >= m.width || my >= m.height) return MASK_WATER;
  return m.cells[my * m.width + mx]!;
}

/** The mask at tile resolution: every tile carries its block's terrain (row-major, width × height). */
export function maskTerrain(m: DecodedMask, width: number, height: number): Terrain[] {
  const out: Terrain[] = new Array<Terrain>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = MASK_TERRAINS[maskAt(m, x, y)] as Terrain;
  }
  return out;
}
