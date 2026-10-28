import { describe, expect, it } from "vitest";
import { coastline } from "../display/coastline";
import { Builder } from "./terrain";
import { distanceTo, EMPTY, type Field, islandField, meshField, SEA_BOTTOM } from "./voxelterrain";

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
  it("merges a flat field's tops into one quad and its rim into one quad per side and layer", () => {
    const b = new Builder();
    meshField(b, flat(8, 6), 0, 0, 8, 6);
    // Top: 2 triangles; four sides × 2 layers (0 down to −2) × 2 triangles.
    expect(tris(b)).toBe(2 + 4 * 2 * 2);
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

  it("steps the coast down in two sand shelves around the land", () => {
    const terrain = ["water", "water", "water", "water", "grass", "water", "water", "water", "water"];
    const island = { width: 3, height: 3, terrain } as never;
    const f = islandField(island, coastline({ width: 3, height: 3, terrain }), 7, 4);
    const hs = new Set(Array.from(f.h));
    expect(hs.has(0)).toBe(true);
    expect(hs.has(-1)).toBe(true);
    expect(hs.has(-2)).toBe(true);
    expect(hs.has(EMPTY)).toBe(true);
    expect(f.bottom).toBe(SEA_BOTTOM);
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
