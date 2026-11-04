import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayState, IslandDisplay, PlanDisplay } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { PlanCard, PlannedFieldsBlock, PlannedRoadCard } from "./PlanCard";

// Plan cards (D-071 §4) against the server's display fixtures: a planned bakery (tier locked) and a planned paved road.
const fixture = (name: string) => (JSON.parse(readFileSync(join(__dirname, `../../../server/testdata/display/${name}.json`), "utf8")) as { base: DisplayState }).base;
const build = fixture("plans_build");
const roads = fixture("plans_roads");
const content = loadContent("content/old_coast");
const noop = () => {};
const visible = (html: string) => html.replace(/<span class="[^"]*srOnly[^"]*">.*?<\/span>/g, "").replace(/<[^>]+>/g, "");
const card = (plan: PlanDisplay, island: IslandDisplay, model: DisplayState = build) =>
  renderToStaticMarkup(createElement(PlanCard, { plan, island, model, content, onBuild: noop, onMove: noop, onDemolish: noop, onPaintFields: noop, onClose: noop }));

describe("plan card (D-071 §4)", () => {
  const island = build.islands[0]!;
  const bakery = island.plans![0]!;

  it("names the plan, shows the server's cost and reason, and offers Build · Move · Demolish", () => {
    const html = card(bakery, island);
    expect(visible(html.match(/data-testid="plan-name">(.*?)<\/h2>/)![1]!)).toBe("Planned: Bakery");
    const cost = html.match(/data-testid="plan-cost">(.*?)<\/div>/)![1]!;
    expect(visible(cost)).toBe("Building costs300 gold·15\u00a0t·15\u00a0t");
    expect(visible(html.match(/data-testid="plan-reason">(.*?)<\/div>/)![1]!)).toMatch(/^Can&#x27;t build now: That tier/);
    for (const id of ["plan-build", "plan-move", "plan-demolish"]) expect(html).toContain(`data-testid="${id}"`);
    // Build is never disabled: the server decides.
    expect(html.match(/<button[^>]*data-testid="plan-build"[^>]*>/)![0]).not.toContain("disabled");
  });

  it("marks the parts the island cannot cover red", () => {
    const poor = { ...build, gold: 0 };
    const html = card(bakery, island, poor);
    expect(html.match(/data-testid="plan-cost">(.*?)<\/div>/)![1]!).toContain('data-short="true"');
  });

  it("builds a planned field with its farm: no Move, the farm's cost and fields", () => {
    const farm: PlanDisplay = { id: 50, type: "wheat_farm", x: 2, y: 2, rotation: 0, planned: true, plan_cost: { gold: 1000, materials: {} } };
    const field: PlanDisplay = { id: 51, type: "wheat_field", x: 5, y: 2, rotation: 0, planned: true, farm_id: 50 };
    const withFarm = { ...island, plans: [farm, field] };
    const html = card(field, withFarm);
    expect(html).not.toContain('data-testid="plan-move"');
    expect(visible(html.match(/data-testid="plan-build"[^>]*>(.*?)<\/button>/)![1]!)).toContain("Build planned fields");
    expect(visible(html.match(/data-testid="plan-status">(.*?)<\/div>/)![1]!)).toContain("planned wheat farm");
    expect(html).toContain('data-testid="plan-cost"');
    // The planned farm's card counts its planned fields and paints more (free: no cost on the button).
    const farmCard = card(farm, withFarm);
    expect(visible(farmCard.match(/data-testid="plan-fields-count">(.*?)<\/div>/)![1]!)).toMatch(/^1 \/ \d+ fields planned$/);
    expect(visible(farmCard.match(/data-testid="farm-add-field"[^>]*>(.*?)<\/button>/)![1]!)).not.toMatch(/gold/);
  });
});

describe("planned road card (D-071 §4)", () => {
  it("names the segment's tiles and type, with cost, reason, Build and Demolish", () => {
    const island = roads.islands[0]!;
    const road = island.planned_roads![0]!;
    const html = renderToStaticMarkup(createElement(PlannedRoadCard, { road, island, model: roads, content, onBuild: noop, onDemolish: noop, onClose: noop }));
    expect(visible(html.match(/data-testid="planned-road-name">(.*?)<\/h2>/)![1]!)).toBe("Planned road · 5 tiles");
    expect(visible(html.match(/data-testid="planned-road-type">(.*?)<\/div>/)![1]!)).toMatch(/^Paved road: /);
    expect(visible(html.match(/data-testid="planned-road-cost">(.*?)<\/div>/)![1]!)).toBe("Building costs25 gold·5\u00a0t");
    expect(html).toContain('data-testid="planned-road-reason"');
    expect(html).toContain('data-testid="planned-road-build"');
    expect(html).toContain('data-testid="planned-road-demolish"');
  });
});

describe("farm card planned fields (D-071 §4)", () => {
  it("counts the planned fields with their cost and a Build planned fields button", () => {
    const island = build.islands[0]!;
    const html = renderToStaticMarkup(createElement(PlannedFieldsBlock, { island, model: build, content, count: 3, cost: { gold: 0, materials: {} }, onBuild: noop }));
    expect(visible(html.match(/data-testid="farm-planned-count">(.*?)<\/div>/)![1]!)).toBe("3 planned fields");
    expect(html).not.toContain("farm-planned-reason");
    expect(visible(html.match(/data-testid="farm-build-planned"[^>]*>(.*?)<\/button>/)![1]!).trim()).toBe("Build planned fields");
  });
});
