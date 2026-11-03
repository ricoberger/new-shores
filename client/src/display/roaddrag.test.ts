import { describe, expect, it } from "vitest";
import { planRoadDrag, roadDragSend, type RoadDragData } from "./roaddrag";

const defs = new Map([
  ["house", { width: 2, height: 2 }],
  ["road_dirt", { width: 1, height: 1, tier: "settlers", road: {} }],
  ["road_paved", { width: 1, height: 1, tier: "citizens", road: {} }],
  ["quay", { width: 1, height: 1, tier: "citizens", road: { shallows: true } }],
]);
const tiers = [
  { id: "settlers", index: 0 },
  { id: "citizens", index: 1 },
];

/** A 12 × 6 island: water in row 0 and column 11, a mountain at (6,3), grass elsewhere. */
function data(): RoadDragData {
  const width = 12;
  const height = 6;
  const terrain = Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    if (y === 0 || x === 11) return "water";
    if (x === 6 && y === 3) return "mountain";
    return "grass";
  });
  return {
    island: { width, height, terrain },
    buildings: [{ type: "house", x: 8, y: 1, rotation: 0 }],
    roads: [
      { x: 3, y: 3, type: "road_dirt" },
      { x: 4, y: 3, type: "road_paved" },
    ],
    defs,
    tiers,
  };
}

describe("planRoadDrag", () => {
  it("hints every tile of the L-path: new road, existing road, rejected terrain", () => {
    const tiles = planRoadDrag({ x: 1, y: 3 }, { x: 7, y: 3 }, "road_dirt", data());
    expect(tiles.map((t) => `${t.x}:${t.hint}`)).toEqual(["1:ok", "2:ok", "3:skip", "4:skip", "5:ok", "6:bad", "7:ok"]);
  });

  it("marks tiles under a building, off the island and on the sea red", () => {
    const tiles = planRoadDrag({ x: 7, y: 2 }, { x: 12, y: 2 }, "road_dirt", data());
    expect(tiles.map((t) => t.hint)).toEqual(["ok", "bad", "bad", "ok", "bad", "bad"]);
  });

  it("sends every tile but the existing roads", () => {
    const tiles = planRoadDrag({ x: 1, y: 3 }, { x: 5, y: 3 }, "road_dirt", data());
    expect(roadDragSend(tiles)).toEqual([
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 5, y: 3 },
    ]);
  });

  it("replaces a road of a lower type (dirt under paved) and sends it; same or higher types are skipped (MECHANICS §3)", () => {
    const tiles = planRoadDrag({ x: 2, y: 3 }, { x: 5, y: 3 }, "road_paved", data());
    expect(tiles.map((t) => t.hint)).toEqual(["ok", "replace", "skip", "ok"]);
    expect(roadDragSend(tiles).map((t) => t.x)).toEqual([2, 3, 5]);
    // Without the tiers nothing is known to be lower: skipped.
    expect(planRoadDrag({ x: 3, y: 3 }, { x: 3, y: 3 }, "road_paved", { ...data(), tiers: undefined })[0]!.hint).toBe("skip");
  });

  it("hints a quay drag by the shallows", () => {
    const tiles = planRoadDrag({ x: 2, y: 0 }, { x: 2, y: 1 }, "quay", data());
    expect(tiles.map((t) => t.hint)).toEqual(["ok", "bad"]);
  });
});
