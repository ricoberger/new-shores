// Voxel terrain (D-057; ART_DIRECTION §4), render data only. A height field of
// square columns — 4 per tile at near/mid, fewer for the far meshes —
// meshed with 2.5D greedy meshing: column tops merge into rectangles of
// equal height, corner occlusion and (unless the field is textured)
// colour; column sides become one quad per run of equal neighbours and
// band colour. One height step is one voxel of the models (VOXEL_STEP =
// 1/8 tile). The coast is the smoothed coastline sampled at the column
// centres (a pixel coastline): beach tiles lower their outermost column by
// one step, then a sand shelf and the wet sand line step down toward the
// sea; land that meets the sea without a beach drops in earth and rock
// bands, darker toward the foot. The terrace levels, ramps and rivers of
// the relief (render/terraces.ts) set the land columns' heights; the rock
// of mountains and islets is a field of its own at near and mid (its
// notches follow the buildings) and baked into the lite and far fields
// (withRock).
//
// The near/mid field is *textured*: its top colours (the smooth blend of
// the tiles' ground colours with beach pebbles and wet sand) go into the
// island's ground texture (one texel per column, render/groundshader.ts),
// so the tops merge regardless of colour; the far fields are the near
// field downsampled (downsampleField) with the averaged colours as vertex
// colours, so the far coast lines up with the near one by construction.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Island, Terrain } from "../api/client";
import type { CoastLoop } from "../display/coastline";
import { fbm, hash2 } from "../display/noise";
import { ISLAND, TERRAIN, WATER } from "../theme/palette";
import { c3 } from "./palette";
import { RIVER_WATER } from "./water";
import { insideGrid, LEVEL_STEPS, reliefColumns, type ReliefColumns, reliefOf, RIVER_DROP, rockStrata, rockTop } from "./terraces";
import { type Builder, groundColor } from "./terrain";

/** Columns per tile of the near/mid terrain (half the models' 8). */
export const TERRAIN_VPT = 4;
/** Height of one voxel step (tiles): one voxel of the models (8 per tile). */
export const VOXEL_STEP = 1 / 8;
/** Empty column (sea). */
export const EMPTY = -128;
/** Lowest layer of the coast columns (steps): below the sea surface (SEA_LEVEL −0.6). */
export const SEA_BOTTOM = -6;
/** Beach: the outermost land column of a coast tile (steps). */
export const RIM_H = -1;
/** The sand shelf off the land (steps). */
export const SHELF_H = -2;
/** The wet sand line just above the sea surface (steps). */
export const WET_H = -4;
/** Coast distance (columns from the land) kept per column: the shelves, foam and shallows (CoastWater) read it. */
export const COAST_REACH = 9;
/** Darkening per occluded corner of a top face (0..3 corners). */
const AO = 0.1;
/** Upward tilt of the side normals (stylised soft lighting of the column sides; groundshader.ts tells tops by it). */
const UP_TILT = 0.9;
/** Colour quantisation of untextured column tops (levels per channel): equal neighbours merge. */
const QUANT = 48;

/** Side kinds of a column (its walls' bands). */
export const SIDE_EARTH = 0;
export const SIDE_SAND = 1;
/** A river column above a lower one: its wall is a waterfall. */
export const SIDE_FALL = 2;
/** Rock walls (the lite and far fields' baked rock). */
export const SIDE_ROCK = 3;
/** Cliff coast: a rock face straight into the sea (no sand shelf), darker toward its foot. */
export const SIDE_CLIFF = 4;

const RIM = c3(ISLAND.sand_rim);
const SAND = c3(TERRAIN.sand);
const WET = Color3.Lerp(SAND, c3(WATER.shallows), 0.22).scale(0.8);
const PEBBLE = c3(ISLAND.rock_light);
const PEBBLE_DARK = c3(ISLAND.rock);
/** Scree: the ground of mountain tiles around the rock (grey grit with darker and lighter stones). */
const SCREE = Color3.Lerp(c3(ISLAND.rock_light), c3(ISLAND.rock), 0.4);
const SCREE_DARK = c3(ISLAND.rock_deep);
const SCREE_LIGHT = c3(ISLAND.rock_light).scale(1.04);
const CLIFF_FOOT = c3(ISLAND.cliff_foot);
/** Earth and rock bands of a grass edge over the sea, top to foot (darker at the base). */
const EARTH_BANDS = [Color3.Lerp(c3(TERRAIN.road_dirt), c3(ISLAND.rock_deep), 0.3), c3(ISLAND.cliff_upper), c3(ISLAND.cliff_ledge), c3(ISLAND.cliff_lower), c3(ISLAND.cliff_foot)];
/** Sand walls of the beach steps, top to foot. */
const SAND_BANDS = [SAND.scale(0.9), SAND.scale(0.86), WET.scale(0.95), WET.scale(0.85), Color3.Lerp(WET, c3(ISLAND.cliff_foot), 0.5)];
/** Terrace walls above the sea, per step within a level from its foot: rock at the foot, earth under the grass lip. */
const TERRACE_BANDS = [c3(ISLAND.cliff_lower), c3(ISLAND.cliff_ledge), c3(ISLAND.cliff_upper), EARTH_BANDS[0] as Color3];
/** Waterfall walls, foot to lip: foam, light water, foam, white water. */
const FALL_BANDS = [c3(WATER.foam), Color3.Lerp(c3(WATER.shallows), c3(WATER.foam), 0.55), c3(WATER.foam).scale(0.96), Color3.Lerp(c3(WATER.shallows), c3(WATER.foam), 0.3)];
/** River water (the river beds' tops: the far fields' rivers): the river surface's colour (water.ts RIVER_WATER). */
const RIVER = RIVER_WATER;
/** River banks: damp sand. */
const BANK_SAND = Color3.Lerp(SAND, c3(TERRAIN.road_dirt), 0.3);
/** The bank colour a river tile lends the blend of its neighbours' ground. */
const BANK = Color3.Lerp(c3(TERRAIN.grass_a), c3(TERRAIN.road_dirt), 0.35);
/** Cliff tops: grass over rock. */
const CLIFF_TOP = Color3.Lerp(c3(TERRAIN.grass_b), c3(ISLAND.rock_light), 0.45);

/** A height field: column (i, j) covers x0 + i·s … x0 + (i+1)·s (island tiles: tile x spans x … x + 1, like the coastline), y likewise. */
export interface Field {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  /** Column size (tiles). */
  s: number;
  /** Top height in steps (EMPTY: no column). */
  h: Int8Array;
  /** Top colour, packed 0xRRGGBB. */
  top: Uint32Array;
  /** Lowest step of every column's sides. */
  bottom: number;
  /** Side colour of a layer (steps; the layer from z to z+1) of a column of a side kind. */
  side: (z: number, kind: number) => Color3;
  /** Side kind per column (default 0). */
  kind?: Uint8Array;
  /** Tops take their colour from the ground texture (groundshader.ts): the vertex colour is the occlusion only. */
  textured?: boolean;
  /** Colour levels per channel of untextured tops (default QUANT). */
  quant?: number;
  /** Distance of sea columns to the land (columns, capped at COAST_REACH; 0 on land). */
  toLand?: Uint8Array;
  /** The lowest step of a column's walls toward an empty neighbour (default: bottom). */
  floor?: Int8Array;
  /** The flat ground of each column's tile (steps; its terrace level): roads and field ground paint where the column stands at it (default 0). */
  flat?: Int8Array;
  /** The relief columns the field was built from (rock, rivers; withRock bakes the rock in). */
  relief?: ReliefColumns;
}

/** Packs a colour into 0xRRGGBB. */
export function pack(c: { r: number; g: number; b: number }): number {
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (q(c.r) << 16) | (q(c.g) << 8) | q(c.b);
}

function quantised(p: number, levels = QUANT): number {
  const q = (v: number) => Math.round((Math.round((v / 255) * levels) / levels) * 255);
  return (q((p >> 16) & 255) << 16) | (q((p >> 8) & 255) << 8) | q(p & 255);
}

function unpack(p: number, k = 1): [number, number, number] {
  return [(((p >> 16) & 255) / 255) * k, (((p >> 8) & 255) / 255) * k, ((p & 255) / 255) * k];
}

/**
 * Chebyshev distance (in columns, capped at cap) of every column to the
 * nearest column where `on` is set: a two-pass chamfer transform (exact
 * for the chessboard metric), linear in the number of columns.
 */
export function distanceTo(on: Uint8Array, nx: number, ny: number, cap: number): Uint8Array {
  const big = 255;
  const d = new Uint8Array(nx * ny).fill(big);
  for (let k = 0; k < nx * ny; k++) if (on[k]) d[k] = 0;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? big : (d[j * nx + i] as number));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (d[k] === 0) continue;
      const m = Math.min(at(i - 1, j), at(i, j - 1), at(i - 1, j - 1), at(i + 1, j - 1)) + 1;
      if (m < (d[k] as number)) d[k] = Math.min(big, m);
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (d[k] === 0) continue;
      const m = Math.min(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), at(i - 1, j + 1)) + 1;
      if (m < (d[k] as number)) d[k] = Math.min(big, m);
    }
  }
  for (let k = 0; k < nx * ny; k++) d[k] = Math.min(cap, d[k] as number);
  return d;
}

/** Side band colour of a layer z (steps below the ground are negative, terraces above it) of a coast, terrace, waterfall or rock column. */
export function coastSide(z: number, kind: number): Color3 {
  const p = ((z % LEVEL_STEPS) + LEVEL_STEPS) % LEVEL_STEPS;
  if (kind === SIDE_FALL) return FALL_BANDS[p] as Color3;
  if (kind === SIDE_ROCK && z >= 0) return rockStrata(z);
  if (kind === SIDE_CLIFF) return z >= 0 ? rockStrata(z) : Color3.Lerp(rockStrata(z), CLIFF_FOOT, Math.min(0.85, -z / 6));
  if (z >= 0) return TERRACE_BANDS[p] as Color3;
  const bands = kind === SIDE_SAND ? SAND_BANDS : EARTH_BANDS;
  return bands[Math.min(bands.length - 1, Math.max(0, -z - 1))] as Color3;
}

/** Whether a river column's surface is above a neighbouring river column's (a rapid of the estuary). */
function riverStep(c: ReliefColumns, k: number): boolean {
  const i = k % c.nx;
  const h = c.riverH[k] as number;
  for (const q of [i + 1 < c.nx ? k + 1 : -1, i > 0 ? k - 1 : -1, k + c.nx < c.nx * c.ny ? k + c.nx : -1, k - c.nx]) if (q >= 0 && c.river[q] && (c.riverH[q] as number) < h) return true;
  return false;
}

/**
 * The island's ground as a field at `vpt` columns per tile. Land (inside
 * the smoothed coastline at the column centre) at height 0, coloured by a
 * bilinear blend of the tiles' ground colours (so tiles fade into each
 * other) with a little low-frequency variation; beach tiles carry pebbles
 * and lower their outermost column (RIM_H); off the land a sand shelf
 * (SHELF_H) and the wet sand line (WET_H) step toward the sea. Grass and
 * forest that meet the sea directly keep their height: the side walls drop
 * in earth and rock bands (coastSide).
 */
export function islandField(
  island: Pick<Island, "width" | "height" | "terrain" | "levels" | "heights">,
  loops: readonly CoastLoop[],
  seed: number,
  vpt = TERRAIN_VPT,
  tile?: (t: Terrain | undefined, x: number, y: number) => Color3,
): Field {
  const s = 1 / vpt;
  const nx = island.width * vpt;
  const ny = island.height * vpt;
  // Columns aligned with the tiles: column i lies in tile floor(i / vpt).
  const inside = insideGrid(loops, s / 2, s / 2, s, nx, ny);
  const outside = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) outside[k] = inside[k] ? 0 : 1;
  const toLand = distanceTo(inside, nx, ny, COAST_REACH);
  const toSea = distanceTo(outside, nx, ny, 2);
  const cols = reliefColumns(reliefOf(island), vpt, seed);
  // Cliff coast: land columns of cliff tiles; the sea columns nearer to them than to other land get no shelf.
  const cliffLand = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) if (inside[k] && island.terrain[Math.min(island.height - 1, Math.floor(Math.floor(k / nx) / vpt)) * island.width + Math.min(island.width - 1, Math.floor((k % nx) / vpt))] === "cliff") cliffLand[k] = 1;
  const toCliff = distanceTo(cliffLand, nx, ny, 5);
  // Estuaries: level-0 river water near the sea steps down toward it (rapids), and the shelf in front of the mouth gives way to the sea.
  const toSeaFar = distanceTo(outside, nx, ny, 8);
  const riverLand = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) {
    if (!inside[k] || !cols.river[k] || (cols.riverH[k] as number) !== -RIVER_DROP) continue;
    riverLand[k] = 1;
    const d = toSeaFar[k] as number;
    if (d <= 6) cols.riverH[k] = d <= 3 ? -RIVER_DROP - 2 : -RIVER_DROP - 1;
  }
  const toRiver = distanceTo(riverLand, nx, ny, 3);
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const kind = new Uint8Array(nx * ny);
  const { width, height, terrain } = island;
  const color = tile ?? ((t: Terrain | undefined, x: number, y: number) => groundColor(t, x, y, seed));
  // The ground colour of every tile (a water tile takes the coast's sand: the smoothed coast bulges into it).
  const tc = new Float32Array(width * height * 3);
  const beach = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let t = terrain[y * width + x] as Terrain | undefined;
      if (t === "water") t = "coast";
      if (t === "coast" || t === "islet") beach[y * width + x] = 1;
      // Mountain ground left around the rounded rock: the rock's warm tone, not the grey mountain role; river tiles lend their banks a muddy grass.
      const c =
        t === "mountain" && !tile
          ? SCREE.scale(0.96 + (0.08 * ((x * 7 + y * 13) % 5)) / 4)
          : t === "river" && !tile
            ? BANK
            : t === "cliff" && !tile
              ? CLIFF_TOP.scale(0.96 + 0.06 * hash2(x, y, seed + 17))
              : color(t, x, y);
      tc[(y * width + x) * 3] = c.r;
      tc[(y * width + x) * 3 + 1] = c.g;
      tc[(y * width + x) * 3 + 2] = c.b;
    }
  }
  const tileAt = (x: number, y: number, ch: number) => tc[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3 + ch] as number;
  const col = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < ny; j++) {
    const ty = Math.min(height - 1, Math.floor(j / vpt));
    // Bilinear blend between tile centres (tile x's centre is x + 0.5).
    const fy = (j + 0.5) / vpt - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const tx = Math.min(width - 1, Math.floor(i / vpt));
      if (inside[k]) {
        const g = cols.ground[k] as number;
        if (cols.river[k]) {
          // The river bed one step under the water surface (RiverWater draws the surface at riverH; the far fields keep the bed's water colour); a waterfall wall where the river drops.
          h[k] = (cols.riverH[k] as number) - 1;
          kind[k] = cols.fall[k] || riverStep(cols, k) ? SIDE_FALL : SIDE_EARTH;
          top[k] = pack(RIVER.scale(0.96 + 0.06 * hash2(i, j, seed + 13)));
          continue;
        }
        if (cols.bank[k]) {
          // Banks: sand with pebbles, one step below the ground.
          h[k] = g;
          kind[k] = SIDE_EARTH;
          const p = hash2(i, j, seed + 23);
          top[k] = pack(p < 0.2 ? PEBBLE_DARK : p < 0.45 ? PEBBLE : BANK_SAND.scale(0.95 + 0.08 * hash2(j, i, seed + 29)));
          continue;
        }
        const isBeach = beach[ty * width + tx] === 1 && g === 0;
        h[k] = g;
        kind[k] = isBeach ? SIDE_SAND : cliffLand[k] ? SIDE_CLIFF : SIDE_EARTH;
        if (toSea[k] === 1 && isBeach) {
          h[k] = RIM_H;
          top[k] = pack(RIM.scale(0.97 + 0.06 * hash2(i, j, seed + 5)));
          continue;
        }
        const fx = (i + 0.5) / vpt - 0.5;
        const x0 = Math.floor(fx);
        const wx = fx - x0;
        for (const [ch, key] of [
          [0, "r"],
          [1, "g"],
          [2, "b"],
        ] as const) {
          const a = tileAt(x0, y0, ch) * (1 - wx) + tileAt(x0 + 1, y0, ch) * wx;
          const b = tileAt(x0, y0 + 1, ch) * (1 - wx) + tileAt(x0 + 1, y0 + 1, ch) * wx;
          col[key] = a * (1 - wy) + b * wy;
        }
        // A little variation inside the tiles (low frequency: patches, not noise).
        let f = 0.96 + 0.08 * fbm(i / (vpt * 1.7), j / (vpt * 1.7), seed + 77);
        if (!tile && terrain[ty * width + tx] === "mountain") {
          // Scree: stones in the grit.
          const p = hash2(i, j, seed + 19);
          if (p < 0.4) {
            const pc = p < 0.17 ? SCREE_DARK : SCREE_LIGHT;
            col.r = pc.r;
            col.g = pc.g;
            col.b = pc.b;
          }
        }
        if (isBeach) {
          // Pebbles and shell grit on the beach.
          const p = hash2(i, j, seed + 11);
          if (p < 0.035) {
            const pc = p < 0.012 ? PEBBLE_DARK : PEBBLE;
            col.r = pc.r;
            col.g = pc.g;
            col.b = pc.b;
            f = 1;
          }
        }
        top[k] = pack({ r: col.r * f, g: col.g * f, b: col.b * f });
      } else {
        const d = toLand[k] as number;
        if (d <= 4 && (toCliff[k] as number) <= d) {
          // At a cliff: no shelf, deeper water at the foot of the face, the foam on the first column.
          toLand[k] = Math.min(COAST_REACH, d + 2);
          continue;
        }
        if (d > 2 || (toRiver[k] as number) <= d) continue;
        kind[k] = SIDE_SAND;
        h[k] = d === 1 ? SHELF_H : WET_H;
        top[k] = pack(d === 1 ? SAND.scale(0.93 + 0.05 * hash2(i, j, seed + 3)) : WET.scale(0.97 + 0.05 * hash2(i, j, seed + 4)));
      }
    }
  }
  return { nx, ny, x0: 0, y0: 0, s, h, top, kind, toLand, flat: cols.flat, relief: cols, bottom: SEA_BOTTOM, side: coastSide };
}

/**
 * A copy of a field with its relief's rock stacked on the ground (the lite
 * and far terrain, which draw no rock layer): rock columns rise by their
 * rock height, take the rock's top colour and rock walls. `tiers` (lite,
 * far): the rock in double levels, at most that many (fewer contour walls;
 * lower rock keeps its colour only); `flatRivers` (far): river and bank
 * columns at their level's ground, keeping their colour.
 */
export function withRock(f: Field, seed: number, opts: { tiers?: number; flatRivers?: boolean } = {}): Field {
  const r = f.relief;
  if (!r || r.nx !== f.nx || r.ny !== f.ny) return f;
  const h = f.h.slice();
  const top = f.top.slice();
  const kind = (f.kind ?? new Uint8Array(f.nx * f.ny)).slice();
  const tier = 2 * LEVEL_STEPS;
  for (let k = 0; k < f.nx * f.ny; k++) {
    if (opts.flatRivers && (r.river[k] || r.bank[k])) {
      // Rivers and banks at their level (estuary rapids included: no walls at far).
      h[k] = (r.ground[k] as number) + (r.bank[k] ? 1 : 0);
      continue;
    }
    const r0 = r.rock[k] as number;
    if (r0 <= 0 || h[k] === EMPTY) continue;
    const rk = opts.tiers === undefined ? r0 : Math.min(opts.tiers, Math.round(r0 / tier)) * tier;
    h[k] = (h[k] as number) + rk;
    top[k] = pack(rockTop(r0, r.rim[k] as number, k % f.nx, Math.floor(k / f.nx), seed));
    if (rk > 0) kind[k] = SIDE_ROCK;
  }
  return { ...f, h, top, kind };
}

/**
 * The field with its land heights (≥ 0 steps) rounded to multiples of
 * `step` (the far terrain: whole terrace levels, no rims or ramps — fewer
 * walls).
 */
export function snapHeights(f: Field, step: number): Field {
  const h = f.h.slice();
  for (let k = 0; k < h.length; k++) {
    const v = h[k] as number;
    if (v > 0) h[k] = Math.round(v / step) * step;
  }
  return { ...f, h };
}

/**
 * A field at 1/k of the columns (k × k columns → one): the column's height
 * is the median of its block's (so it is land exactly when at least half
 * of the block is), its colour the mean of the block's columns at that
 * height, its side kind the first of them. The far meshes are the near
 * field downsampled: their coast lines up with the near one.
 */
export function downsampleField(src: Field, k: number): Field {
  const nx = Math.ceil(src.nx / k);
  const ny = Math.ceil(src.ny / k);
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const kind = new Uint8Array(nx * ny);
  const hs: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      hs.length = 0;
      for (let b = j * k; b < Math.min(src.ny, j * k + k); b++) for (let a = i * k; a < Math.min(src.nx, i * k + k); a++) hs.push(src.h[b * src.nx + a] as number);
      const sorted = [...hs].sort((p, q) => p - q);
      const m = sorted[Math.floor(sorted.length / 2)] as number;
      const o = j * nx + i;
      h[o] = m;
      if (m === EMPTY) continue;
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      let first = -1;
      for (let b = j * k; b < Math.min(src.ny, j * k + k); b++) {
        for (let a = i * k; a < Math.min(src.nx, i * k + k); a++) {
          const q = b * src.nx + a;
          if (src.h[q] !== m) continue;
          if (first < 0) first = q;
          const p = src.top[q] as number;
          r += (p >> 16) & 255;
          g += (p >> 8) & 255;
          bl += p & 255;
          n++;
        }
      }
      top[o] = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n);
      kind[o] = src.kind?.[first] ?? 0;
    }
  }
  return { nx, ny, x0: src.x0, y0: src.y0, s: src.s * k, h, top, kind, bottom: src.bottom, side: src.side };
}

const sameColor = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => a.r === b.r && a.g === b.g && a.b === b.b;

/** Adds a quad (a, b, c, d counter-clockwise seen from outside) with one normal and per-corner colours. */
function quad(b: Builder, p: readonly (readonly [number, number, number])[], n: readonly [number, number, number], cols: readonly (readonly [number, number, number])[], flip: boolean): void {
  const base = b.positions.length / 3;
  for (let k = 0; k < 4; k++) {
    const q = p[k] as readonly [number, number, number];
    const c = cols[k] as readonly [number, number, number];
    b.positions.push(q[0], q[1], q[2]);
    b.colors.push(c[0], c[1], c[2], 1);
    b.normals.push(n[0], n[1], n[2]);
  }
  if (flip) b.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base + 0);
  else b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Meshes the columns i0 ≤ i < i1, j0 ≤ j < j1 of a field into a builder
 * (island-local: column point (x, y) at height z is (x, z·step, −y)).
 * Neighbours outside the range are read from the field, so chunks join
 * without seams. `step` is the height of one step (tiles).
 */
export function meshField(b: Builder, f: Field, i0: number, j0: number, i1: number, j1: number, step = VOXEL_STEP): void {
  const { nx, ny, h, top, s, x0, y0 } = f;
  const textured = !!f.textured;
  const H = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? EMPTY : (h[j * nx + i] as number));
  const K = (i: number, j: number) => (f.kind ? (f.kind[j * nx + i] as number) : 0);
  i0 = Math.max(0, i0);
  j0 = Math.max(0, j0);
  i1 = Math.min(nx, i1);
  j1 = Math.min(ny, j1);
  const w = i1 - i0;
  // Tops: key per column (height, colour unless textured, corner occlusion); greedy rectangles.
  const keys: (string | null)[] = new Array(w * (j1 - j0)).fill(null);
  const occl: number[][] = new Array(w * (j1 - j0));
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const hc = H(i, j);
      if (hc === EMPTY) continue;
      // An occluder one step higher counts half (a road's or a beach step's edge), two or more in full.
      const up = (di: number, dj: number) => {
        const d = H(i + di, j + dj) - hc;
        return d >= 2 ? 1 : d === 1 ? 0.5 : 0;
      };
      const o: number[] = [];
      // Corners (i, j), (i+1, j), (i+1, j+1), (i, j+1).
      for (const [di, dj] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const a = up(di, 0);
        const c = up(0, dj);
        o.push(a && c ? Math.max(a + c + up(di, dj), 1.5 * Math.max(a, c)) : a + c + up(di, dj));
      }
      const k = (j - j0) * w + (i - i0);
      occl[k] = o;
      keys[k] = `${hc}|${textured ? 0 : quantised(top[j * nx + i] as number, f.quant)}|${o.join("")}`;
    }
  }
  const used = new Uint8Array(w * (j1 - j0));
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = (j - j0) * w + (i - i0);
      const key = keys[k];
      if (key === null || key === undefined || used[k]) continue;
      const o = occl[k] as number[];
      const uniform = o[0] === o[1] && o[1] === o[2] && o[2] === o[3];
      const alongI = uniform || (o[0] === o[1] && o[3] === o[2]);
      const alongJ = uniform || (o[0] === o[3] && o[1] === o[2]);
      let rw = 1;
      if (alongI) while (i + rw < i1 && !used[k + rw] && keys[k + rw] === key) rw++;
      let rh = 1;
      if (alongJ) {
        outer: while (j + rh < j1) {
          for (let d = 0; d < rw; d++) {
            const kk = k + rh * w + d;
            if (used[kk] || keys[kk] !== key) break outer;
          }
          rh++;
        }
      }
      for (let dj = 0; dj < rh; dj++) for (let di = 0; di < rw; di++) used[k + dj * w + di] = 1;
      const z = H(i, j) * step;
      const xa = x0 + i * s;
      const xb = x0 + (i + rw) * s;
      const ya = y0 + j * s;
      const yb = y0 + (j + rh) * s;
      const base = textured ? 0xffffff : quantised(top[j * nx + i] as number, f.quant);
      const cols = o.map((n) => unpack(base, 1 - AO * n));
      // Island-local: tile y runs along −z.
      quad(
        b,
        [
          [xa, z, -ya],
          [xb, z, -ya],
          [xb, z, -yb],
          [xa, z, -yb],
        ],
        [0, 1, 0],
        cols,
        (o[0] as number) + (o[2] as number) < (o[1] as number) + (o[3] as number),
      );
    }
  }
  // Sides: per direction, runs of columns along the edge with equal (own, neighbour) heights and side kind.
  const tilt = (nx_: number, nz: number): [number, number, number] => {
    const l = Math.hypot(nx_, UP_TILT, nz);
    return [nx_ / l, UP_TILT / l, nz / l];
  };
  const sideRuns = (dir: 0 | 1 | 2 | 3) => {
    // dir 0: +x, 1: −x, 2: +y (tile y), 3: −y.
    const alongI = dir >= 2;
    const outer0 = alongI ? j0 : i0;
    const outer1 = alongI ? j1 : i1;
    const inner0 = alongI ? i0 : j0;
    const inner1 = alongI ? i1 : j1;
    for (let a = outer0; a < outer1; a++) {
      let start = -1;
      let runKey = "";
      const flush = (end: number) => {
        if (start < 0) return;
        const [hc, hn, kd] = runKey.split("|").map(Number) as [number, number, number];
        emitSide(dir, a, start, end, hc, hn, kd);
        start = -1;
      };
      for (let c = inner0; c <= inner1; c++) {
        let key = "";
        if (c < inner1) {
          const i = alongI ? c : a;
          const j = alongI ? a : c;
          const hc = H(i, j);
          if (hc !== EMPTY) {
            const ni = i + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
            const nj = j + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
            const hnRaw = H(ni, nj);
            const hn = hnRaw === EMPTY ? (f.floor ? (f.floor[j * nx + i] as number) : f.bottom) : Math.max(hnRaw, f.bottom);
            if (hn < hc) key = `${hc}|${hn}|${K(i, j)}`;
          }
        }
        if (key !== runKey) {
          flush(c);
          if (key !== "") start = c;
          runKey = key;
        }
      }
    }
  };
  const emitSide = (dir: 0 | 1 | 2 | 3, a: number, c0: number, c1: number, hc: number, hn: number, kd: number) => {
    // Layers of equal band colour merge into one quad; the wall's foot a little darker (baked occlusion of the step below).
    let z = hn;
    while (z < hc) {
      const col = f.side(z, kd);
      let z1 = z + 1;
      while (z1 < hc && sameColor(f.side(z1, kd), col)) z1++;
      const cc: [number, number, number] = [col.r, col.g, col.b];
      const lo: [number, number, number] = z === hn ? [col.r * 0.86, col.g * 0.86, col.b * 0.86] : cc;
      const za = z * step;
      const zb = z1 * step;
      let p: [number, number, number][];
      let n: [number, number, number];
      if (dir <= 1) {
        const x = x0 + (a + (dir === 0 ? 1 : 0)) * s;
        const ya = y0 + c0 * s;
        const yb = y0 + c1 * s;
        p = [
          [x, za, -ya],
          [x, za, -yb],
          [x, zb, -yb],
          [x, zb, -ya],
        ];
        n = tilt(dir === 0 ? 1 : -1, 0);
      } else {
        const y = y0 + (a + (dir === 2 ? 1 : 0)) * s;
        const xa = x0 + c0 * s;
        const xb = x0 + c1 * s;
        p = [
          [xa, za, -y],
          [xb, za, -y],
          [xb, zb, -y],
          [xa, zb, -y],
        ];
        n = tilt(0, dir === 2 ? -1 : 1);
      }
      quad(b, p, n, [lo, lo, cc, cc], false);
      z = z1;
    }
  };
  for (const d of [0, 1, 2, 3] as const) sideRuns(d);
}

/** Columns of a tile rectangle (chunk) in a field at vpt columns per tile. */
export function tileRange(x: number, y: number, w: number, hgt: number, vpt: number): [number, number, number, number] {
  return [x * vpt, y * vpt, (x + w) * vpt, (y + hgt) * vpt];
}

/** RGBA bytes of a field's top colours, row-major (row 0 = column row j = 0): the ground texture. */
export function groundTexels(f: Field): Uint8Array {
  const out = new Uint8Array(f.nx * f.ny * 4);
  for (let k = 0; k < f.nx * f.ny; k++) {
    const p = f.top[k] as number;
    out[k * 4] = (p >> 16) & 255;
    out[k * 4 + 1] = (p >> 8) & 255;
    out[k * 4 + 2] = p & 255;
    out[k * 4 + 3] = 255;
  }
  return out;
}
