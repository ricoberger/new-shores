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
  tiers: [{ id: "settlers", name: "Settlers", index: 0 }],
  goods: [{ id: "wool", name: "Wool" }],
  buildings: [
    b("pasture", "Pasture", { width: 2, height: 2, cost: { gold: 15_000, materials: {} }, field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } }),
    b("lumberjack", "Lumberjack", { width: 2, height: 2, work_area: { radius: 4, terrain: ["forest"], required_tiles: 24 } }),
    b("sheep_farm", "Sheep farm", { width: 3, height: 3, pause_category: "intermediate", fields: { type: "pasture", required: 4, max: 8 } }),
    b("weaver_wool", "Wool weaver", { width: 2, height: 2 }),
  ],
  ships: [],
  quests: [],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

const panel = (building: BuildingDisplay, island: IslandDisplay, model: DisplayState) =>
  renderToStaticMarkup(
    createElement(InfoPanel, {
      building,
      island,
      model,
      content,
      onSetPaused: () => {},
      onDemolish: () => {},
      onMove: () => {},
      onUpgrade: () => {},
      onUpgradeWarehouse: () => {},
      onUpgradeTradingPost: () => {},
      onSelectBuilding: () => {},
      onAddField: () => {},
      onHoverBuilding: () => {},
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
    const order = [...html.matchAll(/data-testid="build-([a-z_]+)"/g)].map((m) => m[1]).filter((id) => id !== "menu" && !id?.startsWith("tab-"));
    expect(order).toEqual(["lumberjack", "sheep_farm", "weaver_wool"]);
    expect(html).not.toContain('data-testid="build-pasture"');
    // Every card carries its model thumbnail from the asset build (decorative).
    expect(html.match(/<img [^>]*src="\/models\/thumbs\/sheep_farm.png"[^>]*>/)?.[0]).toContain('alt=""');
  });

  it("has a committed thumbnail for every building with a model", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "models");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { models: Record<string, unknown> };
    const ids = Object.keys(manifest.models).filter((id) => !id.startsWith("decor_"));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(existsSync(join(dir, thumbUrl(id).replace("/models/", ""))), id).toBe(true);
  });

  it("shows the farm's fields row: active / required / max, a list and an Add button", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const farm = island.buildings.find((x) => x.type === "sheep_farm")!;
    const html = panel(farm, island, model);
    expect(text(html)).toContain("Fields 4 / 4");
    expect(text(html)).toContain("4 of at most 8 placed");
    expect(html).toContain('data-testid="farm-field-list"');
    for (const id of farm.fields!.ids) expect(html).toContain(`data-testid="farm-field-${id}"`);
    expect(text(html)).toContain("Add pasture (15 gold)");
    expect(html).toContain('data-testid="farm-add-field"');
    expect(html).not.toContain("disabled");
    // At the maximum the button is disabled.
    const full = { ...farm, fields: { ...farm.fields!, ids: [1, 2, 3, 4, 5, 6, 7, 8] } };
    expect(panel(full, island, model)).toMatch(/data-testid="farm-add-field"[^>]*disabled|disabled=""[^>]*data-testid="farm-add-field"/);
    // An inactive field is marked in the list.
    const first = farm.fields!.ids[0]!;
    const broken = { ...island, buildings: island.buildings.map((x) => (x.id === first ? { ...x, active: false, status: "not_adjacent" as const } : x)) };
    const inactive = panel({ ...farm, fields: { ...farm.fields!, active: 3 } }, broken, model);
    expect(text(inactive)).toContain("Fields 3 / 4");
    expect(inactive).toMatch(new RegExp(`data-testid="farm-field-${first}"[^>]*data-active="false"`));
    expect(text(inactive)).toContain("not adjacent");
  });

  it("shows a field's farm and whether it is active", () => {
    const model = fixture("settlers_grow");
    const island = model.islands[0]!;
    const farm = island.buildings.find((x) => x.type === "sheep_farm")!;
    const field = island.buildings.find((x) => x.type === "pasture")!;
    const html = panel(field, island, model);
    expect(text(html)).toContain(`Sheep farm #${farm.id}`);
    expect(text(html)).toContain("Active: it counts for its farm");
    expect(html).not.toContain('data-testid="info-pause"');
    expect(html).toContain('data-testid="info-demolish"');
    // A field cannot be moved: no Move button (the farm keeps its own).
    expect(html).not.toContain('data-testid="info-move"');
    expect(panel(farm, island, model)).toContain('data-testid="info-move"');
    const inactive = panel({ ...field, active: false, status: "not_adjacent" }, island, model);
    expect(text(inactive)).toContain("Not connected to its farm");
    expect(text(inactive)).toContain("Not adjacent: its chain to the farm is broken");
  });
});
