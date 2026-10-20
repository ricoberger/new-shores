import { describe, expect, it } from "vitest";
import { adjacentRoads, covers, lPath, missingRoadHint, nextRotation, rotatedFootprint } from "./geometry";

describe("geometry", () => {
  it("swaps the footprint at 90 and 270 degrees", () => {
    expect(rotatedFootprint(4, 3, 0)).toEqual([4, 3]);
    expect(rotatedFootprint(4, 3, 90)).toEqual([3, 4]);
    expect(rotatedFootprint(4, 3, 180)).toEqual([4, 3]);
    expect(rotatedFootprint(4, 3, 270)).toEqual([3, 4]);
    expect(nextRotation(270)).toBe(0);
  });

  it("covers the rotated footprint only", () => {
    expect(covers(2, 1, 4, 3, 90, 4, 4)).toBe(true);
    expect(covers(2, 1, 4, 3, 90, 5, 1)).toBe(false);
  });

  it("builds an L-path horizontal first, ends inclusive", () => {
    expect(lPath({ x: 1, y: 1 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 0 },
    ]);
    expect(lPath({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it("finds road tiles next to every edge of the rotated footprint, not at corners", () => {
    // 3x2 footprint at (10, 20): x 10..12, y 20..21.
    const ring = ["10,19", "12,19", "9,20", "9,21", "13,21", "11,22"];
    const corners = ["9,19", "13,19", "9,22", "13,22"];
    const inside = ["10,20"];
    const roads = new Set([...ring, ...corners, ...inside]);
    expect(adjacentRoads(roads, 10, 20, 3, 2).map((p) => `${p.x},${p.y}`).sort()).toEqual([...ring].sort());
    expect(adjacentRoads(new Set(corners), 10, 20, 3, 2)).toEqual([]);
  });

  it("hints yellow only for road-requiring buildings without an adjacent road", () => {
    const sawmill = { width: 3, height: 2, requires_road: true };
    const warehouse = { width: 4, height: 3, requires_road: false };
    // At 90 degrees the footprint is 2x3 (x 10..11, y 20..22): (11,23)
    // touches its bottom edge.
    const below = new Set(["11,23"]);
    expect(missingRoadHint(sawmill, below, 10, 20, 90)).toBe(false);
    // At 0 degrees (x 10..12, y 20..21) the same tile is one row away.
    expect(missingRoadHint(sawmill, below, 10, 20, 0)).toBe(true);
    expect(missingRoadHint(sawmill, new Set(), 10, 20, 0)).toBe(true);
    expect(missingRoadHint(warehouse, new Set(), 10, 20, 0)).toBe(false);
  });
});
