import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, IslandDisplay } from "../api/client";
import type { Rotation } from "./geometry";
import { frameRect, groupFrame, groupGhost, groupOffset, groupRect, groupSelection, groupSize, type GroupDef, type GroupSite } from "./group";

interface FrameFixture {
  rect: [number, number, number, number];
  dx: number;
  dy: number;
  rotation: Rotation;
  from: [number, number, number, number];
  to: { x: number; y: number };
}
const frames = JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/group/frames.json"), "utf8")) as FrameFixture[];

describe("D-074 §5 group frame, shared with Go", () => {
  for (const f of frames) {
    it(`(${f.from.join(",")}) by (${f.dx},${f.dy}) / ${f.rotation}°`, () => {
      const [x0, y0, x1, y1] = f.rect;
      const [x, y, w, h] = f.from;
      expect(frameRect(groupFrame({ x0, y0, x1, y1 }, f.dx, f.dy, f.rotation), x, y, w, h)).toEqual(f.to);
    });
  }
});

const defs = new Map<string, GroupDef>([
  ["house", { width: 2, height: 2 }],
  ["farm", { width: 3, height: 2 }],
  ["hedge", { width: 1, height: 1, paint_family: {} }],
  ["pier", { width: 2, height: 2, harbour_lane: true, placement: "shore" }],
  ["road_dirt", { width: 1, height: 1, road: {} }],
  ["quay", { width: 1, height: 1, road: { shallows: true } }],
]);

const building = (id: number, type: string, x: number, y: number): BuildingDisplay => ({
  id,
  type,
  x,
  y,
  rotation: 0,
  paused: false,
  paused_reason: "",
  status: "ok",
  efficiency_permille: 1000,
  throughput_factor_permille: 1000,
});

// Land x 0..19 below the sea rows y 0..4.
const site: GroupSite = { width: 20, height: 20, terrain: (_x, y) => (y < 5 ? "water" : "grass"), defs };

function island(): Pick<IslandDisplay, "buildings" | "plans" | "roads" | "planned_roads"> {
  return {
    buildings: [building(2, "house", 6, 6), building(3, "farm", 8, 6), building(4, "hedge", 6, 9), building(5, "house", 11, 6)],
    plans: [{ id: 7, type: "house", x: 6, y: 10, rotation: 0 }] as IslandDisplay["plans"],
    roads: [
      { x: 6, y: 8, type: "road_dirt" },
      { x: 7, y: 8, type: "road_dirt" },
      { x: 12, y: 8, type: "road_dirt" },
    ] as IslandDisplay["roads"],
    planned_roads: [{ type: "road_dirt", tiles: [{ x: 8, y: 8 }] }] as IslandDisplay["planned_roads"],
  };
}

describe("D-074 §5 group selection", () => {
  it("takes what lies fully inside, in ID order", () => {
    // x 6..10, y 6..11: both houses' left one, the farm, the hedge, the plan, three road tiles; the house at x 11 stays.
    const sel = groupSelection(groupRect({ x: 10, y: 11 }, { x: 6, y: 6 }), island(), defs);
    expect(sel.pieces.map((p) => [p.id, p.plan])).toEqual([
      [2, false],
      [3, false],
      [4, false],
      [7, true],
    ]);
    expect(sel.roads).toEqual([
      { x: 6, y: 8, type: "road_dirt", planned: false },
      { x: 7, y: 8, type: "road_dirt", planned: false },
      { x: 8, y: 8, type: "road_dirt", planned: true },
    ]);
    expect(groupSize(sel)).toBe(7);
    // The farm reaches x 10: a rectangle to x 9 leaves it.
    expect(groupSelection(groupRect({ x: 6, y: 6 }, { x: 9, y: 7 }), island(), defs).pieces.map((p) => p.id)).toEqual([2]);
  });

  it("centres the turned rectangle on the pointer", () => {
    const r = groupRect({ x: 6, y: 6 }, { x: 10, y: 11 }); // 5 × 6
    expect(groupOffset(r, 0, { x: 8, y: 9 })).toEqual({ dx: 0, dy: 0 });
    expect(groupOffset(r, 90, { x: 8, y: 9 })).toEqual({ dx: -1, dy: 1 }); // 6 × 5
  });
});

describe("D-074 §5 group ghost", () => {
  const r = groupRect({ x: 6, y: 6 }, { x: 10, y: 11 });
  const sel = () => groupSelection(r, island(), defs);

  it("is green on free land, the group's own old tiles included", () => {
    const g = groupGhost(groupFrame(r, 0, 1, 0), sel(), island(), site);
    expect(g.every((p) => p.ok)).toBe(true);
    expect(g.find((p) => p.id === 2)).toMatchObject({ x: 6, y: 7, w: 2, h: 2 });
  });

  it("marks overlap with what stays, water and the island's edge", () => {
    // By +2: the farm (x 10..12) lands on the house at x 11 that stays; the house at x 6 on the farm's old tiles is fine.
    const over = groupGhost(groupFrame(r, 2, 0, 0), sel(), island(), site);
    expect(over.find((p) => p.id === 3)?.ok).toBe(false);
    expect(over.find((p) => p.id === 2)?.ok).toBe(true);
    // Up by 3: the houses' top rows on water.
    const wet = groupGhost(groupFrame(r, 0, -3, 0), sel(), island(), site);
    expect(wet.find((p) => p.id === 2)?.ok).toBe(false);
    expect(wet.find((p) => p.id === 7)?.ok).toBe(true);
    const off = groupGhost(groupFrame(r, 12, 0, 0), sel(), island(), site);
    expect(off.every((p) => !p.ok || (p.x + p.w <= 20 && p.y + p.h <= 20))).toBe(true);
    expect(off.some((p) => !p.ok)).toBe(true);
  });

  it("turns the pieces and keeps paint unturned; the named building is red", () => {
    const g = groupGhost(groupFrame(r, 0, 0, 90), sel(), island(), site, 3);
    // 5 × 6 turned: the farm (x 8..10, y 6..7 → u 2, v 0, 3 × 2) lands at u = 6 - 0 - 2 = 4, v = 2, as 2 × 3.
    expect(g.find((p) => p.id === 3)).toMatchObject({ x: 10, y: 8, w: 2, h: 3, ok: false });
    expect(g.find((p) => p.id === 4)).toMatchObject({ w: 1, h: 1 });
  });

  it("refuses a quay in a harbour lane", () => {
    const is = { buildings: [building(9, "pier", 2, 4)], plans: [], roads: [{ x: 14, y: 4, type: "quay" }], planned_roads: [] } as unknown as Pick<IslandDisplay, "buildings" | "plans" | "roads" | "planned_roads">;
    const q = groupRect({ x: 14, y: 4 }, { x: 14, y: 4 });
    const s = groupSelection(q, is, defs);
    // The pier's lane: x 1..4, y 0..3 (its front faces north).
    expect(groupGhost(groupFrame(q, -11, -2, 0), s, is, site)[0]?.ok).toBe(false);
    expect(groupGhost(groupFrame(q, -4, -2, 0), s, is, site)[0]?.ok).toBe(true);
  });
});
