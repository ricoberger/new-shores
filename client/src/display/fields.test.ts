import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, DisplayState } from "../api/client";
import {
  buildMenuOrder,
  classifyFieldTiles,
  fieldRectHint,
  fieldTilesToSend,
  inFarmRadius,
  MAX_FIELD_TILES,
  rectTiles,
} from "./fields";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureDir = join(root, "server", "testdata", "display");
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f, base: (JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as { base: DisplayState }).base }));

/** The shipped content file (footprint and work radius of the farms). */
const shipped = JSON.parse(readFileSync(join(root, "content", "old_coast", "buildings.json"), "utf8")) as {
  id: string;
  footprint: [number, number];
  work_area?: { radius: number };
  fields?: { type: string };
  field?: { type: string };
}[];

const def = (id: string, w: number, h: number, extra: Partial<ContentBuilding> = {}) =>
  ({ id, name: id, width: w, height: h, category: "production", ...extra }) as ContentBuilding;

const pasture = def("pasture", 1, 1, { name: "Pasture", field: { type: "pasture", terrain: ["grass"] } });
const wheatField = def("wheat_field", 1, 1, { name: "Wheat field", field: { type: "wheat_field", terrain: ["grass"], fertility: "wheat" } });
const sheepFarm = def("sheep_farm", 3, 3, { work_area: { radius: 4 }, fields: { type: "pasture", required: 16 } });
const defs = new Map([pasture, wheatField, sheepFarm, def("house", 2, 2)].map((d) => [d.id, d]));

const building = (id: number, type: string, x: number, y: number, rotation = 0) =>
  ({ id, type, x, y, rotation, status: "ok" }) as BuildingDisplay;

/** A 20 × 12 grass island with a forest tile at (2,6). */
function island(fertilities: string[] = []) {
  const width = 20;
  const height = 12;
  const terrain = Array.from({ length: width * height }, (_, i) => (i === 6 * width + 2 ? "forest" : "grass")) as ("grass" | "forest")[];
  return { width, height, terrain, fertilities };
}

describe("rectTiles", () => {
  it("lists the inclusive rectangle row by row for any corner order", () => {
    const a = rectTiles({ x: 3, y: 2 }, { x: 1, y: 3 });
    expect(a).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    expect(rectTiles({ x: 1, y: 3 }, { x: 3, y: 2 })).toEqual(a);
    expect(rectTiles({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("inFarmRadius", () => {
  const farm = { x: 8, y: 5, rotation: 0, width: 3, height: 3, radius: 4 };
  it("uses the server's integer disc rule (boundary included)", () => {
    // (2*13+1-19)^2 + (2*6+1-13)^2 = 64 <= 64; (14,6) gives 100.
    expect(inFarmRadius(farm, 13, 6)).toBe(true);
    expect(inFarmRadius(farm, 14, 6)).toBe(false);
    // Rotation swaps a non-square footprint.
    const long = { x: 0, y: 0, rotation: 90, width: 4, height: 2, radius: 1 };
    expect(inFarmRadius(long, 1, 2)).toBe(true);
    expect(inFarmRadius({ ...long, rotation: 0 }, 1, 2)).toBe(false);
  });

  it("contains every field the server assigned to a farm (shared display fixtures)", () => {
    let checked = 0;
    for (const { name, base } of fixtures) {
      for (const is of base.islands) {
        for (const f of is.buildings) {
          if (f.farm_id === undefined) continue;
          const farm = is.buildings.find((b) => b.id === f.farm_id);
          const fd = shipped.find((d) => d.id === farm?.type);
          expect(farm && fd?.work_area && fd.fields, `${name}: farm ${f.farm_id}`).toBeTruthy();
          if (!farm || !fd?.work_area) continue;
          const ok = inFarmRadius(
            { x: farm.x, y: farm.y, rotation: farm.rotation, width: fd.footprint[0], height: fd.footprint[1], radius: fd.work_area.radius },
            f.x,
            f.y,
          );
          expect(ok, `${name}: field ${f.id} at (${f.x},${f.y}) and farm ${farm.id}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("classifyFieldTiles", () => {
  const buildings = [building(1, "sheep_farm", 8, 5), building(2, "house", 6, 2), building(3, "pasture", 7, 8)];
  const data = (fertilities: string[] = []) => ({ island: island(fertilities), buildings, roads: [{ x: 9, y: 4 }], defs });

  it("colours free matching tiles inside a ring green and outside every ring yellow", () => {
    const { valid, outOfRange } = classifyFieldTiles(pasture, rectTiles({ x: 12, y: 6 }, { x: 15, y: 6 }), data());
    expect(valid).toEqual([
      { x: 12, y: 6 },
      { x: 13, y: 6 },
    ]);
    expect(outOfRange).toEqual([
      { x: 14, y: 6 },
      { x: 15, y: 6 },
    ]);
  });

  it("drops occupied, wrong-terrain and out-of-bounds tiles", () => {
    const tiles = [
      { x: 9, y: 6 }, // farm footprint
      { x: 6, y: 3 }, // house
      { x: 7, y: 8 }, // field
      { x: 9, y: 4 }, // road
      { x: 2, y: 6 }, // forest
      { x: -1, y: 6 },
      { x: 20, y: 6 },
      { x: 7, y: 9 }, // valid
    ];
    expect(classifyFieldTiles(pasture, tiles, data())).toEqual({ valid: [{ x: 7, y: 9 }], outOfRange: [] });
  });

  it("shows nothing for a field whose fertility the island lacks, and needs a farm accepting the type", () => {
    const tiles = rectTiles({ x: 6, y: 6 }, { x: 7, y: 7 });
    expect(classifyFieldTiles(wheatField, tiles, data())).toEqual({ valid: [], outOfRange: [] });
    // Wheat fertility, but no wheat farm: free grass is yellow.
    const r = classifyFieldTiles(wheatField, tiles, data(["wheat"]));
    expect(r.valid).toEqual([]);
    expect(r.outOfRange).toHaveLength(4);
  });
});

describe("field rectangle commands", () => {
  it("sends at most 256 tiles and says so", () => {
    const valid = rectTiles({ x: 0, y: 0 }, { x: 29, y: 9 });
    const { tiles, capped } = fieldTilesToSend(valid);
    expect(tiles).toHaveLength(MAX_FIELD_TILES);
    expect(tiles[0]).toEqual({ x: 0, y: 0 });
    expect(capped).toBe(true);
    expect(fieldTilesToSend(valid.slice(0, 10)).capped).toBe(false);
    expect(fieldRectHint(300, 2, "Pasture")).toBe("256 pastures · at most 256 per drag — 44 not placed · 2 outside every farm's ring");
    expect(fieldRectHint(1, 0, "Wheat field")).toBe("1 wheat field");
    expect(fieldRectHint(0, 3, "Pasture")).toBe("No valid pasture tile · 3 outside every farm's ring");
  });
});

describe("buildMenuOrder", () => {
  it("lists each field right after the farm that accepts it", () => {
    const order = buildMenuOrder([
      pasture,
      def("lumberjack", 2, 2),
      sheepFarm,
      def("weaver", 2, 2),
      def("dairy", 3, 3, { fields: { type: "pasture", required: 16 } }),
      def("orphan_field", 1, 1, { field: { type: "orphan", terrain: ["grass"] } }),
    ]).map((b) => b.id);
    expect(order).toEqual(["lumberjack", "sheep_farm", "pasture", "weaver", "dairy", "orphan_field"]);
  });

  it("keeps the shipped content's fields next to their farms", () => {
    const ids = shipped.map((b) => ({ ...def(b.id, b.footprint[0], b.footprint[1]), fields: b.fields, field: b.field }) as ContentBuilding);
    const order = buildMenuOrder(ids).map((b) => b.id);
    for (const [farm, field] of [
      ["sheep_farm", "pasture"],
      ["wheat_farm", "wheat_field"],
      ["orchard", "orchard_plot"],
      ["hemp_farm", "hemp_field"],
    ]) {
      expect(order.indexOf(field as string)).toBe(order.indexOf(farm as string) + 1);
    }
  });
});
