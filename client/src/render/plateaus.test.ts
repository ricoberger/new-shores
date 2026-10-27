import { describe, expect, it } from "vitest";
import type { Terrain } from "../api/client";
import { insideGrid, insideLoops, loopIndex, PLATEAU_STEP, plateauHeight, plateauLevels, roundLoop } from "./plateaus";

// Mountains as plateaus (visual only): level 1 on mountain tiles, level 2
// deep inside a range, building footprints (mines, quarries) cut out.

function grid(rows: string[]): { width: number; height: number; terrain: Terrain[] } {
  const map: Record<string, Terrain> = { m: "mountain", g: "grass", "~": "water" };
  return { width: rows[0]!.length, height: rows.length, terrain: rows.flatMap((r) => [...r].map((c) => map[c]!)) };
}

describe("plateau levels", () => {
  const island = grid(["ggggg", "gmmmg", "gmmmg", "gmmmg", "ggggg"]);

  it("raises mountains one step and their interior two", () => {
    const l = plateauLevels(island, new Set());
    expect(Array.from(l.slice(5, 10))).toEqual([0, 1, 1, 1, 0]);
    expect(l[2 * 5 + 2]).toBe(2);
    expect(plateauHeight(l, 5, 2, 2)).toBeCloseTo(2 * PLATEAU_STEP);
    expect(plateauHeight(l, 5, 0, 0)).toBe(0);
  });

  it("keeps building footprints at ground level (and their neighbours at one step)", () => {
    const l = plateauLevels(island, new Set(["1,1"]));
    expect(l[1 * 5 + 1]).toBe(0);
    expect(l[2 * 5 + 2]).toBe(1);
  });
});

describe("rounded plateau outline", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it("rounds the corners by at least half a tile and stays inside the tile contour", () => {
    const r = roundLoop(square);
    for (const p of r) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(4 + 1e-9);
    }
    // The closest point to a corner is well inside it: a radius ≥ 0.5 leaves ≥ 0.5·(√2 − 1) ≈ 0.21 tile.
    const nearest = Math.min(...r.map((p) => Math.hypot(p.x, p.y)));
    expect(nearest).toBeGreaterThan(0.2);
    // Straight edges keep their place away from the corners.
    expect(r.some((p) => Math.abs(p.y) < 0.02 && p.x > 1.5 && p.x < 2.5)).toBe(true);
  });

  it("tests points against loops even-odd (holes cut out)", () => {
    const hole = [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 1 },
    ];
    expect(insideLoops([square], 2, 2)).toBe(true);
    expect(insideLoops([square, hole], 2, 2)).toBe(false);
    expect(insideLoops([square, hole], 0.5, 2)).toBe(true);
    expect(insideLoops([square], 5, 2)).toBe(false);
  });

  it("tests a grid and indexed points against loops exactly like insideLoops", () => {
    const hole = [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 1 },
    ];
    const blob = roundLoop([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 5 },
      { x: 0, y: 5 },
    ]);
    for (const loops of [[square], [square, hole], [blob]]) {
      const [x0, y0, g, nx, ny] = [-0.6, -0.55, 0.25, 32, 28];
      const grid = insideGrid(loops, x0, y0, g, nx, ny);
      const index = loopIndex(loops);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const [x, y] = [x0 + i * g, y0 + j * g];
          expect(grid[j * nx + i] === 1).toBe(insideLoops(loops, x, y));
          expect(index(x + 0.07, y + 0.11)).toBe(insideLoops(loops, x + 0.07, y + 0.11));
        }
      }
    }
  });
});
