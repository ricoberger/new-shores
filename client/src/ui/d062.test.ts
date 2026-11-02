import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { BuildMenu } from "./BuildMenu";
import { InfoPanel } from "./InfoPanel";
import { NO_TOOL } from "./tools";

const content = loadContent("content/old_coast");
const model = (JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/display/bootstrap_patricians.json"), "utf8")) as { base: DisplayState }).base;
const island = model.islands[0]!;
const noop = () => {};
const strip = (html: string) => html.replace(/<[^>]+>/g, "");
function card(type: string, extra: Partial<BuildingDisplay> = {}, at = island) {
  const b = { id: 98765, type, x: 0, y: 0, rotation: 0, paused: false, paused_reason: "", status: "ok", efficiency_permille: 1000, throughput_factor_permille: 1000, ...extra } as BuildingDisplay;
  return renderToStaticMarkup(createElement(InfoPanel, {
    building: b, island: at, model, content, onClose: noop, onSetPaused: noop, onDemolish: noop, onMove: noop,
    onUpgrade: noop, onUpgradeBuilding: noop, onSelectBuilding: noop, onAddField: noop,
    nowMs: Date.parse(model.evaluated_at), onOrderShip: noop, onCancelShipOrder: noop,
  }));
}
describe("D-062 / D-063 cards", () => {
  it("shows a fixed-capacity depot, never a level, upgrade block or size row", () => {
    const html = card("depot", { capacity: 150_000 });
    expect(html).toContain('data-testid="depot-capacity"');
    expect(strip(html)).toContain("150");
    expect(html).not.toContain("info-size");
    expect(html).not.toContain("depot-level");
    expect(html).not.toContain("depot-upgrade");
  });
  it("shows the pier's berths with the island's free berths and queue, without a size row", () => {
    const post = { ...island.buildings[0]!, id: 98766, type: "trading_post", berths: { total: 3, busy: 2, ships: [1, 2], queue: [3, 4] } } as unknown as BuildingDisplay;
    const busy = card("trading_pier", {}, { ...island, buildings: [post] });
    expect(busy).toContain('data-testid="pier-panel"');
    expect(strip(busy)).toContain("1 / 3 free · 2 waiting");
    expect(busy).not.toContain("info-size");
    const idle = card("trading_pier", {}, { ...island, buildings: [{ ...post, berths: { total: 3, busy: 0, ships: [], queue: [] } } as unknown as BuildingDisplay] });
    expect(strip(idle)).toContain("3 / 3 free");
    expect(strip(idle)).not.toContain("waiting");
  });
  it("shows surgery's single radius-20 service, without a size row", () => {
    const html = card("surgery");
    expect(strip(html)).toContain("20");
    expect(html).not.toContain("info-size");
    expect(html).not.toContain("service-upgrade-button");
    expect(content.buildings.find((b) => b.id === "surgery")?.tier).toBe("patricians");
  });
  it("lists playhouse rather than theatre, and locks surgery until Patricians", () => {
    const publicContent = { ...content, buildings: content.buildings.filter((b) => b.category === "public") };
    const html = renderToStaticMarkup(createElement(BuildMenu, {
      content: publicContent, model: { ...model, tiers: model.tiers.map((tier) => ({ ...tier, unlocked: tier.id !== "patricians" })) },
      islandId: island.id, fertilities: [], tool: NO_TOOL, onSelect: noop, onDemolishTool: noop,
    }));
    expect(html).toContain('data-testid="build-playhouse"');
    expect(html).not.toContain('data-testid="build-theatre"');
    expect(html).toContain("A timber-framed playhouse");
    expect(html).toContain('data-testid="build-lock-surgery"');
    expect(html).not.toContain('data-testid="build-lock-playhouse"');
  });
});
