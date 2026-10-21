// Deterministic decoration placement (ART_DIRECTION §4), render-only and
// pure: everything derives from a seed that is a stable hash of the
// island's ID and revision (the API has no island seed), so the same
// island and revision look the same across reloads and clients. Trees
// grow on forest tiles, tufts, flowers and small rocks on grass and coast
// tiles; none of them on a building footprint, field or road tile, and
// fewer within one tile of those. Inside the work radius of a harvester
// whose work area includes forest the kept tree fraction follows the
// server's efficiency (treeKeepFraction) — decoration, never a rule
// (D-027): nothing here influences placement or hints.
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { rotatedFootprint, type TilePos, tileKey } from "./geometry";
import { hash2, hashString } from "./noise";

/** Decoration seed of an island revision. */
export function islandSeed(id: string, revision: string): number {
  return hashString(`${id}|${revision}`);
}

/** Tree candidates per forest tile (before exclusion and thinning). */
export const TREES_PER_TILE = 2;
/** Kept fraction next to (within one tile of) a building, field or road. */
export const NEAR_BLOCKED_KEEP = 0.4;

/**
 * Kept tree fraction inside a harvester's work radius: 1 − 0.5 ×
 * efficiency (full efficiency → half the trees; provisional, tunable).
 * Out-of-range input is clamped to 0 … 1000.
 */
export function treeKeepFraction(efficiencyPermille: number): number {
  const e = Math.min(1000, Math.max(0, Number.isFinite(efficiencyPermille) ? efficiencyPermille : 0));
  return 1 - (0.5 * e) / 1000;
}

/** Tiles covered by building footprints, fields and roads (keys "x,y"). */
export function blockedTiles(
  buildings: readonly BuildingDisplay[],
  roads: readonly TilePos[],
  defs: ReadonlyMap<string, Pick<ContentBuilding, "width" | "height">>,
): Set<string> {
  const out = new Set<string>(roads.map(tileKey));
  for (const b of buildings) {
    const def = defs.get(b.type);
    if (!def) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.add(`${b.x + dx},${b.y + dy}`);
  }
  return out;
}

/** A work disc that thins the trees inside it. */
export interface ThinningArea {
  /** Footprint centre (island tiles). */
  cx: number;
  cy: number;
  radius: number;
  /** Kept fraction of the trees inside. */
  keep: number;
}

/** Work discs of the buildings whose content work area includes forest, with the server's efficiency. */
export function thinningAreas(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): ThinningArea[] {
  const out: ThinningArea[] = [];
  for (const b of buildings) {
    const def = defs.get(b.type);
    const area = def?.work_area;
    if (!def || !area || !(area.terrain ?? []).includes("forest")) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    out.push({ cx: b.x + w / 2, cy: b.y + h / 2, radius: area.radius, keep: treeKeepFraction(b.efficiency_permille) });
  }
  return out;
}

/** One placed decoration item (island tiles; `variant` picks the model). */
export interface Placed {
  x: number;
  y: number;
  variant: number;
  scale: number;
  yaw: number;
}

export interface ScatterInput {
  width: number;
  height: number;
  terrain: readonly string[];
  seed: number;
  blocked: ReadonlySet<string>;
}

/** Whether a tile has a blocked tile among its eight neighbours (or is outside none). */
function nearBlocked(blocked: ReadonlySet<string>, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && blocked.has(`${x + dx},${y + dy}`)) return true;
  return false;
}

/**
 * Tree positions on the forest tiles. Every candidate draws its own
 * numbers from (tile, index, seed), so a change elsewhere never moves a
 * tree, and the kept/dropped choice is stable between payloads.
 */
export function scatterTrees(input: ScatterInput, areas: readonly ThinningArea[], variants = 3): Placed[] {
  const { width, height, terrain, seed, blocked } = input;
  const out: Placed[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (terrain[y * width + x] !== "forest" || blocked.has(`${x},${y}`)) continue;
      const near = nearBlocked(blocked, x, y);
      for (let k = 0; k < TREES_PER_TILE; k++) {
        const s = seed + k * 7919;
        const px = x + 0.18 + 0.64 * hash2(x, y, s);
        const py = y + 0.18 + 0.64 * hash2(x, y, s + 1);
        if (near && hash2(x, y, s + 2) >= NEAR_BLOCKED_KEEP) continue;
        let keep = 1;
        for (const a of areas) if ((px - a.cx) ** 2 + (py - a.cy) ** 2 <= a.radius * a.radius) keep = Math.min(keep, a.keep);
        if (keep < 1 && hash2(x, y, s + 3) >= keep) continue;
        out.push({
          x: px,
          y: py,
          variant: Math.floor(hash2(x, y, s + 4) * variants) % variants,
          scale: 0.8 + 0.45 * hash2(x, y, s + 5),
          yaw: hash2(x, y, s + 6) * Math.PI * 2,
        });
      }
    }
  }
  return out;
}

/** Ground scatter classes. */
export type ScatterKind = "tuft" | "flower" | "rock";

/** Chance per tile of each class on grass and on coast (sand). */
const CHANCE: Record<ScatterKind, { grass: number; coast: number }> = {
  tuft: { grass: 0.55, coast: 0.12 },
  flower: { grass: 0.14, coast: 0 },
  rock: { grass: 0.05, coast: 0.1 },
};

/** Tufts, flowers and small rocks on the free grass and coast tiles (variant: 0 tuft, 1 flower, 2 rock). */
export function scatterGround(input: ScatterInput): (Placed & { kind: ScatterKind })[] {
  const { width, height, terrain, seed, blocked } = input;
  const out: (Placed & { kind: ScatterKind })[] = [];
  const kinds: ScatterKind[] = ["tuft", "flower", "rock"];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = terrain[y * width + x];
      if ((t !== "grass" && t !== "coast") || blocked.has(`${x},${y}`)) continue;
      const damp = nearBlocked(blocked, x, y) ? 0.5 : 1;
      kinds.forEach((kind, v) => {
        const s = seed + 1013 * (v + 1);
        if (hash2(x, y, s) >= CHANCE[kind][t] * damp) return;
        out.push({
          kind,
          x: x + 0.15 + 0.7 * hash2(x, y, s + 1),
          y: y + 0.15 + 0.7 * hash2(x, y, s + 2),
          variant: v,
          scale: 0.75 + 0.5 * hash2(x, y, s + 3),
          yaw: hash2(x, y, s + 4) * Math.PI * 2,
        });
      });
    }
  }
  return out;
}
