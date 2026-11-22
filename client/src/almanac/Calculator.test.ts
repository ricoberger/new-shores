import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlmanacView } from "./Almanac";
import { calculate, parseQuery } from "./calc";
import { buildIndex } from "./model";
import { SECTIONS, parseRoute, routePath } from "./route";
import { loadContent } from "./testContent";

const content = loadContent("content/old_coast");
const idx = buildIndex(content);
const page = (urlSearch?: string) => renderToStaticMarkup(createElement(AlmanacView, { content, route: { section: "calculator" }, urlSearch }));

describe("calculator page", () => {
  it("is a section after Needs with its route", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.indexOf("calculator")).toBe(ids.indexOf("needs") + 1);
    expect(routePath("calculator")).toBe("/almanac/calculator");
    expect(parseRoute("/almanac/calculator")).toEqual({ section: "calculator" });
    expect(page()).toContain('href="/almanac/calculator"');
  });

  it("shows the empty state and one field per tier without residents", () => {
    const out = page();
    expect(out).toContain("<h2>Calculator</h2>");
    expect(out).toContain('data-testid="almanac-calc-empty"');
    expect(out).not.toContain("almanac-calc-totals");
    // No category checkboxes while no tier has residents.
    expect(out).not.toContain("Goods supplied");
    for (const t of content.tiers) expect(out).toContain(`aria-label="${t.name} residents"`);
    expect(out).not.toMatch(/undefined|NaN|\[object/);
    // Invalid values count as empty.
    expect(page("?s=abc&c=-4")).toContain("almanac-calc-empty");
  });

  it("renders demand, chains and totals for the shots preset, linked to the building and goods pages", () => {
    const out = page("?s=120&c=400&m=200&p=100");
    const r = calculate(idx, parseQuery(idx, "?s=120&c=400&m=200&p=100"));
    expect(out).not.toContain("almanac-calc-empty");
    expect(out).toContain('value="400"');
    expect(out).toContain('value="120"');
    expect(out).toContain('href="/almanac/buildings/bakery"');
    expect(out).toContain('href="/almanac/goods/bread"');
    // One table per consumed good; every producer row shows its integer count.
    for (const g of r.groups) expect(out).toContain(`id="calc-chain-${g.good}"`);
    expect(out).toContain('data-testid="almanac-calc-demand"');
    // Totals: the integer count of buildings and the deposits' slots.
    expect(out).toMatch(new RegExp(`data-testid="almanac-calc-totals"><div[^>]*><dt>Production buildings</dt><dd>${r.totals.buildings}</dd>`));
    expect(out).toContain("deposit: ");
    // Rates in t/min, coverage-free by default (both goods of every category supplied).
    expect(out).toMatch(/\d\u00a0t\/min/);
    expect(out).not.toContain("almanac-calc-coverage");
    // Category groups for tiers with residents: Citizens food (two goods), but a one-good Settlers category has none.
    expect(out).toContain("Goods supplied");
    expect(out).toContain("Food (Citizens)");
    expect(out).not.toContain("Food (Settlers)");
    expect(out).not.toMatch(/undefined|NaN|\[object/);
  });

  it("notes the coverage of a category with some goods unsupplied and nothing for a fully unsupplied one", () => {
    const some = page("?c=100&off=cheese");
    expect(some).toContain('data-testid="almanac-calc-coverage"');
    expect(some).toContain("only Bread supplied, so the category covers 60 %");
    expect(some).toContain("maximum of 14 residents");
    expect(some).toMatch(/<input type="checkbox"[^>]*\/> Bread/);
    expect(some).toMatch(/<input type="checkbox"[^>]*\/> Cheese/);
    expect(some.match(/checked=""/g)?.length).toBeGreaterThan(0);
    const none = page("?c=100&off=cheese,bread");
    expect(none).not.toContain("only  supplied");
    expect(none).not.toContain("only Bread");
  });

  it("only offers checkboxes for the tiers that have residents", () => {
    expect(page("?m=100")).toContain("Books");
    expect(page("?m=100")).not.toContain("Spectacles");
    expect(page("?p=100")).toContain("Spectacles");
  });

  it("survives content without optional parts", () => {
    const empty = { region: {}, quests: [], tiers: [], goods: [], buildings: [], needs: [], need_categories: [], ships: [], size_classes: [] } as never;
    expect(() => renderToStaticMarkup(createElement(AlmanacView, { content: empty, route: { section: "calculator" }, urlSearch: "?s=5" }))).not.toThrow();
  });
});
