import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { goodIcon, statusIcon, toolIcon } from "../theme/iconSet";
import { AwayDialog } from "./AwayDialog";
import { InfoPanel } from "./InfoPanel";
import { InsolvencyBanner } from "./InsolvencyBanner";
import { draftFromRoute } from "../display/routes";
import { QuestsPanel } from "./QuestsPanel";
import { RouteEditor } from "./RouteEditor";
import { TopBar } from "./TopBar";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const content = {
  tiers: [{ id: "settlers", name: "Settlers", index: 0 }],
  goods: [
    { id: "planks", name: "Planks" },
    { id: "fish", name: "Fish" },
    { id: "wood", name: "Wood" },
  ],
  buildings: [{ id: "fisher", name: "Fisher" }],
  ships: [],
  quests: [
    { id: "intro_first_road", title: "Roads from the warehouse", text: "Lay a road.", objectives: [], rewards: { gold: 25_000, goods: {} }, prerequisites: [] },
    { id: "intro_fish", title: "Fish for the table", text: "Build a fisher.", objectives: [], rewards: { gold: 0, goods: { planks: 45_000 } }, prerequisites: [] },
  ],
} as unknown as Content;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("HUD components", () => {
  describe("top bar", () => {
    const model = fixture("citizens_needs");
    const island = model.islands[0]!;
    const tbContent = {
      ...content,
      region: { id: "r", name: "R", version: "v1", rules: {} },
      tiers: [
        { id: "settlers", name: "Settlers", index: 0 },
        { id: "citizens", name: "Citizens", index: 1 },
      ],
      goods: [...content.goods, { id: "stone", name: "Stone" }],
      buildings: [
        { id: "house_settlers", name: "Settler house", width: 2, height: 2, house: { tier: "settlers" }, cost: { gold: 0, materials: { planks: 10_000 } } },
        { id: "house_citizens", name: "Citizen house", width: 2, height: 2, house: { tier: "citizens" }, cost: { gold: 0, materials: { planks: 15_000, stone: 10_000 } } },
        { id: "market_small", name: "Small market", width: 3, height: 3, cost: { gold: 0, materials: {} } },
      ],
    } as unknown as Content;
    const statics = {
      id: island.id,
      width: 2,
      height: 1,
      terrain: ["coast", "grass"],
      fertilities: ["wheat"],
      deposits: [{ x: 1, y: 0, kind: "iron" }],
      revision: "r",
    };
    const props = { model, content: tbContent, islandId: island.id, statics, onOpenIsland: () => {}, onShips: () => {}, onRoutes: () => {}, onQuests: () => {} } as const;

    it("shows the focused island with its resources, materials, employed / total and satisfaction; no island tabs", () => {
      const html = renderToStaticMarkup(createElement(TopBar, props as never));
      expect(html).not.toContain("island-tab-");
      expect(html).toContain(`data-island="${island.id}"`);
      expect(html).toContain('data-testid="hud-fertility-wheat"');
      expect(html).toContain('data-testid="hud-deposit-iron"');
      expect(text(html)).toContain("Free coast: 1 of 1 tiles");
      expect(html).toContain('data-testid="hud-material-planks"');
      expect(html).toContain('data-testid="hud-material-stone"');
      expect(html).not.toContain('data-testid="hud-material-fish"');
      expect(text(html)).toContain("18 / 88");
      expect(text(html)).toContain("81 %");
      expect(html).toContain('title="Worst unmet need: Small market 36 % (out of range)"');
      expect(text(html)).toContain("22 / 40");
    });

    it("collapses into chips on a phone", () => {
      const html = renderToStaticMarkup(createElement(TopBar, { ...props, compact: "portrait" } as never));
      for (const id of ["hud-island-chip", "hud-materials-chip", "hud-population-chip", "hud-gold", "hud-balance", "hud-ships", "hud-routes"]) expect(html).toContain(`data-testid="${id}"`);
      expect(html).not.toContain('data-testid="hud-island-details"');
    });
  });

  it("renders the insolvency banner from a fixture with unpaid buildings", () => {
    const html = renderToStaticMarkup(createElement(InsolvencyBanner, { model: fixture("away_summary_12h"), onOpenWarnings: () => {} }));
    expect(html).toContain('data-testid="insolvency-banner"');
    expect(text(html)).toContain(
      "Your city cannot afford its upkeep: −4.5 gold/min. Paused: 3 buildings. Demolish, resume manually, or grow your tax base.",
    );
  });

  it("renders no banner without unpaid buildings", () => {
    expect(renderToStaticMarkup(createElement(InsolvencyBanner, { model: fixture("chain_planks"), onOpenWarnings: () => {} }))).toBe("");
  });

  it("renders quest progress and claim buttons", () => {
    const html = renderToStaticMarkup(
      createElement(QuestsPanel, { model: fixture("away_summary_12h"), content, onClaim: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="quest-claim-intro_first_road"');
    expect(html).toContain('data-testid="quest-active-intro_fish"');
    expect(text(html)).toContain("Fisher connected to a warehouse");
    expect(text(html)).toContain("Reward: 45 Planks");
    // Advisor prose also on quests that completed before they were shown
    // as active.
    expect(text(html)).toContain("Lay a road.");
  });

  it("renders the away dialog with the interval and capacity marks", () => {
    const model = fixture("away_summary_12h");
    const html = renderToStaticMarkup(
      createElement(AwayDialog, { summary: model.away_summary!, content, islandName: (id: string) => id, onDismiss: () => {} }),
    );
    expect(text(html)).toContain("2026-01-01T00:30:00.000Z – 2026-01-01T12:30:00.000Z (12 h 0 min)");
    expect(html).toContain('data-testid="away-good-start-planks"');
    expect(text(html)).toContain("300/300at capacity");
    expect(text(html)).toContain("Settlers: 32 → 8");
    expect(text(html)).toContain("Ships arrived: 1");
  });

  describe("route editor", () => {
    const model = fixture("route_loop");
    const route = model.routes[0]!;
    const noop = () => {};
    const editor = (routeId: number | null) =>
      renderToStaticMarkup(
        createElement(RouteEditor, {
          model,
          content,
          routeId,
          draft: draftFromRoute(route),
          pickingShip: null,
          error: null,
          onChange: noop,
          onAddStop: noop,
          onRemoveStop: noop,
          onMoveStop: noop,
          onSave: noop,
          onClose: noop,
          onAssign: noop,
          onUnassign: noop,
          onCancelPick: noop,
        }),
      );

    it("renders the server's estimated effects and loop time of a saved route", () => {
      const html = editor(route.id);
      expect(text(html)).toContain("Net effect (estimated)");
      expect(text(html)).toContain("loop time 2:40");
      // route_loop: wood out of start (−100 per loop, 37.5/min), planks back (+40, 15.0/min).
      const row = (island: string, good: string) => {
        const m = html.match(new RegExp(`<tr data-testid="route-effect-${island}-${good}">(.*?)</tr>`));
        return m ? text(m[1]!) : "";
      };
      expect(row("start", "wood")).toBe("StartWood−100−37.5");
      expect(row("start", "planks")).toBe("StartPlanks+40+15.0");
      expect(row("island2", "wood")).toBe("Island 2Wood+100+37.5");
      expect(row("island2", "planks")).toBe("Island 2Planks−40−15.0");
      // Rows follow the server's order (first stop of the island, then good).
      expect(route.effects.map((e) => `${e.island_id}/${e.good}`)).toEqual(["start/planks", "start/wood", "island2/planks", "island2/wood"]);
      expect(html.indexOf("route-effect-start-planks")).toBeLessThan(html.indexOf("route-effect-island2-planks"));
      // The ship assigned to the route can be unassigned here.
      expect(html).toContain(`data-testid="route-unassign-${route.ship_ids[0]}"`);
    });

    it('shows "Save to compute" before the route is saved', () => {
      const html = editor(null);
      expect(text(html)).toContain("Save to compute");
      expect(html).not.toContain("route-effect-");
      expect(html).not.toContain("route-unassign-");
    });
  });

  describe("info panel icons", () => {
    const shipContent = {
      ...content,
      buildings: [
        { id: "shipyard", name: "Shipyard", tier: "settlers", category: "harbour", width: 2, height: 2, pause_category: "production", shipyard: { ships: ["sloop"] } },
      ],
      ships: [{ id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000, build_ms: 60_000, upkeep_per_min: 1_000, cost: { gold: 900_000, materials: { planks: 40_000, wood: 5_000 } } }],
    } as unknown as Content;
    const island = {
      id: "start",
      name: "Start",
      buildings: [],
      roads: [],
      workforce: {},
      inventory: { planks: { stock: 10_000, capacity: 100_000, in_transit: 0, rate_per_min: 0 }, wood: { stock: 9_000, capacity: 100_000, in_transit: 0, rate_per_min: 0 } },
    } as unknown as IslandDisplay;
    const model = { ...fixture("chain_planks"), gold: 100_000, balance_rate_per_min: 0 } as DisplayState;
    const panel = (b: Partial<BuildingDisplay>) => {
      const noop = () => {};
      return renderToStaticMarkup(
        createElement(InfoPanel, {
          building: { id: 7, type: "shipyard", x: 1, y: 1, rotation: 0, paused: false, paused_reason: "", status: "ok", efficiency_permille: 1000, throughput_factor_permille: 1000, ...b } as BuildingDisplay,
          island,
          model,
          content: shipContent,
          onSetPaused: noop,
          onDemolish: noop,
          onMove: noop,
          onUpgrade: noop,
          onUpgradeWarehouse: noop,
          onSelectBuilding: noop,
          onPlaceFields: noop,
          nowMs: 0,
          onOrderShip: noop,
          onCancelShipOrder: noop,
        }),
      );
    };
    const icon = (path: string) => `<path d="${path}" fill="currentColor"></path>`;

    it("puts an icon next to every good of the shipyard costs and the missing list", () => {
      const html = panel({});
      const costs = html.slice(html.indexOf('data-testid="shipyard-order-sloop"'));
      // Costs: planks and wood with their icons.
      expect(costs.split(icon(goodIcon("planks"))).length - 1).toBe(2); // cost line and missing list
      expect(costs).toContain(icon(goodIcon("wood")));
      const missing = html.match(/data-testid="shipyard-missing-sloop">(.*?)<\/div>/)![1]!;
      expect(text(missing)).toBe("Missing: 800 gold, 30 Planks");
      expect(missing).toContain(icon(goodIcon("planks")));
      expect(missing).not.toContain(icon(goodIcon("wood")));
    });

    it("shows the pause and resume buttons with icons, no glyphs", () => {
      const running = panel({}).match(/data-testid="info-pause">(.*?)<\/button>/)![1]!;
      expect(running).toContain(icon(statusIcon("paused_player")));
      expect(text(running).trim()).toBe("Pause");
      const paused = panel({ paused: true, status: "paused", paused_reason: "player" }).match(/data-testid="info-pause">(.*?)<\/button>/)![1]!;
      expect(paused).toContain(icon(toolIcon("resume")));
      expect(text(paused).trim()).toBe("Resume");
      expect(paused).not.toContain("▶");
    });
  });
});
