import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StartScreen } from "../ui/StartScreen";
import { AlmanacView } from "./Almanac";
import { isAlmanacPath, parseRoute, routePath } from "./route";
import { loadContent } from "./testContent";

const content = loadContent("content/old_coast");
const html = (route: Parameters<typeof AlmanacView>[0]["route"]) => renderToStaticMarkup(createElement(AlmanacView, { content, route }));

describe("almanac rendering", () => {
  it("renders the overview with headings, navigation and footer from content", () => {
    const out = html({ section: "overview" });
    expect(out).toContain("The New Shores Almanac");
    expect(out).toContain("<h2>Overview</h2>");
    expect(out).toContain('aria-current="page"');
    for (const t of content.tiers) expect(out).toContain(t.name);
    expect(out).toContain(content.region.version);
    expect(out).not.toMatch(/undefined|NaN|\[object/);
  });

  it("renders every building once on the buildings page and links goods to their pages", () => {
    const out = html({ section: "buildings" });
    for (const b of content.buildings) expect(out.split(`id="building-${b.id}"`).length - 1, b.id).toBe(1);
    expect(out).toContain('href="/almanac/goods/planks"');
    expect(out).toContain("Footprint");
  });

  it("renders a building page with levels and fields", () => {
    expect(html({ section: "buildings", id: "trading_post" })).toContain("Berths");
    const farm = html({ section: "buildings", id: "wheat_farm" });
    expect(farm).toContain("Fields");
    expect(farm).toContain("140 needed");
  });

  it("renders a good page with producers, consumers and the upstream chain", () => {
    const out = html({ section: "goods", id: "bread" });
    expect(out).toContain("Chain upstream");
    expect(out).toContain("raw");
    expect(out).toContain("Wheat");
    expect(html({ section: "goods", id: "planks" })).toContain("construction");
    expect(html({ section: "goods", id: "nonsense" })).toContain("There is no good");
    for (const g of content.goods) expect(html({ section: "goods" })).toContain(`href="/almanac/goods/${g.id}"`);
  });

  it("renders needs, ships, quests and islands from content", () => {
    const needs = html({ section: "needs" });
    expect(needs).toContain("Per resident/min");
    expect(needs).toContain("0.008");
    expect(needs).toContain("60 %");
    const ships = html({ section: "ships" });
    for (const s of content.ships) expect(ships).toContain(`id="ship-${s.id}"`);
    expect(ships).toContain("2 slots × 50");
    const quests = html({ section: "quests" });
    for (const q of content.quests) expect(quests.split(`id="quest-${q.id}"`).length - 1, q.id).toBe(1);
    expect(quests).toContain("Lay 10 tiles of Dirt road");
    const islands = html({ section: "islands" });
    for (const c of content.size_classes) expect(islands).toContain(c.name);
    expect(islands).toContain("not part of the served content");
  });

  it("survives content without optional parts", () => {
    const empty = { region: {}, quests: [], tiers: [], goods: [], buildings: [], needs: [], need_categories: [], ships: [], size_classes: [] } as never;
    for (const section of ["overview", "buildings", "goods", "needs", "ships", "quests", "islands"] as const)
      expect(() => renderToStaticMarkup(createElement(AlmanacView, { content: empty, route: { section } }))).not.toThrow();
  });
});

describe("entry points", () => {
  it("links the almanac from the start screen", () => {
    expect(renderToStaticMarkup(createElement(StartScreen, { onPlayer: () => undefined }))).toContain('href="/almanac"');
  });
});

describe("routes", () => {
  it("parses and builds /almanac/<section>/<id>", () => {
    expect(isAlmanacPath("/almanac")).toBe(true);
    expect(isAlmanacPath("/almanac/goods/bread")).toBe(true);
    expect(isAlmanacPath("/almanacs")).toBe(false);
    expect(isAlmanacPath("/")).toBe(false);
    expect(parseRoute("/almanac")).toEqual({ section: "overview" });
    expect(parseRoute("/almanac/goods/bread")).toEqual({ section: "goods", id: "bread" });
    expect(parseRoute("/almanac/nope/x")).toEqual({ section: "overview" });
    expect(parseRoute("/almanac/goods/%E0%A4%A")).toEqual({ section: "goods" });
    expect(routePath("overview")).toBe("/almanac");
    expect(routePath("buildings", "a b")).toBe("/almanac/buildings/a%20b");
    expect(parseRoute(routePath("buildings", "a b"))).toEqual({ section: "buildings", id: "a b" });
  });
});
