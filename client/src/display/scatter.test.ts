import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { blockedTiles, islandSeed, type Placed, layerKeys, NEAR_BLOCKED_KEEP, scatterGround, scatterSite, scatterTrees, thinningAreas, treeKeepFraction, TREES_PER_TILE, wallSide } from "./scatter";

/** A width × height map of one terrain. */
const map = (width: number, height: number, t: string) => ({ width, height, terrain: Array.from({ length: width * height }, () => t) });

const defs = new Map<string, ContentBuilding>([
  ["lumberjack", { id: "lumberjack", width: 2, height: 2, category: "production", work_area: { radius: 4, terrain: ["forest"] } } as unknown as ContentBuilding],
  ["sheep_farm", { id: "sheep_farm", width: 3, height: 3, category: "production", work_area: { radius: 4 } } as unknown as ContentBuilding],
  ["house", { id: "house", width: 2, height: 2, category: "houses" } as unknown as ContentBuilding],
]);
const building = (type: string, x: number, y: number, efficiency = 1000) =>
  ({ id: x * 100 + y, type, x, y, rotation: 0, efficiency_permille: efficiency }) as unknown as BuildingDisplay;

describe("island seed", () => {
  it("is a stable hash of id and revision", () => {
    expect(islandSeed("start", "r1")).toBe(islandSeed("start", "r1"));
    expect(islandSeed("start", "r1")).not.toBe(islandSeed("start", "r2"));
    expect(islandSeed("start", "r1")).not.toBe(islandSeed("island2", "r1"));
  });
});

describe("tree thinning", () => {
  it("keeps 1 − 0.5 × efficiency of the trees", () => {
    expect(treeKeepFraction(0)).toBe(1);
    expect(treeKeepFraction(1000)).toBe(0.5);
    expect(treeKeepFraction(400)).toBeCloseTo(0.8, 10);
    expect(treeKeepFraction(-5)).toBe(1);
    expect(treeKeepFraction(5000)).toBe(0.5);
    expect(treeKeepFraction(Number.NaN)).toBe(1);
  });

  it("takes work discs from harvesters whose work area includes forest only", () => {
    const areas = thinningAreas([building("lumberjack", 10, 10, 600), building("sheep_farm", 0, 0), building("house", 5, 5)], defs);
    expect(areas).toEqual([{ cx: 11, cy: 11, radius: 4, keep: 0.7 }]);
  });

  it("thins trees inside the radius deterministically, about to the kept fraction", () => {
    const m = map(40, 40, "forest");
    const blocked = blockedTiles([building("lumberjack", 19, 19)], [], defs);
    const input = { ...m, seed: islandSeed("a", "1"), blocked };
    const areas = thinningAreas([building("lumberjack", 19, 19, 1000)], defs);
    const trees = scatterTrees(input, areas);
    expect(scatterTrees(input, areas)).toEqual(trees);
    const inside = (t: { x: number; y: number }) => (t.x - 20) ** 2 + (t.y - 20) ** 2 <= 16;
    // Candidates inside the disc away from the footprint ring: compare with no thinning.
    const unthinned = scatterTrees(input, []);
    const ratio = trees.filter(inside).length / unthinned.filter(inside).length;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
    // Outside the disc nothing changes, and kept trees are a subset.
    expect(trees.filter((t) => !inside(t))).toEqual(unthinned.filter((t) => !inside(t)));
    const keys = new Set(unthinned.map((t) => `${t.x},${t.y}`));
    expect(trees.every((t) => keys.has(`${t.x},${t.y}`))).toBe(true);
    // Every felled tree leaves a stump where it stood, inside the disc.
    const stumps: Placed[] = [];
    scatterTrees(input, areas, 3, stumps);
    expect(stumps.length).toBe(unthinned.length - trees.length);
    expect(stumps.every(inside)).toBe(true);
    expect(stumps.every((t) => keys.has(`${t.x},${t.y}`))).toBe(true);
  });
});

describe("deterministic scatter", () => {
  it("places the same trees for the same seed and different ones for another", () => {
    const m = map(12, 12, "forest");
    const a = scatterTrees({ ...m, seed: 1, blocked: new Set() }, []);
    expect(a).toHaveLength(12 * 12 * TREES_PER_TILE);
    expect(scatterTrees({ ...m, seed: 1, blocked: new Set() }, [])).toEqual(a);
    expect(scatterTrees({ ...m, seed: 2, blocked: new Set() }, [])).not.toEqual(a);
    const g = scatterGround({ ...map(20, 20, "grass"), seed: 5, blocked: new Set() });
    expect(scatterGround({ ...map(20, 20, "grass"), seed: 5, blocked: new Set() })).toEqual(g);
    expect(scatterGround({ ...map(20, 20, "grass"), seed: 6, blocked: new Set() })).not.toEqual(g);
    expect(new Set(g.map((p) => p.kind))).toEqual(new Set(["tuft", "flower", "bush"]));
    // Rocks and bushes gather at the forest fringe (left half forest).
    const fringe = { width: 20, height: 20, terrain: Array.from({ length: 400 }, (_, i) => (i % 20 < 10 ? "forest" : "grass")) };
    const f = scatterGround({ ...fringe, seed: 5, blocked: new Set() });
    expect(new Set(f.map((p) => p.kind))).toEqual(new Set(["tuft", "flower", "rock", "bush"]));
  });

  it("puts no rocks on open grass and clusters rocks and bushes at the coast, fringe and plateau feet", () => {
    expect(scatterSite({ width: 3, height: 3, terrain: Array(9).fill("grass") }, 1, 1)).toBe("open");
    const t = ["water", "grass", "grass", "grass", "grass", "grass", "forest", "grass", "mountain"];
    expect(scatterSite({ width: 3, height: 3, terrain: t }, 1, 1)).toBe("foot");
    expect(scatterSite({ width: 3, height: 3, terrain: t }, 0, 1)).toBe("fringe");
    expect(scatterSite({ width: 3, height: 3, terrain: t }, 1, 0)).toBe("coast");
    for (let seed = 0; seed < 20; seed++) {
      expect(scatterGround({ ...map(20, 20, "grass"), seed, blocked: new Set() }).some((p) => p.kind === "rock")).toBe(false);
    }
  });

  it("gathers rocks at the foot of terrace walls, against the wall (D-058)", () => {
    // 20 × 20 grass, the right half one level up: column 9 is the foot of the wall.
    const m = map(20, 20, "grass");
    const levels = Array.from({ length: 20 }, () => "0000000000" + "1111111111").join("");
    expect(scatterSite({ ...m, levels }, 9, 5)).toBe("ledge");
    expect(scatterSite({ ...m, levels }, 10, 5)).toBe("open");
    expect(wallSide({ ...m, levels }, 9, 5)).toEqual([1, 0]);
    let rocks = 0;
    for (let seed = 0; seed < 20; seed++) {
      for (const p of scatterGround({ ...m, levels, seed, blocked: new Set() })) {
        if (p.kind !== "rock") continue;
        rocks++;
        expect(Math.floor(p.x)).toBe(9);
        expect(p.x - 9).toBeGreaterThan(0.8);
      }
    }
    expect(rocks).toBeGreaterThan(0);
  });

  it("keeps off buildings, fields and roads and thins next to them", () => {
    const m = map(20, 20, "forest");
    const blocked = blockedTiles([building("house", 4, 4)], [{ x: 10, y: 0 }, { x: 10, y: 1 }], defs);
    expect(blocked).toEqual(new Set(["10,0", "10,1", "4,4", "5,4", "4,5", "5,5"]));
    const trees = scatterTrees({ ...m, seed: 9, blocked }, []);
    for (const t of trees) expect(blocked.has(`${Math.floor(t.x)},${Math.floor(t.y)}`)).toBe(false);
    const ring = (t: { x: number; y: number }) => {
      const x = Math.floor(t.x);
      const y = Math.floor(t.y);
      return x >= 3 && x <= 6 && y >= 3 && y <= 6;
    };
    // 12 ring tiles × 2 candidates, kept at NEAR_BLOCKED_KEEP: clearly fewer than all.
    expect(trees.filter(ring).length).toBeLessThan(12 * TREES_PER_TILE * (NEAR_BLOCKED_KEEP + 0.35));
    const ground = scatterGround({ ...map(20, 20, "grass"), seed: 9, blocked });
    for (const p of ground) expect(blocked.has(`${Math.floor(p.x)},${Math.floor(p.y)}`)).toBe(false);
  });

  it("grows trees on forest only and ground scatter on grass, coast and mountain only", () => {
    const terrain = ["forest", "grass", "coast", "mountain", "water"];
    const m = { width: 5, height: 1, terrain };
    const trees = scatterTrees({ ...m, seed: 3, blocked: new Set() }, []);
    expect(trees.every((t) => Math.floor(t.x) === 0)).toBe(true);
    for (let seed = 0; seed < 30; seed++) {
      for (const p of scatterGround({ ...m, seed, blocked: new Set() })) expect([1, 2, 3]).toContain(Math.floor(p.x));
    }
  });
});

describe("merged-layer keys", () => {
  const base = { buildings: [building("lumberjack", 10, 10, 800), building("house", 4, 4)], roads: [{ x: 3, y: 4, type: "road_dirt" }] };

  it("ignore what does not place a strip, footprint or tree", () => {
    const k = layerKeys(base, defs);
    const busy = { ...base, buildings: base.buildings.map((b) => ({ ...b, status: "warehouse_full", cycle_progress_permille: 500 }) as BuildingDisplay) };
    expect(layerKeys(busy, defs)).toEqual(k);
    // A house's efficiency thins nothing.
    expect(layerKeys({ ...base, buildings: [base.buildings[0]!, { ...base.buildings[1]!, efficiency_permille: 10 }] }, defs)).toEqual(k);
  });

  it("change per layer with its inputs", () => {
    const k = layerKeys(base, defs);
    const moved = layerKeys({ ...base, buildings: [base.buildings[0]!, building("house", 6, 4)] }, defs);
    expect(moved.roads).toBe(k.roads);
    expect(moved.layout).not.toBe(k.layout);
    expect(moved.decoration).not.toBe(k.decoration);
    const road = layerKeys({ ...base, roads: [...base.roads, { x: 3, y: 5, type: "road_dirt" }] }, defs);
    expect(road.roads).not.toBe(k.roads);
    expect(road.layout).toBe(k.layout);
    expect(road.decoration).not.toBe(k.decoration);
    const thinned = layerKeys({ ...base, buildings: [building("lumberjack", 10, 10, 200), base.buildings[1]!] }, defs);
    expect(thinned.layout).toBe(k.layout);
    expect(thinned.decoration).not.toBe(k.decoration);
  });
});

describe("scatter by chunk rectangle", () => {
  it("places exactly the whole island's items of the rectangle, in the same order", () => {
    const m = { width: 70, height: 45, terrain: Array.from({ length: 70 * 45 }, (_, i) => (i % 7 < 3 ? "forest" : i % 11 === 0 ? "mountain" : "grass")) };
    const blocked = blockedTiles([building("lumberjack", 30, 20), building("house", 3, 3)], [], defs);
    const input = { ...m, seed: islandSeed("b", "1"), blocked };
    const areas = thinningAreas([building("lumberjack", 30, 20, 800)], defs);
    const rect = { x: 32, y: 32, width: 32, height: 13 };
    const inRect = (p: Placed) => p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height;
    const stumps: Placed[] = [];
    const stumpsIn: Placed[] = [];
    expect(scatterTrees({ ...input, rect }, areas, 3, stumpsIn)).toEqual(scatterTrees(input, areas, 3, stumps).filter(inRect));
    expect(stumpsIn).toEqual(stumps.filter(inRect));
    expect(scatterGround({ ...input, rect })).toEqual(scatterGround(input).filter(inRect));
    expect(scatterGround({ ...input, rect }).length).toBeGreaterThan(0);
  });
});
