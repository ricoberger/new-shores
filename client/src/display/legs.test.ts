import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DisplayState, ShipDisplay } from "../api/client";
import { serverTimeMs } from "./extrapolate";
import { alongPath, anchorSlots, berthAnchor, type Berths, islandAnchor, type IslandPlacement, legPath, seaPoint, shipPlacement, spreadOffset } from "./ships";

// Leg interpolation of the ships against the server's display
// fixtures (TestDisplayFixtures): positions are lerps of the leg
// timestamps along the leg's path around land (D-058 §5), its ends the
// first harbour berths when known, else the server's harbour or shore
// points.
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

  it("a manual leg: at the origin before depart_at, along the path around land, at the destination after arrive_at", () => {
    const d = fixture("ship_display");
    const ship = d.ships[0]!;
    const pl = placements(d);
    const leg = ship.leg!;
    const depart = serverTimeMs(leg.depart_at);
    const arrive = serverTimeMs(leg.arrive_at);
    // Without berths the ends are the server's points: the start island's
    // harbour and island 2's shore; the start island lies in between.
    const path = leg.path!;
    expect(path.length).toBeGreaterThan(2);
    const pts = legPath(leg, pl)!;
    expect(pts).toEqual(path.map(seaPoint));
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    // Handling: exactly at the origin's anchor (R-13), whatever its slot,
    // also immediately before departure; at depart_at the lerp starts there.
    expect(shipPlacement(ship, pl, depart - 5_000)).toMatchObject({ point: a, atSea: false });
    expect(shipPlacement(ship, pl, depart - 1, 3)).toMatchObject({ point: a, atSea: false });
    expect(shipPlacement(ship, pl, depart)!.point).toEqual(a);
    const justAfter = shipPlacement(ship, pl, depart + 1)!.point;
    expect(Math.hypot(justAfter.x - a.x, justAfter.y - a.y)).toBeLessThan(0.01);
    const mid = shipPlacement(ship, pl, (depart + arrive) / 2)!;
    expect(mid.atSea).toBe(true);
    expect(mid).toMatchObject(alongPath(pts, 0.5));
    expect(shipPlacement(ship, pl, arrive + 60_000)).toMatchObject({ point: b, atSea: false });
    // Every point of the voyage lies on one of the path's segments, never inside the start island's land (x 1..28, y 1..12).
    for (let i = 0; i <= 50; i++) {
      const p = shipPlacement(ship, pl, depart + ((arrive - depart) * i) / 50)!.point;
      expect(p.x >= 1 && p.x < 29 && p.y >= 1 && p.y < 13).toBe(false);
    }
  });

  it("alongPath: constant speed over the segments, heading of the current segment", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 30 },
    ];
    expect(alongPath(pts, 0)).toEqual({ point: { x: 0, y: 0 }, heading: 0 });
    expect(alongPath(pts, 0.125)).toEqual({ point: { x: 5, y: 0 }, heading: 0 });
    expect(alongPath(pts, 0.5)).toEqual({ point: { x: 10, y: 10 }, heading: Math.PI / 2 });
    expect(alongPath(pts, 2)).toEqual({ point: { x: 10, y: 30 }, heading: Math.PI / 2 });
    expect(alongPath([{ x: 1, y: 2 }], 0.5)).toEqual({ point: { x: 1, y: 2 }, heading: 0 });
  });

  it("a route ship handling cargo stays at the origin anchor until depart_at", () => {
    const d = fixture("route_loop");
    const ship = d.ships[0]!;
    expect(ship.state).toBe("on_route");
    const pl = placements(d);
    const now = serverTimeMs(d.evaluated_at);
    expect(now).toBeLessThan(serverTimeMs(ship.leg!.depart_at));
    expect(shipPlacement(ship, pl, now)!.point).toEqual(seaPoint(ship.leg!.path![0]!));
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

  it("spread slots are per island by ascending ID; ships with a leg get none", () => {
    const leg = { from_island_id: "a", from_position: null, to_island_id: "b", depart_at: "2026-01-01T00:00:10.000Z", arrive_at: "2026-01-01T00:01:00.000Z" };
    const ships = [
      { id: 5, island_id: "a", leg: null },
      { id: 2, island_id: "a", leg: null },
      { id: 9, island_id: "", leg },
      { id: 7, island_id: "b", leg: null },
    ];
    const slots = anchorSlots(ships);
    expect([...slots.entries()].sort()).toEqual([
      [2, 0],
      [5, 1],
      [7, 0],
    ]);
    // Distinct offsets for the first ships of a ring.
    const offs = [0, 1, 2, 3, 7].map((i) => spreadOffset(i));
    expect(new Set(offs.map((o) => `${o.x.toFixed(3)},${o.y.toFixed(3)}`)).size).toBe(offs.length);
  });

  it("with harbour berths: legs run between the first berths along the path, idle ships lie at the following berths", () => {
    const d = fixture("ship_display");
    const ship = d.ships[0]!;
    const pl = placements(d);
    const leg = ship.leg!;
    const berths: Berths = new Map([
      [leg.from_island_id, [{ x: 3.5, y: 14.5 }, { x: 5.5, y: 14.5 }, { x: 7.5, y: 14.5 }]],
      [leg.to_island_id, [{ x: 40.5, y: 47.5 }]],
    ]);
    const a = berthAnchor(leg.from_island_id, pl, berths)!;
    const b = berthAnchor(leg.to_island_id, pl, berths)!;
    expect(a).toEqual({ x: 3.5, y: 14.5 });
    expect(b).toEqual({ x: 40.5, y: 47.5 });
    const depart = serverTimeMs(leg.depart_at);
    const arrive = serverTimeMs(leg.arrive_at);
    expect(shipPlacement(ship, pl, depart - 1, 0, berths)!.point).toEqual(a);
    // The berths lead to and from the path's harbour ends (D-058: the hop from the pier to the harbour stays on the water); the waypoints stay.
    const pts = legPath(leg, pl, berths)!;
    expect(pts).toEqual([a, ...leg.path!.map(seaPoint), b]);
    const mid = shipPlacement(ship, pl, (depart + arrive) / 2, 0, berths)!.point;
    expect(mid).toEqual(alongPath(pts, 0.5).point);
    expect(shipPlacement(ship, pl, arrive + 1, 0, berths)!.point).toEqual(b);
    // An older payload without a path: the straight line between the berths.
    expect(legPath({ ...leg, path: undefined }, pl, berths)).toEqual([a, b]);
    // Idle ships: slot i at berth i + 1 (the first berth is the legs' anchor), the last berth when they run out.
    const idle = { island_id: leg.from_island_id, leg: null };
    expect(shipPlacement(idle, pl, 0, 0, berths)!.point).toEqual({ x: 5.5, y: 14.5 });
    expect(shipPlacement(idle, pl, 0, 1, berths)!.point).toEqual({ x: 7.5, y: 14.5 });
    expect(shipPlacement(idle, pl, 0, 5, berths)!.point).toEqual({ x: 7.5, y: 14.5 });
    // Without berths (static data not loaded): the island centre and the spread.
    expect(berthAnchor(leg.from_island_id, pl, new Map())).toEqual(islandAnchor(pl.get(leg.from_island_id)!));
    expect(berthAnchor("nowhere", pl, berths)).toBeNull();
  });

  it("unknown islands give no placement", () => {
    expect(shipPlacement({ island_id: "nowhere", leg: null }, new Map(), 0)).toBeNull();
  });
});
