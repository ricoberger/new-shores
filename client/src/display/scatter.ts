// Deterministic decoration placement (ART_DIRECTION §4), render-only and
// pure: everything derives from a seed that is a stable hash of the
// island's ID and revision (the API has no island seed), so the same
// island and revision look the same across reloads and clients. Trees
// grow on forest tiles, tufts, flowers, rocks and bushes on grass, coast
// and mountain tiles (bushes and rocks mostly along the coast and on the
// rock); none of them on a building footprint, field or road tile,
// and fewer within one tile of those — decoration, never a rule (D-027):
// nothing here influences placement or hints.
import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import { rotatedFootprint, type TilePos, tileKey } from "./geometry";
import { hash2, hashString, valueNoise } from "./noise";

/** Decoration seed of an island revision. */
export function islandSeed(id: string, revision: string): number {
  return hashString(`${id}|${revision}`);
}

/** Tree candidates per forest tile (before exclusion). */
export const TREES_PER_TILE = 2;
/** Kept fraction next to (within one tile of) a building, field or road. */
export const NEAR_BLOCKED_KEEP = 0.4;

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
  /** Terrace level digits per tile (D-058; absent: flat): rocks gather at the foot of the terrace walls. */
  levels?: string;
  /** Only the tiles of this rectangle (one chunk of the incremental build; the placements of the whole island's run inside it, in the same order). */
  rect?: { x: number; y: number; width: number; height: number };
}

/** The tile rows and columns to place on: the input's rect, else the island. */
function span(input: ScatterInput): { x0: number; x1: number; y0: number; y1: number } {
  const r = input.rect;
  return r
    ? { x0: Math.max(0, r.x), x1: Math.min(input.width, r.x + r.width), y0: Math.max(0, r.y), y1: Math.min(input.height, r.y + r.height) }
    : { x0: 0, x1: input.width, y0: 0, y1: input.height };
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
export function scatterTrees(input: ScatterInput, variants = 3): Placed[] {
  const { width, terrain, seed, blocked } = input;
  const { x0, x1, y0, y1 } = span(input);
  const out: Placed[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (terrain[y * width + x] !== "forest" || blocked.has(`${x},${y}`)) continue;
      const near = nearBlocked(blocked, x, y);
      for (let k = 0; k < TREES_PER_TILE; k++) {
        const s = seed + k * 7919;
        const px = x + 0.18 + 0.64 * hash2(x, y, s);
        const py = y + 0.18 + 0.64 * hash2(x, y, s + 1);
        if (near && hash2(x, y, s + 2) >= NEAR_BLOCKED_KEEP) continue;
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
export type ScatterKind = "tuft" | "flower" | "rock" | "bush";

/** Where a ground tile sits: open grass, the coast edge, a forest fringe, a plateau foot, a plateau top, or the foot of a terrace wall (D-058). */
export type ScatterSite = "open" | "coast" | "fringe" | "foot" | "mountain" | "ledge";

/**
 * Chance per tile of each class by site. Tufts and flowers spread over
 * the grass; rocks and bushes cluster where nature would put them — the
 * coast edge, the forest fringe and the plateau feet — and stay off the
 * open grass (no single tiny rocks there; a rare bush). The plateau tops
 * carry their crags (render/terraces.ts), so they get few.
 */
const CHANCE: Record<ScatterKind, Record<ScatterSite, number>> = {
  tuft: { open: 0.4, coast: 0.1, fringe: 0.4, foot: 0.3, mountain: 0.05, ledge: 0.35 },
  flower: { open: 0.14, coast: 0, fringe: 0.1, foot: 0.06, mountain: 0, ledge: 0.06 },
  rock: { open: 0, coast: 0.07, fringe: 0.05, foot: 0.12, mountain: 0.05, ledge: 0.16 },
  bush: { open: 0.008, coast: 0.05, fringe: 0.14, foot: 0.06, mountain: 0.03, ledge: 0.05 },
};

/** Rocks and bushes only where a low-frequency noise is high: they come in clumps, not as an even sprinkle. */
const CLUMP_SCALE = 3.5;
const CLUMP_THRESHOLD = 0.5;

/** The site of a grass, coast or mountain tile (null for other terrain). */
export function scatterSite(input: Pick<ScatterInput, "width" | "height" | "terrain" | "levels">, x: number, y: number): ScatterSite | null {
  const { width, height, terrain } = input;
  const t = terrain[y * width + x];
  if (t === "mountain") return "mountain";
  if (t === "coast") return "coast";
  if (t !== "grass") return null;
  let site: ScatterSite = "open";
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = terrain[ny * width + nx];
      if (n === "mountain") return "foot";
      if (n === "forest") site = "fringe";
      else if ((n === "coast" || n === "water") && site === "open") site = "coast";
    }
  }
  return site === "open" && wallSide(input, x, y) !== null ? "ledge" : site;
}

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The side ([dx, dy]) on which a tile's 4-neighbour stands a terrace level higher (the foot of a wall), or null. */
export function wallSide(input: Pick<ScatterInput, "width" | "height" | "terrain" | "levels">, x: number, y: number): readonly [number, number] | null {
  const lv = input.levels;
  if (!lv) return null;
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= input.width || ty >= input.height ? -1 : lv.charCodeAt(ty * input.width + tx) - 48);
  const own = at(x, y);
  for (const d of SIDES) if (at(x + d[0], y + d[1]) > own && input.terrain[(y + d[1]) * input.width + x + d[0]] !== "river") return d;
  return null;
}

/** Tufts, flowers, rocks and bushes on the free grass, coast and mountain tiles (variant: 0 tuft, 1 flower, 2 rock, 3 bush). */
export function scatterGround(input: ScatterInput): (Placed & { kind: ScatterKind })[] {
  const { seed, blocked } = input;
  const { x0, x1, y0, y1 } = span(input);
  const out: (Placed & { kind: ScatterKind })[] = [];
  const kinds: ScatterKind[] = ["tuft", "flower", "rock", "bush"];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const site = scatterSite(input, x, y);
      if (site === null || blocked.has(`${x},${y}`)) continue;
      const damp = nearBlocked(blocked, x, y) ? 0.5 : 1;
      kinds.forEach((kind, v) => {
        const s = seed + 1013 * (v + 1);
        let chance = CHANCE[kind][site] * damp;
        if (kind === "rock" || kind === "bush") {
          // Clumps: twice the chance inside, none outside (the same mean).
          chance = valueNoise(x / CLUMP_SCALE, y / CLUMP_SCALE, s + 9) >= CLUMP_THRESHOLD ? chance * 2 : 0;
        }
        if (hash2(x, y, s) >= chance) return;
        // At a terrace wall's foot the rocks lie against the wall.
        const wall = site === "ledge" && kind === "rock" ? wallSide(input, x, y) : null;
        const along = (d: number, h: number) => (d > 0 ? 0.82 : d < 0 ? 0.18 : 0.15 + 0.7 * h);
        out.push({
          kind,
          x: x + (wall ? along(wall[0], hash2(x, y, s + 1)) : 0.15 + 0.7 * hash2(x, y, s + 1)),
          y: y + (wall ? along(wall[1], hash2(x, y, s + 2)) : 0.15 + 0.7 * hash2(x, y, s + 2)),
          variant: v,
          scale: 0.75 + 0.5 * hash2(x, y, s + 3),
          yaw: hash2(x, y, s + 4) * Math.PI * 2,
        });
      });
    }
  }
  return out;
}

/**
 * What each merged layer of an island is built from, as comparable keys,
 * so that a payload rebuilds only the layers — and only the islands —
 * whose inputs changed (every payload replaces every island object, but
 * stocks, rates, statuses and cycle progress do not move a tree):
 * `roads` (the road strips), `layout` (building and field footprints:
 * contact shadows, field decoration, mid-LOD blocks) and `decoration`
 * (trees and scatter: the layout and the roads).
 */
export function layerKeys(display: Pick<IslandDisplay, "buildings" | "roads">): { roads: string; layout: string; decoration: string } {
  const roads = display.roads.map((r) => `${r.x},${r.y},${r.type}`).join(";");
  const layout = display.buildings.map((b) => `${b.type}@${b.x},${b.y},${b.rotation}`).join(";");
  return { roads, layout, decoration: `${layout}|${roads}` };
}

/** The most a thinned tree's crown grows to cover for the trees dropped around it (far LOD). */
export const THIN_MAX_GROWTH = 1.3;

/**
 * Density thinning for a budget (the far trees, D-048's far budget):
 * at most `keep` of the trees, an even spread — the trees with the
 * lowest hash of their position, so the choice is deterministic, does not
 * depend on the trees' order and keeps every forest at the same density
 * — and the scale the kept ones grow by to cover about the same ground
 * (√(all / kept), at most THIN_MAX_GROWTH). All trees and scale 1 within
 * the budget.
 */
export function thinTrees(trees: readonly Placed[], keep: number): { trees: Placed[]; growth: number } {
  if (trees.length <= keep) return { trees: [...trees], growth: 1 };
  const rank = (p: Placed) => hash2(Math.round(p.x * 64), Math.round(p.y * 64), 0x7ee5);
  const kept = trees
    .map((p) => [rank(p), p] as const)
    .sort((a, b) => a[0] - b[0] || a[1].x - b[1].x || a[1].y - b[1].y)
    .slice(0, Math.max(0, keep))
    .map(([, p]) => p);
  return { trees: kept, growth: kept.length > 0 ? Math.min(THIN_MAX_GROWTH, Math.sqrt(trees.length / kept.length)) : 1 };
}
