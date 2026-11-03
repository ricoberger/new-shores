import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, DisplayState, IslandDisplay } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { goodIcon } from "../theme/iconSet";
import { InfoPanel } from "./InfoPanel";

const base = (JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/display/bootstrap_citizens.json"), "utf8")) as { base: DisplayState }).base;
const content = loadContent("content/old_coast");
const noop = () => {};
const panel = (building: BuildingDisplay, island: IslandDisplay, model: DisplayState = base) =>
  renderToStaticMarkup(
    createElement(InfoPanel, {
      onClose: noop,
      building,
      island,
      model,
      content,
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
const island = base.islands[0]!;
const of = (type: string) => island.buildings.find((b) => b.type === type)!;
const costLine = (html: string, testId: string) => html.match(new RegExp(`data-testid="${testId}-cost">(.*?)</div>`))?.[1];
/** The visible text: tags and screen-reader-only spans dropped. */
const visible = (html: string) => html.replace(/<span class="[^"]*srOnly[^"]*">.*?<\/span>/g, "").replace(/<[^>]+>/g, "");
const icon = (good: string) => `<path d="${goodIcon(good)}"`;

describe("upgrade cost lines like the build menu (UI.md §4)", () => {
  it("shows the house upgrade's cost — the next tier's house — in the Upgrade section, goods by icon", () => {
    const line = costLine(panel(of("house_settlers"), island), "house-upgrade")!;
    expect(visible(line)).toBe("150 gold·5\u00a0t·3\u00a0t");
    expect(line.indexOf(icon("planks"))).toBeGreaterThan(-1);
    expect(line.indexOf(icon("stone"))).toBeGreaterThan(line.indexOf(icon("planks")));
    // The good's name stays for screen readers and the tooltip.
    expect(line).toContain("Planks");
    expect(line).not.toContain("data-short");
    // Short parts are red: no gold and no stone on hand.
    const poor = { ...island, inventory: { ...island.inventory, stone: { ...island.inventory.stone!, stock: 1_000 } } };
    const short = costLine(panel(of("house_settlers"), poor, { ...base, gold: 0 }), "house-upgrade")!;
    expect(short.match(/data-short="true"/g)).toHaveLength(2);
    expect(short).toMatch(/class="[^"]*warn[^"]*"[^>]*data-short="true"[^>]*data-testid="house-upgrade-cost-stone"/);
  });

  it("has no Upgrade section on a house of the highest tier", () => {
    const top = content.tiers[content.tiers.length - 1]!.house!;
    expect(panel({ ...of("house_settlers"), type: top }, island)).not.toContain('data-testid="house-upgrade"');
  });

  it("puts the icon before the amount and no name on the levelled buildings' upgrade cost", () => {
    const wh = { ...of("house_settlers"), id: 99_001, type: "warehouse", level: 1, residents: undefined, residents_max: undefined, needs: undefined } as BuildingDisplay;
    const line = costLine(panel(wh, island), "warehouse-upgrade")!;
    expect(visible(line)).toBe("150 gold·10\u00a0t·5\u00a0t");
    expect(line.indexOf(icon("planks"))).toBeLessThan(line.indexOf("10\u00a0t"));
  });
});
