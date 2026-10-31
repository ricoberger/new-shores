// Roads as voxel paths in the terrain (D-057 V2; ART_DIRECTION §4), render
// data only: the road tiles of an island painted into the near field —
// a path two columns wide (half a tile) along the tile's centre with an
// arm to every road neighbour, so corners, T-junctions and crossings are
// unions of the same columns, sunk one voxel below the grass; a column
// of worn edge on both sides, on the flat ground of the tile's terrace
// level (render/terraces.ts); where a road tile meets a road neighbour one
// level lower, the road climbs across the tile, one voxel per column (a
// ramp cut into the terrace edge). River tiles carry bridges instead
// (render/terraces.ts). Dirt roads are packed earth with jittered
// stones; the paved road is cobbles in three shades with a kerb of light
// stone. Quays (D-060) stand on the water: the whole tile is a stone
// wharf deck at the level of the shore, its walls stone into the water
// below; toward open water a timber fender runs along the edge, with an
// iron bollard on it every third tile. Heights, side kinds and top
// colours change; the island's terrain mesh and ground texture are
// rebuilt from them (render/terrain.ts).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { hash2 } from "../display/noise";
import { ISLAND, TERRAIN } from "../theme/palette";
import { c3 } from "./palette";
import type { RoadTile } from "./roads";
import { LEVEL_STEPS } from "./terraces";
import { type Field, pack, SIDE_ROCK, TERRAIN_VPT } from "./voxelterrain";

/** Directions to a road neighbour (x, y). */
const RAMP_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Height of a road column (steps): one voxel below the grass. */
export const ROAD_H = -1;

const DIRT = c3(TERRAIN.road_dirt);
const PAVED = c3(TERRAIN.road_paved);
const KERB = c3(TERRAIN.road_border);
const STONE = c3(ISLAND.rock_light);
const STONE_DARK = c3(ISLAND.rock);
const LUSH = c3(TERRAIN.grass_a).scale(0.92);
const TIMBER = c3(TERRAIN.road_dirt).scale(0.55);
const IRON = c3(ISLAND.rock).scale(0.45);

/** Height of a quay's deck (steps): the shore's level 0. */
export const QUAY_H = 0;
/** Height of a bollard on a quay's fender (steps). */
export const BOLLARD_H = QUAY_H + 2;
/** A bollard stands on every this many quay tiles (by tile position). */
export const BOLLARD_EVERY = 3;

/** Whether a road tile is the paved (cobbled) road. */
const paved = (t: RoadTile) => t.type === "road_paved";
/** Whether a road tile is a quay (D-060). */
export const isQuayTile = (t: RoadTile) => t.type === "quay";

/** The base (roadless) heights, top colours and side kinds of a field, kept to repaint from. */
export interface FieldBase {
  h: Int8Array;
  top: Uint32Array;
  kind?: Uint8Array;
}

export function fieldBase(f: Field): FieldBase {
  return { h: f.h.slice(), top: f.top.slice(), kind: f.kind?.slice() };
}

/**
 * Paints the roads into the field (from its base: removed roads go back
 * to the ground). Returns the columns whose height changed (their meshes
 * need a rebuild; colour changes only touch the ground texture).
 */
export function paintRoads(f: Field, base: FieldBase, tiles: readonly RoadTile[], seed: number): number[] {
  const vpt = TERRAIN_VPT;
  const { nx, ny } = f;
  const before = f.h.slice();
  f.h.set(base.h);
  f.top.set(base.top);
  if (f.kind) {
    if (base.kind) f.kind.set(base.kind);
    else f.kind.fill(0);
  }
  const set = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  // Road columns: kind 1 dirt, 2 paved.
  const road = new Map<number, number>();
  const lo = Math.floor(vpt / 2) - 1;
  const hi = Math.ceil(vpt / 2);
  for (const t of tiles) {
    if (isQuayTile(t)) continue;
    const kind = paved(t) ? 2 : 1;
    const put = (a: number, b: number) => {
      const i = t.x * vpt + a;
      const j = t.y * vpt + b;
      if (i < 0 || j < 0 || i >= nx || j >= ny) return;
      const k = j * nx + i;
      // Paved wins at a join of the two kinds.
      road.set(k, Math.max(road.get(k) ?? 0, kind));
    };
    for (let b = lo; b <= hi; b++) for (let a = lo; a <= hi; a++) put(a, b);
    if (has(t.x, t.y - 1)) for (let b = 0; b < lo; b++) for (let a = lo; a <= hi; a++) put(a, b);
    if (has(t.x, t.y + 1)) for (let b = hi + 1; b < vpt; b++) for (let a = lo; a <= hi; a++) put(a, b);
    if (has(t.x - 1, t.y)) for (let a = 0; a < lo; a++) for (let b = lo; b <= hi; b++) put(a, b);
    if (has(t.x + 1, t.y)) for (let a = hi + 1; a < vpt; a++) for (let b = lo; b <= hi; b++) put(a, b);
  }
  const mix = (p: number, c: Color3, t: number) => {
    const r = ((p >> 16) & 255) / 255;
    const g = ((p >> 8) & 255) / 255;
    const b = (p & 255) / 255;
    return pack({ r: r + (c.r - r) * t, g: g + (c.g - g) * t, b: b + (c.b - b) * t });
  };
  const flat = (k: number) => (f.flat ? (f.flat[k] as number) : 0);
  // A tile's level (steps) from the flat ground of its first column (-1 off the field).
  const level = (x: number, y: number) => (x < 0 || y < 0 || x * vpt >= nx || y * vpt >= ny ? -1 : flat(y * vpt * nx + x * vpt));
  const river = (k: number) => f.relief?.river[k] === 1;
  // Road ramps (D-058): a road tile with a road neighbour one level lower climbs to it across the tile.
  const rampOf = (x: number, y: number): readonly [number, number] | null => {
    const lv = level(x, y);
    if (lv <= 0) return null;
    for (const d of RAMP_DIRS) {
      const n = y * vpt * nx + x * vpt;
      if (river(n)) return null;
      const q = (y + d[1]) * vpt * nx + (x + d[0]) * vpt;
      if (has(x + d[0], y + d[1]) && level(x + d[0], y + d[1]) === lv - LEVEL_STEPS && !river(q)) return d;
    }
    return null;
  };
  const ramps = new Map<string, readonly [number, number] | null>();
  const painted = new Set<number>();
  for (const [k, kind] of road) {
    const i = k % nx;
    const j = (k - i) / nx;
    const tx = Math.floor(i / vpt);
    const ty = Math.floor(j / vpt);
    const tk = `${tx},${ty}`;
    if (!ramps.has(tk)) ramps.set(tk, rampOf(tx, ty));
    const d = ramps.get(tk) ?? null;
    const fl = flat(k);
    const bh = base.h[k] as number;
    let h: number;
    if (d) {
      // Columns from the lower edge: one step up per column, the tile's level at the far side.
      const a = i - tx * vpt;
      const b = j - ty * vpt;
      const c = d[0] > 0 ? vpt - 1 - a : d[0] < 0 ? a : d[1] > 0 ? vpt - 1 - b : b;
      h = fl - LEVEL_STEPS + Math.round(((c + 1) * LEVEL_STEPS) / vpt);
    } else if (bh === fl || (fl > 0 && bh < fl && bh > fl - LEVEL_STEPS && !river(k))) {
      // The flat ground of the tile's level, or down a terrace's own ramp (never the beach or a rim at level 0).
      h = bh;
    } else continue;
    f.h[k] = h + ROAD_H;
    painted.add(k);
    const r = hash2(i, j, seed + 61);
    if (kind === 2) {
      // Cobbles: three shades, a dark joint now and then.
      const shade = r < 0.33 ? 0.88 : r < 0.66 ? 0.97 : 1.05;
      f.top[k] = pack(r > 0.95 ? STONE_DARK.scale(0.9) : PAVED.scale(shade));
    } else {
      // Packed earth with stones.
      f.top[k] = pack(r < 0.05 ? STONE_DARK : r < 0.13 ? STONE : DIRT.scale(0.93 + 0.1 * hash2(i, j, seed + 62)));
    }
  }
  // Quays: a stone deck over the whole tile, a timber fender along the edges toward open water, a bollard every third tile.
  const quays = tiles.filter(isQuayTile);
  if (quays.length > 0 && !f.kind) f.kind = new Uint8Array(nx * ny);
  for (const t of quays) {
    // An edge toward open water: the neighbour tile is no road and its ground (base) is below the shore.
    const open = (dx: number, dy: number) => {
      if (has(t.x + dx, t.y + dy)) return false;
      const i = (t.x + dx) * vpt + (dx < 0 ? vpt - 1 : 0);
      const j = (t.y + dy) * vpt + (dy < 0 ? vpt - 1 : 0);
      return i < 0 || j < 0 || i >= nx || j >= ny || (base.h[j * nx + i] as number) < QUAY_H - 1;
    };
    const edges = { n: open(0, -1), s: open(0, 1), w: open(-1, 0), e: open(1, 0) };
    const bollard = (t.x + t.y) % BOLLARD_EVERY === 0;
    for (let b = 0; b < vpt; b++) {
      for (let a = 0; a < vpt; a++) {
        const i = t.x * vpt + a;
        const j = t.y * vpt + b;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        const fender = (edges.n && b === 0) || (edges.s && b === vpt - 1) || (edges.w && a === 0) || (edges.e && a === vpt - 1);
        // The bollard: the fender column at the middle of the tile's first open edge.
        const mid = (edges.n && b === 0 && a === lo) || (!edges.n && edges.e && a === vpt - 1 && b === lo) || (!edges.n && !edges.e && edges.s && b === vpt - 1 && a === hi) || (!edges.n && !edges.e && !edges.s && edges.w && a === 0 && b === hi);
        f.h[k] = bollard && mid ? BOLLARD_H : QUAY_H;
        (f.kind as Uint8Array)[k] = SIDE_ROCK;
        painted.add(k);
        const r = hash2(i, j, seed + 64);
        if (bollard && mid) f.top[k] = pack(IRON);
        else if (fender) f.top[k] = pack(TIMBER.scale(0.9 + 0.15 * r));
        else {
          // Stone slabs of 2 × 2 columns in two shades, a darker joint now and then.
          const slab = ((Math.floor(i / 2) + Math.floor(j / 2)) & 1) === 0;
          f.top[k] = pack(r > 0.94 ? STONE_DARK : STONE.scale((slab ? 0.92 : 1.0) + 0.05 * r));
        }
      }
    }
  }
  // Worn edges: the ground columns next to a road column.
  for (const [k, kind] of road) {
    if (!painted.has(k)) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a;
      if (road.has(q) || (base.h[q] as number) !== flat(q) || f.top[q] !== base.top[q]) continue;
      const w = hash2(a, b, seed + 63);
      if (kind === 2) f.top[q] = w < 0.75 ? pack(KERB.scale(0.95 + 0.08 * w)) : mix(base.top[q] as number, KERB, 0.5);
      else if (w < 0.85) f.top[q] = mix(base.top[q] as number, DIRT, 0.5 + 0.4 * w);
    }
  }
  const changed: number[] = [];
  for (let k = 0; k < nx * ny; k++) if (f.h[k] !== before[k]) changed.push(k);
  return changed;
}

/** A field tile and its field type (the ground under it is painted: render/terrain.ts). */
export interface FieldTile {
  x: number;
  y: number;
  type: string;
  /** Rotated footprint (tiles; 1 × 1 without): the far view's patch covers it (render/farfields.ts); paintFields paints the anchor tile. */
  w?: number;
  h?: number;
  /** The far view's patch colour (packed RGB, render/farfields.ts farFieldColor; the fallback without). */
  patch?: number;
}

/** The ground of a field type: ploughed furrows, pasture grass or orchard grass. */
export function fieldGround(type: string): "furrows" | "pasture" | "orchard" {
  return type.includes("pasture") ? "pasture" : type.includes("orchard") ? "orchard" : "furrows";
}

/**
 * Paints the ground under the field tiles (colour only, after the roads):
 * crop fields are ploughed soil in furrows along the tile's x, pastures a
 * lusher grass, orchards grass mown in rows. Road and lowered columns
 * keep their colour.
 */
export function paintFields(f: Field, base: FieldBase, fields: readonly FieldTile[], seed: number): void {
  const vpt = TERRAIN_VPT;
  for (const t of fields) {
    const g = fieldGround(t.type);
    for (let b = 0; b < vpt; b++) {
      for (let a = 0; a < vpt; a++) {
        const i = t.x * vpt + a;
        const j = t.y * vpt + b;
        if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) continue;
        const k = j * f.nx + i;
        const fl = f.flat ? (f.flat[k] as number) : 0;
        if ((f.h[k] as number) !== fl || (base.h[k] as number) !== fl) continue;
        const r = hash2(i, j, seed + 71);
        const p = base.top[k] as number;
        const grass = new Color3(((p >> 16) & 255) / 255, ((p >> 8) & 255) / 255, (p & 255) / 255);
        if (g === "furrows") f.top[k] = pack(DIRT.scale((b % 2 === 0 ? 0.74 : 0.9) + 0.05 * r));
        else if (g === "pasture") f.top[k] = pack(Color3.Lerp(grass, LUSH, 0.45).scale(0.96 + 0.08 * r));
        else f.top[k] = pack(grass.scale(a % 4 === 1 ? 0.9 : 1.02 + 0.03 * r));
      }
    }
  }
}

/** The chunk keys whose meshes a height change of these columns touches (the columns and their neighbours: sides and corner occlusion). */
export function touchedChunks(changed: readonly number[], f: Field, chunkOf: (tx: number, ty: number) => string): Set<string> {
  const out = new Set<string>();
  const vpt = TERRAIN_VPT;
  for (const k of changed) {
    const i = k % f.nx;
    const j = (k - i) / f.nx;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= f.nx || b >= f.ny) continue;
        out.add(chunkOf(Math.floor(a / vpt), Math.floor(b / vpt)));
      }
    }
  }
  return out;
}
