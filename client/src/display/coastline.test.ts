import { describe, expect, it } from "vitest";
import { chaikin, coastline, loopArea, marchingSquares, outwardNormal, traceLoops } from "./coastline";

/** A grid from rows of '#' (land) and '.' (water). */
function grid(rows: string[]) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const terrain = rows.flatMap((r) => [...r].map((c) => (c === "#" ? "grass" : c === "M" ? "mountain" : "water")));
  return { width, height, terrain, land: (x: number, y: number) => terrain[y * width + x] !== "water" };
}

function loopsOf(rows: string[]) {
  const g = grid(rows);
  return traceLoops(marchingSquares(g.width, g.height, g.land));
}

const pts = (loop: { x: number; y: number }[]) => loop.map((p) => `${p.x},${p.y}`).sort();

describe("marching squares coastline", () => {
  it("draws a diamond through the edge midpoints of a single tile", () => {
    const loops = loopsOf(["...", ".#.", "..."]);
    expect(loops).toHaveLength(1);
    expect(pts(loops[0]!)).toEqual(["1,1.5", "1.5,1", "1.5,2", "2,1.5"]);
    // Every crossing belongs to the land tile.
    expect(loops[0]!.every((p) => p.landX === 1 && p.landY === 1)).toBe(true);
  });

  it("chamfers a 2×2 blob into an octagon", () => {
    const loops = loopsOf(["....", ".##.", ".##.", "...."]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(8);
    expect(pts(loops[0]!)).toEqual(["1,1.5", "1,2.5", "1.5,1", "1.5,3", "2.5,1", "2.5,3", "3,1.5", "3,2.5"]);
  });

  it("keeps diagonal land tiles apart at a saddle", () => {
    expect(loopsOf(["#.", ".#"])).toHaveLength(2);
    expect(loopsOf([".#", "#."])).toHaveLength(2);
  });

  it("closes the contour along the map border", () => {
    const loops = loopsOf(["##", "##"]);
    expect(loops).toHaveLength(1);
    // The outline lies on the map edge (x = 0 / y = 0 between the outside
    // water and the border tiles' centres) and the map corners are cut.
    const xs = loops[0]!.map((p) => p.x);
    const ys = loops[0]!.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(2);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(2);
  });

  it("traces an island with a lake as two loops of opposite orientation", () => {
    const loops = loopsOf([".....", ".###.", ".#.#.", ".###.", "....."]);
    expect(loops).toHaveLength(2);
    const areas = loops.map(loopArea).sort((a, b) => a - b);
    expect(Math.sign(areas[0]!)).not.toBe(Math.sign(areas[1]!));
    // The outer loop is the larger one.
    expect(Math.abs(areas[0]!) + Math.abs(areas[1]!)).toBeGreaterThan(2 * Math.min(Math.abs(areas[0]!), Math.abs(areas[1]!)));
  });

  it("orients loops with the land on the right: outward normals point to water", () => {
    const g = grid([".....", ".###.", ".###.", ".###.", "....."]);
    const [loop] = traceLoops(marchingSquares(g.width, g.height, g.land));
    loop!.forEach((p, k) => {
      const n = outwardNormal(loop!, k);
      const wx = Math.floor(p.x + n.x * 0.4);
      const wy = Math.floor(p.y + n.y * 0.4);
      const lx = Math.floor(p.x - n.x * 0.4);
      const ly = Math.floor(p.y - n.y * 0.4);
      expect(g.land(wx, wy) && wx >= 0 && wy >= 0 && wx < 5 && wy < 5).toBe(false);
      expect(g.land(lx, ly)).toBe(true);
    });
  });

  it("records the land tile of each crossing (mountain cliffs)", () => {
    const g = grid(["....", ".M#.", "...."]);
    const loops = traceLoops(marchingSquares(g.width, g.height, g.land));
    expect(loops).toHaveLength(1);
    const tiles = new Set(loops[0]!.map((p) => `${p.landX},${p.landY}`));
    expect(tiles).toEqual(new Set(["1,1", "2,1"]));
  });

  it("smooths deterministically with Chaikin and keeps the loop closed", () => {
    const [loop] = loopsOf(["....", ".##.", ".##.", "...."]);
    const s = chaikin(loop!, 2);
    expect(s).toHaveLength(loop!.length * 4);
    expect(chaikin(loop!, 2)).toEqual(s);
    expect(Math.abs(loopArea(s))).toBeLessThan(Math.abs(loopArea(loop!)));
    expect(coastline(grid(["....", ".##.", ".##.", "...."]))).toEqual([s]);
  });

  it("finds no coast on an all-water map", () => {
    expect(loopsOf(["...", "..."])).toEqual([]);
  });
});
