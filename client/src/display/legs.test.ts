import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DisplayState, ShipDisplay } from "../api/client";
import { serverTimeMs } from "./extrapolate";
import { anchorSlots, islandAnchor, type IslandPlacement, shipPlacement, spreadOffset } from "./ships";

// Leg interpolation of the archipelago view against the server's display
// fixtures (TestDisplayFixtures): positions are lerps of the leg
// timestamps between island anchors (silhouette centres).
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

function placements(d: DisplayState): Map<string, IslandPlacement> {
  return new Map(d.islands.map((is) => [is.id, { position: is.position, width: is.width, height: is.height }]));
}

describe("ship placement against the server fixtures", () => {
  it("anchors are silhouette centres", () => {
    const d = fixture("ship_display");
    const pl = placements(d);
    // start 30×14 at (0,0); island2 18×8 at (36,48).
    expect(islandAnchor(pl.get("start")!)).toEqual({ x: 15, y: 7 });
    expect(islandAnchor(pl.get("island2")!)).toEqual({ x: 45, y: 52 });
  });

  it("a manual leg: at the origin before depart_at, lerped mid-leg, at the destination after arrive_at", () => {
    const d = fixture("ship_display");
    const ship = d.ships[0]!;
    const pl = placements(d);
    const leg = ship.leg!;
    const depart = serverTimeMs(leg.depart_at);
    const arrive = serverTimeMs(leg.arrive_at);
    const a = islandAnchor(pl.get(leg.from_island_id)!);
    const b = islandAnchor(pl.get(leg.to_island_id)!);
    // Handling: at the origin's anchor plus the berth offset of its slot.
    const o0 = spreadOffset(0);
    expect(shipPlacement(ship, pl, depart - 5_000)).toMatchObject({ point: { x: a.x + o0.x, y: a.y + o0.y }, atSea: false });
    expect(shipPlacement(ship, pl, depart)!.point).toEqual(a);
    const mid = shipPlacement(ship, pl, (depart + arrive) / 2)!;
    expect(mid.atSea).toBe(true);
    expect(mid.point.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(mid.point.y).toBeCloseTo((a.y + b.y) / 2, 6);
    const quarter = shipPlacement(ship, pl, depart + (arrive - depart) / 4)!;
    expect(quarter.point.x).toBeCloseTo(a.x + (b.x - a.x) / 4, 6);
    expect(shipPlacement(ship, pl, arrive + 60_000)).toMatchObject({ point: b, atSea: false });
    // Heading points from the origin to the destination.
    expect(mid.heading).toBeCloseTo(Math.atan2(b.y - a.y, b.x - a.x), 9);
    // At the payload's evaluated_at the ship is between the two anchors.
    const now = shipPlacement(ship, pl, serverTimeMs(d.evaluated_at))!;
    expect(now.point.x).toBeGreaterThan(a.x);
    expect(now.point.x).toBeLessThan(b.x);
  });

  it("a route ship handling cargo stays at the origin anchor until depart_at", () => {
    const d = fixture("route_loop");
    const ship = d.ships[0]!;
    expect(ship.state).toBe("on_route");
    const pl = placements(d);
    const now = serverTimeMs(d.evaluated_at);
    expect(now).toBeLessThan(serverTimeMs(ship.leg!.depart_at));
    const a = islandAnchor(pl.get(ship.leg!.from_island_id)!);
    const o = spreadOffset(0);
    expect(shipPlacement(ship, pl, now)!.point).toEqual({ x: a.x + o.x, y: a.y + o.y });
  });

  it("idle and anchored_unpaid ships are at their island's anchor plus a deterministic spread", () => {
    const d = fixture("manual_shipment_excess");
    const idle = d.ships[0]!;
    expect(idle.state).toBe("idle");
    const pl = placements(d);
    const a = islandAnchor(pl.get(idle.island_id)!);
    const o0 = spreadOffset(0);
    expect(shipPlacement(idle, pl, 0)).toEqual({ point: { x: a.x + o0.x, y: a.y + o0.y }, heading: 0, atSea: false });
    // The berth is off the anchor (the island label sits there).
    expect(Math.hypot(o0.x, o0.y)).toBeGreaterThan(3);
    const anchored: ShipDisplay = { ...fixture("ship_insolvency").ships[0]!, state: "anchored_unpaid", paused: true, paused_reason: "unpaid" };
    const pl2 = placements(fixture("ship_insolvency"));
    const b = islandAnchor(pl2.get(anchored.island_id)!);
    const o = spreadOffset(1);
    expect(shipPlacement(anchored, pl2, 0, 1)!.point).toEqual({ x: b.x + o.x, y: b.y + o.y });
    expect(o).not.toEqual(o0);
  });

  it("spread slots are per island by ascending ID; ships at sea get none", () => {
    const leg = { from_island_id: "a", to_island_id: "b", depart_at: "2026-01-01T00:00:10.000Z", arrive_at: "2026-01-01T00:01:00.000Z" };
    const ships = [
      { id: 5, island_id: "a", leg: null },
      { id: 2, island_id: "a", leg: null },
      { id: 9, island_id: "", leg },
      { id: 7, island_id: "b", leg: null },
    ];
    const before = anchorSlots(ships, serverTimeMs("2026-01-01T00:00:00.000Z"));
    expect([...before.entries()].sort()).toEqual([
      [2, 0],
      [5, 1],
      [7, 0],
      [9, 2],
    ]);
    const after = anchorSlots(ships, serverTimeMs("2026-01-01T00:00:30.000Z"));
    expect(after.has(9)).toBe(false);
    // Distinct offsets for the first ships of a ring.
    const offs = [0, 1, 2, 3, 7].map((i) => spreadOffset(i));
    expect(new Set(offs.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`)).size).toBe(offs.length);
  });

  it("unknown islands give no placement", () => {
    expect(shipPlacement({ island_id: "nowhere", leg: null }, new Map(), 0)).toBeNull();
  });
});
