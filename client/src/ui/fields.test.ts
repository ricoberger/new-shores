import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { BuildMenu } from "./BuildMenu";
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
  tiers: [{ id: "settlers", name: "Settlers", index: 0 }],
  goods: [{ id: "wool", name: "Wool" }],
  buildings: [
    b("pasture", "Pasture", { field: { type: "pasture", terrain: ["grass"] } }),
    b("lumberjack", "Lumberjack", { width: 2, height: 2, work_area: { radius: 4, terrain: ["forest"], required_tiles: 24 } }),
    b("sheep_farm", "Sheep farm", { width: 3, height: 3, pause_category: "intermediate", work_area: { radius: 4 }, fields: { type: "pasture", required: 16 } }),
    b("weaver_wool", "Wool weaver", { width: 2, height: 2 }),
  ],
  ships: [],
  quests: [],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("fields in the HUD (D-049)", () => {
  it("lists fields in Production right after their farm", () => {
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
    // Only Production is present, so it is shown.
    const order = [...html.matchAll(/data-testid="build-([a-z_]+)"/g)].map((m) => m[1]).filter((id) => id !== "menu" && !id?.startsWith("tab-"));
    expect(order).toEqual(["lumberjack", "sheep_farm", "pasture", "weaver_wool"]);
    expect(html).toContain('data-testid="build-tab-production"');
  });

  it("shows the farm's field count and a place button, and a field's farm", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const farm = island.buildings.find((x) => x.type === "sheep_farm")!;
    const html = renderToStaticMarkup(
      createElement(InfoPanel, {
        building: farm,
        island,
        model,
        content,
        onSetPaused: () => {},
        onDemolish: () => {},
        onMove: () => {},
        onUpgrade: () => {},
        onUpgradeWarehouse: () => {},
        onSelectBuilding: () => {},
        onPlaceFields: () => {},
        nowMs: 0,
        onOrderShip: () => {},
        onCancelShipOrder: () => {},
      }),
    );
    expect(text(html)).toContain("Fields 16 / 16");
    expect(text(html)).toContain("Place pastures 16 / 16");
    expect(html).toContain('data-testid="farm-place-fields"');

    const field = island.buildings.find((x) => x.type === "pasture")!;
    const fieldHtml = renderToStaticMarkup(
      createElement(InfoPanel, {
        building: field,
        island,
        model,
        content,
        onSetPaused: () => {},
        onDemolish: () => {},
        onMove: () => {},
        onUpgrade: () => {},
        onUpgradeWarehouse: () => {},
        onSelectBuilding: () => {},
        onPlaceFields: () => {},
        nowMs: 0,
        onOrderShip: () => {},
        onCancelShipOrder: () => {},
      }),
    );
    expect(text(fieldHtml)).toContain(`Sheep farm #${farm.id}`);
    expect(fieldHtml).not.toContain('data-testid="info-pause"');
    expect(fieldHtml).toContain('data-testid="info-move"');
    expect(fieldHtml).toContain('data-testid="info-demolish"');
    const orphan = renderToStaticMarkup(
      createElement(InfoPanel, {
        building: { ...field, farm_id: undefined, status: "no_farm" },
        island,
        model,
        content,
        onSetPaused: () => {},
        onDemolish: () => {},
        onMove: () => {},
        onUpgrade: () => {},
        onUpgradeWarehouse: () => {},
        onSelectBuilding: () => {},
        onPlaceFields: () => {},
        nowMs: 0,
        onOrderShip: () => {},
        onCancelShipOrder: () => {},
      }),
    );
    expect(text(orphan)).toContain("No farm in range");
    expect(text(orphan)).toContain("No accepting farm in range");
  });
});
