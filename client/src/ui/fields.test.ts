import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { BuildMenu, thumbUrl } from "./BuildMenu";
import { InfoPanel } from "./InfoPanel";
import { NO_TOOL } from "./tools";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const b = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: "settlers",
  category: "production",
  width: 1,
  height: 1,
  coastal: false,
  requires_road: false,
  cost: { gold: 0, materials: {} },
  upkeep_per_min: 0,
  pause_category: "never",
  ...extra,
});

const content = {
  tiers: [
    { id: "settlers", name: "Settlers", index: 0 },
    { id: "merchants", name: "Merchants", index: 2 },
  ],
  goods: [{ id: "wool", name: "Wool" }],
  buildings: [
    b("pasture", "Pasture", { width: 2, height: 2, cost: { gold: 15_000, materials: {} }, field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } }),
    b("lumberjack", "Lumberjack", { width: 2, height: 2 }),
    b("sheep_farm", "Sheep farm", { width: 3, height: 3, pause_category: "intermediate", fields: { type: "pasture", required: 4, max: 4 } }),
    b("weaver_wool", "Wool weaver", { width: 2, height: 2 }),
    b("warehouse", "Warehouse", {
      category: "harbour",
      width: 2,
      height: 2,
      warehouse: {
        levels: [{ throughput_per_min: 30_000 }, { throughput_per_min: 55_000, cost: { gold: 150_000, materials: { planks: 10_000, stone: 5_000 } } }, { throughput_per_min: 80_000, cost: { gold: 300_000, materials: {} } }],
      },
    }),
    b("trading_post", "Trading Post", {
      category: "harbour",
      width: 3,
      height: 3,
      trading_post: {
        levels: [{ capacity: 300_000, throughput_per_min: 30_000, berths: 1 }, { capacity: 500_000, throughput_per_min: 55_000, berths: 2, cost: { gold: 300_000, materials: { planks: 20_000 } } }],
      },
    }),
    b("tavern", "Tavern", { width: 3, height: 3, category: "public", upkeep_per_min: 6_000, pause_category: "public", service: { radius: 14, levels: [{ radius: 14 }] } }),
    b("market", "Small market", {
      width: 4,
      height: 4,
      category: "public",
      pause_category: "public",
      service: {
        radius: 12,
        levels: [{ radius: 12 }, { radius: 16, tier: "merchants", cost: { gold: 1_000_000, materials: { planks: 15_000 } } }, { radius: 20, tier: "patricians", cost: { gold: 5_000_000, materials: {} } }],
      },
    }),
  ],
  ships: [],
  quests: [],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

const panel = (building: BuildingDisplay, island: IslandDisplay, model: DisplayState) =>
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

describe("fields in the HUD (D-051 part 4)", () => {
  it("does not list fields in the build menu (they are added from their farm)", () => {
    const html = renderToStaticMarkup(
      createElement(BuildMenu, {
        content,
        model: null,
        islandId: "main",
        fertilities: [],
        tool: NO_TOOL,
        onSelect: () => {},
        onDemolishTool: () => {},
      }),
    );
    const order = [...html.matchAll(/data-testid="build-([a-z_]+)"/g)].map((m) => m[1]).filter((id) => id !== "menu" && id !== "size" && !id?.startsWith("tab-"));
    expect(order).toEqual(["lumberjack", "sheep_farm", "weaver_wool"]);
    expect(html).not.toContain('data-testid="build-pasture"');
    // Every card carries its model thumbnail from the asset build (decorative).
    expect(html.match(/<img [^>]*src="\/models\/thumbs\/sheep_farm.png"[^>]*>/)?.[0]).toContain('alt=""');
  });

  it("locks every card with Loading island… while the island's tiles load", () => {
    const html = renderToStaticMarkup(
      createElement(BuildMenu, {
        content,
        model: null,
        islandId: "main",
        fertilities: [],
        loading: true,
        tool: NO_TOOL,
        onSelect: () => {},
        onDemolishTool: () => {},
      }),
    );
    for (const id of ["lumberjack", "sheep_farm", "weaver_wool"]) {
      expect(html.match(new RegExp(`<button[^>]*data-testid="build-${id}"[^>]*>`))?.[0]).toContain("disabled");
      expect(html).toContain(`data-testid="build-lock-${id}">Loading island…</span>`);
    }
  });

  it("has a committed thumbnail for every building with a model", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "models");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { models: Record<string, unknown> };
    const ids = Object.keys(manifest.models).filter((id) => !id.startsWith("decor_"));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(existsSync(join(dir, thumbUrl(id).replace("/models/", ""))), id).toBe(true);
  });

  it("shows the farm's fields block: placed of the maximum, not connected fields and the Paint button (D-054)", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const farm = island.buildings.find((x) => x.type === "sheep_farm")!;
    const html = panel(farm, island, model);
    // The bar is the farm's Efficiency (Details); the block counts the fields placed of the maximum.
    expect(text(html)).not.toContain("Fields 4 / 4");
    expect(html).toContain('data-testid="farm-fields-count"');
    expect(text(html)).toContain("4 / 4 placed");
    // The cycle, efficiency, workers and transfer rows sit in a collapsed Details section.
    expect(html).toMatch(/<details[^>]*data-testid="info-details"(?![^>]*\bopen\b)/);
    expect(text(html)).toContain("Upkeep");
    expect(html).toContain('data-testid="info-upkeep"');
    // No field list and no warning while every field is connected.
    expect(html).not.toContain('data-testid="farm-field-list"');
    expect(html).not.toContain("farm-fields-inactive");
    // Paint stays at the maximum (its right click / long press removes fields); the price only while fields fit.
    expect(html).toContain('data-testid="farm-add-field"');
    expect(text(html)).toContain("Paint pasture");
    expect(text(html)).not.toContain("gold each");
    expect(html).toContain('data-testid="farm-remove-hint"');
    const short = { ...farm, fields: { ...farm.fields!, active: 3, ids: [1, 2, 3] } };
    const shortHtml = panel(short, island, model);
    expect(text(shortHtml)).toContain("3 / 4 placed");
    expect(text(shortHtml)).toContain("Paint pasture (15 gold each)");
    expect(shortHtml).not.toContain("disabled");
    // An inactive field is counted in a warning line.
    const first = farm.fields!.ids[0]!;
    const broken = { ...island, buildings: island.buildings.map((x) => (x.id === first ? { ...x, active: false, status: "not_adjacent" as const } : x)) };
    const inactive = panel({ ...farm, fields: { ...farm.fields!, active: 3 } }, broken, model);
    expect(text(inactive)).toContain("4 / 4 placed");
    expect(text(inactive)).toContain("1 not connected to the farm");
  });

  it("shows whether a field counts for its farm", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const farm = island.buildings.find((x) => x.type === "sheep_farm")!;
    const field = island.buildings.find((x) => x.type === "pasture")!;
    const html = panel(field, island, model);
    // No link to the farm: the status sentence says it all.
    expect(html).not.toContain('data-testid="field-farm');
    expect(text(html)).not.toContain("Farm");
    expect(text(html)).toContain("Counts for its farm");
    expect(text(html)).not.toContain("Running");
    expect(html).not.toContain('data-testid="info-pause"');
    expect(html).toContain('data-testid="info-demolish"');
    // A field cannot be moved: no Move button (the farm keeps its own).
    expect(html).not.toContain('data-testid="info-move"');
    expect(panel(farm, island, model)).toContain('data-testid="info-move"');
    const inactive = panel({ ...field, active: false, status: "not_adjacent" }, island, model);
    expect(text(inactive)).toContain("Not connected to its farm");
    expect(text(inactive)).not.toContain("Counts for its farm");
  });

  it("shows the radius and upkeep of a service building in a collapsed Details", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const tavern = { ...island.buildings[0]!, id: 9_999, type: "tavern", paused: false } as unknown as BuildingDisplay;
    delete (tavern as { rates?: unknown }).rates;
    delete (tavern as { residents?: unknown }).residents;
    const html = panel(tavern, island, model);
    expect(html).toMatch(/<details[^>]*data-testid="info-details"(?![^>]*\bopen\b)/);
    expect(text(html)).toContain("Radius14 tiles");
    expect(text(html)).toContain("Upkeep6.0 $/min");
    expect(text(panel({ ...tavern, paused: true }, island, model))).toContain("Upkeep0.0 $/min");
  });

  it("shows a levelled market's level, radius and next level with its tier lock, with Upgrade in the footer (D-056)", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const market = { ...island.buildings[0]!, id: 9_998, type: "market", level: 1, paused: false } as unknown as BuildingDisplay;
    delete (market as { rates?: unknown }).rates;
    delete (market as { residents?: unknown }).residents;
    const t = text(panel(market, island, model));
    expect(t).toContain("Level1 / 3");
    expect(t).toContain("Radius12 tiles");
    expect(t).toContain("Upgrade to level 2");
    expect(t).toContain("16 tiles radius");
    expect(t).toContain("Needs Merchants");
    expect(panel(market, island, model)).toContain('data-testid="service-upgrade-button"');
    const top = text(panel({ ...market, level: 3 } as BuildingDisplay, island, model));
    expect(top).toContain("Radius20 tiles");
    expect(top).not.toContain("Upgrade to level");
  });

  it("shows the warehouse as rows, its producers and the next level, with Upgrade in the footer", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const base = island.buildings[0]!;
    const wh = { ...base, id: 8_001, type: "warehouse", level: 1, throughput_per_min: 30_000, load_permille: 400 } as unknown as BuildingDisplay;
    const producers = [1, 2].map((n) => ({ ...base, id: 8_100 + n, type: "lumberjack", assigned_warehouse_id: 8_001, rates: { inputs: {}, outputs: {} } }) as unknown as BuildingDisplay);
    const withProducers = { ...island, buildings: [...island.buildings, wh, ...producers] };
    const html = panel(wh, withProducers, model);
    const t = text(html);
    expect(t).toContain("DetailsLevel1 / 3");
    expect(t).toContain("Throughput30.0/min");
    expect(t).toContain("Load40 %");
    expect(t).toContain("Producers (2)");
    // The producers are collapsed by default.
    expect(html).toMatch(/<details[^>]*data-testid="collector-producers"(?![^>]*\bopen\b)/);
    expect(t).not.toContain("#8100");
    expect(html).toContain('data-testid="collector-producer-8101"');
    expect(t).toContain("Upgrade to level 2");
    expect(t).toContain("55.0/min throughput");
    expect(t).not.toContain("adds no capacity");
    // The button is pinned in the footer: after the preview, next to Move.
    expect(html.indexOf("warehouse-upgrade-button")).toBeGreaterThan(html.indexOf("Upgrade to level"));
    expect(html.indexOf("warehouse-upgrade-button")).toBeLessThan(html.indexOf("info-move"));
    expect(html.match(/warehouse-upgrade-button/g)).toHaveLength(1);
    // No next level at the top: no preview and no button.
    const top = panel({ ...wh, level: 3 }, withProducers, model);
    expect(text(top)).not.toContain("Upgrade to level");
    expect(top).not.toContain("warehouse-upgrade-button");
    // No producer: a hint instead of a list.
    expect(text(panel(wh, island, model))).toContain("Producers (0)None yet");
  });

  it("shows the Trading Post as rows: details, pier, inventory and the next level", () => {
    const model = fixture("settlers_grow");
    const island = { ...model.islands[0]!, inventory: { wool: { stock: 120_000, capacity: 300_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: -1_000 } } } as IslandDisplay;
    const tp = {
      ...island.buildings[0]!,
      id: 8_201,
      type: "trading_post",
      level: 1,
      capacity: 300_000,
      throughput_per_min: 30_000,
      load_permille: 400,
      berths: { total: 2, busy: 1, ships: [1], queue: [2] },
    } as unknown as BuildingDisplay;
    const html = panel(tp, island, model);
    const t = text(html);
    expect(t).toContain("DetailsLevel1 / 2Capacity300 per goodThroughput30.0/minLoad40 %Berths1 / 2 free");
    expect(t).toContain("PierShip #1at the pierShip #2waiting");
    expect(t).toContain("InventoryWool120 / 300−1.0Producers (0)");
    expect(t).toContain("Upgrade to level 2500 capacity per good·2 berths·55.0/min throughput");
    expect(t).not.toContain("Net/min");
    // Net rate: red below 0, green above, plain at 0 (and when it rounds to 0.0).
    const net = (rate: number) => {
      const inv = { ...island, inventory: { wool: { stock: 0, capacity: 300_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: rate } } } as IslandDisplay;
      return panel(tp, inv, model).match(/<td class="([^"]*)" data-testid="trading-post-net-wool"/)?.[1] ?? "";
    };
    expect(net(-1_000)).toMatch(/negative/);
    expect(net(2_000)).toMatch(/positive/);
    expect(net(0)).toBe("");
    expect(net(40)).toBe("");
    expect(html).not.toContain("trading-post-queue");
    // The button is pinned in the footer; no pier section without ships.
    expect(html.indexOf("trading-post-upgrade-button")).toBeGreaterThan(html.indexOf("Upgrade to level"));
    const empty = panel({ ...tp, berths: { total: 2, busy: 0, ships: [], queue: [] } }, island, model);
    expect(empty).not.toContain('data-testid="trading-post-pier"');
    expect(text(empty)).toContain("Berths2 / 2 free");
    // The last level: no preview, no button.
    const top = panel({ ...tp, level: 2 }, island, model);
    expect(text(top)).not.toContain("Upgrade to level");
    expect(top).not.toContain("trading-post-upgrade-button");
  });
});
