import { describe, expect, it } from "vitest";
import { coastline } from "../display/coastline";
import { Builder } from "./terrain";
import { distanceTo, downsampleField, EMPTY, type Field, islandField, meshField, RIM_H, roundDistanceTo, SEA_BOTTOM, SHELF_H, WET_H } from "./voxelterrain";

const flat = (nx: number, ny: number, h = 0): Field => ({
  nx,
  ny,
  x0: 0,
  y0: 0,
  s: 1,
  h: new Int8Array(nx * ny).fill(h),
  top: new Uint32Array(nx * ny).fill(0x808080),
  bottom: -2,
  side: () => ({ r: 0.5, g: 0.5, b: 0.5 }) as never,
});

const tris = (b: Builder) => b.indices.length / 3;

describe("voxel terrain", () => {
  it("merges a flat field's tops into one quad and its rim into one quad per side and band", () => {
    const b = new Builder();
    meshField(b, flat(8, 6), 0, 0, 8, 6);
    // Top: 2 triangles; four sides, one band (0 down to −2) × 2 triangles.
    expect(tris(b)).toBe(2 + 4 * 2);
    const banded = new Builder();
    meshField(banded, { ...flat(8, 6), side: (z) => ({ r: z === -1 ? 0.5 : 0.3, g: 0.5, b: 0.5 }) as never }, 0, 0, 8, 6);
    // Two bands: two quads per side.
    expect(tris(banded)).toBe(2 + 4 * 2 * 2);
  });

  it("merges textured tops regardless of their colour, with the occlusion only in the vertex colour", () => {
    const f = { ...flat(8, 6), textured: true };
    for (let k = 0; k < f.top.length; k++) f.top[k] = k * 977;
    const b = new Builder();
    meshField(b, f, 0, 0, 8, 6);
    expect(tris(b)).toBe(2 + 4 * 2);
    // The top's vertices are white (the texture colours them).
    expect(b.colors.slice(0, 4)).toEqual([1, 1, 1, 1]);
  });

  it("joins chunks without seams: the halves have the triangles of the whole", () => {
    const f = flat(8, 8);
    f.h[3 * 8 + 3] = 2;
    const whole = new Builder();
    meshField(whole, f, 0, 0, 8, 8);
    const left = new Builder();
    meshField(left, f, 0, 0, 4, 8);
    meshField(left, f, 4, 0, 8, 8);
    // The split cuts merged rectangles but adds no faces between the halves: the surface area is the same.
    const area = (b: Builder) => {
      let a = 0;
      for (let t = 0; t < b.indices.length; t += 3) {
        const p = [0, 1, 2].map((k) => b.positions.slice((b.indices[t + k] as number) * 3, (b.indices[t + k] as number) * 3 + 3));
        const [u, v] = [1, 2].map((k) => (p[k] as number[]).map((x, i) => x - ((p[0] as number[])[i] as number)));
        const [ux, uy, uz] = u as number[];
        const [vx, vy, vz] = v as number[];
        a += Math.hypot(uy! * vz! - uz! * vy!, uz! * vx! - ux! * vz!, ux! * vy! - uy! * vx!) / 2;
      }
      return a;
    };
    expect(area(left)).toBeCloseTo(area(whole), 6);
  });

  it("darkens the corners of tops next to a higher column", () => {
    const f = flat(3, 3);
    f.h[4] = 1;
    const b = new Builder();
    meshField(b, f, 0, 0, 3, 3);
    const reds = b.colors.filter((_, k) => k % 4 === 0);
    expect(Math.min(...reds)).toBeLessThan(0.5);
  });

  it("steps the coast down: beach rim, sand shelf, wet sand line; grass meets the shelf at full height", () => {
    const at = (terrain: string[]) => {
      const island = { width: 5, height: 5, terrain } as never;
      return islandField(island, coastline({ width: 5, height: 5, terrain: terrain as never }), 7, 4);
    };
    const ring = (inner: string) => Array.from({ length: 25 }, (_, k) => (k % 5 === 0 || k % 5 === 4 || k < 5 || k >= 20 ? "water" : inner));
    const beach = at(ring("coast"));
    const hs = new Set(Array.from(beach.h));
    for (const h of [0, RIM_H, SHELF_H, WET_H, EMPTY]) expect(hs.has(h)).toBe(true);
    expect(beach.bottom).toBe(SEA_BOTTOM);
    // The wet line is the outermost: every wet column is next to a shelf column, never next to land.
    const grass = at(ring("grass"));
    expect(new Set(Array.from(grass.h)).has(RIM_H)).toBe(false);
    // The coast distances reach past the shelves (the shallows and foam read them).
    expect(Math.max(...Array.from(grass.toLand!))).toBeGreaterThan(4);
  });

  it("downsamples the near field so the far coast lines up with it (no jump at the LOD switch)", () => {
    // An irregular island: a blob with a bay, coast tiles on its rim.
    const W = 14;
    const H = 12;
    const terrain: string[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - 6.5) / 5.5, (y - 5.5) / 4.5);
        const bay = x > 8 && Math.abs(y - 5.5) < 1.5;
        terrain.push(d > 1 || bay ? "water" : d > 0.8 ? "coast" : (x + y) % 5 === 0 ? "forest" : "grass");
      }
    }
    const island = { width: W, height: H, terrain } as never;
    const near = islandField(island, coastline({ width: W, height: H, terrain: terrain as never }), 3, 4);
    for (const k of [2, 4]) {
      const far = downsampleField(near, k);
      expect(far.s).toBeCloseTo(near.s * k, 9);
      let landNear = 0;
      let landFar = 0;
      for (let j = 0; j < far.ny; j++) {
        for (let i = 0; i < far.nx; i++) {
          let land = 0;
          let n = 0;
          for (let b = j * k; b < Math.min(near.ny, j * k + k); b++) {
            for (let a = i * k; a < Math.min(near.nx, i * k + k); a++) {
              n++;
              if ((near.h[b * near.nx + a] as number) >= RIM_H) land++;
            }
          }
          landNear += land;
          const isLand = (far.h[j * far.nx + i] as number) >= RIM_H;
          if (isLand) landFar += k * k;
          // A far column is land exactly when at least half of its near columns are.
          expect(isLand).toBe(land * 2 >= n);
        }
      }
      // So the land's outline moves by less than a far column: the areas agree closely.
      expect(Math.abs(landFar - landNear) / landNear).toBeLessThan(0.08);
    }
  });

  it("measures Chebyshev distances", () => {
    const on = new Uint8Array(25);
    on[12] = 1;
    const d = distanceTo(on, 5, 5, 3);
    expect(d[12]).toBe(0);
    expect(d[0]).toBe(2);
    expect(d[6]).toBe(1);
  });
});

describe("round distance (D-058: halos that follow an outline)", () => {
  it("grows an octagon around a point, not the chessboard's square, capped", () => {
    const n = 21;
    const on = new Uint8Array(n * n);
    on[10 * n + 10] = 1;
    const d = roundDistanceTo(on, n, n, 9);
    const cheb = distanceTo(on, n, n, 9);
    expect(d[10 * n + 15]).toBe(5);
    // The diagonal is longer than the chessboard's: 5 steps out on both axes ≈ 7.
    expect(cheb[15 * n + 15]).toBe(5);
    expect(d[15 * n + 15]).toBe(7);
    expect(d[0]).toBe(9);
    expect(d[10 * n + 10]).toBe(0);
  });
});
