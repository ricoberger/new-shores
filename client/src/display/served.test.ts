import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { rotatedFootprint } from "./geometry";
import { collectorReach, ghostRelated, reachOutline, servedRelated, serviceRadius, wouldServe } from "./served";

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
  const isle = base.islands.find((is) => is.id === "oc-01")!;
  const idsOf = (...types: string[]) => isle.buildings.filter((b) => types.includes(b.type)).map((b) => b.id).sort((a, b) => a - b);
  const ghost = (type: string, x = 0, y = 0) => ({ type, island: "oc-01", x, y, rotation: 0 });

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

  it("a Warehouse: the producers within its reach at its level (D-069), nothing else", () => {
    const reach = collectorReach(def("warehouse"), 1)!;
    expect(reach).toBeGreaterThan(0);
    const sawmill = isle.buildings.find((b) => b.type === "sawmill")!;
    const [sw] = rotatedFootprint(def("sawmill").width, def("sawmill").height, sawmill.rotation);
    // A warehouse whose nearest tile is reach (in) or reach + 1 (out) tiles right of the sawmill, in its rows.
    const at = (gap: number, level = 1) => ({ ...ghost("warehouse", sawmill.x + sw - 1 + gap, sawmill.y), level });
    expect(ghostRelated(at(reach), content, base)).toContain(sawmill.id);
    expect(ghostRelated(at(reach + 1), content, base)).not.toContain(sawmill.id);
    // A higher level reaches further (a moved warehouse keeps its level).
    expect(ghostRelated(at(reach + 1, 2), content, base)).toContain(sawmill.id);
    const producers = new Set(idsOf("fisher", "lumberjack", "sawmill", "sheep_farm", "weaver_wool", "quarry"));
    for (const id of ghostRelated(at(reach), content, base)) expect(producers.has(id) || !!def(isle.buildings.find((b) => b.id === id)!.type).recipe).toBe(true);
  });

  it("a producer: the Warehouses and Trading Posts whose reach covers it, none of another island", () => {
    const tp = isle.buildings.find((b) => b.type === "trading_post")!;
    const reach = collectorReach(def("trading_post"), tp.level ?? 1)!;
    const [tw] = rotatedFootprint(def("trading_post").width, def("trading_post").height, tp.rotation);
    const at = (gap: number) => ghost("sawmill", tp.x + tw - 1 + gap, tp.y);
    expect(ghostRelated(at(reach), content, base)).toContain(tp.id);
    expect(ghostRelated(at(reach + 1), content, base)).not.toContain(tp.id);
    const collectors = new Set(idsOf("trading_post", "warehouse"));
    for (const id of ghostRelated(at(0), content, base)) expect(collectors.has(id)).toBe(true);
    expect(ghostRelated({ ...at(0), island: "oc-02" }, content, base).every((id) => !collectors.has(id))).toBe(true);
  });

  it("the reach outline: the footprint grown by reach + ½ tile around its corner tiles", () => {
    const pts = reachOutline({ x: 10, y: 20, w: 2, h: 2 }, 5, 4);
    expect(pts).toHaveLength(20);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10.5 - 5.5);
    expect(Math.max(...xs)).toBeCloseTo(11.5 + 5.5);
    expect(Math.min(...ys)).toBeCloseTo(20.5 - 5.5);
    expect(Math.max(...ys)).toBeCloseTo(21.5 + 5.5);
    expect(collectorReach(def("chapel"))).toBeNull();
    expect(collectorReach(def("warehouse"), 99)).toBe(def("warehouse").warehouse!.levels.at(-1)!.reach);
  });

  it("is empty for anything else (roads, fields, the shipyard) or an unknown island", () => {
    expect(ghostRelated(ghost("road_dirt"), content, base)).toEqual([]);
    expect(ghostRelated(ghost("shipyard"), content, base)).toEqual([]);
    expect(ghostRelated({ ...ghost("sawmill"), island: "nowhere" }, content, base)).toEqual([]);
  });
});

describe("plans in the served hints (D-071)", () => {
  const isle = base.islands.find((is) => is.id === "oc-01")!;

  it("ignore plans: a planned house in a chapel ghost's radius is not tinted, a planned chapel serves nobody", () => {
    const chapelGhost = { type: "chapel", island: "oc-01", x: 0, y: 0, rotation: 0 };
    const plain = ghostRelated(chapelGhost, content, base);
    // Plans live in their own array: the hint reads `buildings` only.
    const planned = { ...isle, plans: [{ id: 9001, type: "house_settlers", x: 1, y: 1, rotation: 0 as const, planned: true }] };
    const withPlans = { ...base, islands: base.islands.map((is) => (is.id === "oc-01" ? planned : is)) };
    expect(ghostRelated(chapelGhost, content, withPlans)).toEqual(plain);
    const house = isle.buildings.find((b) => b.type === "house_settlers")!;
    expect(servedRelated(house, isle.buildings, def("house_settlers"))).not.toContain(9001);
  });
});

describe("serviceRadius", () => {
  it("is a public building's (or the market's) radius at a level, null for anything else", () => {
    expect(serviceRadius(def("market"), 1)).toBe(def("market").service!.levels[0]!.radius);
    expect(serviceRadius(def("market"), 2)).toBe(def("market").service!.levels[1]!.radius);
    expect(serviceRadius(chapel)).toBe(16);
    expect(serviceRadius(producer)).toBeNull();
    expect(serviceRadius(def("warehouse"))).toBeNull();
  });
});
