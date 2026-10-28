import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { goodIcon, statusIcon, toolIcon } from "../theme/iconSet";
import { AwayDialog } from "./AwayDialog";
import { BuildMenu } from "./BuildMenu";
import { NO_TOOL } from "./tools";
import { FoundingPanel } from "./FoundingPanel";
import { InfoPanel } from "./InfoPanel";
import { InsolvencyBanner } from "./InsolvencyBanner";
import { Minimap } from "./Minimap";
import { IslandCard } from "./IslandCard";
import { draftFromRoute } from "../display/routes";
import { QuestsPanel } from "./QuestsPanel";
import { RouteEditor } from "./RouteEditor";
import { RoutesPanel } from "./RoutesPanel";
import { units } from "../display/format";
import { tierRows } from "../display/hud";
import { SideDock } from "./SideDock";
import { GoldDetails, PopulationDetails, TopBar } from "./TopBar";
import { warningEntries, WarningsPanel } from "./WarningsPanel";

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
    const props = { model, content: tbContent, islandId: island.id, statics, onOpenIsland: () => {} } as const;
    const rows = tierRows(island, tbContent, new Map(tbContent.buildings.map((b) => [b.id, b])));

    it("shows icons and numbers for the focused island: gold, residents, materials, and the island in the middle; no island tabs", () => {
      const html = renderToStaticMarkup(createElement(TopBar, props as never));
      expect(html).not.toContain("island-tab-");
      expect(html).toContain(`data-island="${island.id}"`);
      expect(html).toContain('data-testid="hud-gold"');
      expect(html).toContain('data-testid="hud-population-chip"');
      expect(html).toContain('data-testid="hud-fertility-wheat"');
      expect(html).toContain('data-testid="hud-deposit-iron"');
      expect(html).toContain('data-testid="hud-material-planks"');
      expect(html).toContain('data-testid="hud-material-stone"');
      expect(html).not.toContain('data-testid="hud-material-fish"');
      // Details stay in the popups until opened; the bar has no tier rows, satisfaction or balance.
      for (const id of ["hud-gold-chip-details", "hud-population-chip-details", "hud-tier-settlers", "hud-satisfaction-settlers", "hud-balance", "hud-ships", "hud-routes", "hud-quests"]) {
        expect(html).not.toContain(`data-testid="${id}"`);
      }
      expect(text(html)).not.toContain("unsettled");
      expect(text(html)).toContain(`${units(rows.reduce((n, r) => n + r.total, 0))}Residents`);
    });

    it("shows the population details per tier: employed / total, satisfaction and the worst unmet need", () => {
      const html = renderToStaticMarkup(createElement(PopulationDetails, { rows, content: tbContent, islandName: "Start" }));
      expect(text(html)).toContain("18 / 88");
      expect(text(html)).toContain("81 %");
      expect(text(html)).toContain("Worst unmet need: Small market 36 % (out of range)");
      expect(text(html)).toContain("22 / 40");
    });

    it("marks a tier short of workers in the population details and turns the number red", () => {
      const short = { ...model, islands: [{ ...island, workforce: { ...island.workforce, settlers: { required: 100_000, available: 88_000 } } }, ...model.islands.slice(1)] };
      const shortRows = tierRows(short.islands[0] as never, tbContent, new Map(tbContent.buildings.map((b) => [b.id, b])));
      const details = text(renderToStaticMarkup(createElement(PopulationDetails, { rows: shortRows, content: tbContent, islandName: "Start" })));
      expect(details).toContain("Short of workers: 12 jobs unfilled (100 needed)");
      // Between the tier's numbers and its worst unmet need.
      expect(details.indexOf("Short of workers")).toBeLessThan(details.indexOf("Worst unmet need"));
      expect(text(renderToStaticMarkup(createElement(PopulationDetails, { rows, content: tbContent, islandName: "Start" })))).not.toContain("Short of workers");
      const bar = (m: typeof model) => renderToStaticMarkup(createElement(TopBar, { ...props, model: m } as never));
      expect(bar(short as never)).toMatch(/negative[^"]*"[^>]*data-testid="hud-population"/);
      expect(bar(model)).not.toMatch(/negative[^"]*"[^>]*data-testid="hud-population"/);
    });

    it("shows the current gold and the coloured balance on one line each", () => {
      const gold = (balance: number) => renderToStaticMarkup(createElement(GoldDetails, { model: { ...model, gold: 5_000, balance_rate_per_min: balance } as never }));
      expect(text(gold(12_000))).toContain("Current5");
      expect(text(gold(12_000))).toContain("Balance▲ +12.0/min");
      expect(text(gold(-4_500))).toContain("Balance▼ −4.5/min");
      expect(text(gold(0))).toContain("Balance0.0/min");
      expect(text(gold(-4_500))).not.toMatch(/taxes|shrinking|rising/);
    });

    it("shows the island's resources on the island card", () => {
      const noop = () => {};
      const card = (st: typeof statics | undefined) =>
        renderToStaticMarkup(
          createElement(IslandCard, { islandId: island.id, model, content: tbContent, statics: st as never, onClose: noop, onRename: () => Promise.resolve(true) }),
        );
      const html = card(statics);
      expect(html).toContain('data-testid="island-card-fertility-wheat"');
      expect(text(html)).toContain("Iron deposit (1 tile)");
      expect(text(html)).toContain("Free coast: 1 of 1 tiles");
      expect(text(card({ ...statics, fertilities: [], deposits: [] }))).toContain("No fertility or deposit");
      expect(text(card(undefined))).toContain("ResourcesLoading…");
      // Population of every tier; no status, fill, warnings, ships or buttons.
      for (const t of tbContent.tiers) expect(html).toContain(`data-testid="island-card-population-${t.id}"`);
      expect(html).not.toMatch(/<button[^>]*data-testid="island-card-(enter|new-route|found)/);
      expect(text(html)).not.toMatch(/Settled|Trading Post fill|Warnings|Ships here/);
    });

    it("shows the size class and the rename pencil of a settled island (D-053)", () => {
      const classes = { ...tbContent, size_classes: [{ id: "medium", name: "Medium", rock: false }, { id: "rock", name: "Resource rock", rock: true }] };
      const card = (is: typeof island) =>
        renderToStaticMarkup(
          createElement(IslandCard, {
            islandId: is.id,
            model: { ...model, islands: [is, ...model.islands.filter((i) => i.id !== is.id)] },
            content: classes as never,
            statics: undefined,
            onClose: () => {},
            onRename: () => Promise.resolve(true),
          }),
        );
      const medium = card({ ...island, size_class: "medium", rock: false, settled: true });
      expect(text(medium)).toContain("Medium island");
      expect(medium).toMatch(/<button[^>]*aria-label="Rename the island"[^>]*data-testid="island-rename"/);
      const rock = card({ ...island, size_class: "rock", rock: true, settled: false });
      expect(text(rock)).toContain("Resource rock");
      expect(text(rock)).not.toContain("Resource rock island");
      expect(rock).not.toContain('data-testid="island-rename"');
      expect(card({ ...island, size_class: "", rock: false })).not.toContain('data-testid="island-card-kind"');
      const bar = renderToStaticMarkup(
        createElement(TopBar, { ...props, content: classes, model: { ...model, islands: [{ ...island, size_class: "medium" }, ...model.islands.slice(1)] } } as never),
      );
      // The top bar shows the name and resources only; the size class is the card's.
      expect(bar).toContain('data-testid="hud-island-name"');
      expect(bar).not.toContain("hud-island-kind");
      expect(text(bar)).not.toContain("Medium");
    });

    it("renames with icon buttons, the cancel icon in the close button's place", () => {
      const html = renderToStaticMarkup(
        createElement(IslandCard, {
          islandId: island.id,
          model: { ...model, islands: [{ ...island, settled: true }, ...model.islands.filter((i) => i.id !== island.id)] },
          content: tbContent as never,
          statics: undefined,
          onClose: () => {},
          onRename: () => Promise.resolve(true),
          initiallyRenaming: true,
        }),
      );
      expect(html).toContain('data-testid="island-rename-form"');
      expect(html).toMatch(/<button type="submit"[^>]*aria-label="Rename"[^>]*data-testid="island-rename-save"><svg/);
      expect(html).toMatch(/<button type="button"[^>]*aria-label="Cancel renaming"[^>]*data-testid="island-rename-cancel"><svg/);
      // Icons only, no text buttons; one cross per row.
      expect(text(html)).not.toMatch(/Rename|cancel/i);
      expect(html).not.toContain('data-testid="island-card-close"');
    });

    it("keeps the same stats on a phone, with the island on its own row", () => {
      const html = renderToStaticMarkup(createElement(TopBar, { ...props, compact: "portrait" } as never));
      for (const id of ["hud-gold-chip", "hud-population-chip", "hud-materials-chip", "hud-island-name"]) expect(html).toContain(`data-testid="${id}"`);
    });
  });

  it("shows the side dock with counts only above zero and marks the open panel", () => {
    const dock = (active: "none" | "ships", counts: Record<"warnings" | "quests" | "ships" | "routes", number>) =>
      renderToStaticMarkup(createElement(SideDock, { active, onToggle: () => {}, counts, buildOpen: false, onToggleBuild: () => {} }));
    const html = dock("ships", { warnings: 25, quests: 0, ships: 2, routes: 0 });
    for (const id of ["build", "warnings", "quests", "ships", "routes"]) expect(html).toContain(`data-testid="dock-${id}"`);
    expect(html).toContain('data-testid="dock-warnings-count"');
    expect(html).toContain('data-testid="dock-ships-count"');
    expect(html).not.toContain('data-testid="dock-quests-count"');
    expect(html).not.toContain('data-testid="dock-routes-count"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    const open = renderToStaticMarkup(createElement(SideDock, { active: "none", onToggle: () => {}, counts: { warnings: 0, quests: 0, ships: 0, routes: 0 }, buildOpen: true, onToggleBuild: () => {} }));
    expect(open.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(dock("none", { warnings: 0, quests: 0, ships: 0, routes: 0 })).not.toContain('aria-pressed="true"');
  });

  describe("founding panel", () => {
    const panel = (over: Partial<Parameters<typeof FoundingPanel>[0]>) =>
      renderToStaticMarkup(
        createElement(FoundingPanel, {
          name: "Mistle Haven",
          seafaring: true,
          detail: "Ship #1 sails there first.",
          pending: null,
          onCancelPending: () => {},
          onFound: () => {},
          onReroll: () => {},
          sheet: false,
          ...over,
        }),
      );
    const buttons = ['data-testid="found-settlement-here"', 'data-testid="reroll-archipelago"'];

    it("shows the full text and both buttons on the desktop, without a chevron: the start dialog centred, a later island's docked", () => {
      const html = panel({});
      expect(html).toContain('data-testid="seafaring-panel"');
      expect(html).toContain('data-placement="centred"');
      expect(panel({ seafaring: false })).toContain('data-placement="docked"');
      expect(panel({ sheet: true })).toContain('data-placement="sheet"');
      expect(html).toContain('data-testid="seafaring-hint"');
      expect(html).toContain("Ship #1 sails there first.");
      for (const b of buttons) expect(html).toContain(b);
      expect(html).not.toContain('data-testid="founding-expand"');
    });

    it("collapses to one line with the buttons on a phone and expands with the chevron", () => {
      const collapsed = panel({ sheet: true });
      expect(collapsed).toContain('data-testid="founding-line"');
      expect(collapsed).toContain('aria-expanded="false"');
      expect(collapsed).not.toContain('data-testid="seafaring-hint"');
      expect(collapsed).not.toContain("Ship #1 sails there first.");
      for (const b of buttons) expect(collapsed).toContain(b);
      const expanded = panel({ sheet: true, initiallyExpanded: true });
      expect(expanded).toContain('aria-expanded="true"');
      expect(expanded).toContain('data-testid="seafaring-hint"');
      for (const b of buttons) expect(expanded).toContain(b);
    });

    it("names the island on the line of a later unsettled island, and a pending founding replaces Found", () => {
      const html = panel({ sheet: true, seafaring: false, pending: "Ship #1 sails to Mistle Haven", onReroll: undefined });
      expect(html).toContain('data-testid="unsettled-panel"');
      expect(html).toContain("<strong>Mistle Haven</strong> is not settled.");
      expect(html).toContain('data-testid="pending-founding"');
      expect(html).not.toContain('data-testid="found-settlement-here"');
      expect(html).not.toContain('data-testid="reroll-archipelago"');
    });
  });

  it("lists the warnings in a panel", () => {
    const model = fixture("away_summary_12h");
    const entries = warningEntries(model, content);
    expect(entries.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(createElement(WarningsPanel, { model, content, onFocus: () => {}, onClose: () => {} }));
    expect(html).toContain('data-testid="warnings-panel"');
    expect(html.match(/data-testid="warning-entry"/g)).toHaveLength(entries.length);
    // Panels close with an icon button, not a text link.
    expect(html).toMatch(/<button[^>]*aria-label="Close"[^>]*data-testid="warnings-close"/);
    expect(html).not.toMatch(/>\s*close\s*</i);
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
    expect(text(html)).toContain("Fisher connected to the Trading Post or a Warehouse");
    expect(text(html)).toContain("Reward: 45 Planks");
    // Advisor prose also on quests that completed before they were shown
    // as active.
    expect(text(html)).toContain("Lay a road.");
  });

  it("renders the away dialog with a readable interval, the overview, island and ships headings and no capacity badge", () => {
    const model = fixture("away_summary_12h");
    const html = renderToStaticMarkup(
      createElement(AwayDialog, { summary: model.away_summary!, content, islandName: (id: string) => id, timeZone: "UTC", onDismiss: () => {} }),
    );
    expect(text(html)).toContain("1 Jan, 00:30 – 12:30 (12 h 0 min)");
    expect(html).toContain('data-testid="away-good-start-planks"');
    expect(text(html)).toContain("Planks15800300/300Wood");
    expect(text(html)).not.toContain("at capacity");
    expect(text(html)).toContain("OverviewGold: 258 → 26 (−232)Settlers: 32 → 8startGood");
    expect(text(html)).toContain("Ships arrived (1)Ship #1: 1 arrival (island2)");
    // Each island's name is a section heading (no "Islands" heading above them).
    expect(html).toMatch(/<div class="[^"]*sectionTitle[^"]*" data-testid="away-island-start">start<\/div>/);
    expect(text(html)).not.toContain("Islands");
    // The signature row carries the title's brass divider.
    expect(html).toMatch(/<div class="[^"]*letterEnd[^"]*" data-testid="away-end"><span[^>]*>Your humble advisor/);
  });

  it("lists the tiers unlocked while away with the server's building count", () => {
    const model = fixture("away_unlock");
    expect(model.away_summary?.tiers_unlocked).toEqual([{ id: "citizens", buildings: 15 }]);
    const c = { ...content, tiers: [...content.tiers, { id: "citizens", name: "Citizens", index: 1 }] } as unknown as Content;
    const html = renderToStaticMarkup(createElement(AwayDialog, { summary: model.away_summary!, content: c, islandName: (id: string) => id, timeZone: "UTC", onDismiss: () => {} }));
    expect(html).toContain('data-testid="away-unlocks"');
    expect(text(html)).toContain("Citizens unlocked — 15 new buildings");
    // No unlock, no line.
    const none = renderToStaticMarkup(createElement(AwayDialog, { summary: fixture("away_summary_12h").away_summary!, content, islandName: (id: string) => id, timeZone: "UTC", onDismiss: () => {} }));
    expect(none).not.toContain("away-unlocks");
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
          error: null,
          onChange: noop,
          onAddStop: noop,
          onRemoveStop: noop,
          onMoveStop: noop,
          onSave: noop,
          onDelete: noop,
          onClose: noop,
          onUnassign: noop,
          onAssign: noop,
        }),
      );

    it("lists a route as name, stops with loop time and ship count; it opens the editor", () => {
      const html = renderToStaticMarkup(createElement(RoutesPanel, { model, onEdit: noop, onClose: noop }));
      const name = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
      const stops = route.stops.map((st) => name(st.island_id)).join(" → ");
      expect(text(html)).toContain(`${route.name}${stops} (2:20 min)Ships: ${route.ship_ids.length}`);
      expect(html).toMatch(new RegExp(`<button[^>]*data-testid="route-${route.id}"`));
      expect(html).not.toContain("route-delete");
    });

    it("names the route in the header like an island: the pencil, then the input with Rename and Cancel icons", () => {
      const html = editor(route.id);
      expect(html).toMatch(new RegExp(`data-testid="route-editor-title">${route.name}</h2>`));
      expect(html).toMatch(/<button[^>]*aria-label="Rename the route"[^>]*data-testid="route-rename"><svg/);
      expect(html).not.toContain('data-testid="route-rename-input"');
      expect(html).toContain('data-testid="route-editor-close"');
      const naming = renderToStaticMarkup(
        createElement(RouteEditor, {
          model,
          content,
          routeId: route.id,
          draft: draftFromRoute(route),
          error: null,
          onChange: noop,
          onAddStop: noop,
          onRemoveStop: noop,
          onMoveStop: noop,
          onSave: noop,
          onDelete: noop,
          onClose: noop,
          onUnassign: noop,
          onAssign: noop,
          initiallyRenaming: true,
        }),
      );
      expect(naming).toMatch(new RegExp(`<input[^>]*data-testid="route-rename-input" value="${route.name}"`));
      expect(naming).toMatch(/<button type="submit"[^>]*aria-label="Rename"[^>]*data-testid="route-rename-save"><svg/);
      expect(naming).toMatch(/<button type="button"[^>]*aria-label="Cancel renaming"[^>]*data-testid="route-rename-cancel"><svg/);
      expect(naming).not.toContain('data-testid="route-editor-title"');
      expect(naming).not.toContain('data-testid="route-editor-close"');
    });

    it("offers Delete in the editor of a saved route only while no ship is assigned", () => {
      const withModel = (routes: DisplayState["routes"]) =>
        renderToStaticMarkup(
          createElement(RouteEditor, {
            model: { ...model, routes },
            content: content,
            routeId: route.id,
            draft: draftFromRoute(route),
            error: null,
            onChange: noop,
            onAddStop: noop,
            onRemoveStop: noop,
            onMoveStop: noop,
            onSave: noop,
            onDelete: noop,
            onClose: noop,
            onUnassign: noop,
            onAssign: noop,
          }),
        );
      expect(withModel([{ ...route, ship_ids: [] }])).toContain('data-testid="route-delete"');
      expect(withModel([{ ...route, ship_ids: [7] }])).not.toContain('data-testid="route-delete"');
      expect(editor(null)).not.toContain('data-testid="route-delete"');
    });

    it("renders the server's estimated effects of a saved route", () => {
      const html = editor(route.id);
      expect(text(html)).toContain("Net effect (estimated)");
      expect(html).not.toContain("route-loop");
      // route_loop: wood out of start (−100 per loop, 42.9/min), planks back (+40, 17.1/min) over the 140 s estimated loop.
      const row = (island: string, good: string) => {
        const m = html.match(new RegExp(`<tr data-testid="route-effect-${island}-${good}">(.*?)</tr>`));
        return m ? text(m[1]!) : "";
      };
      expect(row("start", "wood")).toBe("StartWood−100−42.9");
      expect(row("start", "planks")).toBe("StartPlanks+40+17.1");
      expect(row("island2", "wood")).toBe("Island 2Wood+100+42.9");
      expect(row("island2", "planks")).toBe("Island 2Planks−40−17.1");
      // Rows follow the server's order (first stop of the island, then good).
      expect(route.effects.map((e) => `${e.island_id}/${e.good}`)).toEqual(["start/planks", "start/wood", "island2/planks", "island2/wood"]);
      expect(html.indexOf("route-effect-start-planks")).toBeLessThan(html.indexOf("route-effect-island2-planks"));
      // The ship assigned to the route can be unassigned here.
      expect(html).toContain(`data-testid="route-unassign-${route.ship_ids[0]}"`);
    });

    it("offers idle ships in a '+ assign…' dropdown of a saved route only", () => {
      const idle = { ...model.ships[0]!, id: 99, state: "idle", route_id: 0, leg: null, island_id: model.islands[0]!.id } as (typeof model.ships)[number];
      const withIdle = { ...model, ships: [...model.ships, idle] };
      const render = (m: typeof model, routeId: number | null) =>
        renderToStaticMarkup(
          createElement(RouteEditor, {
            model: m,
            content,
            routeId,
            draft: draftFromRoute(route),
            error: null,
            onChange: noop,
            onAddStop: noop,
            onRemoveStop: noop,
            onMoveStop: noop,
            onSave: noop,
            onDelete: noop,
            onClose: noop,
            onAssign: noop,
            onUnassign: noop,
          }),
        );
      expect(render(withIdle, route.id)).toContain('data-testid="route-assign-add"');
      expect(render(withIdle, route.id)).toContain('value="99"');
      expect(render(withIdle, null)).not.toContain("route-assign-add");
      expect(render({ ...model, ships: model.ships.filter((s) => s.state !== "idle") }, route.id)).not.toContain("route-assign-add");
    });

    it("shows no effects or ships before the route is saved", () => {
      const html = editor(null);
      expect(html).not.toContain("route-effects");
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
      inventory: { planks: { stock: 10_000, capacity: 100_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: 0 }, wood: { stock: 9_000, capacity: 100_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: 0 } },
    } as unknown as IslandDisplay;
    const model = { ...fixture("chain_planks"), gold: 100_000, balance_rate_per_min: 0 } as DisplayState;
    const panel = (b: Partial<BuildingDisplay>) => {
      const noop = () => {};
      return renderToStaticMarkup(
        createElement(InfoPanel, {
          onClose: () => {},
          building: { id: 7, type: "shipyard", x: 1, y: 1, rotation: 0, paused: false, paused_reason: "", status: "ok", efficiency_permille: 1000, throughput_factor_permille: 1000, ...b } as BuildingDisplay,
          island,
          model,
          content: shipContent,
          onSetPaused: noop,
          onDemolish: noop,
          onMove: noop,
          onUpgrade: noop,
          onUpgradeBuilding: noop,
          onSelectBuilding: noop,
          onAddField: noop,
          nowMs: 0,
          onOrderShip: noop,
          onCancelShipOrder: noop,
        }),
      );
    };
    const icon = (path: string) => `<path d="${path}" fill="currentColor"></path>`;

    it("puts an icon next to every good of the shipyard costs, short goods red", () => {
      const html = panel({});
      const cost = html.match(/data-testid="shipyard-cost-sloop">(.*?)<\/div>/)![1]!;
      expect(text(cost)).toBe("900 gold·40Planks·5Wood·1:00 min build");
      expect(cost).toContain(icon(goodIcon("planks")));
      expect(cost).toContain(icon(goodIcon("wood")));
      // Gold (100 available) and planks (10 in stock) are short, wood (9 in stock) is not.
      const warn = (title: string) => new RegExp(`<span class="[^"]*warn[^"]*" title="${title}"`).test(cost);
      expect([warn("100 gold available"), warn("10 in stock"), warn("9 in stock")]).toEqual([true, true, false]);
      expect(html).not.toContain("shipyard-missing");
      expect(html).not.toContain("shipyard-progress");
    });

    it("lists every ship type with speed, cargo and build time", () => {
      const html = panel({});
      expect(text(html)).not.toContain("Ships");
      expect(text(html)).toContain("SloopOrder");
      expect(text(html)).toContain("2×50 cargo·1.0× speed·1.0 $/min upkeep");
      expect(text(html)).toContain("Idle");
    });

    it("shows the pending order as the status with Cancel in the footer and the ships list disabled", () => {
      const html = panel({ ship_order: { type: "sloop", ordered_at: "1970-01-01T00:00:00Z", due_at: "1970-01-01T00:00:42Z" } as BuildingDisplay["ship_order"] });
      expect(html.match(/data-testid="info-status">(.*?)<\/div>/)![1]).toBe("Building a Sloop · ready in 0:42 min");
      // The 50 % hint is the second status line.
      expect(html).toMatch(/data-testid="info-status">[^]*?<\/div><div class="[^"]*fix[^"]*">Cancelling the order returns 50 % of the materials\.<\/div>/);
      expect(html).toContain('data-testid="shipyard-cancel"');
      // The list stays, its Order buttons are disabled.
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="shipyard-order-sloop"/);
      // Idle: enabled, no hint.
      const idle = panel({});
      expect(idle).not.toMatch(/disabled=""[^>]*data-testid="shipyard-order-sloop"/);
      expect(text(idle)).not.toContain("Cancelling");
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

  describe("D-054 sizes in the build menu and the cards", () => {
    const def = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      tier: "settlers",
      category: "production",
      width: 1,
      height: 1,
      water_tiles: 0,
      coastal: false,
      requires_road: false,
      cost: { gold: 0, materials: {} },
      upkeep_per_min: 0,
      pause_category: "never",
      ...extra,
    });
    const sized = {
      ...content,
      buildings: [
        def("wheat_farm", "Wheat farm", { width: 3, height: 4, fields: { type: "wheat_field", required: 140, max: 140 } }),
        def("wheat_field", "Wheat field", { field: { type: "wheat_field", farm: "wheat_farm", terrain: ["grass"] } }),
        def("sheep_farm", "Sheep farm", { width: 3, height: 3, fields: { type: "pasture", required: 3, max: 3 } }),
        def("pasture", "Pasture", { width: 3, height: 3, field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } }),
        def("fisher", "Fisher", { width: 3, height: 8, water_tiles: 3 }),
        def("trading_post", "Trading Post", {
          category: "harbour",
          width: 6,
          height: 9,
          water_tiles: 3,
          trading_post: { levels: [1, 2, 3, 4].map((n) => ({ capacity: 100_000 * n, throughput_per_min: 30_000, berths: n })) },
        }),
      ],
    } as unknown as Content;
    const island = { id: "start", name: "Start", buildings: [], roads: [], workforce: {}, inventory: {} } as unknown as IslandDisplay;
    const model = fixture("chain_planks");
    const card = (b: Partial<BuildingDisplay>) =>
      renderToStaticMarkup(
        createElement(InfoPanel, {
          onClose: () => {},
          building: { id: 7, x: 1, y: 1, rotation: 0, paused: false, paused_reason: "", status: "ok", efficiency_permille: 1000, throughput_factor_permille: 1000, ...b } as BuildingDisplay,
          island,
          model,
          content: sized,
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
    const strip = (html: string) => html.replace(/<[^>]+>/g, "");

    it("shows every build card's size: a farm with its fields at the maximum, a pier with its water rows", () => {
      const html = renderToStaticMarkup(
        createElement(BuildMenu, { content: sized, model: null, islandId: "start", fertilities: [], tool: NO_TOOL, onSelect: () => {}, onDemolishTool: () => {} }),
      );
      const size = (id: string) => strip(html.match(new RegExp(`<span[^>]*data-testid="build-size-${id}"[^>]*>[^<]*</span>`))?.[0] ?? "");
      expect(size("wheat_farm")).toBe("3×4 + 140 fields");
      expect(size("sheep_farm")).toBe("3×3 + 3 pastures of 3×3");
      expect(size("fisher")).toBe("3×8 (3 rows on water)");
      // Fields and the Trading Post are not built from the menu.
      expect(html).not.toContain("build-size-wheat_field");
      expect(html).not.toContain("build-size-trading_post");
    });

    it("has a Size row in the Details of a farm, a producer and the Trading Post", () => {
      const farm = card({ type: "wheat_farm", rates: { inputs: {}, outputs: { wheat: 1_000 } }, fields: { active: 12, required: 140, max: 140, ids: Array.from({ length: 12 }, (_, i) => 100 + i) } } as Partial<BuildingDisplay>);
      expect(strip(farm)).toContain("Size3×4 + 140 fields");
      expect(strip(farm)).toContain("12 / 140 placed");
      expect(strip(farm)).toContain("Paint wheat field");
      const fisher = card({ type: "fisher", rates: { inputs: {}, outputs: { fish: 1_000 } } } as Partial<BuildingDisplay>);
      expect(strip(fisher)).toContain("Size3×8 (3 rows on water)");
      const tp = card({ type: "trading_post", level: 2, capacity: 200_000, throughput_per_min: 30_000, load_permille: 0 });
      expect(strip(tp)).toContain("Size6×9 (3 rows on water)");
    });

    it("follows the Trading Post's level on its berths line (the server's berths when it sends them)", () => {
      for (const level of [1, 2, 3, 4]) {
        const tp = card({ type: "trading_post", level, capacity: 100_000, throughput_per_min: 30_000, load_permille: 0 });
        expect(strip(tp), `level ${level}`).toContain(`Berths${level} / ${level} free`);
      }
      const busy = card({ type: "trading_post", level: 4, capacity: 400_000, throughput_per_min: 30_000, load_permille: 0, berths: { total: 4, busy: 3, ships: [1, 2, 3], queue: [] } });
      expect(strip(busy)).toContain("Berths1 / 4 free");
      // The next level's preview names its berths.
      expect(strip(card({ type: "trading_post", level: 3, capacity: 300_000, throughput_per_min: 30_000, load_permille: 0 }))).toContain("4 berths");
    });
  });

  describe("phone minimap", () => {
    const html = (settled: boolean, initiallyCollapsed: boolean) => {
      const base = fixture("citizens_needs");
      const model = { ...base, islands: base.islands.map((is) => ({ ...is, settled: settled && is.settled })) };
      return renderToStaticMarkup(createElement(Minimap, { renderer: null, model, viewport: { width: 412, height: 915 }, collapsible: true, initiallyCollapsed, heading: 0 }));
    };

    it("opens expanded while no island is settled, with the layout's default afterwards", () => {
      expect(html(false, true)).toContain('data-testid="minimap-panel"');
      expect(html(false, true)).toContain('aria-expanded="true"');
      expect(html(true, true)).not.toContain('data-testid="minimap-panel"');
      expect(html(true, false)).toContain('data-testid="minimap-panel"');
    });
  });
});
