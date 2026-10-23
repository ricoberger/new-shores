import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { depositText, fertilityNeed, listedInBuildMenu, lockReason, missingFertilityText, populationTotals, tierUnlocked } from "./tiers";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const content = {
  region: { id: "r", name: "R", version: "v", rules: {} },
  tiers: [
    { id: "settlers", name: "Settlers", index: 0, house: "house_settlers" },
    { id: "citizens", name: "Citizens", index: 1, house: "house_citizens" },
  ],
  goods: [{ id: "fish", name: "Fish", type: "food" }],
  buildings: [
    { id: "house_settlers", name: "Settler house", tier: "settlers", house: { tier: "settlers" } },
    { id: "house_citizens", name: "Citizen house", tier: "citizens", house: { tier: "citizens" } },
    { id: "market_small", name: "Small market", tier: "settlers" },
    { id: "chapel", name: "Chapel", tier: "settlers" },
    { id: "wheat_farm", name: "Wheat farm", tier: "citizens", work_area: { radius: 4, terrain: ["grass"], required_tiles: 24, fertility: "wheat" } },
  ],
  needs: [],
} as unknown as Content;

const building = (id: string) => content.buildings.find((b) => b.id === id) as ContentBuilding;

describe("tiers", () => {
  it("lists the server's unmet unlock conditions as the lock reason", () => {
    const model = {
      tiers: [
        { id: "settlers", unlocked: true, population: {}, buildings: {}, goods_delivered: {} },
        {
          id: "citizens",
          unlocked: false,
          population: { settlers: { have: 88_000, need: 120_000 } },
          buildings: { market_small: true, chapel: false },
          goods_delivered: { fish: false },
        },
      ],
      islands: [],
    } as unknown as DisplayState;
    expect(lockReason(model, content, "citizens")).toBe("Needs Citizens — Settlers 88/120, Chapel, deliver Fish");
    expect(lockReason(model, content, "settlers")).toBeNull();
    expect(tierUnlocked(model, "citizens")).toBe(false);
    // Conditions met but not yet evaluated, or no model: just the tier.
    expect(lockReason(null, content, "citizens")).toBe("Needs Citizens");
  });

  it("reads the unlock state from a server fixture (golden u)", () => {
    const model = fixture("citizens_needs");
    expect(model.tiers.map((t) => t.id)).toEqual(["settlers", "citizens"]);
    expect(tierUnlocked(model, "citizens")).toBe(true);
    expect(lockReason(model, content, "citizens")).toBeNull();
  });

  it("does not list houses of later tiers (upgrade only)", () => {
    expect(listedInBuildMenu(building("house_settlers"), content)).toBe(true);
    expect(listedInBuildMenu(building("house_citizens"), content)).toBe(false);
    expect(listedInBuildMenu(building("wheat_farm"), content)).toBe(true);
  });

  it("looks up the fertility of a building on the island", () => {
    expect(fertilityNeed(building("wheat_farm"), ["wheat", "apple"])).toEqual({ fertility: "wheat", present: true });
    expect(fertilityNeed(building("wheat_farm"), ["hemp"])).toEqual({ fertility: "wheat", present: false });
    expect(fertilityNeed(building("wheat_farm"), undefined)).toEqual({ fertility: "wheat", present: false });
    expect(fertilityNeed(building("chapel"), ["hemp"])).toBeNull();
    expect(missingFertilityText("wheat", ["hemp"])).toBe("Needs wheat fertility — this island has hemp");
    expect(missingFertilityText("wheat", [])).toBe("Needs wheat fertility — this island has none");
  });

  it("sums Citizens into the top bar population (golden u)", () => {
    const pop = populationTotals(fixture("citizens_needs"));
    expect(pop.get("citizens")).toBeGreaterThan(20_000);
    expect(pop.get("settlers")).toBeGreaterThan(0);
    expect(populationTotals(null).size).toBe(0);
  });
});

describe("deposit text", () => {
  it("picks the article from the deposit's name", () => {
    expect(depositText("stone")).toBe("Must cover a stone deposit");
    expect(depositText("iron")).toBe("Must cover an iron deposit");
  });
});
