import { describe, expect, it } from "vitest";
import { shoreHint, shoreTiles } from "./geometry";

// A 10 × 10 map: water in rows 0–4, coast in row 5, grass below, a
// mountain at (8,6), a terrace (level 1) at (6,6); a quay at (2,3).
const terrain = (x: number, y: number) => {
  if (x < 0 || y < 0 || x >= 10 || y >= 10) return "water";
  if (x === 2 && y === 3) return "quay";
  if (y < 5) return "water";
  if (y === 5) return "coast";
  return x === 8 && y === 6 ? "mountain" : "grass";
};
const level = (x: number, y: number) => (x === 6 && y === 6 ? 1 : 0);
const def = { width: 2, height: 3 };

describe("shore placement preview (D-077 §5)", () => {
  it("accepts a deck over the water with its back on the shore", () => {
    // Rotation 0: front at the top, back row y = 5 (coast).
    expect(shoreHint(shoreTiles(def, terrain, 0, 3, 0, level))).toBeNull();
    // Fully on water, the back row on the water but the tile behind on the coast.
    expect(shoreHint(shoreTiles(def, terrain, 0, 2, 0, level))).toBeNull();
  });

  it("marks open water behind the back edge", () => {
    const tiles = shoreTiles(def, terrain, 4, 0, 0, level);
    expect(shoreHint(tiles)).toBe("back");
    expect(tiles.filter((p) => p.problem === "back").map((p) => `${p.x},${p.y}`)).toEqual(["4,2", "5,2"]);
    // A quay behind the back edge carries it (the column at x = 2).
    expect(shoreTiles(def, terrain, 2, 0, 0, level).filter((p) => p.problem === "back").map((p) => p.x)).toEqual([3]);
  });

  it("needs water, flat buildable land and the low shore", () => {
    expect(shoreHint(shoreTiles(def, terrain, 0, 6, 0, level))).toBe("water");
    expect(shoreHint(shoreTiles(def, terrain, 7, 4, 0, level))).toBe("land");
    expect(shoreHint(shoreTiles(def, terrain, 5, 4, 0, level))).toBe("low");
  });

  it("turns with the rotation: at 180 the back is the top row", () => {
    // Rotation 180: front at the bottom; footprint rows 3–5 → the back row is y = 3 (water), behind it y = 2 (water).
    expect(shoreHint(shoreTiles(def, terrain, 4, 3, 180, level))).toBe("back");
    // Rows 5–7 on land only: no water.
    expect(shoreHint(shoreTiles(def, terrain, 0, 5, 180, level))).toBe("water");
  });
});
