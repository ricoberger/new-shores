// Roads as voxel paths in the terrain (D-057 V2; ART_DIRECTION §4), render
// data only: the road tiles of an island painted into the near field —
// a path two columns wide (half a tile) along the tile's centre with an
// arm to every road neighbour, so corners, T-junctions and crossings are
// unions of the same columns, sunk one voxel below the grass; a column
// of worn edge on both sides. Dirt roads are packed earth with jittered
// stones; the paved road is cobbles in three shades with a kerb of light
// stone. Heights and top colours change; the island's terrain mesh and
// ground texture are rebuilt from them (render/terrain.ts).
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { hash2 } from "../display/noise";
import { ISLAND, TERRAIN } from "../theme/palette";
import { c3 } from "./palette";
import type { RoadTile } from "./roads";
import { type Field, pack, TERRAIN_VPT } from "./voxelterrain";

/** Height of a road column (steps): one voxel below the grass. */
export const ROAD_H = -1;

const DIRT = c3(TERRAIN.road_dirt);
const PAVED = c3(TERRAIN.road_paved);
const KERB = c3(TERRAIN.road_border);
const STONE = c3(ISLAND.rock_light);
const STONE_DARK = c3(ISLAND.rock);
const LUSH = c3(TERRAIN.grass_a).scale(0.92);

/** Whether a road tile is the paved (cobbled) road. */
const paved = (t: RoadTile) => t.type === "road_paved";

/** The base (roadless) heights and top colours of a field, kept to repaint from. */
export interface FieldBase {
  h: Int8Array;
  top: Uint32Array;
}

export function fieldBase(f: Field): FieldBase {
  return { h: f.h.slice(), top: f.top.slice() };
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
  const set = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  // Road columns: kind 1 dirt, 2 paved.
  const road = new Map<number, number>();
  const lo = Math.floor(vpt / 2) - 1;
  const hi = Math.ceil(vpt / 2);
  for (const t of tiles) {
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
  for (const [k, kind] of road) {
    // Only on the ground (never lower the beach or raise anything).
    if ((base.h[k] as number) !== 0) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    f.h[k] = ROAD_H;
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
  // Worn edges: the ground columns next to a road column.
  for (const [k, kind] of road) {
    if ((f.h[k] as number) !== ROAD_H) continue;
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
      if (road.has(q) || (base.h[q] as number) !== 0 || f.top[q] !== base.top[q]) continue;
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
        if ((f.h[k] as number) !== 0 || (base.h[k] as number) !== 0) continue;
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
