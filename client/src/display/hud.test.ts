import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, ContentBuilding, DisplayState, Island } from "../api/client";
import { constructionGoods, islandKind, islandResources, tierRows, worstNeedText } from "./hud";
import { needLabel } from "./needs";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const content = {
  tiers: [
    { id: "settlers", name: "Settlers" },
    { id: "citizens", name: "Citizens" },
  ],
  goods: [{ id: "wood" }, { id: "planks" }, { id: "stone" }, { id: "tools" }, { id: "fish" }],
  buildings: [
    { id: "house_settlers", width: 2, height: 2, house: { tier: "settlers" }, cost: { gold: 0, materials: { planks: 10_000 } } },
    { id: "house_citizens", width: 2, height: 2, house: { tier: "citizens" }, cost: { gold: 0, materials: { planks: 15_000, stone: 10_000 } } },
    { id: "warehouse", width: 4, height: 3, cost: { gold: 0, materials: { planks: 20_000 } } },
  ],
  ships: [{ id: "sloop", cost: { gold: 0, materials: { tools: 5_000, planks: 10_000 } } }],
} as unknown as Content;
const defs = new Map(content.buildings.map((b) => [b.id, b as ContentBuilding]));

describe("top-bar aggregates", () => {
  it("names the island's size class from content (D-053)", () => {
    const classes = { size_classes: [{ id: "large", name: "Large" }, { id: "rock", name: "Resource rock" }] };
    expect(islandKind({ size_class: "large", rock: false }, classes)).toBe("Large");
    expect(islandKind({ size_class: "rock", rock: true }, classes)).toBe("Resource rock");
    expect(islandKind({ size_class: "rock", rock: true }, null)).toBe("rock");
    expect(islandKind({ size_class: "", rock: false }, classes)).toBe("");
  });

  it("lists the construction materials in the goods order", () => {
    expect(constructionGoods(content)).toEqual(["planks", "stone", "tools"]);
  });

  it("counts fertilities, deposits and the free coast (coast tiles without a building or road)", () => {
    // 4 × 3: coast on the top row and at (0, 1); a warehouse-sized house covers (1, 0) and (2, 0); a road on (3, 0).
    const statics = {
      id: "a",
      width: 4,
      height: 3,
      terrain: ["coast", "coast", "coast", "coast", "coast", "grass", "grass", "grass", "water", "water", "water", "water"],
      fertilities: ["wheat"],
      deposits: [
        { x: 1, y: 1, kind: "stone" },
        { x: 2, y: 1, kind: "stone" },
      ],
    } as unknown as Island;
    const r = islandResources(statics, { buildings: [{ id: 1, type: "house_settlers", x: 1, y: 0, rotation: 0 }] as never, roads: [{ x: 3, y: 0, type: "road_dirt" }] }, defs);
    expect(r).toEqual({ fertilities: ["wheat"], deposits: [{ kind: "stone", tiles: 2 }], coast: { tiles: 5, free: 2 } });
    expect(islandResources(statics, undefined, defs).coast).toEqual({ tiles: 5, free: 5 });
  });

  it("shows employed / total per tier and a resident-weighted satisfaction with the worst unmet need", () => {
    const island = fixture("citizens_needs").islands[0]!;
    const [settlers, citizens] = tierRows(island, content, defs);
    expect(settlers).toMatchObject({ tier: "settlers", employed: 18_000, total: 88_000 });
    // 4 houses at 100 %, 7 at 70 % (8 residents each): 809 ‰.
    expect(settlers!.satisfactionPermille).toBe(809);
    expect(settlers!.worst).toMatchObject({ id: "settlers_market_small", fulfilmentPermille: 364, reason: "out_of_range" });
    // The need's content name (needLabel), not its ID or the building's name.
    const needs = { needs: [{ id: "settlers_market_small", name: "Market" }], buildings: [{ id: "market_small", name: "Small market" }] } as unknown as Content;
    expect(worstNeedText(settlers!.worst, (n) => needLabel(needs, n))).toBe("Worst unmet need: Market 36 % (out of range)");
    expect(worstNeedText(settlers!.worst, (n) => needLabel(null, n))).toBe("Worst unmet need: market_small 36 % (out of range)");
    expect(citizens).toMatchObject({ employed: 22_000, total: 40_000, satisfactionPermille: 1000, worst: null });
    expect(worstNeedText(null, (n) => n.id)).toBe("All needs met");
  });

  it("has no satisfaction without residents (unsettled island)", () => {
    const island = { ...fixture("citizens_needs").islands[0]!, buildings: [], population: {}, workforce: {} };
    expect(tierRows(island, content, defs)[0]).toEqual({ tier: "settlers", name: "Settlers", employed: 0, total: 0, required: 0, short: 0, satisfactionPermille: null, worst: null });
  });

  it("reports the jobs the residents cannot fill", () => {
    const island = fixture("citizens_needs").islands[0]!;
    const short = { ...island, workforce: { ...island.workforce, settlers: { required: 100_000, available: 88_000 } as never } };
    expect(tierRows(short, content, defs)[0]).toMatchObject({ employed: 88_000, total: 88_000, required: 100_000, short: 12_000 });
    expect(tierRows(island, content, defs)[0]).toMatchObject({ short: 0 });
  });
});
