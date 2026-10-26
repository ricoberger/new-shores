import { describe, expect, it } from "vitest";
import { decodeMask, encodeMask, MASK_COAST, MASK_FOREST, MASK_GRASS, MASK_MOUNTAIN, MASK_WATER, maskAt, maskSize } from "./mask";

const NAMES: Record<string, string> = { w: "water", c: "coast", g: "grass", f: "forest", m: "mountain" };

function island(...rows: string[]) {
  return { width: rows[0]!.length, height: rows.length, terrain: rows.flatMap((r) => [...r].map((c) => NAMES[c]!)) };
}

describe("terrain mask", () => {
  it("encodes the majority per 4×4 block with water on ties and partial edge blocks (as sim.TerrainMask)", () => {
    // The server's TestTerrainMask example.
    const is = island("wwccggggf", "wwccggggf", "ggggffmmw", "ggggffmmw", "mmmfwwwww");
    expect(encodeMask(is)).toBe("ggw" + "mww");
    expect(encodeMask(island("ffgg", "ffgg", "ffgg", "ffgg"))).toBe("f");
    expect(encodeMask(island("ccmm", "ccmm", "ccmm", "ccmm"))).toBe("c");
    // A four-way tie and a land/water tie: water.
    expect(encodeMask(island("wcgfmw", "wcgfmw", "wcgfmw", "wcgfmw"))).toBe("ww");
    expect(maskSize(9, 5)).toEqual({ width: 3, height: 2 });
  });

  it("decodes cells and reads them per tile, water outside and for unknown or missing characters", () => {
    const m = decodeMask("gcmfw?", 9, 5);
    expect(m.width).toBe(3);
    expect(m.height).toBe(2);
    expect([...m.cells]).toEqual([MASK_GRASS, MASK_COAST, MASK_MOUNTAIN, MASK_FOREST, MASK_WATER, MASK_WATER]);
    expect(maskAt(m, 0, 0)).toBe(MASK_GRASS);
    expect(maskAt(m, 7, 3)).toBe(MASK_COAST);
    expect(maskAt(m, 8, 0)).toBe(MASK_MOUNTAIN);
    expect(maskAt(m, 0, 4)).toBe(MASK_FOREST);
    expect(maskAt(m, -1, 0)).toBe(MASK_WATER);
    expect(maskAt(m, 12, 0)).toBe(MASK_WATER);
    // Short mask (an older server): the rest is water.
    expect([...decodeMask("g", 9, 5).cells]).toEqual([MASK_GRASS, 0, 0, 0, 0, 0]);
  });
});
