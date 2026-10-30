import { describe, expect, it } from "vitest";
import type { BuildingDisplay } from "../api/client";
import { flankDocks, type FlankEntry, isFlankAnchor, withIdleAtPier } from "./moorings";
import { pierHeading } from "../display/ships";
import { buildingAnchor, type ModelEntry } from "./models";

const tp = (ships: number[], queue: number[], total = 2): BuildingDisplay => ({ type: "trading_post", berths: { total, busy: ships.length, ships, queue } }) as unknown as BuildingDisplay;
const island = (id: string, ...buildings: BuildingDisplay[]) => ({ id, buildings });

describe("idle ships at the pier", () => {
  it("puts idle ships into the free berths, the rest at the end of the queue", () => {
    const out = withIdleAtPier([island("a", tp([1], [9]))], [
      { id: 1, state: "manual_leg", island_id: "a", leg: {} },
      { id: 4, state: "idle", island_id: "a" },
      { id: 3, state: "anchored_unpaid", island_id: "a" },
      { id: 9, state: "waiting_for_berth", island_id: "a" },
    ]);
    expect(out[0]!.buildings[0]!.berths).toEqual({ total: 2, busy: 1, ships: [1, 3], queue: [9, 4] });
  });

  it("leaves other islands, ships on legs and ships already listed alone", () => {
    const a = island("a", tp([5], []));
    const b = island("b", { type: "house" } as unknown as BuildingDisplay);
    const out = withIdleAtPier([a, b], [
      { id: 5, state: "idle", island_id: "a" },
      { id: 6, state: "on_route", island_id: "a", leg: {} },
      { id: 7, state: "idle", island_id: "b" },
    ]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});

describe("flank berths", () => {
  // A synthetic manifest: a 3 × 9 pier, model space centred on the footprint (x across, z along; the front at +z).
  const W = 3;
  const H = 9;
  const flankEntry = { kind: "building", footprint: { w: W, h: H }, bounds: { min: [-1.5, 0, -4.5], max: [1.5, 1, 4.5] }, anchors: { berth_1: [-(W / 2 + 1.2), 0, 0], berth_2: [W / 2 + 1.2, 0, 0] } } as unknown as ModelEntry;
  const frontEntry = { kind: "building", footprint: { w: W, h: H }, bounds: { min: [-1.5, 0, -4.5], max: [1.5, 1, 4.5] }, anchors: { berth_1: [-0.75, 0, 4.35], berth_2: [0.75, 0, 4.35] } } as unknown as ModelEntry;
  const def = { width: W, height: H, trading_post: {} };
  const defs = new Map([["trading_pier", def]]);
  const pier = (rotation: number, ships: number[], queue: number[] = []) =>
    ({ position: { x: 100, y: 200 }, buildings: [{ type: "trading_pier", x: 10, y: 20, rotation, berths: { total: 2, busy: ships.length, ships, queue } } as unknown as BuildingDisplay] });

  it("tells flank anchors (outside the footprint's x-range) from front anchors", () => {
    expect(isFlankAnchor(flankEntry as unknown as FlankEntry, "berth_1")).toBe(true);
    expect(isFlankAnchor(flankEntry as unknown as FlankEntry, "berth_2")).toBe(true);
    expect(isFlankAnchor(frontEntry as unknown as FlankEntry, "berth_1")).toBe(false);
    expect(isFlankAnchor(flankEntry as unknown as FlankEntry, "berth_3")).toBe(false);
  });

  it("lays a front-berth pier to dockPoints: no flank docks", () => {
    const anchor = (b: BuildingDisplay, d: { width: number; height: number }, n: string) => buildingAnchor(frontEntry, d, b, n);
    expect(flankDocks([pier(0, [1, 2])], defs, () => frontEntry as unknown as FlankEntry, anchor, 0.5).size).toBe(0);
  });

  for (const rot of [0, 90, 180, 270]) {
    it(`moors along the long axis, bow seaward, outside the pier's edge, at rotation ${rot}`, () => {
      const anchor = (b: BuildingDisplay, d: { width: number; height: number }, n: string) => buildingAnchor(flankEntry, d, b, n);
      const stern = 0.5;
      const is = pier(rot, [1, 2], [3, 4, 5]);
      const docks = flankDocks([is], defs, () => flankEntry as unknown as FlankEntry, anchor, stern, (id) => (id === 2 ? 1.6 : 1));
      const heading = pierHeading(rot);
      const [ox, oy] = [Math.cos(heading), Math.sin(heading)];
      const b = is.buildings[0] as BuildingDisplay;
      const [fw, fh] = rot === 90 || rot === 270 ? [H, W] : [W, H];
      const centre = { x: 100 + b.x + fw / 2, y: 200 + b.y + fh / 2 };
      // Distance across the long axis (signed) and along it from the pier's centre.
      const across = (p: { x: number; y: number }) => (p.x - centre.x) * -oy + (p.y - centre.y) * ox;
      const along = (p: { x: number; y: number }) => (p.x - centre.x) * ox + (p.y - centre.y) * oy;
      const a = docks.get(1)!;
      const c = docks.get(2)!;
      expect(a.heading).toBeCloseTo(heading, 9);
      expect(c.heading).toBeCloseTo(heading, 9);
      // Opposite flanks, each outside the footprint's half-width plus its half-beam (longer hulls are wider).
      expect(Math.sign(across(a.point))).toBe(-Math.sign(across(c.point)));
      expect(Math.abs(across(a.point))).toBeCloseTo(W / 2 + 1.2 + 0.4 * stern, 6);
      expect(Math.abs(across(c.point))).toBeCloseTo(W / 2 + 1.2 + 0.4 * stern * 1.6, 6);
      // Centred on the anchors along the flank (mid-water-row y).
      expect(along(a.point)).toBeCloseTo(0, 6);
      expect(along(c.point)).toBeCloseTo(0, 6);
      // The queue waits along the flanks, alternating sides, each row one hull further seaward.
      const q = [3, 4, 5].map((id) => docks.get(id)!);
      expect(q.every((d) => d.queued === true && d.heading === heading)).toBe(true);
      expect(Math.sign(across(q[0]!.point))).toBe(Math.sign(across(a.point)));
      expect(Math.sign(across(q[1]!.point))).toBe(Math.sign(across(c.point)));
      expect(Math.sign(across(q[2]!.point))).toBe(Math.sign(across(a.point)));
      expect(along(q[0]!.point)).toBeGreaterThan(2 * stern);
      expect(along(q[2]!.point)).toBeGreaterThan(along(q[0]!.point) + 2 * stern);
    });
  }
});
