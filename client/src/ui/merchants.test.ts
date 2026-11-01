import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { ICON_PATHS } from "../theme/icons";
import { InfoPanel } from "./InfoPanel";

// Tier 3 in the cards (D-056 C3): the brig in the shipyard, a market at
// level 2 and a Merchant house with its comfort need, against the
// tier-3 reference game's display fixture and the shipped content names.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = (name: string) => (JSON.parse(readFileSync(join(repo, "server", "testdata", "display", `${name}.json`), "utf8")) as { base: DisplayState }).base;
const shipped = <T>(file: string) => JSON.parse(readFileSync(join(repo, "content", "old_coast", file), "utf8")) as T;

const def = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: "settlers",
  category: "public",
  width: 2,
  height: 2,
  coastal: false,
  requires_road: true,
  cost: { gold: 0, materials: {} },
  upkeep_per_min: 0,
  pause_category: "never",
  ...extra,
});

const content = {
  tiers: [
    { id: "settlers", name: "Settlers", index: 0 },
    { id: "citizens", name: "Citizens", index: 1 },
    { id: "merchants", name: "Merchants", index: 2 },
    { id: "patricians", name: "Patricians", index: 3 },
  ],
  goods: [
    { id: "planks", name: "Planks" },
    { id: "sails", name: "Sails" },
    { id: "tools", name: "Tools" },
    { id: "stone", name: "Stone" },
    { id: "bricks", name: "Bricks" },
  ],
  needs: shipped<{ id: string; name: string }[]>("needs.json"),
  need_categories: shipped<{ id: string; name: string; icon: string }[]>("need_categories.json"),
  buildings: [
    def("shipyard", "Shipyard", { tier: "citizens", category: "harbour", width: 8, height: 12, shipyard: { ships: ["sloop", "brig"] } }),
    def("market", "Market", {
      width: 5,
      height: 6,
      service: {
        radius: 12,
        levels: [
          { radius: 12 },
          { radius: 15, tier: "citizens", cost: { gold: 400_000, materials: { planks: 10_000, stone: 10_000 } } },
          { radius: 18, tier: "merchants", cost: { gold: 1_000_000, materials: { planks: 15_000, stone: 30_000 } } },
          { radius: 21, tier: "patricians", cost: { gold: 5_000_000, materials: { planks: 15_000, stone: 45_000, bricks: 15_000 } } },
        ],
      },
    }),
    def("house_merchants", "Merchant house", { tier: "merchants", category: "housing", house: { tier: "merchants" } }),
    def("chapel", "Chapel", { service: { radius: 16, chain: "faith", rank: 1, levels: [{ radius: 16 }] } }),
    def("church", "Church", { tier: "merchants", service: { radius: 20, chain: "faith", rank: 2, levels: [{ radius: 20 }] } }),
    def("cathedral", "Cathedral", { tier: "patricians", service: { radius: 28, chain: "faith", rank: 3, levels: [{ radius: 28 }] } }),
  ],
  ships: [
    { id: "sloop", name: "Sloop", tier: "citizens", slots: 2, slot_size: 50_000, build_ms: 120_000, upkeep_per_min: 1_000, cost: { gold: 100_000, materials: { planks: 20_000, sails: 10_000 } } },
    { id: "brig", name: "Brig", tier: "merchants", slots: 4, slot_size: 50_000, build_ms: 300_000, upkeep_per_min: 4_000, cost: { gold: 1_500_000, materials: { planks: 60_000, sails: 20_000, tools: 10_000 } } },
  ],
  quests: [],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

const model = fixture("bootstrap_merchants");
const home = model.islands.find((is) => is.buildings.some((b) => b.type === "house_merchants"))!;

const panel = (building: BuildingDisplay, island: IslandDisplay = home) =>
  renderToStaticMarkup(
    createElement(InfoPanel, {
      onClose: () => {},
      building,
      island,
      model,
      content,
      onSetPaused: () => {},
      onDemolish: () => {},
      onMove: () => {},
      onUpgrade: () => {},
      onUpgradeBuilding: () => {},
      onSelectBuilding: () => {},
      onAddField: () => {},
      nowMs: 0,
      onOrderShip: () => {},
      onCancelShipOrder: () => {},
    }),
  );

const plain = (id: number, type: string, extra: Partial<BuildingDisplay> = {}) =>
  ({ id, type, x: 1, y: 1, rotation: 0, paused: false, paused_reason: "", status: "ok", efficiency_permille: 1000, throughput_factor_permille: 1000, ...extra }) as BuildingDisplay;

describe("tier 3 in the cards (D-056)", () => {
  it("lists the brig in the shipyard after the sloop, with its cargo, upkeep and costs", () => {
    const html = panel(plain(9_001, "shipyard"));
    const t = text(html);
    expect(t.indexOf("SloopOrder")).toBeLessThan(t.indexOf("BrigOrder"));
    expect(html).toContain('data-testid="shipyard-order-brig"');
    expect(text(html.match(/data-testid="shipyard-ship-brig">(.*?)<\/button>/)![0])).toContain("Brig");
    expect(t).toContain("4×50 cargo·1.0× speed·4.0 $/min upkeep");
    expect(text(html.match(/data-testid="shipyard-cost-brig">(.*?)<\/div>/)![1]!)).toBe("1500 gold·60Planks·20Sails·10Tools·5:00 min build");
  });

  it("shows a market at level 3 of 4 (D-065) with its radius and the Patrician-locked level 4", () => {
    const html = panel(plain(9_002, "market", { level: 3 }));
    const t = text(html);
    expect(t).toContain("Level3 / 4");
    expect(t).toContain("Radius18 tiles");
    expect(t).toContain("Upgrade to level 4");
    expect(t).toContain("21 tiles radius");
    expect(t).toContain("Needs Patricians");
    expect(html).toContain('data-testid="service-upgrade-button"');
  });

  it("shows a Merchant house of the reference game: residents, its own categories with comfort, then the carried ones", () => {
    const house = home.buildings.find((b) => b.type === "house_merchants")!;
    const html = panel(house);
    const t = text(html);
    expect(t).toContain("Residents→ 25 / 25");
    const rows = [...html.matchAll(/data-testid="house-need-(?!group-)([a-z_]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual([
      "merchants_food",
      "merchants_drink",
      "merchants_clothing",
      "merchants_comfort",
      "merchants_market",
      "merchants_faith",
      "merchants_education",
      "merchants_culture",
      "merchants_safety",
      "merchants_fire_protection",
      "merchants_settlers_food",
      "merchants_settlers_clothing",
      "merchants_citizens_food",
      "merchants_citizens_drink",
      "merchants_citizens_clothing",
    ]);
    expect(t).toContain("Food (Citizens)");
    // Safety and fire protection under one Security heading (D-065), right before them.
    expect(html).toMatch(/data-testid="house-need-group-security"[^>]*><th[^>]*>Security<\/th><\/tr><tr[^>]*data-testid="house-need-merchants_safety"/);
    // A chain need names the buildings of its rank or higher (D-065).
    expect(html).toMatch(/data-testid="house-need-merchants_faith" title="Church or Cathedral/);
    // Comfort: its own icon and the server's fulfilment.
    const comfort = html.match(/data-testid="house-need-merchants_comfort"[^>]*>(.*?)<\/tr>/)![1]!;
    expect(text(comfort)).toBe("Comfort60 %");
    expect(comfort).toContain(`<path d="${ICON_PATHS["need:comfort"]}"`);
    // The civic services (D-060): one building each, served by the civic cluster; the
    // chains (D-065) by the church and the playhouse of the reference game.
    for (const [id, label] of [
      ["merchants_safety", "Safety100 %"],
      ["merchants_fire_protection", "Fire protection100 %"],
      ["merchants_faith", "Faith100 %"],
      ["merchants_culture", "Culture100 %"],
    ]) {
      const row = html.match(new RegExp(`data-testid="house-need-${id}"[^>]*>(.*?)</tr>`))![1]!;
      expect(text(row)).toBe(label);
    }
    // Every category of every Merchant house is covered (CONTENT §12).
    for (const b of home.buildings.filter((x) => x.type === "house_merchants")) {
      for (const n of b.needs ?? []) expect(n.fulfilment_permille).toBeGreaterThanOrEqual(600);
    }
  });
});
