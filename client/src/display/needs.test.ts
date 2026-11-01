import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content } from "../api/client";
import { needIcon } from "../theme/iconSet";
import { ICON_PATHS } from "../theme/icons";
import {
  type NeedContent,
  chainBuildings,
  groupNeeds,
  needAlternatives,
  needCategory,
  needFromTier,
  needGroup,
  needGroupName,
  needLabel,
  needName,
  orderNeeds,
  upgradeReasonText,
} from "./needs";

// The shipped content files carry the names (content/old_coast), so the
// lookup is checked against the real catalogue shape and an empty one.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = <T>(file: string) => JSON.parse(readFileSync(join(repo, "content", "old_coast", file), "utf8")) as T;
const content = {
  needs: read<{ id: string; name: string }[]>("needs.json"),
  need_categories: read<{ id: string; name: string; icon: string }[]>("need_categories.json"),
  buildings: [{ id: "market", name: "Small market" }],
  tiers: read<{ id: string; name: string }[]>("tiers.json"),
} as unknown as Content;

describe("upgrade reasons", () => {
  it("words the server's reason codes, naming the category of a need", () => {
    expect(upgradeReasonText(content, "tier_locked")).toBe("The next tier is not unlocked yet");
    expect(upgradeReasonText(content, "not_full")).toBe("The house is not full yet");
    expect(upgradeReasonText(content, "needs_below_threshold:clothing:60")).toBe("Clothing is not supplied well enough");
    expect(upgradeReasonText(null, "needs_below_threshold:clothing:60")).toBe("clothing is not supplied well enough");
    expect(upgradeReasonText(content, "cannot_afford")).toBe("Not enough gold or materials");
    expect(upgradeReasonText(content, "no_house")).toBe("There is no house of a next tier");
    expect(upgradeReasonText(content, "something_new")).toBe("something_new");
  });
});

describe("need display names", () => {
  it("names needs and categories from the content catalogue", () => {
    expect(needName(content, "settlers_food")).toBe("Food");
    expect(needName(content, "settlers_clothing")).toBe("Clothing");
    expect(needName(content, "settlers_market")).toBe("Market");
    expect(needName(content, "merchants_faith")).toBe("Faith");
    expect(needCategory(content, "market")).toEqual({ id: "market", name: "Market", icon: "need:market", group: "public" });
    expect(needCategory(content, "safety")).toEqual({ id: "safety", name: "Safety", icon: "need:safety", group: "public" });
    expect(needCategory(content, "food")).toEqual({ id: "food", name: "Food", icon: "need:food", group: "goods" });
    expect(needCategory(content, "clothing")).toEqual({ id: "clothing", name: "Clothing", icon: "need:clothing", group: "goods" });
    expect(needCategory(content, "luxury").name).toBe("Luxury");
  });

  it("falls back to the ID for unknown needs and categories, and for a missing or partial catalogue", () => {
    expect(needName(content, "patricians_opera")).toBe("patricians_opera");
    expect(needCategory(content, "spices")).toEqual({ id: "spices", name: "spices" });
    const partial: NeedContent[] = [null, undefined, {}, { needs: [] }, { need_categories: [] }];
    for (const c of partial) {
      expect(needName(c, "settlers_food")).toBe("settlers_food");
      expect(needCategory(c, "food")).toEqual({ id: "food", name: "food" });
    }
  });

  it("labels a need entry by its name, else its category's or building's name, else its ID", () => {
    expect(needLabel(content, { id: "settlers_food", category: "food" })).toBe("Food");
    expect(needLabel(content, { id: "citizens_education", category: "education" })).toBe("Education");
    // Unknown need IDs (content drift): the category or building name.
    expect(needLabel(content, { id: "x_drink", category: "drink" })).toBe("Drink");
    expect(needLabel(content, { id: "x_market", building: "market" })).toBe("Small market");
    expect(needLabel(null, { id: "x_food", category: "food" })).toBe("food");
    expect(needLabel(null, { id: "x_market", building: "market" })).toBe("market");
    expect(needLabel(undefined, { id: "x" })).toBe("x");
  });

  it("uses the category's content icon when the HUD set has it", () => {
    expect(needIcon({ category: "clothing" }, needCategory(content, "clothing").icon)).toBe(ICON_PATHS["need:clothing"]);
    // Comfort has its own icon since tier 3 (D-056 C3), luxury since tier 4 (C4).
    expect(needIcon({ category: "comfort" }, needCategory(content, "comfort").icon)).toBe(ICON_PATHS["need:comfort"]);
    expect(needIcon({ category: "luxury" }, needCategory(content, "luxury").icon)).toBe(ICON_PATHS["need:luxury"]);
    expect(needIcon({ category: "food" }, "need:not_in_the_set")).toBe(ICON_PATHS["need:food"]);
    expect(needIcon({ category: "spices" }, needCategory(content, "spices").icon)).toBe(ICON_PATHS["need:_fallback"]);
  });

  it("labels lower-tier categories with their tier and lists them after the own needs (D-056)", () => {
    expect(needFromTier(content, "citizens_settlers_food")).toBe("Settlers");
    expect(needFromTier(content, "citizens_food")).toBeUndefined();
    expect(needLabel(content, { id: "citizens_settlers_food", category: "food" })).toBe("Food (Settlers)");
    expect(needLabel(content, { id: "citizens_food", category: "food" })).toBe("Food");
    const ids = orderNeeds(content, [{ id: "citizens_settlers_food" }, { id: "citizens_food" }, { id: "citizens_settlers_clothing" }, { id: "citizens_tavern" }]).map((n) => n.id);
    expect(ids).toEqual(["citizens_food", "citizens_tavern", "citizens_settlers_food", "citizens_settlers_clothing"]);
  });
});

describe("need alternatives (D-056)", () => {
  const c = {
    goods: [
      { id: "bread", name: "Bread" },
      { id: "cheese", name: "Cheese" },
    ],
    buildings: [
      { id: "market", name: "Small market" },
      { id: "chapel", name: "Chapel" },
      { id: "school", name: "School" },
    ],
    needs: [
      { id: "citizens_food", goods: [{ good: "bread", share: 600 }, { good: "cheese", share: 600 }] },
      { id: "citizens_services", buildings: [{ building: "market" }, { building: "chapel" }, { building: "school" }, { building: "opera" }] },
      { id: "settlers_food", goods: [{ good: "fish", share: 1000 }] },
    ],
  } as unknown as Content;

  it("lists the goods or buildings of a category by name", () => {
    expect(needAlternatives(c, "citizens_food")).toBe("Bread or Cheese");
    expect(needAlternatives(c, "citizens_services")).toBe("Small market, Chapel, School or opera");
  });

  it("is undefined for a lone alternative, an unknown need or no catalogue", () => {
    expect(needAlternatives(c, "settlers_food")).toBeUndefined();
    expect(needAlternatives(c, "nobody")).toBeUndefined();
    expect(needAlternatives(null, "citizens_food")).toBeUndefined();
  });
});

describe("service chains (D-065) and the need groups", () => {
  const c = {
    ...content,
    buildings: [
      { id: "chapel", name: "Chapel", service: { chain: "faith", rank: 1, radius: 16 } },
      { id: "cathedral", name: "Cathedral", service: { chain: "faith", rank: 3, radius: 28 } },
      { id: "church", name: "Church", service: { chain: "faith", rank: 2, radius: 20 } },
      { id: "school", name: "School", service: { chain: "education", rank: 1, radius: 16 } },
      { id: "city_guard", name: "City guard", service: { radius: 16 } },
    ],
  } as unknown as Content;

  it("lists a chain's buildings of the minimum rank or higher, by rank", () => {
    expect(chainBuildings(c, "faith", 1)).toEqual(["chapel", "church", "cathedral"]);
    expect(chainBuildings(c, "faith", 2)).toEqual(["church", "cathedral"]);
    expect(chainBuildings(c, "faith", 4)).toEqual([]);
    expect(chainBuildings(null, "faith", 1)).toEqual([]);
    expect(needAlternatives(c, "settlers_faith")).toBe("Chapel, Church or Cathedral");
    expect(needAlternatives(c, "merchants_faith")).toBe("Church or Cathedral");
    // One building of the rank or higher: no alternatives to list.
    expect(needAlternatives(c, "patricians_faith")).toBeUndefined();
    expect(needAlternatives(c, "citizens_education")).toBeUndefined();
  });

  it("groups the goods categories, carried ones included, and the public-building categories in card order", () => {
    expect(needGroup(c, "health")).toBe("public");
    expect(needGroup(c, "faith")).toBe("public");
    expect(needGroup(c, "food")).toBe("goods");
    expect(needGroup(c, undefined)).toBeUndefined();
    expect(needGroupName("goods")).toBe("Goods");
    expect(needGroupName("public")).toBe("Public buildings");
    expect(needGroupName("wonders")).toBe("wonders");
    const runs = groupNeeds(c, [
      { id: "patricians_settlers_food", category: "food" },
      { id: "patricians_food", category: "food" },
      { id: "patricians_safety", category: "safety" },
      { id: "patricians_market", category: "market" },
      { id: "patricians_health", category: "health" },
      { id: "patricians_mystery" },
    ]);
    expect(runs.map((r) => [r.group, r.needs.map((n) => n.id)])).toEqual([
      ["goods", ["patricians_food", "patricians_settlers_food"]],
      ["public", ["patricians_safety", "patricians_market", "patricians_health"]],
      [undefined, ["patricians_mystery"]],
    ]);
  });
});
