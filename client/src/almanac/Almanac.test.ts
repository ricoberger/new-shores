import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("survives content without optional parts", () => {
    const empty = { region: {}, quests: [], tiers: [], goods: [], buildings: [], needs: [], need_categories: [], ships: [], size_classes: [] } as never;
    expect(renderToStaticMarkup(createElement(AlmanacView, { content: empty, route: { section: "overview" } }))).toContain("Overview");
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
