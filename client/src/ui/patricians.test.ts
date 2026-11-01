import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, ContentBuilding, DisplayState, IslandDisplay } from "../api/client";
import { tierRows } from "../display/hud";
import { ICON_PATHS } from "../theme/icons";
import { InfoPanel } from "./InfoPanel";
import { PopulationDetails } from "./TopBar";

// Tier 4 in the cards (D-056 C4): the galleon in the shipyard, a market at
// its last level 3 and a Patrician house with its own five categories and
// the three lower tiers' categories, against the shipped content's needs,
// names and ships.
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

type ShippedShip = { id: string; name: string; tier: string; slots: number; slot_size: number; build_seconds: number; upkeep_per_min: number; cost: Record<string, number> };
// The shipped ships in the API's units (milli, ms; materials apart from gold).
const ships = shipped<ShippedShip[]>("ships.json").map((s) => {
  const { gold, ...materials } = s.cost;
  return {
    id: s.id,
    name: s.name,
    tier: s.tier,
    slots: s.slots,
    slot_size: s.slot_size * 1000,
    build_ms: s.build_seconds * 1000,
    upkeep_per_min: s.upkeep_per_min * 1000,
    cost: { gold: (gold ?? 0) * 1000, materials: Object.fromEntries(Object.entries(materials).map(([g, v]) => [g, v * 1000])) },
  };
});

const content = {
  tiers: shipped<{ id: string; name: string }[]>("tiers.json").map((t, index) => ({ id: t.id, name: t.name, index })),
  goods: shipped<{ id: string; name: string }[]>("goods.json"),
  needs: shipped<{ id: string; name: string }[]>("needs.json"),
  need_categories: shipped<{ id: string; name: string; icon: string }[]>("need_categories.json"),
  buildings: [
    def("shipyard", "Shipyard", { tier: "citizens", category: "harbour", width: 8, height: 12, shipyard: { ships: ["sloop", "brig", "galleon"] } }),
    def("market", "Market", {
      width: 5,
      height: 6,
      service: {
        radius: 12,
        levels: [
          { radius: 12 },
          { radius: 16, tier: "merchants", cost: { gold: 1_000_000, materials: { planks: 15_000, stone: 30_000 } } },
          { radius: 20, tier: "patricians", cost: { gold: 5_000_000, materials: { planks: 15_000, stone: 45_000, bricks: 15_000 } } },
        ],
      },
    }),
    def("house_settlers", "Settler house", { category: "housing", house: { tier: "settlers" } }),
    def("house_citizens", "Citizen house", { tier: "citizens", category: "housing", house: { tier: "citizens" } }),
    def("house_merchants", "Merchant house", { tier: "merchants", category: "housing", house: { tier: "merchants" } }),
    def("house_patricians", "Patrician house", { tier: "patricians", category: "housing", width: 3, height: 3, house: { tier: "patricians" } }),
  ],
  ships,
  quests: [],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

// A full Patrician house as the server reports it: the needs in payload
// order (own categories, market, chains and security, then the lower
// tiers'), luxury the
// worst at 60 % (one of two alternatives).
type NeedEntry = { id: string; category?: string };
const patricianNeeds = (shipped<(NeedEntry & { tier: string })[]>("needs.json")).filter((n) => n.tier === "patricians");
const house: BuildingDisplay = {
  id: 9_100,
  type: "house_patricians",
  x: 10,
  y: 10,
  rotation: 0,
  paused: false,
  paused_reason: "",
  status: "ok",
  efficiency_permille: 1000,
  throughput_factor_permille: 1000,
  residents: 40_000,
  residents_floor: 12_000,
  residents_max: 40_000,
  growth_progress_permille: 0,
  growth_rate_per_min: 0,
  satisfaction_permille: 880,
  tax_rate_per_min: 108_000,
  needs: patricianNeeds.map((n) => ({
    id: n.id,
    kind: "required",
    category: n.category,
    fulfilment_permille: n.id === "patricians_luxury" ? 600 : 1000,
    reason: "ok",
  })),
} as unknown as BuildingDisplay;

const model = fixture("bootstrap_merchants");
const base = model.islands.find((is) => is.buildings.some((b) => b.type === "house_merchants"))!;
const home: IslandDisplay = { ...base, buildings: [...base.buildings, house], population: { ...base.population, patricians: 40_000 } };

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

describe("tier 4 in the cards (D-056 C4)", () => {
  it("lists the galleon in the shipyard after the brig, with its cargo, upkeep and costs", () => {
    const html = panel(plain(9_001, "shipyard"));
    const t = text(html);
    expect(t.indexOf("SloopOrder")).toBeLessThan(t.indexOf("BrigOrder"));
    expect(t.indexOf("BrigOrder")).toBeLessThan(t.indexOf("GalleonOrder"));
    expect(html).toContain('data-testid="shipyard-order-galleon"');
    expect(text(html.match(/data-testid="shipyard-ship-galleon">(.*?)<\/button>/)![0])).toContain("Galleon");
    expect(t).toContain("6×60 cargo·1.0× speed·8.0 $/min upkeep");
    expect(text(html.match(/data-testid="shipyard-cost-galleon">(.*?)<\/div>/)![1]!)).toBe("6000 gold·120Planks·40Sails·30Tools·10:00 min build");
  });

  it("shows a market at level 3, its last, with radius 20 and no upgrade", () => {
    const html = panel(plain(9_002, "market", { level: 3 }));
    const t = text(html);
    expect(t).toContain("Level3 / 3");
    expect(t).toContain("Radius20 tiles");
    expect(t).not.toContain("Upgrade to level");
    expect(html).not.toContain('data-testid="service-upgrade-button"');
  });

  it("shows a Patrician house: its five categories, the market, the chains and the Security group, then the three lower tiers' categories, ungrouped", () => {
    const html = panel(house);
    const t = text(html);
    expect(t).toContain("Residents→ 40 / 40");
    const rows = [...html.matchAll(/data-testid="house-need-(?!group-)([a-z_]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual([
      "patricians_food",
      "patricians_drink",
      "patricians_clothing",
      "patricians_comfort",
      "patricians_luxury",
      "patricians_market",
      "patricians_faith",
      "patricians_education",
      "patricians_culture",
      "patricians_safety",
      "patricians_fire_protection",
      "patricians_health",
      "patricians_settlers_food",
      "patricians_settlers_clothing",
      "patricians_citizens_food",
      "patricians_citizens_drink",
      "patricians_citizens_clothing",
      "patricians_merchants_food",
      "patricians_merchants_drink",
      "patricians_merchants_clothing",
      "patricians_merchants_comfort",
    ]);
    // One flat list but for the Security heading (D-065): each carried row names its tier; no tier headings.
    for (const label of ["Food (Settlers)", "Clothing (Settlers)", "Drink (Citizens)", "Comfort (Merchants)"]) expect(t).toContain(label);
    expect(html.match(/<tr[^>]*data-testid="house-need-(?!group-)/g)).toHaveLength(21);
    expect(html.match(/data-testid="house-need-group-[a-z_]+"/g)).toEqual(['data-testid="house-need-group-security"']);
    expect(html).not.toMatch(/<th[^>]*>(Settlers|Citizens|Merchants)<\/th>/);
    // Luxury: its own icon and the server's fulfilment.
    const luxury = html.match(/data-testid="house-need-patricians_luxury"[^>]*>(.*?)<\/tr>/)![1]!;
    expect(text(luxury)).toBe("Luxury60 %");
    expect(luxury).toContain(`<path d="${ICON_PATHS["need:luxury"]}"`);
  });

  it("names luxury with its icon as the Patricians' worst need in the population details", () => {
    const defs = new Map((content.buildings as ContentBuilding[]).map((b) => [b.id, b]));
    const rows = tierRows(home, content, defs);
    const html = renderToStaticMarkup(createElement(PopulationDetails, { rows, content, islandName: "Home" }));
    const worst = html.match(/data-testid="hud-worst-need-patricians"[^>]*>(.*?)<\/span>/)![1]!;
    expect(text(worst)).toContain("Luxury 60 %");
    expect(worst).toContain(`<path d="${ICON_PATHS["need:luxury"]}"`);
    expect(text(html.match(/data-testid="hud-tier-patricians"[^>]*>(.*?)<\/div>/)![1]!)).toContain("88 %");
  });
});
