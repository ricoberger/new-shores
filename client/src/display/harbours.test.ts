import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { shipWhere } from "../ui/ShipsPanel";
import { founderFor, pendingFoundingStep } from "./archipelago";
import { serverTimeMs } from "./extrapolate";
import { waterEdgeHint, waterRows } from "./geometry";
import { anchorSlots, berthDock, dockPoints, type ModelAnchor, pierHeading, pierLayout, pierPoint, seaPoint, shipLengthRatio, shipPlacement } from "./ships";

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
// The hand-made scenarios run on the pre-D-054 content (their "content"),
// so the footprints and water rows below are that content's.
const shipped = JSON.parse(readFileSync(join(root, "server", "testdata", "content", "old_coast_pre_d054", "buildings.json"), "utf8")) as {
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
    // It ends at Home's shore nearest its spawn (the server's path end; no Trading Post yet).
    const end = shipPlacement(s, islands, arrive)!;
    expect(end.point).toEqual(seaPoint(s.leg!.path![s.leg!.path!.length - 1]!));
    expect(shipWhere(s, depart + 1, (id) => id)).toMatch(/^arrives in/);
    // Before it sails: idle at sea at its position.
    const atSea = { ...s, state: "idle" as const, leg: null, island_id: "", position: from };
    expect(shipPlacement(atSea, islands, depart)).toEqual({ point: { x: from.x + 0.5, y: from.y + 0.5 }, heading: 0, atSea: true });
    expect(shipWhere(atSea, depart, (id) => id)).toBe("at sea");
    // Arrived at the unsettled island (no berths): it stays where its leg ended, not on the island (D-058).
    const arrived = { ...s, state: "idle" as const, leg: null, island_id: s.leg!.to_island_id };
    expect(shipPlacement(arrived, islands, arrive, 0, undefined, undefined, end.point)).toEqual({ point: end.point, heading: 0, atSea: false });
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
    expect(docks.get(2)).toEqual({ point: { x: is.position.x + b.x + 1.5, y: is.position.y + b.y - 1.5 }, heading: pierHeading(0), queued: true });
    const islands = new Map(d.islands.map((i) => [i.id, i]));
    const now = serverTimeMs(d.evaluated_at);
    for (const s of d.ships) expect(shipPlacement(s, islands, now, 0, undefined, docks.get(s.id))).toEqual({ point: docks.get(s.id)?.point, heading: docks.get(s.id)?.heading, atSea: false });
    expect(anchorSlots(d.ships, docks).size).toBe(0);
    // Fishers and shipyards hold no ships.
    const edge = display("water_edge_placement");
    expect([...dockPoints(edge.islands, defs).keys()]).toEqual([]);
  });

  // A pier front at y = 0 (rotation 0: out is −y), berth anchors 1.5 tiles apart, the middle pair first (the recipe's order).
  const pier = [
    { x: -0.75, y: 0 },
    { x: 0.75, y: 0 },
    { x: -2.25, y: 0 },
    { x: 2.25, y: 0 },
  ];

  it("moors ship i bow out from berth anchor i + 1, the sterns at the anchors and the bows fanned apart", () => {
    const docks = [0, 1, 2, 3].map((i) => berthDock(pier, 0, i, false, 2))!;
    docks.forEach((d, i) => {
      const a = pier[i]!;
      // The stern (2 tiles behind the origin) lies on the anchor; the ship points out to sea.
      expect(d!.point.x - Math.cos(d!.heading) * 2).toBeCloseTo(a.x);
      expect(d!.point.y - Math.sin(d!.heading) * 2).toBeCloseTo(a.y);
      expect(d!.point.y).toBeLessThan(0);
    });
    // Mirrored about the pier's centre; the outer berths turn further out than the middle ones.
    const turn = docks.map((d) => d!.heading - pierHeading(0));
    expect(turn[0]).toBeCloseTo(-turn[1]!);
    expect(turn[2]).toBeCloseTo(-turn[3]!);
    expect(Math.abs(turn[2]!)).toBeGreaterThan(Math.abs(turn[0]!));
    // Neighbouring hulls (2.2 tiles wide at scale 5, the origin 2.35 tiles ahead of the stern) clear each other amidships.
    const wide = [0, 2].map((i) => berthDock(pier, 0, i, false, 2.35)!.point.x);
    expect(wide[0]! - wide[1]!).toBeGreaterThan(2.2);
    // More ships than anchors, or no anchors at all: the caller falls back to the front row.
    expect(berthDock(pier, 0, 4, false, 2)).toBeNull();
    expect(berthDock([], 0, 0, false, 2)).toBeNull();
  });

  it("spaces the berths by ship length: no two moored hulls overlap at any Trading Post level, sterns on the pier front", () => {
    // Drawn hulls: 0.444 lengths wide (the models' beam), a reference ship 5 tiles long with its stern 2.35 tiles behind the origin (DOCK_STERN).
    const stern = 2.35;
    const beam = (r: number) => 0.444 * 5 * r;
    const ratios = [1, 1.3, 1.6]; // sloop, brig, galleon (length_tiles 2, 2.6, 3.2)
    for (let berths = 1; berths <= 4; berths++) {
      const combos: number[][] = [[]];
      for (let k = 0; k < berths; k++) combos.splice(0, combos.length, ...combos.flatMap((c) => ratios.map((r) => [...c, r])));
      for (const moored of combos) {
        for (const rot of [0, 90]) {
          const anchors = rot === 0 ? pier : pier.map((a) => ({ x: -a.y, y: a.x }));
          const out = pierLayout(anchors, rot, moored, [1, 1.6], stern);
          const docks = out.moored.map((d) => d!);
          docks.forEach((d, i) => {
            // Stern-first: the stern lies on the pier front (the anchors' line), the bow points out to sea.
            const sx = d.point.x - Math.cos(d.heading) * stern * moored[i]!;
            const sy = d.point.y - Math.sin(d.heading) * stern * moored[i]!;
            expect(rot === 0 ? sy : -sx).toBeCloseTo(0);
            expect(Math.cos(d.heading - pierHeading(rot))).toBeGreaterThan(0.3);
          });
          for (let a = 0; a < docks.length; a++) {
            for (let b = a + 1; b < docks.length; b++) {
              const gap = Math.hypot(docks[a]!.point.x - docks[b]!.point.x, docks[a]!.point.y - docks[b]!.point.y);
              expect(gap, `${berths} berths ${moored} ships ${a}/${b}`).toBeGreaterThan((beam(moored[a]!) + beam(moored[b]!)) / 2);
            }
          }
          // The queue waits beyond the longest moored bow.
          const reach = Math.max(...moored) * 2 * stern;
          for (const q of out.queued) expect(rot === 0 ? -q!.point.y : q!.point.x).toBeGreaterThan(reach + 1.6 * stern);
        }
      }
    }
    // Reference-length ships lie exactly on the anchors (unchanged from berthDock).
    const sloops = pierLayout(pier, 0, [1, 1, 1, 1], [], 2).moored;
    sloops.forEach((d, i) => expect(d).toEqual(berthDock(pier, 0, i, false, 2)));
    expect(sloops[0]!.point.x - Math.cos(sloops[0]!.heading) * 2).toBeCloseTo(-0.75);
    // A brig in the first slot pushes the third ship (same side) outwards.
    const mixed = pierLayout(pier, 0, [1.3, 1, 1], [], 2).moored;
    expect(mixed[2]!.point.x).toBeLessThan(sloops[2]!.point.x);
    expect(shipLengthRatio({ length_milli_tiles: 2_600 })).toBeCloseTo(1.3);
    expect(shipLengthRatio({})).toBe(1);
  });

  it("queues waiting ships bow out beyond the moored bows, centre first, the next row further out", () => {
    const q = [0, 1, 2, 5].map((i) => berthDock(pier, 0, i, true, 2)!);
    for (const d of q) expect(d.heading).toBeCloseTo(pierHeading(0));
    // Beyond the moored ships' bows (2 × stern out) with a gap: origin ≥ 3 × stern out.
    expect(q[0]!.point.x).toBeCloseTo(0);
    expect(q[0]!.point.y).toBeCloseTo(-7);
    expect(q[1]!.point.y).toBeCloseTo(-7);
    expect(Math.abs(q[1]!.point.x - q[2]!.point.x)).toBeCloseTo(5);
    expect(q[3]!.point.y).toBeLessThan(q[0]!.point.y - 4);
    // Rotation 90: out is +x.
    const r90 = berthDock(
      pier.map((a) => ({ x: -a.y, y: a.x })),
      90,
      0,
      true,
      2,
    )!;
    expect(r90.point.x).toBeCloseTo(7);
  });

  it("fills the Trading Post's own berths first, then the trading piers' (D-060)", () => {
    const d = structuredClone(display("berth_queue"));
    const is = d.islands[0]!;
    const tp = is.buildings.find((x) => x.type === "trading_post")!;
    const ships = [...tp.berths!.ships, ...tp.berths!.queue];
    tp.berths = { total: 3, busy: ships.length, ships, queue: [] };
    tp.level = 1;
    const pier = { ...tp, id: 999, type: "trading_pier", x: tp.x + 8, berths: undefined };
    is.buildings.push(pier);
    const pierDefs = new Map<string, { width: number; height: number; water_tiles?: number; trading_post?: unknown; pier?: { berths: number } }>(defs);
    pierDefs.set("trading_post", { ...defs.get("trading_post")!, trading_post: { levels: [{ berths: 1 }] } });
    pierDefs.set("trading_pier", { width: 3, height: 4, water_tiles: 3, pier: { berths: 2 } });
    const docks = dockPoints(d.islands, pierDefs);
    const at = (p: { x: number; y: number } | null) => ({ x: is.position.x + p!.x, y: is.position.y + p!.y });
    expect(docks.get(ships[0]!)?.point).toEqual(at(pierPoint(defs.get("trading_post")!, tp, 0, false)));
    expect(docks.get(ships[1]!)?.point).toEqual(at(pierPoint(pierDefs.get("trading_pier")!, pier, 0, false)));
    // Without the content's levels every ship stays at the Trading Post.
    expect(dockPoints(d.islands, defs).get(ships[1]!)?.point).toEqual(at(pierPoint(defs.get("trading_post")!, tp, 1, false)));
  });

  it("lays the docks on the model's berth anchors when given, else along the front row", () => {
    const d = display("berth_queue");
    const is = d.islands[0]!;
    const b = is.buildings.find((x) => x.type === "trading_post")!;
    const anchor: ModelAnchor = (bb, _def, name) => {
      const i = ["berth_1", "berth_2", "berth_3", "berth_4"].indexOf(name);
      return i < 0 ? null : { x: bb.x + pier[i]!.x + 3, y: bb.y + 0.5, h: 0.06 };
    };
    const docks = dockPoints(d.islands, defs, anchor, 2);
    const moored = berthDock(
      pier.map((a) => ({ x: is.position.x + b.x + a.x + 3, y: is.position.y + b.y + 0.5 })),
      b.rotation,
      0,
      false,
      2,
    )!;
    expect(docks.get(1)?.point.x).toBeCloseTo(moored.point.x);
    expect(docks.get(1)?.point.y).toBeCloseTo(moored.point.y);
    expect(docks.get(1)?.heading).toBeCloseTo(moored.heading);
    expect(docks.get(2)?.queued).toBe(true);
    // An anchor that is missing (model not loaded): the front row.
    expect(dockPoints(d.islands, defs, () => null, 2)).toEqual(dockPoints(d.islands, defs));
  });
});
