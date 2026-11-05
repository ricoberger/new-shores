import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, IslandDisplay, PlanDisplay } from "../api/client";
import { fieldPlacementHint } from "./fields";
import { hintFarm, hintSite, moveTarget, planAsBuilding, roadsUnder, planAt, planCostParts, planCount, planFarmOf, plannedFarmAsBuilding, plannedRoadAt, planningRoadDrag, plannedRoadTiles, plansUnder, selectedPlanMarks } from "./plans";
import { planRoadDrag } from "./roaddrag";

const def = (id: string, w: number, h: number, extra: Partial<ContentBuilding> = {}) => ({ id, name: id, width: w, height: h, category: "production", ...extra }) as ContentBuilding;
const wheatField = def("wheat_field", 1, 1, { field: { type: "wheat_field", farm: "wheat_farm", terrain: ["grass"] } } as Partial<ContentBuilding>);
const wheatFarm = def("wheat_farm", 3, 3, { fields: { type: "wheat_field", required: 4, max: 4 } } as Partial<ContentBuilding>);
const defs = new Map([wheatField, wheatFarm, def("house", 2, 2), def("road_dirt", 1, 1, { tier: "settlers", road: {} } as Partial<ContentBuilding>)].map((d) => [d.id, d]));

const plan = (id: number, type: string, x: number, y: number, farm_id?: number): PlanDisplay => ({ id, type, x, y, rotation: 0, planned: true, ...(farm_id !== undefined ? { farm_id } : {}) });
const farm = { id: 1, type: "wheat_farm", x: 4, y: 4, rotation: 0, status: "ok", fields: { active: 1, required: 4, max: 4, ids: [2] } } as BuildingDisplay;
const field = { id: 2, type: "wheat_field", x: 7, y: 4, rotation: 0, status: "ok", farm_id: 1, active: true } as BuildingDisplay;

/** A wheat farm at (4,4) with one field at (7,4), a planned field at (8,4), a planned house at (1,1) and a planned road (4..6, 8). */
const island = {
  buildings: [farm, field],
  roads: [{ x: 3, y: 4, type: "road_dirt" }],
  plans: [plan(10, "house", 1, 1), plan(11, "wheat_field", 8, 4, 1)],
  planned_roads: [{ type: "road_dirt", planned: true, tiles: [{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }], plan_cost: { gold: 0, materials: {} } }],
} as unknown as IslandDisplay;
const statics = { width: 16, height: 12, terrain: Array.from({ length: 16 * 12 }, () => "grass" as const), fertilities: [] };

describe("plans as hint data (D-071)", () => {
  it("counts plans and planned road tiles", () => {
    expect(planCount(island)).toBe(5);
    expect(plannedRoadTiles(island)).toEqual([{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }]);
    expect(planCount({} as IslandDisplay)).toBe(0);
  });

  it("reserves plan footprints and planned road tiles for the field hint", () => {
    const site = hintSite(island, false);
    const data = { island: statics, ...site, defs };
    // On the planned house, on the planned road, on the planned field.
    expect(fieldPlacementHint(farm, wheatField, 2, 2, 0, data)).toBe("occupied");
    expect(fieldPlacementHint(farm, wheatField, 5, 8, 0, data)).toBe("occupied");
    expect(fieldPlacementHint(farm, wheatField, 8, 4, 0, data)).toBe("occupied");
    // Outside planning mode a planned field does not chain its farm: (9,4) only touches the planned field.
    expect(fieldPlacementHint(farm, wheatField, 9, 4, 0, data)).toBe("not_adjacent");
  });

  it("chains planned fields and counts them toward the maximum in planning mode", () => {
    const data = { island: statics, ...hintSite(island, true), defs };
    expect(fieldPlacementHint(hintFarm(farm, island, true), wheatField, 9, 4, 0, data)).toBeNull();
    expect(hintFarm(farm, island, true).fields?.ids).toEqual([2, 11]);
    expect(hintFarm(farm, island, false)).toBe(farm);
    // Two more reach the maximum of four.
    const full = { ...island, plans: [...(island.plans ?? []), plan(12, "wheat_field", 9, 4, 1), plan(13, "wheat_field", 10, 4, 1)] };
    expect(fieldPlacementHint(hintFarm(farm, full, true), wheatField, 11, 4, 0, { island: statics, ...hintSite(full, true), defs })).toBe("max_reached");
  });

  it("turns a plan into a footprint building with its farm link", () => {
    expect(planAsBuilding(plan(11, "wheat_field", 8, 4, 1), true)).toMatchObject({ id: 11, type: "wheat_field", x: 8, y: 4, farm_id: 1, active: true });
    expect(planAsBuilding(plan(10, "house", 1, 1), true)).not.toHaveProperty("farm_id");
  });
});

describe("road drag with plans (D-071)", () => {
  const data = { island: statics, buildings: hintSite(island, false).buildings, roads: island.roads, defs, tiers: [{ id: "settlers", index: 0 }] };

  it("rejects a tile under a planned building in both modes", () => {
    const tiles = planRoadDrag({ x: 0, y: 2 }, { x: 3, y: 2 }, "road_dirt", data);
    expect(tiles.map((t) => t.hint)).toEqual(["ok", "bad", "bad", "ok"]);
  });

  it("lays a real road over a planned road, a planned road on free tiles only", () => {
    const tiles = planRoadDrag({ x: 3, y: 8 }, { x: 7, y: 8 }, "road_dirt", data);
    expect(tiles.map((t) => t.hint)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(planningRoadDrag(tiles, island).map((t) => t.hint)).toEqual(["ok", "skip", "skip", "skip", "ok"]);
    // A real road is skipped too: a planned road never replaces a road.
    const across = planningRoadDrag(planRoadDrag({ x: 2, y: 4 }, { x: 3, y: 4 }, "road_dirt", data), island);
    expect(across.map((t) => t.hint)).toEqual(["ok", "skip"]);
  });
});

describe("plan lookups for cards and tools (D-071 §4)", () => {
  it("finds the plan or planned road segment under a tile", () => {
    expect(planAt(island, defs, 2, 2)?.id).toBe(10);
    expect(planAt(island, defs, 8, 4)?.id).toBe(11);
    expect(planAt(island, defs, 7, 4)).toBeUndefined();
    expect(plannedRoadAt(island, 5, 8)?.tiles).toHaveLength(3);
    expect(plannedRoadAt(island, 3, 4)).toBeUndefined();
  });

  it("lists the planned buildings (not fields) under a rectangle once each", () => {
    const tiles = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 8, y: 4 }];
    expect(plansUnder(tiles, island, defs).map((p) => p.id)).toEqual([10]);
  });

  it("finds a planned field's farm: a building or a planned farm", () => {
    expect(planFarmOf(island, plan(11, "wheat_field", 8, 4, 1)).building?.id).toBe(1);
    const farmPlan = plan(20, "wheat_farm", 10, 0);
    const withFarm = { ...island, plans: [farmPlan, plan(21, "wheat_field", 13, 0, 20)] };
    expect(planFarmOf(withFarm, plan(21, "wheat_field", 13, 0, 20)).plan?.id).toBe(20);
    expect(planFarmOf(island, plan(10, "house", 1, 1))).toEqual({});
  });

  it("makes a planned farm the field tool's farm with its planned fields, not counted twice in planning mode", () => {
    const farmPlan = plan(20, "wheat_farm", 10, 0);
    const withFarm = { ...island, plans: [farmPlan, plan(21, "wheat_field", 13, 0, 20)] };
    const farmB = plannedFarmAsBuilding(farmPlan, withFarm, wheatFarm)!;
    expect(farmB.fields).toEqual({ active: 0, required: 4, max: 4, ids: [21] });
    expect(hintFarm(farmB, withFarm, true).fields?.ids).toEqual([21]);
    expect(plannedFarmAsBuilding(plan(10, "house", 1, 1), withFarm, defs.get("house"))).toBeUndefined();
  });

  it("marks the parts of a plan's cost the island cannot cover now", () => {
    const parts = planCostParts({ gold: 5000, materials: { stone: 3000, planks: 2000 } }, 4000, (g) => (g === "planks" ? 2000 : 0));
    expect(parts.gold).toEqual({ amount: 5000, short: true });
    expect(parts.materials).toEqual([
      { good: "planks", amount: 2000, short: false },
      { good: "stone", amount: 3000, short: true },
    ]);
  });
});

describe("the Move tool's pick", () => {
  it("picks the building or plan under a tile, and for a field its farm", () => {
    expect(moveTarget(island, defs, 5, 5)).toEqual({ id: 1, type: "wheat_farm", x: 4, y: 4, rotation: 0, planned: false });
    // The field at (7,4) and the planned field at (8,4) both mean the farm.
    expect(moveTarget(island, defs, 7, 4)?.id).toBe(1);
    expect(moveTarget(island, defs, 8, 4)?.id).toBe(1);
    expect(moveTarget(island, defs, 2, 2)).toMatchObject({ id: 10, planned: true });
    expect(moveTarget(island, defs, 3, 4)).toBeUndefined();
    // A planned field of a planned farm picks the planned farm.
    const withFarm = { ...island, plans: [plan(20, "wheat_farm", 10, 0), plan(21, "wheat_field", 13, 0, 20)] };
    expect(moveTarget(withFarm, defs, 13, 0)).toMatchObject({ id: 20, type: "wheat_farm", planned: true });
  });
});

describe("the Demolish tool's rectangle over roads", () => {
  it("takes the road and planned road tiles under it, in the rectangle's order", () => {
    const rect = [];
    for (let y = 4; y <= 8; y++) for (let x = 3; x <= 5; x++) rect.push({ x, y });
    expect(roadsUnder(rect, island)).toEqual([{ x: 3, y: 4 }, { x: 4, y: 8 }, { x: 5, y: 8 }]);
    expect(roadsUnder([{ x: 0, y: 0 }], island)).toEqual([]);
  });
});

describe("selectedPlanMarks", () => {
  it("marks every tile of a selected planned road segment and nothing for a selected planned building (no pale plate under its model)", () => {
    expect(selectedPlanMarks(undefined)).toEqual([]);
    const marks = selectedPlanMarks({ type: "road_dirt", tiles: [{ x: 1, y: 2 }, { x: 2, y: 2 }] } as never);
    expect(marks.map((m) => [m.x, m.y])).toEqual([[1, 2], [2, 2]]);
  });
});
