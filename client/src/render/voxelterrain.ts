// Voxel terrain of the art-style prototype (?voxel=1, display/voxel.ts;
// .experiment/voxel/NOTES.md), render data only. A height field of
// square columns — 4 per tile at near/mid, fewer for the far meshes —
// meshed with 2.5D greedy meshing: column tops merge into rectangles of
// equal colour and corner occlusion, column sides become one quad per
// voxel layer and run of equal neighbours. One height step is one voxel
// (VOXEL_STEP tiles). The coast is the smoothed coastline sampled at the
// column centres (a pixel coastline) with two sand shelves stepping down
// toward the sea; plateaus (mountains) are terraces of the same columns.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Island, Terrain } from "../api/client";
import type { CoastLoop } from "../display/coastline";
import { ISLAND, TERRAIN } from "../theme/palette";
import { c3 } from "./palette";
import { insideGrid } from "./plateaus";
import { type Builder, groundColor } from "./terrain";

/** Voxels per tile of the near/mid terrain (half the models' 8). */
export const TERRAIN_VPT = 4;
/** Height of one voxel step (tiles): one voxel of the terrain grid. */
export const VOXEL_STEP = 1 / TERRAIN_VPT;
/** Empty column (sea). */
export const EMPTY = -128;
/** Lowest layer of the coast columns (steps): below the sea surface (SEA_LEVEL −0.6). */
export const SEA_BOTTOM = -3;
/** Darkening per occluded corner of a top face (0..3 corners). */
const AO = 0.09;
/** Upward tilt of the side normals (like the slab's UP_TILT). */
const UP_TILT = 0.9;
/** Colour quantisation of the column tops (per channel): equal neighbours merge. */
const QUANT = 48;

const RIM = c3(ISLAND.sand_rim);
const SAND = c3(TERRAIN.sand);
const ROCK_GROUND = Color3.Lerp(c3(ISLAND.rock_light), c3(ISLAND.moss), 0.25);
const BANDS = [c3(ISLAND.cliff_upper), c3(ISLAND.cliff_ledge), c3(ISLAND.cliff_lower), c3(ISLAND.cliff_foot)];

/** A height field: column (i, j) covers x0 + i·s … x0 + (i+1)·s (island tiles; tile centres are integers), y likewise. */
export interface Field {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  /** Column size (tiles). */
  s: number;
  /** Top height in steps (EMPTY: no column). */
  h: Int8Array;
  /** Top colour, packed 0xRRGGBB (quantised). */
  top: Uint32Array;
  /** Lowest step of every column's sides. */
  bottom: number;
  /** Side colour of a layer (steps; the layer from z to z+1) of a column. */
  side: (z: number, i: number, j: number) => Color3;
}

function pack(c: Color3): number {
  const q = (v: number) => Math.max(0, Math.min(255, Math.round((Math.round(v * QUANT) / QUANT) * 255)));
  return (q(c.r) << 16) | (q(c.g) << 8) | q(c.b);
}

function unpack(p: number, k = 1): [number, number, number] {
  return [(((p >> 16) & 255) / 255) * k, (((p >> 8) & 255) / 255) * k, ((p & 255) / 255) * k];
}

/** Chebyshev distance (in columns, capped at cap) of every column to the nearest column where `on` is set. */
export function distanceTo(on: Uint8Array, nx: number, ny: number, cap: number): Uint8Array {
  const d = new Uint8Array(nx * ny).fill(cap);
  for (let k = 0; k < nx * ny; k++) if (on[k]) d[k] = 0;
  for (let pass = 0; pass < cap; pass++) {
    const prev = d.slice();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let m = prev[j * nx + i] as number;
        if (m === 0) continue;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
            m = Math.min(m, (prev[b * nx + a] as number) + 1);
          }
        }
        d[j * nx + i] = Math.min(cap, m);
      }
    }
  }
  return d;
}

/**
 * The island's ground as a field at `vpt` columns per tile: land (inside
 * the smoothed coastline at the column centre) at height 0 in the tile's
 * ground colour with a sand rim on the outermost column, then two sand
 * shelves (−1, −2 steps) out into the sea.
 */
export function islandField(island: Pick<Island, "width" | "height" | "terrain">, loops: readonly CoastLoop[], seed: number, vpt = TERRAIN_VPT, tile?: (t: Terrain | undefined, x: number, y: number) => Color3): Field {
  const s = 1 / vpt;
  const nx = island.width * vpt;
  const ny = island.height * vpt;
  const x0 = -0.5;
  const y0 = -0.5;
  const inside = insideGrid(loops, x0 + s / 2, y0 + s / 2, s, nx, ny);
  const outside = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) outside[k] = inside[k] ? 0 : 1;
  const toLand = distanceTo(inside, nx, ny, 3);
  const toSea = distanceTo(outside, nx, ny, 2);
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const color = tile ?? ((t: Terrain | undefined, x: number, y: number) => groundColor(t, x, y, seed));
  const { width, terrain } = island;
  for (let j = 0; j < ny; j++) {
    const ty = Math.min(island.height - 1, Math.floor(j / vpt));
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const tx = Math.min(width - 1, Math.floor(i / vpt));
      if (inside[k]) {
        h[k] = 0;
        let t = terrain[ty * width + tx] as Terrain | undefined;
        // A land column in a water tile (the smoothed coast bulges out): the coast's sand.
        if (t === "water") t = "coast";
        // Mountain ground left around the rounded plateaus: the plateau's warm rock, not the grey mountain role.
        top[k] = pack(toSea[k] === 1 ? RIM : t === "mountain" && !tile ? ROCK_GROUND.scale(0.96 + 0.08 * ((tx * 7 + ty * 13) % 5) / 4) : color(t, tx, ty));
      } else {
        const d = toLand[k] as number;
        if (d >= 3) continue;
        h[k] = -d;
        top[k] = pack(SAND.scale(d === 1 ? 0.95 : 0.84));
      }
    }
  }
  return { nx, ny, x0, y0, s, h, top, bottom: SEA_BOTTOM, side: (z) => BANDS[Math.min(BANDS.length - 1, Math.max(0, -z - 1))] as Color3 };
}

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
  const H = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? EMPTY : (h[j * nx + i] as number));
  i0 = Math.max(0, i0);
  j0 = Math.max(0, j0);
  i1 = Math.min(nx, i1);
  j1 = Math.min(ny, j1);
  const w = i1 - i0;
  // Tops: key per column (height, colour, corner occlusion); greedy rectangles.
  const keys: (string | null)[] = new Array(w * (j1 - j0)).fill(null);
  const occl: number[][] = new Array(w * (j1 - j0));
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const hc = H(i, j);
      if (hc === EMPTY) continue;
      const up = (di: number, dj: number) => (H(i + di, j + dj) > hc ? 1 : 0);
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
        o.push(a && c ? 3 : a + c + up(di, dj));
      }
      const k = (j - j0) * w + (i - i0);
      occl[k] = o;
      keys[k] = `${hc}|${top[j * nx + i]}|${o.join("")}`;
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
      const cols = o.map((n) => unpack(top[j * nx + i] as number, 1 - AO * n));
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
  // Sides: per direction, runs of columns along the edge with equal (own, neighbour) heights.
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
        const [hc, hn] = runKey.split("|").map(Number) as [number, number];
        emitSide(dir, a, start, end, hc, hn);
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
            const hn = hnRaw === EMPTY ? f.bottom : Math.max(hnRaw, f.bottom);
            if (hn < hc) key = `${hc}|${hn}`;
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
  const emitSide = (dir: 0 | 1 | 2 | 3, a: number, c0: number, c1: number, hc: number, hn: number) => {
    for (let z = hn; z < hc; z++) {
      const col = f.side(z, dir >= 2 ? c0 : a, dir >= 2 ? a : c0);
      const cc: [number, number, number] = [col.r, col.g, col.b];
      // The lowest layer of a wall a little darker at its foot (baked occlusion of the step below).
      const lo: [number, number, number] = z === hn ? [col.r * 0.88, col.g * 0.88, col.b * 0.88] : cc;
      const za = z * step;
      const zb = (z + 1) * step;
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
    }
  };
  for (const d of [0, 1, 2, 3] as const) sideRuns(d);
}

/** Columns of a tile rectangle (chunk) in a field at vpt columns per tile. */
export function tileRange(x: number, y: number, w: number, hgt: number, vpt: number): [number, number, number, number] {
  return [x * vpt, y * vpt, (x + w) * vpt, (y + hgt) * vpt];
}
