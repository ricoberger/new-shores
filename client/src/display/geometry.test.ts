import { describe, expect, it } from "vitest";
import { covers, lPath, nextRotation, rotatedFootprint } from "./geometry";

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
});
