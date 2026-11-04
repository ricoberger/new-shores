import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { buildCost, buildMenuGroups, buildTierTabs, chainDepths, defaultBuildTier } from "../display/buildMenu";
import { BuildMenu } from "./BuildMenu";
import { NO_TOOL } from "./tools";

const content = loadContent("content/old_coast");
const base = (JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/display/bootstrap_settlers.json"), "utf8")) as { base: DisplayState }).base;
const tierState = (id: string, unlocked: boolean, population: Record<string, { have: number; need: number }> = {}, buildings: Record<string, boolean> = {}) => ({ id, unlocked, population, buildings });
// Settlers unlocked, Citizens locked with two unmet conditions, the rest locked.
const model = {
  ...base,
  gold: 50_000,
  tiers: [
    tierState("settlers", true),
    tierState("citizens", false, { settlers: { have: 88_000, need: 120_000 } }, { chapel: false, market: true }),
    tierState("merchants", false),
    tierState("patricians", false),
  ],
} as unknown as DisplayState;
const island = model.islands[0]!;
const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, "");
const render = (extra: Partial<Parameters<typeof BuildMenu>[0]> = {}, m: DisplayState = model) =>
  renderToStaticMarkup(createElement(BuildMenu, { content, model: m, islandId: island.id, fertilities: ["wheat"], tool: NO_TOOL, onSelect: noop, onDemolishTool: noop, ...extra }));
const ids = (html: string) => [...html.matchAll(/<button[^>]*data-testid="build-([a-z_]+)"/g)].map((m) => m[1]).filter((id) => id !== "demolish" && !id?.startsWith("tab"));

describe("build menu tabs", () => {
  it("has one tab per tier with its numeral and name, the current tier selected", () => {
    const html = render();
    const tabs = buildTierTabs(model, content);
    expect(tabs.map((t) => t.id)).toEqual(["settlers", "citizens", "merchants", "patricians"]);
    expect(defaultBuildTier(tabs)).toBe("settlers");
    expect(text(html.match(/data-testid="build-tab-settlers"[^>]*>(.*?)<\/button>/)![1]!)).toBe("I Settlers");
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="build-tab-settlers"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-testid="build-tab-citizens"/);
    // The highest unlocked tier is the default.
    const grown = { ...model, tiers: model.tiers.map((t) => ({ ...t, unlocked: t.id !== "merchants" && t.id !== "patricians" })) } as DisplayState;
    expect(defaultBuildTier(buildTierTabs(grown, content))).toBe("citizens");
  });

  it("dims a locked tier with its unmet unlock conditions as the subtitle and opens it to look ahead", () => {
    const html = render();
    expect(html).toMatch(/class="[^"]*tabLocked[^"]*"[^>]*data-testid="build-tab-citizens"/);
    expect(html).not.toMatch(/class="[^"]*tabLocked[^"]*"[^>]*data-testid="build-tab-settlers"/);
    expect(text(html.match(/data-testid="build-tab-sub-citizens">(.*?)<\/span>/)![1]!)).toBe("88/120 Settlers · Build Chapel");
    expect(html).not.toContain("build-tab-sub-settlers");
    // Opened: its cards are disabled and say why.
    const citizens = render({ initialTier: "citizens" });
    expect(citizens.match(/<button[^>]*data-testid="build-bakery"[^>]*>/)?.[0]).toContain("disabled");
    expect(text(citizens.match(/data-testid="build-lock-bakery"[^>]*>(.*?)<\/span>/)![1]!)).toBe("Needs Citizens — 88/120 Settlers · Build Chapel");
  });
});

describe("build menu groups", () => {
  const groups = (tier: string) => buildMenuGroups(content, tier).map((r) => [r.group, r.items.map((b) => b.id)] as const);

  it("lists General (house, road, warehouse), Production, Public (market first) in a tab, empty groups left out", () => {
    const [general, production, pub, ...rest] = groups("settlers");
    expect(general).toEqual(["general", ["house_settlers", "road_dirt", "warehouse"]]);
    expect(production?.[0]).toBe("production");
    // The market serves a public-group need (D-065): it stands with the service buildings.
    expect(pub).toEqual(["public", ["market", "chapel"]]);
    expect(rest).toEqual([]);
    // The Trading Post is never listed; later houses are upgrade-only.
    expect(JSON.stringify(groups("settlers"))).not.toContain("trading_post");
    expect(JSON.stringify(groups("patricians"))).not.toContain("house_patricians");
  });

  it("puts the quay in Harbour after the shipyard, pier and depot", () => {
    const citizens = groups("citizens");
    expect(citizens.map(([g]) => g)).toEqual(["general", "production", "public", "harbour"]);
    expect(citizens[0]).toEqual(["general", ["road_paved"]]);
    // Pier and depot arrive with the Merchants (D-069 §5).
    expect(citizens[3]).toEqual(["harbour", ["shipyard", "quay"]]);
    expect(groups("merchants").find(([g]) => g === "harbour")).toEqual(["harbour", ["trading_pier", "depot"]]);
  });

  it("orders Production along the chains: raw first, then intermediate, then final goods", () => {
    const depths = chainDepths(content);
    const production = groups("citizens").find(([g]) => g === "production")![1];
    expect(production.indexOf("wheat_farm")).toBeLessThan(production.indexOf("mill"));
    expect(production.indexOf("mill")).toBeLessThan(production.indexOf("bakery"));
    expect(depths.get("wheat_farm")).toBe(0);
    expect(depths.get("mill")).toBe(1);
    expect(depths.get("bakery")).toBe(2);
    const sorted = production.map((id) => depths.get(id)!);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });

  it("renders the groups in the strip, each with its label", () => {
    const html = render();
    expect(ids(html).slice(0, 3)).toEqual(["house_settlers", "road_dirt", "warehouse"]);
    expect([...html.matchAll(/data-testid="build-group-([a-z]+)"/g)].map((m) => m[1])).toEqual(["general", "production", "public"]);
    expect(text(html.match(/data-testid="build-group-general"[^>]*><div[^>]*>(.*?)<\/div>/)![1]!)).toBe("General");
  });
});

describe("build cards", () => {
  const card = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="build-${id}"[^>]*>.*?</button>`))![0];

  it("shows the cost with good icons and marks only the parts the player cannot cover in red", () => {
    const tight = {
      ...model,
      gold: 100_000,
      islands: model.islands.map((is, i) => (i === 0 ? { ...is, inventory: { ...is.inventory, planks: { ...is.inventory.planks!, stock: 3_000 } } } : is)),
    } as DisplayState;
    const sawmill = content.buildings.find((b) => b.id === "sawmill")!;
    const cost = buildCost(sawmill, tight.gold, (g) => tight.islands[0]!.inventory[g]?.stock ?? 0);
    expect(cost.gold.short).toBe(sawmill.cost.gold > 100_000);
    const html = render({}, tight);
    expect(text(card(html, "sawmill"))).toMatch(/\d+ gold·\d+\u00a0t/);
    expect(card(html, "sawmill")).toContain("<svg");
    // No stock numbers, no footprint, no tier badge.
    expect(card(html, "sawmill")).not.toMatch(/\d+\/\d+/);
    expect(html).not.toContain("build-size-");
    const poor = render({}, { ...tight, gold: 0 } as DisplayState);
    expect(card(poor, "sawmill")).toMatch(/data-short="true"/);
    const rich = render({}, { ...tight, gold: 100_000_000, islands: tight.islands.map((is) => ({ ...is, inventory: Object.fromEntries(Object.entries(is.inventory).map(([k, v]) => [k, { ...v, stock: 999_000_000 }])) })) } as DisplayState);
    expect(card(rich, "sawmill")).not.toContain("data-short");
    expect(card(poor, "sawmill")).not.toContain("disabled");
  });

  it("shows upkeep and what a producer, a farm and a public building does on the second line", () => {
    const html = render({ initialTier: "citizens" });
    const info = (id: string) => text(card(html, id).match(new RegExp(`data-testid="build-info-${id}"[^>]*>(.*?)</button>`))![1]!);
    expect(info("mill")).toMatch(/gold\/min·Wheat.*→.*Flour/);
    expect(info("wheat_farm")).toMatch(/gold\/min·Wheat field.*→.*Wheat/);
    expect(info("wheat_farm")).not.toMatch(/\d+ ×/);
    const settlers = render();
    expect(text(card(settlers, "chapel").match(/data-testid="build-info-chapel"[^>]*>(.*?)<\/button>/)![1]!)).toMatch(/gold\/min·Faith$/);
    expect(text(card(settlers, "market").match(/data-testid="build-info-market"[^>]*>(.*?)<\/button>/)![1]!)).toMatch(/gold\/min·Market$/);
  });

  it("names the deposit a mine needs in front of its output, on one line", () => {
    const html = render({ initialTier: "citizens" });
    const quarry = card(html, "quarry");
    expect(text(quarry.match(/data-testid="build-info-quarry"[^>]*>(.*?)<\/button>/)![1]!)).toMatch(/gold\/min·[A-Z]\w+ deposit→/);
    expect(quarry).not.toContain("Must cover");
    expect(quarry).toMatch(/data-testid="build-deposit-quarry"[^>]*><svg/);
  });

  it("separates a producer's several inputs with commas", () => {
    const html = render({ initialTier: "citizens" });
    const info = text(card(html, "smelter").match(/data-testid="build-info-smelter"[^>]*>(.*?)<\/button>/)![1]!);
    expect(info).toMatch(/gold\/min·[\w ]+,[\w ]+→/);
    expect(text(card(html, "mill").match(/data-testid="build-info-mill"[^>]*>(.*?)<\/button>/)![1]!)).not.toContain(",");
  });

  it("separates gold and every material with a dot", () => {
    const html = render({ initialTier: "citizens" });
    expect(text(card(html, "wheat_farm"))).toMatch(/\d+ gold·\d+\u00a0t·\d+\u00a0t/);
  });

  it("gives every card the same four rows: a note row exists with and without a lock", () => {
    const html = render({ initialTier: "citizens" });
    for (const id of ["road_paved", "quarry", "mill"]) expect(card(html, id)).toMatch(/cardNote/);
    expect(card(html, "quarry")).toContain("build-lock-quarry");
    const settlers = render();
    expect(card(settlers, "house_settlers")).toMatch(/<span class="[^"]*cardNote[^"]*" aria-hidden="true"><\/span>/);
  });

  it("replaces the second line with the missing fertility in red", () => {
    const html = render({ initialTier: "citizens", fertilities: [] });
    const farm = card(html, "wheat_farm");
    expect(farm).toMatch(/class="[^"]*warn[^"]*"[^>]*data-testid="build-fertility-wheat_farm"/);
    expect(farm).not.toContain("build-info-wheat_farm");
    // Only what it needs, not what the island has.
    expect(text(farm.match(/data-testid="build-fertility-wheat_farm"[^>]*>(.*?)<\/span>/)![1]!)).toBe("Needs wheat fertility");
    expect(card(render({ initialTier: "citizens", fertilities: ["wheat"] }), "wheat_farm")).not.toContain("build-fertility-");
  });
});

describe("build bar Move tool (UI.md §3)", () => {
  it("sits next to Demolish when the HUD wires it, pressed while picking or moving from it", () => {
    expect(render()).not.toContain('data-testid="tool-move"');
    const idle = render({ onMoveTool: noop });
    expect(idle).toMatch(/aria-pressed="false"[^>]*aria-label="Move"[^>]*data-testid="tool-move"/);
    expect(idle.indexOf('data-testid="tool-move"')).toBeLessThan(idle.indexOf('data-testid="tool-demolish"'));
    expect(render({ onMoveTool: noop, tool: { kind: "movePick" } })).toMatch(/aria-pressed="true"[^>]*data-testid="tool-move"/);
    const picked = { kind: "move", buildingId: 1, buildingType: "fisher", rotation: 0, pick: true } as const;
    expect(render({ onMoveTool: noop, tool: picked })).toMatch(/aria-pressed="true"[^>]*data-testid="tool-move"/);
    // A move from the card is not the bar's tool.
    expect(render({ onMoveTool: noop, tool: { ...picked, pick: undefined } })).toMatch(/aria-pressed="false"[^>]*data-testid="tool-move"/);
  });
});
