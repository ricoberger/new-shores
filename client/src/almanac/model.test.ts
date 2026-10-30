import { describe, expect, it } from "vitest";
import type { Content } from "../api/client";
import { buildIndex, buildingGroups, buildingView, chain, goodView, islandsView, needsByTier, num, perMinute, search, searchEntries, shipView, tierViews, type ChainNode } from "./model";
import { objectiveSentence, questViews } from "./questText";
import { loadContent } from "./testContent";

const DIRS = [
  "content/old_coast",
  "server/testdata/content/old_coast_dairy",
  "server/testdata/content/old_coast_pre_d054",
  "server/testdata/content/old_coast_variety",
];

const once = (ids: string[]) => {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n !== 1).map(([id]) => id);
};

describe.each(DIRS)("almanac model of %s", (dir) => {
  const content = loadContent(dir);
  const idx = buildIndex(content);

  it("lists every building exactly once, grouped by tier and category", () => {
    const ids = buildingGroups(idx).flatMap((g) => g.categories.flatMap((c) => c.buildings.map((b) => b.id)));
    expect(once(ids)).toEqual([]);
    expect([...ids].sort()).toEqual(content.buildings.map((b) => b.id).sort());
  });

  it("covers every good, need, ship, quest and tier exactly once", () => {
    const entries = searchEntries(idx);
    for (const [section, all] of [
      ["goods", content.goods.map((g) => g.id)],
      ["ships", content.ships.map((s) => s.id)],
      ["quests", content.quests.map((q) => q.id)],
      ["buildings", content.buildings.map((b) => b.id)],
    ] as const) {
      const got = entries.filter((e) => e.section === section).map((e) => e.id);
      expect(once(got)).toEqual([]);
      expect(got.sort()).toEqual([...all].sort());
    }
    const needIds = needsByTier(idx).flatMap((t) => t.own.map((n) => n.id));
    expect(once(needIds)).toEqual([]);
    expect(needIds.sort()).toEqual(content.needs.filter((n) => !n.from_tier).map((n) => n.id).sort());
    expect(questViews(idx).map((q) => q.id)).toEqual(content.quests.map((q) => q.id));
    expect(content.ships.map((s) => shipView(idx, s).id)).toEqual(content.ships.map((s) => s.id));
    expect(tierViews(idx).map((t) => t.id)).toEqual(content.tiers.map((t) => t.id));
  });

  it("resolves every referenced ID", () => {
    const missing: string[] = [];
    const need = (kind: "building" | "good" | "tier" | "ship" | "quest", id: string | undefined, where: string) => {
      if (id !== undefined && !idx[kind](id)) missing.push(`${where}: ${kind} ${id}`);
    };
    for (const b of content.buildings) {
      need("tier", b.tier, b.id);
      for (const m of Object.keys(b.cost.materials)) need("good", m, `${b.id} cost`);
      for (const i of b.recipe?.inputs ?? []) for (const g of i.goods) need("good", g, `${b.id} input`);
      for (const o of b.recipe?.outputs ?? []) need("good", o.good, `${b.id} output`);
      for (const s of b.shipyard?.ships ?? []) need("ship", s, b.id);
      for (const f of b.field?.farms ?? []) need("building", f, b.id);
      need("tier", b.workforce?.tier, b.id);
      for (const l of b.service?.levels ?? []) need("tier", l.tier, b.id);
      for (const l of b.depot?.levels ?? []) need("tier", l.tier, b.id);
    }
    for (const t of content.tiers) {
      need("building", t.house ?? undefined, t.id);
      for (const b of t.unlock.buildings) need("building", b, t.id);
      for (const k of Object.keys(t.unlock.population)) need("tier", k, t.id);
    }
    for (const n of content.needs) {
      need("tier", n.tier, n.id);
      for (const g of n.goods ?? []) need("good", g.good, n.id);
      for (const b of n.buildings ?? []) need("building", b.building, n.id);
      if (n.category && !content.need_categories.some((c) => c.id === n.category)) missing.push(`${n.id}: category ${n.category}`);
    }
    for (const s of content.ships) {
      need("tier", s.tier, s.id);
      for (const m of Object.keys(s.cost.materials)) need("good", m, `${s.id} cost`);
    }
    for (const q of content.quests) {
      for (const p of q.prerequisites) need("quest", p, q.id);
      for (const g of Object.keys(q.rewards.goods)) need("good", g, `${q.id} reward`);
      for (const o of q.objectives) {
        need("tier", o.tier, q.id);
        need("good", o.good, q.id);
        if (o.kind === "ship_count") need("ship", o.type, q.id);
        if (o.kind === "building_count" || o.kind === "connected") need("building", o.type, q.id);
      }
    }
    expect(missing).toEqual([]);
  });

  it("formats every quest condition without a fallback or a raw ID", () => {
    for (const q of questViews(idx)) {
      expect(q.conditions.length).toBeGreaterThan(0);
      for (const c of q.conditions) {
        expect(c).not.toMatch(/unknown|undefined|NaN|objective/i);
        for (const b of content.buildings) expect(c).not.toContain(b.id.includes("_") ? b.id : "\u0000");
      }
    }
  });

  it("builds a view of every building and good without throwing", () => {
    for (const b of content.buildings) {
      const v = buildingView(idx, b);
      expect(v.footprint).toMatch(/^\d+ × \d+/);
    }
    for (const g of content.goods) expect(goodView(idx, g).id).toBe(g.id);
  });
});

describe("arithmetic of the tables", () => {
  const idx = buildIndex(loadContent("content/old_coast"));

  it("derives per-minute rates from cycle times", () => {
    expect(perMinute(1000, 30000)).toBe(2);
    expect(perMinute(1000, 40000)).toBe(1.5);
    expect(perMinute(1000, 0)).toBe(0);
    const lumberjack = buildingView(idx, idx.building("lumberjack")!);
    expect(lumberjack.outputs).toEqual([{ goods: ["wood"], perMin: 2 }]);
    expect(lumberjack.cycleSeconds).toBe(30);
  });

  it("keeps recipe input alternatives in one slot", () => {
    const smelter = buildingView(idx, idx.building("smelter")!);
    expect(smelter.inputs.map((i) => i.goods)).toEqual([["iron_ore"], ["charcoal", "coal"]]);
  });

  it("reads tiers, residents and tax", () => {
    const t = tierViews(idx);
    expect(t[1]).toMatchObject({ id: "citizens", residentsFloor: 5, residentsMax: 15, tax: 0.8 });
    expect(t[1]?.unlock.population).toEqual([{ tier: "settlers", amount: 120 }]);
    expect(t[1]?.taxFullHouse).toBeCloseTo(12);
  });

  it("lists need alternatives with shares, rates and services with radii", () => {
    const citizens = needsByTier(idx).find((t) => t.tier === "citizens")!;
    const food = citizens.own.find((n) => n.category === "food")!;
    expect(food.alternatives.map((a) => [a.id, a.share, a.perResident])).toEqual([
      ["bread", 0.6, 0.008],
      ["cheese", 0.6, 0.006],
    ]);
    expect(food.alternatives[0]?.providers.length).toBeGreaterThan(0);
    const services = needsByTier(idx)[0]!.own.find((n) => n.services)!;
    expect(services.alternatives.map((a) => a.radius)).toEqual([12, 16]);
    expect(needsByTier(idx)[1]?.servicesAdded.length).toBeGreaterThan(0);
  });

  it("derives upstream chains from the recipes", () => {
    const flat = (n: ChainNode): string[] => [n.good, ...n.via.flatMap((v) => v.inputs.flatMap((i) => i.goods.flatMap(flat)))];
    const goods = flat(chain(idx, "bread"));
    expect(goods[0]).toBe("bread");
    expect(goods).toContain("wheat");
    expect(chain(idx, "wood").via[0]?.inputs).toEqual([]);
  });

  it("stops a chain at a cycle", () => {
    const loop = {
      ...loadContent("content/old_coast"),
      buildings: [
        { ...idx.building("lumberjack")!, id: "a", recipe: { inputs: [{ good: "x", goods: ["x"], amount: 1000 }], outputs: [{ good: "y", amount: 1000 }], cycle_ms: 60000 } },
        { ...idx.building("lumberjack")!, id: "b", recipe: { inputs: [{ good: "y", goods: ["y"], amount: 1000 }], outputs: [{ good: "x", amount: 1000 }], cycle_ms: 60000 } },
      ],
    } as Content;
    const tree = chain(buildIndex(loop), "x");
    expect(JSON.stringify(tree)).toContain('"cycle":true');
  });

  it("formats numbers", () => {
    expect(num(1.5)).toBe("1.5");
    expect(num(30)).toBe("30");
    expect(num(0.3333)).toBe("0.33");
  });
});

describe("islands view", () => {
  it("renders the served size classes and nothing else when that is all there is", () => {
    const v = islandsView(loadContent("content/old_coast"));
    expect(v.sizeClasses.map((s) => s.id)).toEqual(["large", "medium", "small", "rock", "scenic"]);
    expect(v.sizeClasses.filter((s) => s.scenic).map((s) => s.id)).toEqual(["scenic"]);
    expect(v.basicOnly).toBe(true);
    expect(v.home).toEqual([]);
  });

  it("reads counts, pools and the home guarantees when the payload carries them", () => {
    const base = loadContent("content/old_coast");
    const extended = {
      ...base,
      size_classes: base.size_classes.map((s) => ({ ...s, size: 100, count: { min: 1, max: 2 }, fertilities: { min: 2, max: 4 } })),
      fertilities: [{ id: "wheat", count: { min: 3, max: 5 } }, { id: "broken" }, 7],
      deposits: [{ id: "stone", count: { min: 3, max: 6 } }],
      home: { size_class: "large", deposits: ["stone"], fertilities_none: ["hemp"] },
    } as unknown as Content;
    const v = islandsView(extended);
    expect(v.basicOnly).toBe(false);
    expect(v.sizeClasses[0]).toMatchObject({ size: 100, count: { min: 1, max: 2 } });
    expect(v.fertilities).toEqual([{ id: "wheat", count: { min: 3, max: 5 } }, { id: "broken", count: undefined }]);
    expect(v.home.map((h) => h.label)).toEqual(["Size class", "Deposits", "No fertility of"]);
  });

  it("survives a payload without optional parts", () => {
    const empty = { region: {}, quests: [], tiers: [], goods: [], buildings: [], needs: [], need_categories: [], ships: [], size_classes: [] } as unknown as Content;
    expect(islandsView(empty).sizeClasses).toEqual([]);
    const idx = buildIndex(empty);
    expect(buildingGroups(idx)).toEqual([]);
    expect(needsByTier(idx)).toEqual([]);
    expect(questViews(idx)).toEqual([]);
  });
});

describe("quest conditions", () => {
  const idx = buildIndex(loadContent("content/old_coast"));
  const kinds = ["building_count", "connected", "population", "stock", "route_exists", "island_settled", "tier_unlocked", "ship_count", "satisfaction"] as const;

  it("formats every condition type of MECHANICS §12a", () => {
    const sample = { type: "road_dirt", good: "planks", tier: "citizens", target: 10000 };
    for (const kind of kinds) {
      const text = objectiveSentence({ kind, ...sample, ...(kind === "ship_count" ? { type: "sloop", target: 2 } : {}), ...(kind === "building_count" || kind === "island_settled" ? { target: 10 } : {}) }, idx);
      expect(text, kind).not.toMatch(/unknown|undefined|NaN|objective/i);
      expect(text.length).toBeGreaterThan(5);
    }
  });

  it("says what the numbers mean", () => {
    expect(objectiveSentence({ kind: "building_count", type: "road_dirt", target: 10 }, idx)).toBe("Lay 10 tiles of Dirt road");
    expect(objectiveSentence({ kind: "population", tier: "settlers", target: 120000 }, idx)).toBe("Reach 120 Settlers");
    expect(objectiveSentence({ kind: "stock", good: "planks", target: 30000 }, idx)).toBe("Have 30 Planks in stock");
    expect(objectiveSentence({ kind: "satisfaction", tier: "settlers", target: 600 }, idx)).toBe("Keep Settlers satisfaction at 60 % or more");
    expect(objectiveSentence({ kind: "ship_count", type: "galleon", target: 1 }, idx)).toBe("Own 1 Galleon");
  });
});

describe("search", () => {
  const idx = buildIndex(loadContent("content/old_coast"));
  const entries = searchEntries(idx);
  it("filters all sections by name or ID", () => {
    const hits = search(entries, "bread");
    expect(hits.some((h) => h.section === "goods" && h.id === "bread")).toBe(true);
    expect(search(entries, "bakery").some((h) => h.section === "buildings" && h.id === "bakery")).toBe(true);
    expect(search(entries, "  ")).toEqual([]);
    expect(search(entries, "zzzzzz")).toEqual([]);
  });
});

describe("almanac model of the harbour buildings (D-060)", () => {
  const idx = buildIndex(loadContent("content/old_coast"));

  it("shows the pier's berths, the depot's levels and the quay's site", () => {
    const pier = buildingView(idx, idx.building("trading_pier")!);
    expect(pier).toMatchObject({ category: "harbour", pierBerths: 2, waterTiles: 3, levels: [] });
    const depot = buildingView(idx, idx.building("depot")!);
    expect(depot.category).toBe("harbour");
    expect(depot.levels.map((l) => [l.level, l.capacity, l.tier])).toEqual([
      [1, 150, undefined],
      [2, 300, "merchants"],
    ]);
    const quay = buildingView(idx, idx.building("quay")!);
    expect(quay).toMatchObject({ shallows: true, roadSecondsPerTile: 0.6 });
  });
});
