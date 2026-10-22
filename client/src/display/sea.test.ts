import { describe, expect, it } from "vitest";
import { DEEP_TILES, depthFactor, landDistance, SHALLOW_TILES } from "./sea";

const island = (x: number, y: number, rows: string[]) => ({
  position: { x, y },
  width: rows[0]!.length,
  height: rows.length,
  terrain: rows.flatMap((r) => [...r].map((c) => (c === "#" ? "grass" : "water"))),
});

describe("sea distance field", () => {
  it("is 0 on land and grows by about a tile per tile of open water", () => {
    const f = landDistance([island(0, 0, ["#"])], 5)!;
    expect(f.step).toBe(1);
    expect(f.width).toBe(11);
    expect(f.originX).toBe(-5);
    const at = (x: number, y: number) => f.dist[(y - f.originY) * f.width + (x - f.originX)]!;
    expect(at(0, 0)).toBe(0);
    expect(at(1, 0)).toBe(1);
    expect(at(3, 0)).toBe(3);
    expect(at(2, 2)).toBeCloseTo(2 * Math.SQRT2, 5);
  });

  it("measures to the nearest island and ignores water tiles of an island", () => {
    const f = landDistance([island(0, 0, ["#..", "..."]), island(10, 0, ["#"])], 2)!;
    const at = (x: number, y: number) => f.dist[(y - f.originY) * f.width + (x - f.originX)]!;
    expect(at(2, 0)).toBe(2); // a water tile inside island 1's rectangle
    expect(at(8, 0)).toBe(2); // nearer to island 2
  });

  it("coarsens large archipelagos to at most maxTexels per side", () => {
    const f = landDistance([island(0, 0, ["#"]), island(3000, 0, ["#"])], 0, 1024)!;
    expect(f.step).toBe(3);
    expect(f.width).toBeLessThanOrEqual(1024);
  });

  it("blends shallows to deep between the thresholds", () => {
    expect(depthFactor(0)).toBe(0);
    expect(depthFactor(SHALLOW_TILES)).toBe(0);
    expect(depthFactor(DEEP_TILES)).toBe(1);
    expect(depthFactor(50)).toBe(1);
    expect(depthFactor((SHALLOW_TILES + DEEP_TILES) / 2)).toBeCloseTo(0.5, 5);
    expect(landDistance([])).toBeNull();
  });
});
