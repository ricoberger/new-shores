import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { AwayDialog } from "./AwayDialog";
import { InsolvencyBanner } from "./InsolvencyBanner";
import { QuestsPanel } from "./QuestsPanel";

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
});
