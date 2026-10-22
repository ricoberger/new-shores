import { describe, expect, it } from "vitest";
import type { Terrain } from "../api/client";
import { PLATEAU_STEP, plateauHeight, plateauLevels } from "./plateaus";

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
