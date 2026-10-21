import { describe, expect, it } from "vitest";
import { adjacentRoads, covers, lPath, missingDepositHint, missingRoadHint, nextRotation, roadStrips, rotatedFootprint, type TilePos } from "./geometry";

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

  it("hints red when a deposit building covers no deposit tile of its kind", () => {
    const quarry = { width: 3, height: 2, requires_deposit: "stone" };
    const deposits = new Map([
      ["12,21", "stone"],
      ["20,20", "iron"],
    ]);
    // x 10..12, y 20..21 covers (12,21).
    expect(missingDepositHint(quarry, deposits, 10, 20, 0)).toBe(false);
    // At 90 degrees the footprint is 2x3 (x 10..11, y 20..22): no stone.
    expect(missingDepositHint(quarry, deposits, 10, 20, 90)).toBe(true);
    // The wrong kind does not count; buildings without a deposit never hint.
    expect(missingDepositHint(quarry, deposits, 19, 19, 0)).toBe(true);
    expect(missingDepositHint({ width: 2, height: 2 }, new Map(), 0, 0, 0)).toBe(false);
  });
});

describe("roadStrips", () => {
  const tilesOf = (strips: ReturnType<typeof roadStrips>): string[] => {
    const out: string[] = [];
    for (const s of strips) for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) out.push(`${x},${y}`);
    return out.sort();
  };

  it("merges rows into horizontal strips and the rest into vertical ones, each tile once", () => {
    // A grid: two rows joined by a column at each end, plus a lone tile.
    const tiles: TilePos[] = [];
    for (let x = 0; x <= 5; x++) tiles.push({ x, y: 0 }, { x, y: 4 });
    for (let y = 1; y <= 3; y++) tiles.push({ x: 0, y }, { x: 5, y });
    tiles.push({ x: 9, y: 9 }, { x: 0, y: 0 }); // a duplicate is ignored
    const strips = roadStrips(tiles);
    expect(strips).toEqual([
      { x0: 0, y0: 0, x1: 5, y1: 0 },
      { x0: 0, y0: 4, x1: 5, y1: 4 },
      { x0: 0, y0: 1, x1: 0, y1: 3 },
      { x0: 5, y0: 1, x1: 5, y1: 3 },
      { x0: 9, y0: 9, x1: 9, y1: 9 },
    ]);
    const unique = [...new Set(tiles.map((t) => `${t.x},${t.y}`))].sort();
    expect(tilesOf(strips)).toEqual(unique);
    expect(roadStrips([])).toEqual([]);
  });
});
