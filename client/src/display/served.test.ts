import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { rotatedFootprint } from "./geometry";
import { ghostRelated, servedRelated, wouldServe } from "./served";

const b = (id: number, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as unknown as BuildingDisplay;
const chapel = { service: { radius: 16 } } as unknown as ContentBuilding;
const producer = {} as unknown as ContentBuilding;

describe("servedRelated", () => {
  const houses = [b(1, { served_by: [10, 11] }), b(2, { served_by: [11] }), b(3, { residents: 2000 })];
  const all = [...houses, b(10), b(11), b(12)];

  it("lists the serving buildings of a house", () => {
    expect(servedRelated(houses[0]!, all, undefined)).toEqual([10, 11]);
    expect(servedRelated(houses[2]!, all, undefined)).toEqual([]);
  });
  it("lists the houses a service building serves", () => {
    expect(servedRelated(b(11), all, chapel)).toEqual([1, 2]);
    expect(servedRelated(b(10), all, chapel)).toEqual([1]);
    expect(servedRelated(b(12), all, chapel)).toEqual([]);
  });
  it("ignores other buildings", () => {
    expect(servedRelated(b(10), all, producer)).toEqual([]);
  });

  it("links a producer with the Warehouse or Trading Post it delivers to, in both directions", () => {
    const rates = { inputs: {}, outputs: {} };
    const fisher = b(20, { assigned_warehouse_id: 30, rates });
    const lumberjack = b(21, { assigned_warehouse_id: 30, rates });
    const other = b(22, { assigned_warehouse_id: 31, rates });
    const warehouse = b(30);
    const everything = [fisher, lumberjack, other, warehouse, b(31), ...all];
    expect(servedRelated(fisher, everything, producer)).toEqual([30]);
    expect(servedRelated(warehouse, everything, producer)).toEqual([20, 21]);
    expect(servedRelated(b(31), everything, producer)).toEqual([22]);
    expect(servedRelated(b(32), everything, producer)).toEqual([]);
    // 0 = not connected: nothing to show.
    expect(servedRelated(b(23, { assigned_warehouse_id: 0, rates }), everything, producer)).toEqual([]);
  });
});

const content = loadContent("content/old_coast");
const base = (JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/display/bootstrap_citizens.json"), "utf8")) as { base: DisplayState }).base;
const island = base.islands.find((is) => is.buildings.some((b) => b.type.startsWith("house_")))!;
const def = (id: string) => content.buildings.find((b) => b.id === id)!;
const radius = def("chapel").service!.levels[0]!.radius;
const house = island.buildings.find((b) => b.type.startsWith("house_"))!;
const [hw] = rotatedFootprint(def(house.type).width, def(house.type).height, house.rotation);
// A chapel whose nearest tile is `gap` tiles right of the house's right edge, in the house's rows.
const chapelAt = (gap: number) => ({ type: "chapel", island: island.id, x: house.x + hw - 1 + gap, y: house.y, rotation: 0 });

describe("wouldServe (ghost hint, D-027)", () => {
  it("includes a house exactly at the level-1 radius and leaves out one a tile further", () => {
    expect(wouldServe(chapelAt(radius), content, base)).toContain(house.id);
    expect(wouldServe(chapelAt(radius + 1), content, base)).not.toContain(house.id);
  });

  it("measures Euclidean distance between the nearest tiles, not a square", () => {
    // Diagonal offset: dx = dy = r → distance r√2 > r; dx = dy = floor(r/√2) → inside.
    const inside = Math.floor(radius / Math.SQRT2);
    const [, hh] = rotatedFootprint(def(house.type).width, def(house.type).height, house.rotation);
    const at = (d: number) => ({ type: "chapel", island: island.id, x: house.x + hw - 1 + d, y: house.y + hh - 1 + d, rotation: 0 });
    expect(wouldServe(at(inside), content, base)).toContain(house.id);
    expect(wouldServe(at(radius), content, base)).not.toContain(house.id);
  });

  it("lists only houses, and only the ones within range", () => {
    const ids = wouldServe(chapelAt(0), content, base);
    const byId = new Map(island.buildings.map((b) => [b.id, b]));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(byId.get(id)!.type.startsWith("house_")).toBe(true);
    expect(ids.length).toBeLessThanOrEqual(island.buildings.filter((b) => b.type.startsWith("house_")).length);
  });

  it("leaves out houses of another island, even at the same tiles", () => {
    const other = { ...island, id: "other-island", buildings: island.buildings.map((b) => ({ ...b, id: b.id + 100_000 })) };
    const state = { islands: [island, other] };
    const ids = wouldServe(chapelAt(0), content, state);
    expect(ids).toContain(house.id);
    expect(ids.every((id) => id < 100_000)).toBe(true);
    expect(wouldServe({ ...chapelAt(0), island: "other-island" }, content, state).every((id) => id >= 100_000)).toBe(true);
    expect(wouldServe({ ...chapelAt(0), island: "nowhere" }, content, state)).toEqual([]);
  });

  it("is empty for a building that serves nobody", () => {
    expect(wouldServe({ ...chapelAt(0), type: "warehouse" }, content, base)).toEqual([]);
    expect(wouldServe({ ...chapelAt(0), type: "house_settlers" }, content, base)).toEqual([]);
  });

  it("uses the radius of the given level", () => {
    const market = def("market");
    const r4 = market.service!.levels[3]!.radius;
    const r1 = market.service!.levels[0]!.radius;
    expect(r4).toBeGreaterThan(r1);
    const at = (gap: number, level?: number) => ({ type: "market", island: island.id, x: house.x + hw - 1 + gap, y: house.y, rotation: 0, ...(level ? { level } : {}) });
    expect(wouldServe(at(r4), content, base)).not.toContain(house.id);
    expect(wouldServe(at(r4, 4), content, base)).toContain(house.id);
  });
});

describe("ghostRelated (ghost hint, D-027)", () => {
  const isle = base.islands.find((is) => is.id === "isle-01")!;
  const idsOf = (...types: string[]) => isle.buildings.filter((b) => types.includes(b.type)).map((b) => b.id).sort((a, b) => a - b);
  const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
  const ghost = (type: string, x = 0, y = 0) => ({ type, island: "isle-01", x, y, rotation: 0 });

  it("a service building: the houses it would serve", () => {
    expect(ghostRelated(chapelAt(0), content, base)).toEqual(wouldServe(chapelAt(0), content, base));
  });

  it("a house: the service buildings whose own radius reaches it, each at its level", () => {
    const chapel = isle.buildings.find((b) => b.type === "chapel")!;
    const [cw] = rotatedFootprint(def("chapel").width, def("chapel").height, chapel.rotation);
    const r = def("chapel").service!.levels[0]!.radius;
    // A settler house (2×2) whose nearest tile is r (in) or r + 1 (out) tiles right of the chapel's right edge, in its rows.
    const at = (gap: number) => ghost("house_settlers", chapel.x + cw - 1 + gap, chapel.y);
    expect(ghostRelated(at(r), content, base)).toContain(chapel.id);
    expect(ghostRelated(at(r + 1), content, base)).not.toContain(chapel.id);
    // Only service buildings, none of the producers or houses.
    const allowed = new Set(idsOf("chapel", "market"));
    for (const id of ghostRelated(at(0), content, base)) expect(allowed.has(id)).toBe(true);
  });

  it("a Warehouse: every producer on the island, nothing else", () => {
    const producers = idsOf("fisher", "lumberjack", "sawmill", "sheep_farm", "weaver_wool", "quarry");
    expect(sorted(ghostRelated(ghost("warehouse"), content, base))).toEqual(producers);
  });

  it("a producer: every Warehouse and Trading Post on its island, none of another island", () => {
    expect(ghostRelated(ghost("sawmill"), content, base)).toEqual(idsOf("trading_post"));
    const warehouse = { ...isle.buildings[0]!, id: 900_001, type: "warehouse" };
    const withWarehouse = { islands: [{ ...isle, buildings: [...isle.buildings, warehouse] }, ...base.islands.filter((is) => is.id !== "isle-01")] };
    expect(sorted(ghostRelated(ghost("sawmill"), content, withWarehouse))).toEqual(sorted([...idsOf("trading_post"), 900_001]));
    expect(ghostRelated({ ...ghost("sawmill"), island: "isle-02" }, content, base)).toEqual(
      base.islands.find((is) => is.id === "isle-02")!.buildings.filter((b) => b.type === "trading_post").map((b) => b.id),
    );
  });

  it("is empty for anything else (roads, fields, the shipyard) or an unknown island", () => {
    expect(ghostRelated(ghost("road_dirt"), content, base)).toEqual([]);
    expect(ghostRelated(ghost("shipyard"), content, base)).toEqual([]);
    expect(ghostRelated({ ...ghost("sawmill"), island: "nowhere" }, content, base)).toEqual([]);
  });
});
