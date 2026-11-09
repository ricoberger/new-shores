import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { levelAt, waterEdgeHint, waterEdgeTiles, type WaterEdgeDef } from "./geometry";
import { withQuays } from "./quay";
import { footprintText } from "./fields";

interface Site extends WaterEdgeDef {
  name: string;
  rotation: number;
  x: number;
  y: number;
  rows: string[];
  /** Terrace level digits per row (D-075 low shore; absent: all 0). */
  levels?: string[];
  quays: { x: number; y: number }[];
  error: string;
  tiles: { x: number; y: number; water: boolean; problem: string }[];
}
const sites = JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/water_rows/sites.json"), "utf8")) as Site[];
const terrainNames: Record<string, string> = { "~": "water", ".": "grass", c: "coast", f: "forest", m: "mountain", r: "river", i: "islet" };

describe("D-062 per-column water rows, shared with Go", () => {
  for (const site of sites) {
    it(`${site.name} / ${site.rotation}°`, () => {
      const terrain = withQuays((x, y) => terrainNames[site.rows[y]?.[x] ?? "~"]!, new Set(site.quays.map((p) => `${p.x},${p.y}`)));
      const level = levelAt(site.levels?.join(""), site.rows[0]!.length);
      const tiles = waterEdgeTiles(site, terrain, site.x, site.y, site.rotation, level);
      expect(tiles.map((p) => ({ ...p, problem: p.problem ?? "" }))).toEqual(site.tiles);
      expect(tiles.some((p) => p.problem)).toBe(site.error !== "");
      const hint = waterEdgeHint(site, terrain, site.x, site.y, site.rotation, level);
      const first = (["front", "land", "low"] as const).find((problem) => site.tiles.some((p) => p.problem === problem)) ?? null;
      expect(hint).toBe(first);
    });
  }

  it("reads the low-shore cases from the shared fixture (D-075)", () => {
    const low = sites.filter((s) => s.name.startsWith("low-shore"));
    expect(low).toHaveLength(12);
    expect(low.filter((s) => s.tiles.some((p) => p.problem === "low"))).toHaveLength(8);
  });

  it("has no water preview for an inland building", () => {
    expect(waterEdgeTiles({ width: 3, height: 5 }, () => "grass", 0, 0, 0)).toEqual([]);
  });

  it("formats equal, variable and zero-minimum ranges without a scalar alias", () => {
    const def = { id: "fisher", width: 3, height: 8, water_rows: { min: 2, max: 3 } };
    expect(footprintText(def, { buildings: [] })).toBe("3×8 (2–3 rows on water)");
    expect(footprintText({ ...def, water_rows: { min: 0, max: 1 } }, { buildings: [] })).toBe("3×8 (0–1 rows on water)");
    expect(footprintText({ ...def, water_rows: { min: 1, max: 1 } }, { buildings: [] })).toBe("3×8 (1 row on water)");
  });
});
