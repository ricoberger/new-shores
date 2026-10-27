import { Color3 } from "@babylonjs/core/Maths/math.color";
import { describe, expect, it } from "vitest";
import type { Terrain } from "../api/client";
import { marchingSquares, traceLoops } from "../display/coastline";
import { fillTop, insideGrid, insideLoops, loopIndex, PLATEAU_STEP, plateauHeight, plateauLevels, roundLoop } from "./plateaus";
import { Builder } from "./terrain";

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

describe("plateau top", () => {
  /** Area of a builder's triangles (on the xz plane) and its triangle count. */
  const area = (b: Builder) => {
    let a = 0;
    for (let i = 0; i < b.indices.length; i += 3) {
      const p = (k: number) => [b.positions[(b.indices[i + k] as number) * 3] as number, b.positions[(b.indices[i + k] as number) * 3 + 2] as number];
      const [ax, az] = p(0) as [number, number];
      const [bx, bz] = p(1) as [number, number];
      const [cx, cz] = p(2) as [number, number];
      a += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    return { area: a, tris: b.indices.length / 3 };
  };

  it("merges runs of whole cells into quads: the same surface with far fewer triangles", () => {
    // A blob with a hole and a notch: partial cells along every edge.
    const rows = ["gggggggggg", "gmmmmmmmmg", "gmmmmmmmmg", "gmmggmmmmg", "gmmggmmmgg", "gmmmmmmmmg", "gmmmmmmmmg", "gggggggggg"];
    const { width, height, terrain } = grid(rows);
    const mask = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] === "mountain";
    const loops = traceLoops(marchingSquares(width, height, mask)).map((l) => roundLoop(l));
    const merged = new Builder();
    const cells = new Builder();
    fillTop(merged, loops, 1, Color3.White());
    fillTop(cells, loops, 1, Color3.White(), false);
    const m = area(merged);
    const c = area(cells);
    expect(m.area).toBeCloseTo(c.area, 6);
    expect(m.tris).toBeLessThan(c.tris / 3);
    expect(merged.positions.filter((_, i) => i % 3 === 1).every((y) => y === 1)).toBe(true);
  });
});
