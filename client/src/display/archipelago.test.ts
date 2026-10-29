import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { cargoCoversWarehouse, depositCounts, foundingShips, islandSummary } from "./archipelago";
import { createdRouteId, draftFromRoute, ribbonLegs, ribbonsShown, signedUnits, stopsFromDraft } from "./routes";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const content = {
  buildings: [{ id: "trading_post", trading_post: { levels: [] }, cost: { gold: 200_000, materials: { planks: 20_000 } } }],
} as unknown as Content;

describe("island summary", () => {
  it("sums population, warehouse fill and warnings from display numbers", () => {
    const d = fixture("route_loop");
    const start = d.islands.find((i) => i.id === "start")!;
    const s = islandSummary(start);
    const stock = Object.values(start.inventory).reduce((a, g) => a + g.stock, 0);
    const cap = Object.values(start.inventory).reduce((a, g) => a + g.capacity, 0);
    expect(s.fillPercent).toBe(Math.round((stock / cap) * 100));
    expect(s.population).toBe(Object.values(start.population).reduce((a, v) => a + v, 0));
    expect(s.warnings).toBe(start.buildings.filter((b) => b.status !== "ok").length);
    const unsettled = fixture("ship_insolvency").islands.find((i) => !i.settled)!;
    expect(islandSummary(unsettled).fillPercent).toBeNull();
  });

  it("counts deposit tiles by kind", () => {
    expect(depositCounts({ deposits: [{ x: 0, y: 0, kind: "stone" }, { x: 1, y: 0, kind: "iron" }, { x: 2, y: 0, kind: "stone" }] })).toEqual([
      { kind: "iron", tiles: 1 },
      { kind: "stone", tiles: 2 },
    ]);
    expect(depositCounts(undefined)).toEqual([]);
  });

  it("founding ships (cargo covers the warehouse materials)", () => {
    const d = fixture("ship_insolvency");
    const ship = d.ships[0]!;
    expect(cargoCoversWarehouse([{ good: "planks", amount: 50_000 }], content)).toBe(true);
    expect(cargoCoversWarehouse([{ good: "planks", amount: 10_000 }], content)).toBe(false);
    const withCargo = { ...d, ships: [{ ...ship, cargo: [{ good: "planks", amount: 20_000 }] }] };
    expect(foundingShips(withCargo, content, ship.island_id).map((s) => s.id)).toEqual([ship.id]);
  });
});

describe("route drafts", () => {
  it("round-trips a saved route in whole units and milli-units", () => {
    const r = fixture("route_loop").routes[0]!;
    const d = draftFromRoute(r);
    expect(d.stops[0]!.load[0]).toEqual({ good: "wood", max: 100 });
    expect(stopsFromDraft(d)).toEqual(r.stops);
    expect(signedUnits(-50_000)).toBe("−50");
    expect(signedUnits(40_000)).toBe("+40");
    expect(signedUnits(0)).toBe("0");
    expect(createdRouteId([r], [r, { ...r, id: 2 }])).toBe(2);
    expect(createdRouteId([r], [r])).toBeNull();
  });
});

describe("route ribbons shown", () => {
  // Route 1's legs a → b and b → a go around land; route 2 has no voyages (straight ribbons).
  const voyage = [
    { x: 10, y: 10 },
    { x: 20, y: 30 },
    { x: 40, y: 30 },
  ];
  const route = (id: number, stops: string[], paths: { x: number; y: number }[][] = stops.map(() => [])) => ({
    id,
    name: `r${id}`,
    stops: stops.map((island_id) => ({ island_id, load: [], unload: [] })),
    ship_ids: [],
    paths,
  });
  const routes = [route(1, ["a", "b"], [voyage, [...voyage].reverse()]), route(2, ["b", "c"])] as unknown as DisplayState["routes"];

  it("draws none without a selected ship's route or the editor", () => {
    expect(ribbonsShown(routes, null, null)).toEqual([]);
  });

  it("draws only the selected ship's route, bright", () => {
    expect(ribbonsShown(routes, 2, null)).toEqual([{ key: "route_2", stops: ["b", "c"], paths: [[], []], colorIndex: 1, bright: true }]);
  });

  it("draws every route while the editor is open: the edited one bright, the others faint, plus the draft", () => {
    const r = ribbonsShown(routes, 1, ["a", "b"]);
    expect(r.map((x) => [x.key, x.bright])).toEqual([
      ["route_1", true],
      ["route_2", false],
      ["draft", true],
    ]);
    // A new route without stops yet: every saved route faintly.
    expect(ribbonsShown(routes, null, []).map((x) => [x.key, x.bright])).toEqual([
      ["route_1", false],
      ["route_2", false],
    ]);
  });
});

describe("route ribbons along the voyages (D-058)", () => {
  const anchors: Record<string, { x: number; y: number }> = { a: { x: 9, y: 9 }, b: { x: 42, y: 31 }, c: { x: 80, y: 0 } };
  const anchor = (id: string) => anchors[id] ?? null;
  const voyage = [
    { x: 10, y: 10 },
    { x: 20, y: 30 },
    { x: 40, y: 30 },
  ];
  const centres = voyage.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));

  it("runs each leg from its stop's anchor along the voyage (harbour ends kept) to the next stop's anchor", () => {
    const legs = ribbonLegs(["a", "b"], [voyage, [...voyage].reverse()], anchor);
    expect(legs).toEqual([
      [anchors.a, ...centres, anchors.b],
      [anchors.b, ...[...centres].reverse(), anchors.a],
    ]);
    // Without a voyage: the straight line; a stop without an anchor drops its legs.
    expect(ribbonLegs(["b", "c"], [], anchor)).toEqual([
      [anchors.b, anchors.c],
      [anchors.c, anchors.b],
    ]);
    expect(ribbonLegs(["a", "x"], [], anchor)).toEqual([]);
  });

  it("lets the draft follow the voyages its legs share with a saved route, in either direction", () => {
    const route = { id: 1, name: "r1", stops: ["a", "b"].map((island_id) => ({ island_id, load: [], unload: [] })), ship_ids: [], paths: [voyage, []] };
    const draft = ribbonsShown([route] as unknown as DisplayState["routes"], null, ["b", "a", "c"]).find((r) => r.key === "draft")!;
    // b → a is the reverse of the saved a → b; a → c and c → b are unknown.
    expect(draft.paths).toEqual([[...voyage].reverse(), undefined, undefined]);
  });
});
