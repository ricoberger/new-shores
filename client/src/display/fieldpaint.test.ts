import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { fieldPlacementHint } from "./fields";
import { fieldsUnder, MAX_PAINT_TILES, paintAnchors, paintCountText, paintTiles, planPaint } from "./fieldpaint";

const def = (id: string, w: number, h: number, extra: Partial<ContentBuilding> = {}) =>
  ({ id, name: id, width: w, height: h, category: "production", ...extra }) as ContentBuilding;

const pasture = def("pasture", 3, 3, { name: "Pasture", field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } });
const wheatField = def("wheat_field", 1, 1, { name: "Wheat field", field: { type: "wheat_field", farm: "wheat_farm", terrain: ["grass"] } });
const wheatFarm = def("wheat_farm", 3, 4, { fields: { type: "wheat_field", required: 12, max: 12 } });
const sheepFarm = def("sheep_farm", 3, 3, { fields: { type: "pasture", required: 3, max: 3 } });
const defs = new Map([pasture, wheatField, wheatFarm, sheepFarm, def("house", 3, 3)].map((d) => [d.id, d]));

const building = (id: number, type: string, x: number, y: number, extra: Partial<BuildingDisplay> = {}) =>
  ({ id, type, x, y, rotation: 0, status: "ok", ...extra }) as BuildingDisplay;

/** A 40 × 20 grass island with forest at (20,6). */
function island() {
  const width = 40;
  const height = 20;
  const terrain = Array.from({ length: width * height }, (_, i) => (i === 6 * width + 20 ? "forest" : "grass")) as ("grass" | "forest")[];
  return { width, height, terrain, fertilities: [] as string[] };
}

/** A farm of `type` at (8,5) with fields (all its own, active unless said). */
function world(type: "wheat_farm" | "sheep_farm", fields: { id: number; x: number; y: number; active?: boolean; farm?: number }[] = [], max?: number) {
  const fd = defs.get(type)!.fields!;
  const fieldType = type === "wheat_farm" ? "wheat_field" : "pasture";
  const own = fields.filter((f) => (f.farm ?? 1) === 1);
  const farm = building(1, type, 8, 5, { fields: { active: own.filter((f) => f.active !== false).length, required: fd.required, max: max ?? fd.max, ids: own.map((f) => f.id) } });
  const fs = fields.map((f) => building(f.id, fieldType, f.x, f.y, { farm_id: f.farm ?? 1, active: f.active ?? true }));
  const buildings = [farm, building(50, "house", 30, 12), ...fs];
  return { farm, buildings, data: { island: island(), buildings, roads: [{ x: 9, y: 4 }], defs } };
}

describe("paintAnchors", () => {
  it("covers the dragged rectangle tile by tile for one-tile fields, in rows from the start", () => {
    expect(paintAnchors({ start: { x: 5, y: 5 }, end: { x: 7, y: 6 } }, 1, 1).anchors).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 7, y: 6 },
    ]);
    // Dragged up and left: the same tiles, from the start.
    const back = paintAnchors({ start: { x: 7, y: 6 }, end: { x: 5, y: 5 } }, 1, 1).anchors;
    expect(back[0]).toEqual({ x: 7, y: 6 });
    expect(back).toHaveLength(6);
    expect(paintAnchors({ start: { x: 3, y: 3 }, end: { x: 3, y: 3 } }, 1, 1)).toEqual({ anchors: [{ x: 3, y: 3 }], clipped: false });
  });

  it("puts pasture modules on a grid aligned on the start tile: every module the pointer reaches", () => {
    const grid = (ex: number, ey: number) => paintAnchors({ start: { x: 11, y: 5 }, end: { x: ex, y: ey } }, 3, 3).anchors;
    expect(grid(13, 7)).toEqual([{ x: 11, y: 5 }]);
    expect(grid(14, 7)).toEqual([
      { x: 11, y: 5 },
      { x: 14, y: 5 },
    ]);
    expect(grid(10, 5)).toEqual([
      { x: 11, y: 5 },
      { x: 8, y: 5 },
    ]);
    expect(grid(17, 8)).toHaveLength(6);
    // A rotated module (3 × 4 turned: 4 × 3).
    expect(paintAnchors({ start: { x: 0, y: 0 }, end: { x: 4, y: 3 } }, 4, 3).anchors).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
    ]);
  });

  it(`clips a rectangle above ${MAX_PAINT_TILES} tiles at its start corner`, () => {
    const { anchors, clipped } = paintAnchors({ start: { x: 10, y: 10 }, end: { x: 109, y: 59 } }, 1, 1);
    expect(clipped).toBe(true);
    expect(anchors.length).toBeLessThanOrEqual(MAX_PAINT_TILES);
    expect(anchors.length).toBeGreaterThan(MAX_PAINT_TILES * 0.9);
    expect(anchors[0]).toEqual({ x: 10, y: 10 });
    // The aspect stays (100 × 50 → about 32 × 16).
    const xs = new Set(anchors.map((a) => a.x)).size;
    const ys = new Set(anchors.map((a) => a.y)).size;
    expect(xs).toBeGreaterThan(ys);
    // A thin line keeps its length up to the limit.
    const line = paintAnchors({ start: { x: 0, y: 0 }, end: { x: 999, y: 0 } }, 1, 1);
    expect(line.anchors).toHaveLength(MAX_PAINT_TILES);
    expect(paintAnchors({ start: { x: 0, y: 0 }, end: { x: 15, y: 31 } }, 1, 1).clipped).toBe(false);
    expect(paintTiles({ start: { x: 0, y: 0 }, end: { x: 15, y: 31 } }).tiles).toHaveLength(512);
  });
});

describe("planPaint", () => {
  const row = (x0: number, x1: number, y: number) => paintAnchors({ start: { x: x0, y }, end: { x: x1, y } }, 1, 1).anchors;

  it("counts the rectangle's own valid tiles as active: a strip away from the farm chains back to it", () => {
    const { farm, data } = world("wheat_farm");
    // Dragged from the far end: only (11,5) touches the farm (x 8..10); the passes carry the chain.
    const plan = planPaint(farm, wheatField, row(15, 11, 5), 0, data);
    expect(plan.tiles.map((t) => t.hint)).toEqual([null, null, null, null, null]);
    expect(plan.adding).toBe(5);
    expect(paintCountText(plan)).toBe("5 / 12 · +5");
  });

  it("marks tiles beyond the maximum (max) and leaves the ones the passes reach first", () => {
    const { farm, data } = world("wheat_farm", [], 3);
    const plan = planPaint(farm, wheatField, row(11, 15, 5), 0, data);
    expect(plan.tiles.map((t) => t.hint)).toEqual([null, null, null, "max_reached", "max_reached"]);
    expect(plan).toMatchObject({ placed: 0, adding: 3, max: 3, overMax: 2 });
    expect(paintCountText(plan)).toBe("3 / 3 · +3 · 2 over the max");
  });

  it("keeps the one-field rules: terrain, occupied, bounds and a gap", () => {
    const { farm, data } = world("wheat_farm");
    // (9,4) is a road, (20,6) forest; (8..10,4) above the farm otherwise touches it.
    const plan = planPaint(farm, wheatField, [{ x: 8, y: 4 }, { x: 9, y: 4 }, { x: 9, y: 6 }, { x: 20, y: 6 }, { x: 25, y: 6 }, { x: 40, y: 6 }], 0, data);
    expect(plan.tiles.map((t) => t.hint)).toEqual([null, "occupied", "occupied", "terrain", "not_adjacent", "bounds"]);
    // A corner does not chain: (11,4) meets the farm (x 8..10, y 5..8) at a corner only.
    expect(planPaint(farm, wheatField, [{ x: 11, y: 4 }], 0, data).tiles[0]!.hint).toBe("not_adjacent");
    // An inactive or foreign field never carries the chain.
    const broken = world("wheat_farm", [{ id: 2, x: 11, y: 5, active: false }, { id: 3, x: 11, y: 6, farm: 9 }]);
    expect(planPaint(broken.farm, wheatField, [{ x: 12, y: 5 }, { x: 12, y: 6 }], 0, broken.data).tiles.map((t) => t.hint)).toEqual(["not_adjacent", "not_adjacent"]);
  });

  it("paints pastures as modules and starts from the fields the farm has", () => {
    const { farm, data } = world("sheep_farm", [{ id: 2, x: 11, y: 5 }]);
    const anchors = paintAnchors({ start: { x: 14, y: 5 }, end: { x: 20, y: 5 } }, 3, 3).anchors;
    const plan = planPaint(farm, pasture, anchors, 0, data);
    expect(anchors).toEqual([
      { x: 14, y: 5 },
      { x: 17, y: 5 },
      { x: 20, y: 5 },
    ]);
    // The farm has 1 of 3: two more fit, the third module is over the max.
    expect(plan.tiles.map((t) => t.hint)).toEqual([null, null, "max_reached"]);
    expect(plan).toMatchObject({ w: 3, h: 3, placed: 1, adding: 2, max: 3 });
  });

  it("agrees with the one-field hint for a single anchor anywhere", () => {
    const { farm, data } = world("sheep_farm", [{ id: 2, x: 11, y: 5 }, { id: 3, x: 8, y: 8, active: false }]);
    for (let y = -1; y < 21; y++) {
      for (let x = -1; x < 41; x++) {
        expect(planPaint(farm, pasture, [{ x, y }], 0, data).tiles[0]!.hint, `${x},${y}`).toBe(fieldPlacementHint(farm, pasture, x, y, 0, data));
      }
    }
  });
});

describe("fieldsUnder", () => {
  it("groups the tiles on fields by farm; a pasture under several tiles counts once", () => {
    const { buildings } = world("sheep_farm", [{ id: 2, x: 11, y: 5 }, { id: 3, x: 14, y: 5 }, { id: 4, x: 20, y: 5, farm: 9 }]);
    const tiles = paintTiles({ start: { x: 12, y: 6 }, end: { x: 21, y: 6 } }).tiles;
    const all = fieldsUnder(tiles, buildings, defs, null);
    expect([...all.keys()].sort()).toEqual([1, 9]);
    expect(all.get(1)!.fields.map((f) => f.id)).toEqual([2, 3]);
    expect(all.get(1)!.tiles).toHaveLength(5); // x 12..16
    expect(all.get(9)!.tiles).toEqual([
      { x: 20, y: 6 },
      { x: 21, y: 6 },
    ]);
    // One farm only (the field tool's removal); the farm itself and other buildings are never included.
    const one = fieldsUnder(paintTiles({ start: { x: 8, y: 5 }, end: { x: 21, y: 6 } }).tiles, buildings, defs, 1);
    expect([...one.keys()]).toEqual([1]);
    expect(fieldsUnder([{ x: 30, y: 12 }], buildings, defs, null).size).toBe(0);
  });
});
