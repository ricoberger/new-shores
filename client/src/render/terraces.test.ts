import { describe, expect, it } from "vitest";
import type { Terrain } from "../api/client";
import { marchingSquares, traceLoops } from "../display/coastline";
import { cover, groundY, insideGrid, insideLoops, LEVEL_HEIGHT, LEVEL_STEPS, reliefColumns, reliefOf, RIVER_DROP, rockField } from "./terraces";
import { EMPTY, islandField, VOXEL_STEP, withRock } from "./voxelterrain";

// The relief (D-058): terrace levels, rock and rivers as voxel columns.

const MAP: Record<string, Terrain> = { "~": "water", c: "coast", g: "grass", m: "mountain", r: "river", i: "islet", k: "cliff" };

function island(rows: string[], levels: string[], heights?: string[]) {
  return {
    width: rows[0]!.length,
    height: rows.length,
    terrain: rows.flatMap((r) => [...r].map((c) => MAP[c]!)),
    levels: levels.join(""),
    heights: heights?.join(""),
  };
}

describe("relief of an island", () => {
  it("reads levels and rock heights per tile (rock only on mountain, cliff and islet tiles; the sea flat)", () => {
    const r = reliefOf(island(["~gm", "~rk"], ["011", "011"], ["123", "456"]));
    expect(Array.from(r.level)).toEqual([0, 1, 1, 0, 1, 1]);
    expect(Array.from(r.rock)).toEqual([0, 0, 3, 0, 0, 6]);
    expect(groundY(r, 1, 0)).toBeCloseTo(LEVEL_HEIGHT);
    expect(groundY(r, 9, 9)).toBe(0);
    expect(LEVEL_HEIGHT).toBeCloseTo(LEVEL_STEPS * VOXEL_STEP);
  });

  it("is flat without levels or heights", () => {
    const r = reliefOf({ width: 2, height: 1, terrain: ["grass", "mountain"] });
    expect(Array.from(r.level)).toEqual([0, 0]);
    expect(Array.from(r.rock)).toEqual([0, 0]);
  });

  it("blends a tile predicate bilinearly between tile centres", () => {
    const left = (x: number) => x === 0;
    expect(cover(left, 0.5, 0.5)).toBeCloseTo(1); // a tile centre
    expect(cover(left, 0.5, 1)).toBeCloseTo(1);
    expect(cover(left, 1, 1)).toBeCloseTo(0.5);
    expect(cover(left, 1.5, 1)).toBeCloseTo(0);
  });
});

describe("relief columns", () => {
  it("raises a level by LEVEL_STEPS with straight edges on the tile border and no ramps by the sea", () => {
    // Every tile is within a tile of the sea: cliffs, no ramps (any seed).
    const rows = ["~~~~~~", "~gggg~", "~gggg~", "~~~~~~"];
    const lv = ["000000", "000110", "000110", "000000"];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = reliefColumns(reliefOf(island(rows, lv)), 4, seed);
      const at = (x: number, y: number) => c.ground[Math.floor(y * 4) * c.nx + Math.floor(x * 4)];
      expect(at(3.1, 1.5)).toBe(LEVEL_STEPS);
      expect(at(4.5, 2.5)).toBe(LEVEL_STEPS);
      expect(at(2.9, 1.5)).toBe(0);
      expect(c.flat[Math.floor(1.5 * 4) * c.nx + 13]).toBe(LEVEL_STEPS);
      expect(c.flat[Math.floor(1.5 * 4) * c.nx + 11]).toBe(0);
    }
  });

  it("cuts ramps of one step per column only inland, in noise zones", () => {
    // A wide level-1 plateau far from the sea: some of its edge columns ramp (1–3 steps), none jump by more than the level.
    const w = 40;
    const rws = Array.from({ length: w }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === w - 1 ? "~" : "g")).join(""));
    const lvs = Array.from({ length: w }, (_, y) => Array.from({ length: w }, (_, x) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? "1" : "0")).join(""));
    const seeds = [1, 2, 3, 4, 5];
    let ramps = 0;
    for (const s of seeds) {
      const c = reliefColumns(reliefOf(island(rws, lvs)), 4, s);
      for (let k = 0; k < c.ground.length; k++) if (c.ground[k]! > 0 && c.ground[k]! < LEVEL_STEPS) ramps++;
    }
    expect(ramps).toBeGreaterThan(0);
  });

  it("puts rivers RIVER_DROP below their level and marks waterfalls where the river drops a level", () => {
    const r = ["~~~~~~", "~gggg~", "~rrrr~", "~gggg~", "~~~~~~"];
    const l = ["000000", "001100", "001100", "001100", "000000"];
    const c = reliefColumns(reliefOf(island(r, l)), 4, 1);
    const col = (x: number, y: number) => Math.floor(y * 4) * c.nx + Math.floor(x * 4);
    expect(c.river[col(1.5, 2.5)]).toBe(1);
    expect(c.riverH[col(1.5, 2.5)]).toBe(-RIVER_DROP);
    expect(c.riverH[col(2.5, 2.5)]).toBe(LEVEL_STEPS - RIVER_DROP);
    // The level-1 river column next to the level-0 one is a waterfall; the low one is not.
    expect(c.fall[Math.floor(2.5 * 4) * c.nx + 8]).toBe(1);
    expect(c.fall[col(1.5, 2.5)]).toBe(0);
  });

  it("stacks rock with stepped rims, cut out under building footprints", () => {
    const r = ["~~~~~~~~~", "~ggggggg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~ggggggg~", "~~~~~~~~~"];
    const l = r.map((row) => row.replace(/./g, "0"));
    const h = r.map((row) => row.replace(/./g, (ch) => (ch === "m" ? "1" : "0")));
    const rel = reliefOf(island(r, l, h));
    const c = reliefColumns(rel, 4, 1);
    const centre = 18 * c.nx + 18;
    expect(c.rock[centre]).toBe(LEVEL_STEPS);
    // No rock outside the mountain tiles (erosion only removes).
    for (let k = 0; k < c.rock.length; k++) {
      const tx = Math.floor((k % c.nx) / 4);
      const ty = Math.floor(Math.floor(k / c.nx) / 4);
      if (r[ty]![tx] !== "m") expect(c.rock[k]).toBe(0);
    }
    // Rims step up: no rock column is more than two steps above a rockless neighbour.
    for (let k = 0; k < c.rock.length; k++) {
      const i = k % c.nx;
      if (i + 1 < c.nx && c.rock[k + 1] === 0) expect(c.rock[k]!).toBeLessThanOrEqual(2);
    }
    const cut = reliefColumns(rel, 4, 1, new Set(["4,4"]));
    expect(cut.rock[centre]).toBe(0);
    // The rock field stands on the ground; its walls reach down to it.
    const f = rockField(c, 1);
    expect(f.h[centre]).toBe(LEVEL_STEPS);
    expect(f.h[0]).toBe(EMPTY);
    expect(f.floor![centre]).toBe(0);
  });

  it("bakes the rock into the lite and far fields", () => {
    const r = ["~~~~~", "~gmg~", "~~~~~"];
    const l = ["00000", "00000", "00000"];
    const h = ["00000", "00200", "00000"];
    const rel = island(r, l, h);
    const loops = traceLoops(marchingSquares(rel.width, rel.height, (x, y) => x >= 0 && y >= 0 && x < rel.width && y < rel.height && rel.terrain[y * rel.width + x] !== "water"));
    const f = islandField(rel, loops, 1);
    const k = 6 * f.nx + 10;
    expect(f.h[k]).toBe(0);
    expect(withRock(f, 1).h[k]).toBeGreaterThan(0);
  });
});

describe("loops", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  const hole = [
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 1 },
  ];

  it("tests points against loops even-odd (holes cut out)", () => {
    expect(insideLoops([square], 2, 2)).toBe(true);
    expect(insideLoops([square, hole], 2, 2)).toBe(false);
    expect(insideLoops([square, hole], 0.5, 2)).toBe(true);
    expect(insideLoops([square], 5, 2)).toBe(false);
  });

  it("tests a grid exactly like insideLoops", () => {
    for (const loops of [[square], [square, hole]]) {
      const [x0, y0, g, nx, ny] = [-0.6, -0.55, 0.25, 32, 28];
      const grid = insideGrid(loops, x0, y0, g, nx, ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) expect(grid[j * nx + i] === 1).toBe(insideLoops(loops, x0 + i * g, y0 + j * g));
    }
  });
});
