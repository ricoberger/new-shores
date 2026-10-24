import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { shipWhere } from "../ui/ShipsPanel";
import { founderFor, pendingFoundingStep } from "./archipelago";
import { serverTimeMs } from "./extrapolate";
import { waterEdgeHint, waterRows } from "./geometry";
import { anchorSlots, dockPoints, islandAnchor, pierHeading, pierPoint, shipPlacement } from "./ships";

// The harbour displays of D-051 against the shared fixtures: water-edge
// ghosts (the scenario's island rows and the shipped water_tiles), ships
// at sea and in the berth queue, and the client's chained founding.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const display = (name: string) => (JSON.parse(readFileSync(join(root, "server", "testdata", "display", `${name}.json`), "utf8")) as { base: DisplayState }).base;
const scenario = (name: string) =>
  JSON.parse(readFileSync(join(root, "server", "testdata", "scenarios", `${name}.json`), "utf8")) as {
    island: { rows: string[] };
    steps: { place?: { type: string; x: number; y: number; rotation: number }; expect_error?: string }[];
  };
const shipped = JSON.parse(readFileSync(join(root, "content", "old_coast", "buildings.json"), "utf8")) as {
  id: string;
  footprint: [number, number];
  water_tiles?: number;
}[];
const defs = new Map(
  shipped.map((b) => [b.id, { width: b.footprint[0], height: b.footprint[1], water_tiles: b.water_tiles, ...(b.id === "trading_post" ? { trading_post: {} } : {}) }]),
);

describe("water-edge footprints", () => {
  it("marks the front rows at every rotation (the server's sim.WaterTile)", () => {
    const fisher = defs.get("fisher")!;
    expect(waterRows(fisher, 4, 6, 0)).toEqual({ x: 4, y: 6, w: 2, h: 1 });
    expect(waterRows(fisher, 4, 6, 90)).toEqual({ x: 5, y: 6, w: 1, h: 2 });
    expect(waterRows(fisher, 4, 6, 180)).toEqual({ x: 4, y: 7, w: 2, h: 1 });
    expect(waterRows(fisher, 4, 6, 270)).toEqual({ x: 4, y: 6, w: 1, h: 2 });
    expect(waterRows(defs.get("trading_post")!, 2, 0, 0)).toEqual({ x: 2, y: 0, w: 4, h: 2 });
    expect(waterRows(defs.get("house_settlers")!, 2, 0, 0)).toBeNull();
  });

  it("flags a land row over the water", () => {
    const fisher = defs.get("fisher")!;
    // Rows 0–1 water, land below: the fisher at y 0 has both rows on the water.
    const terrain = (_x: number, y: number) => (y < 2 ? "water" : "land");
    expect(waterEdgeHint(fisher, terrain, 4, 1, 0)).toBeNull();
    expect(waterEdgeHint(fisher, terrain, 4, 0, 0)).toBe("land");
    expect(waterEdgeHint(fisher, terrain, 4, 2, 0)).toBe("front");
  });

  it("agrees with the server on the water_edge_placement scenario", () => {
    const sc = scenario("water_edge_placement");
    const rows = sc.island.rows;
    const terrain = (x: number, y: number) => (y < 0 || y >= rows.length || x < 0 || x >= (rows[0]?.length ?? 0) || rows[y]![x] === "~" ? "water" : "land");
    // Every water-edge building the server accepted fits.
    const placed = display("water_edge_placement").islands[0]!.buildings.filter((b) => (defs.get(b.type)?.water_tiles ?? 0) > 0);
    expect(placed.length).toBeGreaterThanOrEqual(6);
    for (const b of placed) expect(waterEdgeHint(defs.get(b.type)!, terrain, b.x, b.y, b.rotation), `${b.type} at ${b.x},${b.y}`).toBeNull();
    // The rejected ones are red too. The fisher facing land (rotation 180 on
    // the north coast) has both its rows wrong: the server reports the
    // terrain first, the hint the front row (rotating it fixes both).
    const failures = sc.steps.filter((s) => s.place && s.expect_error && s.place.type !== "trading_post");
    expect(failures.map((s) => [s.expect_error, waterEdgeHint(defs.get(s.place!.type)!, terrain, s.place!.x, s.place!.y, s.place!.rotation)])).toEqual([
      ["not_on_water", "front"],
      ["terrain", "front"],
      ["not_on_water", "front"],
    ]);
  });
});

describe("ships at sea and at the pier", () => {
  it("draws the start ship's leg from its sea position", () => {
    const d = display("start_voyage");
    const s = d.ships[0]!;
    const islands = new Map(d.islands.map((i) => [i.id, i]));
    const depart = serverTimeMs(s.leg!.depart_at);
    const arrive = serverTimeMs(s.leg!.arrive_at);
    const from = s.leg!.from_position!;
    expect(shipPlacement(s, islands, depart)).toEqual(expect.objectContaining({ point: { x: from.x + 0.5, y: from.y + 0.5 } }));
    const mid = shipPlacement(s, islands, (depart + arrive) / 2)!;
    expect(mid.atSea).toBe(true);
    const end = shipPlacement(s, islands, arrive)!;
    expect(end.point).toEqual(islandAnchor(islands.get(s.leg!.to_island_id)!));
    expect(shipWhere(s, depart + 1, (id) => id)).toMatch(/^arrives in/);
    // Before it sails: idle at sea at its position.
    const atSea = { ...s, state: "idle" as const, leg: null, island_id: "", position: from };
    expect(shipPlacement(atSea, islands, depart)).toEqual({ point: { x: from.x + 0.5, y: from.y + 0.5 }, heading: 0, atSea: true });
    expect(shipWhere(atSea, depart, (id) => id)).toBe("at sea");
  });

  it("names the ship at the pier and the one waiting for its berth", () => {
    const d = display("berth_queue");
    const tp = d.islands[0]!.buildings.find((b) => b.type === "trading_post")!;
    expect(tp.berths).toEqual({ total: 1, busy: 1, ships: [1], queue: [2] });
    const now = serverTimeMs(d.evaluated_at);
    const [unloading, waiting] = d.ships;
    expect(shipWhere(unloading!, now, (id) => id)).toMatch(/^unloading at harbour \(/);
    expect(shipWhere(waiting!, now, (id) => id)).toBe("waiting for a berth at harbour");
  });
});

describe("founding from the island card", () => {
  const content = {
    buildings: [{ id: "trading_post", trading_post: { levels: [] }, cost: { gold: 200_000, materials: { planks: 15_000 } } }],
  } as unknown as Content;

  it("picks the ship idle here first, else the one at sea, and only with the materials aboard", () => {
    const d = display("start_voyage");
    const s = d.ships[0]!;
    const atSea = { ...s, state: "idle" as const, leg: null, island_id: "", position: { x: 20, y: 20 }, cargo: [{ good: "planks", amount: 150_000 }] };
    const model = { ...d, ships: [atSea] };
    expect(founderFor(model, content, "home")?.id).toBe(s.id);
    expect(founderFor({ ...model, ships: [{ ...atSea, cargo: [] }] }, content, "home")).toBeNull();
    const here = { ...atSea, id: 9, position: null, island_id: "home" };
    expect(founderFor({ ...model, ships: [atSea, here] }, content, "home")?.id).toBe(9);
    expect(founderFor({ ...model, islands: model.islands.map((i) => ({ ...i, settled: true })) }, content, "home")).toBeNull();
  });

  it("founds when the ship is idle there, waits while it sails, drops otherwise", () => {
    const d = display("start_voyage");
    const s = d.ships[0]!;
    const p = { shipId: s.id, islandId: s.leg!.to_island_id, x: 1, y: 0, rotation: 0 };
    expect(pendingFoundingStep(p, d)).toBe("wait");
    const arrived = { ...d, ships: [{ ...s, state: "idle" as const, leg: null, island_id: p.islandId }] };
    expect(pendingFoundingStep(p, arrived)).toBe("found");
    expect(pendingFoundingStep({ ...p, islandId: "other" }, d)).toBe("drop");
    expect(pendingFoundingStep(p, { ...arrived, islands: arrived.islands.map((i) => ({ ...i, settled: true })) })).toBe("drop");
    expect(pendingFoundingStep({ ...p, shipId: 99 }, d)).toBe("drop");
  });
});

describe("moorings at the Trading Post's pier", () => {
  const tp = defs.get("trading_post")!;

  it("puts pier slot i at tile i of the front row one tile out, the queue one tile further and spaced", () => {
    const at0 = { x: 2, y: 0, rotation: 0 as const };
    expect([0, 1, 2, 3].map((i) => pierPoint(tp, at0, i, false))).toEqual([
      { x: 2.5, y: -0.5 },
      { x: 3.5, y: -0.5 },
      { x: 4.5, y: -0.5 },
      { x: 5.5, y: -0.5 },
    ]);
    // Between two pier slots, two tiles apart; the next row staggered back.
    expect([0, 1, 2, 3].map((i) => pierPoint(tp, at0, i, true))).toEqual([
      { x: 3.5, y: -1.5 },
      { x: 5.5, y: -1.5 },
      { x: 2.5, y: -2.5 },
      { x: 4.5, y: -2.5 },
    ]);
    // Rotated: out is +x at 90, +y at 180, −x at 270.
    expect(pierPoint(tp, { x: 0, y: 0, rotation: 90 }, 1, false)).toEqual({ x: 4.5, y: 1.5 });
    expect(pierPoint(tp, { x: 2, y: 28, rotation: 180 }, 0, false)).toEqual({ x: 2.5, y: 32.5 });
    expect(pierPoint(tp, { x: 6, y: 3, rotation: 270 }, 2, true)).toEqual({ x: 3.5, y: 3.5 });
    // Moored ships point out to sea.
    expect(pierHeading(0)).toBeCloseTo(-Math.PI / 2);
    expect(pierHeading(180)).toBeCloseTo(Math.PI / 2);
    // Not a water-edge building: no pier.
    expect(pierPoint(defs.get("house_settlers")!, at0, 0, false)).toBeNull();
  });

  it("moors the unloading ship at the pier and the waiting one in the queue, both off the idle berths", () => {
    const d = display("berth_queue");
    const docks = dockPoints(d.islands, defs);
    const is = d.islands[0]!;
    const b = is.buildings.find((x) => x.type === "trading_post")!;
    expect(docks.get(1)).toEqual({ point: { x: is.position.x + b.x + 0.5, y: is.position.y + b.y - 0.5 }, heading: pierHeading(0) });
    expect(docks.get(2)).toEqual({ point: { x: is.position.x + b.x + 1.5, y: is.position.y + b.y - 1.5 }, heading: pierHeading(0) });
    const islands = new Map(d.islands.map((i) => [i.id, i]));
    const now = serverTimeMs(d.evaluated_at);
    for (const s of d.ships) expect(shipPlacement(s, islands, now, 0, undefined, docks.get(s.id))).toEqual({ ...docks.get(s.id), atSea: false });
    expect(anchorSlots(d.ships, docks).size).toBe(0);
    // Fishers and shipyards hold no ships.
    const edge = display("water_edge_placement");
    expect([...dockPoints(edge.islands, defs).keys()]).toEqual([]);
  });
});
