import { describe, expect, it } from "vitest";
import { isPaintType, planRoadDrag, roadDragSend, type RoadDragData } from "./roaddrag";

const defs = new Map([
  ["house", { width: 2, height: 2 }],
  ["road_dirt", { width: 1, height: 1, tier: "settlers", road: {} }],
  ["road_paved", { width: 1, height: 1, tier: "citizens", road: {} }],
  ["quay", { width: 1, height: 1, tier: "citizens", road: { shallows: true } }],
  ["hedge", { width: 1, height: 1, tier: "settlers", paint_family: {} }],
  ["city_wall", { width: 1, height: 1, tier: "citizens", paint_family: { road_crossing: true } }],
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

  it("hints a quay by its connection to land (D-077 §8): a tile off the land and off other quays is red", () => {
    // A 6 × 6 island: land in the bottom row only; water above (all shallows).
    const width = 6;
    const terrain = Array.from({ length: width * 6 }, (_, i) => (Math.floor(i / width) === 5 ? "grass" : "water"));
    const d: RoadDragData = { island: { width, height: 6, terrain }, buildings: [], roads: [{ x: 0, y: 2, type: "quay" }], defs, tiers };
    // A pier from the land up: every tile reaches land over the drag.
    expect(planRoadDrag({ x: 2, y: 4 }, { x: 2, y: 1 }, "quay", d).map((t) => t.hint)).toEqual(["ok", "ok", "ok", "ok"]);
    // A floating row: red; a row touching the (floating) old quay at (0,2) is still not anchored.
    expect(planRoadDrag({ x: 3, y: 1 }, { x: 5, y: 1 }, "quay", d).map((t) => t.hint)).toEqual(["bad", "bad", "bad"]);
    expect(planRoadDrag({ x: 1, y: 2 }, { x: 1, y: 2 }, "quay", d)[0]!.hint).toBe("bad");
    // Next to a building on the water (a shore deck): anchored.
    const deck = { ...d, buildings: [{ type: "house", x: 4, y: 3, rotation: 0 as const }] };
    expect(planRoadDrag({ x: 4, y: 2 }, { x: 4, y: 2 }, "quay", deck)[0]!.hint).toBe("ok");
  });
});

describe("paint families with the road tool (D-077 §2–§3)", () => {
  it("knows the paint families", () => {
    expect(isPaintType(defs, "hedge")).toBe(true);
    expect(isPaintType(defs, "road_dirt")).toBe(false);
  });

  it("paints buildable land, skips its own tiles, refuses roads, buildings and other terrain", () => {
    const d = { ...data(), buildings: [...data().buildings, { type: "hedge", x: 2, y: 4, rotation: 0 as const }] };
    // Row 3: grass at 1–2, roads at 3–4, grass at 5, the mountain at 6, grass at 7.
    expect(planRoadDrag({ x: 1, y: 3 }, { x: 7, y: 3 }, "hedge", d).map((t) => t.hint)).toEqual(["ok", "ok", "bad", "bad", "ok", "bad", "ok"]);
    expect(planRoadDrag({ x: 2, y: 4 }, { x: 2, y: 4 }, "hedge", d)[0]!.hint).toBe("skip");
    expect(planRoadDrag({ x: 8, y: 1 }, { x: 8, y: 1 }, "hedge", d)[0]!.hint).toBe("bad");
    expect(planRoadDrag({ x: 1, y: 0 }, { x: 1, y: 0 }, "hedge", d)[0]!.hint).toBe("bad");
  });

  it("lets the city wall cross a land road, never a quay", () => {
    const d = { ...data(), roads: [...data().roads, { x: 2, y: 3, type: "quay" }] };
    expect(planRoadDrag({ x: 2, y: 3 }, { x: 4, y: 3 }, "city_wall", d).map((t) => t.hint)).toEqual(["bad", "ok", "ok"]);
  });
});
