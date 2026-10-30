import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, DisplayState } from "../api/client";
import { fieldsPlural, statusText } from "./status";

const content = {
  region: { id: "r", name: "R", version: "v", rules: {} },
  tiers: [{ id: "settlers", name: "Settlers" }],
  goods: [
    { id: "wood", name: "Wood", type: "raw" },
    { id: "planks", name: "Planks", type: "construction" },
    { id: "fish", name: "Fish", type: "food" },
  ],
  buildings: [],
  needs: [],
} as unknown as Content;

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const bases = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => (JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as { base: DisplayState }).base);

describe("statusText", () => {
  it("renders a sentence for every building status in the fixtures", () => {
    const seen = new Set<string>();
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          const s = statusText(b, is, d, content);
          seen.add(s.key);
          expect(s.sentence).not.toMatch(/undefined|NaN/);
          if (s.key !== "ok") expect(s.fix).not.toBe("");
        }
      }
    }
    for (const key of ["ok", "paused_unpaid", "warehouse_full", "input_starved", "throttled", "low_efficiency", "not_connected"]) {
      expect(seen).toContain(key);
    }
  });

  it("suggests a road next to an unconnected building", () => {
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          if (b.status !== "not_connected") continue;
          const s = statusText(b, is, d, content);
          expect(s.sentence).toBe("No road to the Trading Post or a Warehouse");
          expect(s.fix).toBe("Build a road next to it that leads to the Trading Post or a Warehouse.");
          return;
        }
      }
    }
    throw new Error("no not_connected building in the fixtures");
  });

  it("names the starved inputs with their island rate", () => {
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          if (b.status !== "input_starved") continue;
          const s = statusText(b, is, d, content);
          expect(s.sentence).toMatch(/^Missing: .+ \(-?\d+\.\d\/min\)/);
          return;
        }
      }
    }
    throw new Error("no input_starved building in the fixtures");
  });
});

describe("field statuses (D-049)", () => {
  const fieldContent = {
    ...content,
    buildings: [
      { id: "sheep_farm", name: "Sheep farm", fields: { type: "pasture", required: 4, max: 4 } },
      { id: "pasture", name: "Pasture", field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } },
      { id: "lumberjack", name: "Lumberjack" },
    ],
  } as unknown as Content;
  const first = <T>(xs: T[]): T => {
    const x = xs[0];
    if (x === undefined) throw new Error("no fixture");
    return x;
  };
  const d = first(bases);
  const is = first(d.islands);
  const building = (b: Partial<BuildingDisplay>) =>
    ({ id: 99, x: 0, y: 0, rotation: 0, paused: false, paused_reason: "", throughput_factor_permille: 1000, ...b }) as BuildingDisplay;

  it("counts the fields of a farm below full efficiency", () => {
    const s = statusText(
      building({ type: "sheep_farm", status: "low_efficiency", efficiency_permille: 750, fields: { active: 3, required: 4, max: 4, ids: [1, 2, 3] } }),
      is,
      d,
      fieldContent,
    );
    expect(s).toEqual({ key: "low_efficiency", sentence: "3 / 4 fields", fix: "Add more pastures next to the farm or its fields." });
  });

  it("keeps the work-area sentence of the lumberjack", () => {
    const s = statusText(building({ type: "lumberjack", status: "low_efficiency", efficiency_permille: 500 }), is, d, fieldContent);
    expect(s.sentence).toBe("Only 50 % usable land in range");
  });

  it("explains an inactive field", () => {
    const s = statusText(building({ type: "pasture", status: "not_adjacent", efficiency_permille: 1000, active: false }), is, d, fieldContent);
    expect(s).toEqual({ key: "not_adjacent", sentence: "Not connected to its farm", fix: "Add or rebuild the fields between it and the farm." });
  });

  it("names the field type of a farm in the plural", () => {
    expect(fieldsPlural(fieldContent, "sheep_farm")).toBe("pastures");
    expect(fieldsPlural(fieldContent, "lumberjack")).toBe("fields");
  });
});
