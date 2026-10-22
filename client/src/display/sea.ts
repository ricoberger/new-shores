// Sea depth look (ART_DIRECTION §4), render-only and pure: the distance
// from every sea texel to the nearest land tile over the archipelago,
// computed once per payload change from the islands' static terrain, and
// the shallows→deep blend factor of a distance. Coordinates are
// archipelago tiles.

export interface IslandLand {
  position: { x: number; y: number };
  width: number;
  height: number;
  terrain: readonly string[];
}

export interface DistanceField {
  /** Archipelago tile of texel (0, 0)'s corner. */
  originX: number;
  originY: number;
  /** Texels per row and rows. */
  width: number;
  height: number;
  /** Tiles per texel (1 unless the archipelago is large). */
  step: number;
  /** Distance (tiles) from each texel centre to the nearest land tile; 0 on land. Row-major, row 0 at originY. */
  dist: Float32Array;
}

/** Within this distance (tiles) of land the sea is fully shallow. */
export const SHALLOW_TILES = 2;
/** Beyond this distance (tiles) the sea is fully deep. */
export const DEEP_TILES = 10;

/** 0 = shallows, 1 = deep, smooth in between. */
export function depthFactor(d: number): number {
  const t = Math.min(1, Math.max(0, (d - SHALLOW_TILES) / (DEEP_TILES - SHALLOW_TILES)));
  return t * t * (3 - 2 * t);
}

/**
 * Distance field over the islands' bounding box plus `margin` tiles, at
 * most `maxTexels` texels per side (two-pass chamfer distance, weights 1
 * and √2). Null without islands.
 */
export function landDistance(islands: readonly IslandLand[], margin = DEEP_TILES + 4, maxTexels = 1024): DistanceField | null {
  if (islands.length === 0) return null;
  const minX = Math.min(...islands.map((i) => i.position.x)) - margin;
  const minY = Math.min(...islands.map((i) => i.position.y)) - margin;
  const maxX = Math.max(...islands.map((i) => i.position.x + i.width)) + margin;
  const maxY = Math.max(...islands.map((i) => i.position.y + i.height)) + margin;
  const step = Math.max(1, Math.ceil(Math.max(maxX - minX, maxY - minY) / maxTexels));
  const width = Math.ceil((maxX - minX) / step);
  const height = Math.ceil((maxY - minY) / step);
  const INF = 1e9;
  const dist = new Float32Array(width * height).fill(INF);
  for (const is of islands) {
    for (let r = 0; r < height; r++) {
      const ty = Math.floor(minY + (r + 0.5) * step - is.position.y);
      if (ty < 0 || ty >= is.height) continue;
      for (let c = 0; c < width; c++) {
        const tx = Math.floor(minX + (c + 0.5) * step - is.position.x);
        if (tx < 0 || tx >= is.width) continue;
        if (is.terrain[ty * is.width + tx] !== "water") dist[r * width + c] = 0;
      }
    }
  }
  const D = Math.SQRT2;
  const get = (c: number, r: number) => (c < 0 || r < 0 || c >= width || r >= height ? INF : (dist[r * width + c] as number));
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      dist[i] = Math.min(dist[i] as number, get(c - 1, r) + 1, get(c, r - 1) + 1, get(c - 1, r - 1) + D, get(c + 1, r - 1) + D);
    }
  }
  for (let r = height - 1; r >= 0; r--) {
    for (let c = width - 1; c >= 0; c--) {
      const i = r * width + c;
      dist[i] = Math.min(dist[i] as number, get(c + 1, r) + 1, get(c, r + 1) + 1, get(c + 1, r + 1) + D, get(c - 1, r + 1) + D);
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] = (dist[i] as number) * step;
  return { originX: minX, originY: minY, width, height, step, dist };
}
