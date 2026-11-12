import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harbourLanes, laneGhost, laneRect, laneTiles, type LaneDef, type LaneSite } from "./lane";
import { planRoadDrag } from "./roaddrag";

interface LaneFixture {
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  island_width: number;
  island_height: number;
  tiles: { x: number; y: number }[];
}
const fixtures = JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/lane/lanes.json"), "utf8")) as LaneFixture[];

const defs = new Map<string, LaneDef>([
  ["trading_pier", { width: 6, height: 9, harbour_lane: true, placement: "shore" }],
  ["harbour_statue", { width: 2, height: 2, placement: "shore" }],
  ["hedge", { width: 1, height: 1, paint_family: {} }],
  ["house", { width: 2, height: 2 }],
  ["quay", { width: 1, height: 1, road: { shallows: true } }],
  ["road", { width: 1, height: 1, road: {} }],
]);
const site = (buildings: LaneSite["buildings"], roads: LaneSite["roads"] = []): LaneSite => ({ width: 30, height: 30, buildings, roads, defs });

describe("D-078 harbour lanes, shared with Go", () => {
  it("covers every shipped berth holder", () => {
    expect(new Set(fixtures.map((f) => f.type))).toEqual(new Set(["depot", "kontor", "repair_crane", "shipyard", "trading_pier", "trading_post"]));
  });
  for (const f of fixtures) {
    it(`${f.type} at (${f.x},${f.y}) / ${f.rotation}°`, () => {
      expect(laneTiles({ width: f.width, height: f.height, harbour_lane: true }, f.x, f.y, f.rotation, f.island_width, f.island_height)).toEqual(f.tiles);
    });
  }
});

describe("lane ghost", () => {
  it("has no lane for a building without one", () => {
    expect(laneTiles({ width: 2, height: 2 }, 5, 5, 0, 30, 30)).toEqual([]);
    expect(laneRect({ width: 2, height: 2 }, 5, 5, 0, 30, 30)).toBeNull();
  });

  it("is the width plus a tile each side, four rows in front", () => {
    const pier = defs.get("trading_pier")!;
    expect(laneRect(pier, 10, 10, 0, 30, 30)).toEqual({ x: 9, y: 6, w: 8, h: 4 });
    expect(laneRect(pier, 10, 10, 180, 30, 30)).toEqual({ x: 9, y: 19, w: 8, h: 4 });
  });

  it("reds a shore building's tiles on another holder's lane, but not on its own", () => {
    const pier = { id: 1, type: "trading_pier", x: 10, y: 10, rotation: 0 };
    const tiles = laneGhost(defs.get("harbour_statue")!, 9, 8, 0, site([pier]));
    expect(tiles).toEqual([
      { x: 9, y: 8, blocked: true, lane: false },
      { x: 10, y: 8, blocked: true, lane: false },
      { x: 9, y: 9, blocked: true, lane: false },
      { x: 10, y: 9, blocked: true, lane: false },
    ]);
    expect(laneGhost(defs.get("harbour_statue")!, 9, 4, 0, site([pier]))).toEqual([]);
    // A moved holder ignores its old lane.
    expect(laneGhost(defs.get("trading_pier")!, 10, 11, 0, site([pier]), 1).every((p) => !p.blocked)).toBe(true);
  });

  it("reds a holder's own lane tiles over a quay, a shore building or a paint tile, not over a house or a road", () => {
    const pier = defs.get("trading_pier")!;
    const tiles = laneGhost(pier, 10, 10, 0, site([{ id: 2, type: "hedge", x: 9, y: 6, rotation: 0 }, { id: 3, type: "house", x: 12, y: 6, rotation: 0 }], [{ x: 16, y: 9, type: "quay" }, { x: 15, y: 9, type: "road" }]));
    expect(tiles).toHaveLength(32);
    expect(tiles.filter((p) => p.blocked).map(({ x, y }) => `${x},${y}`).sort()).toEqual(["16,9", "9,6"]);
  });

  it("lists the lanes of built and planned holders", () => {
    const lanes = harbourLanes(site([{ id: 1, type: "trading_pier", x: 10, y: 10, rotation: 0 }, { id: 2, type: "house", x: 0, y: 0, rotation: 0 }]));
    expect(lanes.size).toBe(32);
    expect(harbourLanes(site([{ id: 1, type: "trading_pier", x: 10, y: 10, rotation: 0 }]), 1).size).toBe(0);
  });

  it("marks quay and paint drags on a lane bad", () => {
    const width = 30;
    const terrain = Array.from({ length: width * width }, (_, i) => (Math.floor(i / width) < 8 ? "water" : "grass"));
    const data = {
      island: { width, height: width, terrain },
      buildings: [{ type: "trading_pier", x: 10, y: 10, rotation: 0 as const }],
      roads: [],
      defs: defs as never,
    };
    // The pier's lane: x 9..16, y 6..9; the shallows along the land at y 7.
    const quay = planRoadDrag({ x: 3, y: 7 }, { x: 12, y: 7 }, "quay", data);
    expect(quay.map((p) => p.hint)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "bad", "bad", "bad", "bad"]);
    const hedge = planRoadDrag({ x: 7, y: 9 }, { x: 10, y: 9 }, "hedge", data);
    expect(hedge.map((p) => p.hint)).toEqual(["ok", "ok", "bad", "bad"]);
  });
});
