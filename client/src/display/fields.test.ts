import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, ContentBuilding, DisplayState } from "../api/client";
import { farmChain, fieldBuildingOf, fieldHintText, fieldPlacementHint, rectsTouch } from "./fields";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureDir = join(root, "server", "testdata", "display");
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f, base: (JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as { base: DisplayState }).base }));

type BuildingJson = {
  id: string;
  footprint: [number, number];
  fields?: { type: string; required: number; max: number };
  field?: { type: string; farm: string };
};
const buildingsOf = (dir: string) => JSON.parse(readFileSync(join(root, dir, "buildings.json"), "utf8")) as BuildingJson[];
/** The shipped content file (footprints and the farm of each field). */
const shipped = buildingsOf(join("content", "old_coast"));
/** The content a display fixture was built with: its scenario's "content" (default the shipped one). */
const fixtureBuildings = (fixture: string) => {
  const sc = JSON.parse(readFileSync(join(root, "server", "testdata", "scenarios", fixture), "utf8")) as { content?: string };
  return buildingsOf(sc.content ?? join("content", "old_coast"));
};

const def = (id: string, w: number, h: number, extra: Partial<ContentBuilding> = {}) =>
  ({ id, name: id, width: w, height: h, category: "production", ...extra }) as ContentBuilding;

const pasture = def("pasture", 2, 2, { name: "Pasture", field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } });
const wheatField = def("wheat_field", 1, 1, { name: "Wheat field", field: { type: "wheat_field", farm: "wheat_farm", terrain: ["grass"], fertility: "wheat" } });
const sheepFarm = def("sheep_farm", 3, 3, { fields: { type: "pasture", required: 4, max: 4 } });
const wheatFarm = def("wheat_farm", 3, 3, { fields: { type: "wheat_field", required: 16, max: 16 } });
const defs = new Map([pasture, wheatField, sheepFarm, wheatFarm, def("house", 2, 2)].map((d) => [d.id, d]));

const building = (id: number, type: string, x: number, y: number, extra: Partial<BuildingDisplay> = {}) =>
  ({ id, type, x, y, rotation: 0, status: "ok", ...extra }) as BuildingDisplay;

/** A 24 × 14 grass island with a forest tile at (2,6). */
function island(fertilities: string[] = []) {
  const width = 24;
  const height = 14;
  const terrain = Array.from({ length: width * height }, (_, i) => (i === 6 * width + 2 ? "forest" : "grass")) as ("grass" | "forest")[];
  return { width, height, terrain, fertilities };
}

/** The farm at (8,5) (x 8..10, y 5..7) with the given fields. */
function world(fields: { id: number; x: number; y: number; active?: boolean; type?: string; farm?: number }[] = []) {
  const farm = building(1, "sheep_farm", 8, 5, { fields: { active: fields.filter((f) => f.active !== false).length, required: 4, max: 4, ids: fields.map((f) => f.id) } });
  const fs = fields.map((f) => building(f.id, f.type ?? "pasture", f.x, f.y, { farm_id: f.farm ?? 1, active: f.active ?? true }));
  const buildings = [farm, building(50, "house", 14, 10), ...fs];
  return { farm, buildings, data: { island: island(), buildings, roads: [{ x: 9, y: 4 }], defs } };
}

describe("rectsTouch", () => {
  it("is the server's 4-edge adjacency: a shared edge segment counts, a corner or a gap does not", () => {
    const a = { x: 8, y: 5, w: 3, h: 3 };
    expect(rectsTouch(a, { x: 11, y: 5, w: 2, h: 2 })).toBe(true); // east edge
    expect(rectsTouch(a, { x: 11, y: 7, w: 2, h: 2 })).toBe(true); // east edge, one row of overlap
    expect(rectsTouch(a, { x: 8, y: 8, w: 1, h: 1 })).toBe(true); // south edge
    expect(rectsTouch(a, { x: 11, y: 8, w: 2, h: 2 })).toBe(false); // corner only (south-east)
    expect(rectsTouch(a, { x: 6, y: 3, w: 2, h: 2 })).toBe(false); // corner only (north-west)
    expect(rectsTouch(a, { x: 11, y: 4, w: 1, h: 1 })).toBe(false); // corner only, 1x1
    expect(rectsTouch(a, { x: 12, y: 5, w: 2, h: 2 })).toBe(false); // gap at x = 11
    expect(rectsTouch(a, { x: 11, y: 9, w: 2, h: 2 })).toBe(false); // gap at y = 8
  });
});

describe("fieldPlacementHint", () => {
  it("accepts a ghost that shares an edge with the farm and rejects one that touches only a corner or nothing", () => {
    const { farm, data } = world();
    expect(fieldPlacementHint(farm, pasture, 11, 5, 0, data)).toBeNull();
    expect(fieldPlacementHint(farm, pasture, 11, 7, 0, data)).toBeNull();
    expect(fieldPlacementHint(farm, pasture, 11, 8, 0, data)).toBe("not_adjacent"); // corner (10,7)-(11,8) only
    expect(fieldPlacementHint(farm, pasture, 12, 5, 0, data)).toBe("not_adjacent");
    expect(fieldPlacementHint(farm, pasture, 16, 9, 0, data)).toBe("not_adjacent");
  });

  it("treats a field that meets its farm only at a corner as inactive (never as carrying the chain)", () => {
    // The server marks such a field inactive (e.g. after the farm moved): the hint does not chain over it.
    const diagonal = world([{ id: 2, x: 11, y: 8, active: false }]);
    expect(fieldPlacementHint(diagonal.farm, pasture, 13, 8, 0, diagonal.data)).toBe("not_adjacent");
    // An active field touched only at its corner does not carry the chain either.
    const active = world([{ id: 2, x: 11, y: 5 }]);
    expect(fieldPlacementHint(active.farm, pasture, 13, 7, 0, active.data)).toBe("not_adjacent"); // corner (12,6)-(13,7)
    expect(fieldPlacementHint(active.farm, pasture, 13, 6, 0, active.data)).toBeNull(); // edge of the field
    // The shared server fixtures: every active field shares an edge with its farm or an active field.
    for (const { name, base } of fixtures) {
      const defs = fixtureBuildings(name);
      for (const is of base.islands) {
        const size = (b: BuildingDisplay) => {
          const d = defs.find((x) => x.id === b.type)!;
          const [w, h] = b.rotation === 90 || b.rotation === 270 ? [d.footprint[1], d.footprint[0]] : d.footprint;
          return { x: b.x, y: b.y, w, h };
        };
        for (const f of is.buildings.filter((b) => b.farm_id !== undefined)) {
          const farm = is.buildings.find((b) => b.id === f.farm_id)!;
          const edgeToFarm = rectsTouch(size(farm), size(f));
          const edgeToField = is.buildings.some((o) => o.farm_id === farm.id && o.id !== f.id && o.active && rectsTouch(size(o), size(f)));
          expect(f.active === (edgeToFarm || edgeToField) || f.active === true, `${name}: field ${f.id}`).toBe(true);
          if (f.active) expect(edgeToFarm || edgeToField, `${name}: active field ${f.id} shares no edge`).toBe(true);
        }
      }
    }
  });

  it("chains over active fields only", () => {
    const active = world([{ id: 2, x: 11, y: 5 }]);
    expect(fieldPlacementHint(active.farm, pasture, 13, 5, 0, active.data)).toBeNull();
    const broken = world([{ id: 2, x: 11, y: 5, active: false }]);
    expect(fieldPlacementHint(broken.farm, pasture, 13, 5, 0, broken.data)).toBe("not_adjacent");
    // A field of another farm never carries the chain.
    const foreign = world([{ id: 2, x: 11, y: 5, farm: 9 }]);
    expect(fieldPlacementHint(foreign.farm, pasture, 13, 5, 0, foreign.data)).toBe("not_adjacent");
  });

  it("reports the server's rules in the server's order", () => {
    const { farm, data } = world();
    expect(fieldPlacementHint(farm, pasture, 23, 5, 0, data)).toBe("bounds");
    expect(fieldPlacementHint(farm, pasture, -1, 5, 0, data)).toBe("bounds");
    expect(fieldPlacementHint(farm, pasture, 6, 5, 0, { ...data, island: { ...data.island, terrain: data.island.terrain.map(() => "forest") } })).toBe("terrain");
    expect(fieldPlacementHint(farm, pasture, 0, 5, 0, data)).toBe("not_adjacent");
    expect(fieldPlacementHint(farm, pasture, 1, 5, 0, data)).toBe("terrain"); // (2,6) is forest
    expect(fieldPlacementHint(farm, pasture, 9, 3, 0, data)).toBe("occupied"); // road at (9,4)
    expect(fieldPlacementHint(farm, pasture, 9, 6, 0, data)).toBe("occupied"); // the farm
    // Fertility is checked before adjacency.
    const wheat = { ...farm, type: "wheat_farm" } as BuildingDisplay;
    expect(fieldPlacementHint(wheat, wheatField, 11, 5, 0, data)).toBe("fertility");
    expect(fieldPlacementHint(wheat, wheatField, 11, 5, 0, { ...data, island: island(["wheat"]) })).toBeNull();
  });

  it("stops at the maximum", () => {
    const ids = Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, x: 11 + 2 * (i % 4), y: i < 4 ? 5 : 7 }));
    const full = world(ids);
    expect(fieldPlacementHint(full.farm, pasture, 8, 8, 0, full.data)).toBe("max_reached");
  });

  it("has a sentence for every hint", () => {
    for (const h of ["bounds", "terrain", "occupied", "fertility", "not_adjacent", "max_reached"] as const) {
      expect(fieldHintText(h, "Pasture", "Sheep farm")).toMatch(/\S/);
    }
    expect(fieldHintText("not_adjacent", "Pasture", "Sheep farm")).toBe("A pasture must touch sheep farm or one of its active pastures");
  });
});

describe("farmChain", () => {
  it("is the farm and its fields from the farm or from one of its fields", () => {
    const w = world([
      { id: 2, x: 11, y: 5 },
      { id: 3, x: 13, y: 5, active: false },
      { id: 4, x: 16, y: 5, farm: 9 },
    ]);
    for (const selected of [w.farm, w.buildings.find((b) => b.id === 3)!]) {
      const c = farmChain(selected, w.buildings);
      expect(c.farm?.id).toBe(1);
      expect(c.fields.map((f) => f.id)).toEqual([2, 3]);
    }
    expect(farmChain(w.buildings.find((b) => b.id === 50)!, w.buildings)).toEqual({ farm: undefined, fields: [] });
  });
});

describe("fieldBuildingOf", () => {
  it("finds the one field building of each shipped farm", () => {
    const content = { buildings: shipped.map((b) => ({ ...def(b.id, b.footprint[0], b.footprint[1]), fields: b.fields, field: b.field })) } as unknown as Content;
    for (const [farm, field, size] of [
      ["sheep_farm", "pasture", 3],
      ["wheat_farm", "wheat_field", 1],
      ["orchard", "orchard_plot", 1],
      ["hemp_farm", "hemp_field", 1],
    ] as const) {
      const f = fieldBuildingOf(content, farm);
      expect(f?.id).toBe(field);
      expect(f?.width).toBe(size);
    }
    expect(fieldBuildingOf(content, "lumberjack")).toBeUndefined();
  });
});

describe("the shared display fixtures", () => {
  it("show every field with its farm, an active flag and the farm's field list", () => {
    let checked = 0;
    for (const { name, base } of fixtures) {
      const defs = fixtureBuildings(name);
      for (const is of base.islands) {
        for (const f of is.buildings) {
          if (f.farm_id === undefined) continue;
          const farm = is.buildings.find((b) => b.id === f.farm_id);
          const fd = defs.find((d) => d.id === farm?.type);
          expect(farm && fd?.fields, `${name}: farm ${f.farm_id}`).toBeTruthy();
          expect(farm?.fields?.ids, `${name}: farm ${f.farm_id} lists field ${f.id}`).toContain(f.id);
          expect(typeof f.active, `${name}: field ${f.id}`).toBe("boolean");
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("agree with the client's chain hint: every active field touches its farm or an active field of it", () => {
    for (const { name, base } of fixtures) {
      const defs = fixtureBuildings(name);
      for (const is of base.islands) {
        const size = (b: BuildingDisplay) => {
          const d = defs.find((x) => x.id === b.type)!;
          const [w, h] = b.rotation === 90 || b.rotation === 270 ? [d.footprint[1], d.footprint[0]] : d.footprint;
          return { x: b.x, y: b.y, w, h };
        };
        for (const f of is.buildings.filter((b) => b.farm_id !== undefined && b.active)) {
          const farm = is.buildings.find((b) => b.id === f.farm_id)!;
          const near = [farm, ...is.buildings.filter((b) => b.farm_id === farm.id && b.active && b.id !== f.id)];
          expect(
            near.some((o) => rectsTouch(size(o), size(f))),
            `${name}: active field ${f.id} touches nothing of farm ${farm.id}`,
          ).toBe(true);
        }
      }
    }
  });
});
