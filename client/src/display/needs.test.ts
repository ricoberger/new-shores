import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content } from "../api/client";
import { needIcon } from "../theme/iconSet";
import { ICON_PATHS } from "../theme/icons";
import { type NeedContent, needCategory, needLabel, needName } from "./needs";

// The shipped content files carry the names (content/old_coast), so the
// lookup is checked against the real catalogue shape and an empty one.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = <T>(file: string) => JSON.parse(readFileSync(join(repo, "content", "old_coast", file), "utf8")) as T;
const content = {
  needs: read<{ id: string; name: string }[]>("needs.json"),
  need_categories: read<{ id: string; name: string; icon: string }[]>("need_categories.json"),
  buildings: [{ id: "market_small", name: "Small market" }],
} as unknown as Content;

describe("need display names", () => {
  it("names needs and categories from the content catalogue", () => {
    expect(needName(content, "settlers_food")).toBe("Food");
    expect(needName(content, "settlers_clothing")).toBe("Clothing");
    expect(needName(content, "settlers_market_small")).toBe("Market");
    expect(needName(content, "citizens_chapel")).toBe("Chapel");
    expect(needName(content, "citizens_tavern")).toBe("Tavern");
    expect(needCategory(content, "clothing")).toEqual({ id: "clothing", name: "Clothing", icon: "need:clothing" });
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
    expect(needLabel(content, { id: "settlers_market_small", building: "market_small" })).toBe("Market");
    // Unknown need IDs (content drift): the category or building name.
    expect(needLabel(content, { id: "x_drink", category: "drink" })).toBe("Drink");
    expect(needLabel(content, { id: "x_market", building: "market_small" })).toBe("Small market");
    expect(needLabel(null, { id: "x_food", category: "food" })).toBe("food");
    expect(needLabel(null, { id: "x_market", building: "market_small" })).toBe("market_small");
    expect(needLabel(undefined, { id: "x" })).toBe("x");
  });

  it("uses the category's content icon when the HUD set has it", () => {
    expect(needIcon({ category: "clothing" }, needCategory(content, "clothing").icon)).toBe(ICON_PATHS["need:clothing"]);
    expect(needIcon({ category: "comfort" }, needCategory(content, "comfort").icon)).toBe(ICON_PATHS["need:_fallback"]);
    expect(needIcon({ category: "food" }, "need:not_in_the_set")).toBe(ICON_PATHS["need:food"]);
    expect(needIcon({ category: "spices" }, needCategory(content, "spices").icon)).toBe(ICON_PATHS["need:_fallback"]);
  });
});
