// Small ground detail of the voxel world (D-057 V2, ART_DIRECTION §4):
// ferns, mushrooms and fallen logs on the forest floor, flower patches and
// stones in the meadows, pebbles and dune grass on the beach, pebbles and
// tufts between the crags. Placed per terrain role from the island seed
// (hash per tile and index, so a change elsewhere never moves an item), off
// buildings, fields and roads like the ground scatter (display/scatter.ts),
// and drawn at near LOD only (render/trees.ts Decoration detail mesh).
import { hash2, valueNoise } from "../display/noise";
import type { Placed, ScatterInput } from "../display/scatter";

/** One placed detail item: the decor model ID with its placement. */
export interface DetailPlaced extends Placed {
  id: string;
}

/** A detail class: its models and the chance per tile of one item, by site. */
interface DetailClass {
  ids: readonly string[];
  /** Chance per free tile by site. */
  chance: Partial<Record<DetailSite, number>>;
  /** Only where the patch noise is high (flowers in patches, not a sprinkle). */
  patch?: number;
  scale: [number, number];
}

/** Where a detail tile sits. */
export type DetailSite = "forest" | "meadow" | "beach" | "rock";

const CLASSES: readonly DetailClass[] = [
  { ids: ["decor_fern_a", "decor_fern_b"], chance: { forest: 0.35 }, scale: [0.8, 1.2] },
  { ids: ["decor_mushroom_a"], chance: { forest: 0.06 }, scale: [0.8, 1.2] },
  { ids: ["decor_log_a"], chance: { forest: 0.03 }, scale: [0.8, 1.1] },
  { ids: ["decor_flowers_a", "decor_flowers_b"], chance: { meadow: 0.45 }, patch: 0.68, scale: [0.8, 1.2] },
  { ids: ["decor_flowers_a", "decor_flowers_b"], chance: { meadow: 0.02, forest: 0.02 }, scale: [0.8, 1.1] },
  { ids: ["decor_pebbles_a", "decor_pebbles_b"], chance: { meadow: 0.015, beach: 0.2, rock: 0.25 }, scale: [0.8, 1.3] },
  { ids: ["decor_reeds_a"], chance: { beach: 0.1 }, scale: [0.8, 1.2] },
];

/** Patch noise scale (tiles): meadow flower patches a few tiles across. */
const PATCH_SCALE = 4;

/** The detail site of a terrain tile (null: none there). */
export function detailSite(terrain: string | undefined): DetailSite | null {
  switch (terrain) {
    case "forest":
      return "forest";
    case "grass":
      return "meadow";
    case "coast":
      return "beach";
    case "mountain":
      return "rock";
    default:
      return null;
  }
}

/** The detail items of an island (or of the input's rect), in tile order. */
export function scatterDetail(input: ScatterInput): DetailPlaced[] {
  const { width, height, terrain, seed, blocked } = input;
  const r = input.rect;
  const x0 = r ? Math.max(0, r.x) : 0;
  const y0 = r ? Math.max(0, r.y) : 0;
  const x1 = r ? Math.min(width, r.x + r.width) : width;
  const y1 = r ? Math.min(height, r.y + r.height) : height;
  const out: DetailPlaced[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const site = detailSite(terrain[y * width + x]);
      if (site === null || blocked.has(`${x},${y}`)) continue;
      CLASSES.forEach((c, k) => {
        const s = seed + 4099 * (k + 1);
        const chance = c.chance[site] ?? 0;
        if (chance <= 0) return;
        if (c.patch !== undefined && valueNoise(x / PATCH_SCALE, y / PATCH_SCALE, s + 5) < c.patch) return;
        if (hash2(x, y, s) >= chance) return;
        const v = Math.floor(hash2(x, y, s + 1) * c.ids.length) % c.ids.length;
        out.push({
          id: c.ids[v] as string,
          x: x + 0.12 + 0.76 * hash2(x, y, s + 2),
          y: y + 0.12 + 0.76 * hash2(x, y, s + 3),
          variant: v,
          scale: c.scale[0] + (c.scale[1] - c.scale[0]) * hash2(x, y, s + 4),
          yaw: hash2(x, y, s + 6) * Math.PI * 2,
        });
      });
    }
  }
  return out;
}
