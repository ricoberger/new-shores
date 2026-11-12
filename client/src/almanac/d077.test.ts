import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IslandDisplay } from "../api/client";
import { buildingNotes } from "../display/buildMenu";
import { paintUnder } from "../display/plans";
import { AlmanacView } from "./Almanac";
import { loadContent } from "./testContent";

// D-077 in the client: card notes, the almanac's sections and the Demolish
// tool's paint tiles, against the shipped content.
const content = loadContent("content/old_coast");
const defs = new Map(content.buildings.map((b) => [b.id, b]));
const def = (id: string) => defs.get(id)!;
const html = (route: Parameters<typeof AlmanacView>[0]["route"]) => renderToStaticMarkup(createElement(AlmanacView, { content, route }));

describe("D-077 card notes", () => {
  it("say what the dormant values do and the scopes", () => {
    expect(buildingNotes(def("hedge"))).toEqual(["Painted tile by tile"]);
    expect(buildingNotes(def("city_wall"))).toEqual(["Painted tile by tile", "Defense 1 (no effect yet)"]);
    expect(buildingNotes(def("gatehouse"))).toEqual(["Gate in the city wall", "Defense 5 (no effect yet)"]);
    expect(buildingNotes(def("repair_crane"))).toEqual(["Repairs ships (no effect yet)"]);
    expect(buildingNotes(def("kontor"))).toEqual(["Only one in the world · unlocks expeditions later"]);
    expect(buildingNotes(def("fountain"))).toEqual([]);
  });
});

describe("D-077 almanac", () => {
  it("lists the Ornaments and Military categories and the notes", () => {
    const out = html({ section: "buildings" });
    expect(out).toContain("Ornaments");
    expect(out).toContain("Military");
    expect(out).toContain("Defense 30 (no effect yet)");
  });

  it("shows the warships' attack, the patrol and the harbor basins", () => {
    const ships = html({ section: "ships" });
    expect(ships).toMatch(/War cog/i);
    expect(ships).toContain("(no effect yet: raids come later)");
    expect(ships).toContain("Carries no cargo");
    expect(ships).toMatch(/data-testid="almanac-patrol"/);
    const islands = html({ section: "islands" });
    expect(islands).toMatch(/data-testid="almanac-basins"><h3[^>]*>Harbor basins<\/h3><p>The shallows reach 8 tiles/);
  });
});

describe("paintUnder", () => {
  it("takes the built and planned paint tiles of a rectangle, nothing else", () => {
    const b = (id: number, type: string, x: number, y: number) => ({ id, type, x, y, rotation: 0 }) as IslandDisplay["buildings"][number];
    const is = {
      buildings: [b(1, "hedge", 0, 0), b(2, "city_wall", 1, 0), b(3, "fountain", 2, 0)],
      plans: [{ id: 4, type: "square", x: 0, y: 1, rotation: 0 }],
    } as unknown as Pick<IslandDisplay, "buildings" | "plans">;
    const tiles = [0, 1, 2, 3].flatMap((x) => [0, 1].map((y) => ({ x, y })));
    expect(paintUnder(tiles, is, defs)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
  });
});
