import { describe, expect, it } from "vitest";
import { groundFootprint } from "./camera";
import { focusedIsland, islandRect, rectIntersectsQuad, rectQuadOverlap, visibleIslands } from "./frustum";

const square = (x0: number, y0: number, s: number) => [
  { x: x0, y: y0 },
  { x: x0 + s, y: y0 },
  { x: x0 + s, y: y0 + s },
  { x: x0, y: y0 + s },
];

describe("rectIntersectsQuad", () => {
  it("axis-aligned overlap, touching and separation", () => {
    const r = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(rectIntersectsQuad(r, square(5, 5, 10))).toBe(true);
    expect(rectIntersectsQuad(r, square(10, 0, 5))).toBe(true); // touching edge
    expect(rectIntersectsQuad(r, square(11, 0, 5))).toBe(false);
    expect(rectIntersectsQuad(r, square(2, 2, 3))).toBe(true); // inside
    expect(rectIntersectsQuad(r, square(-20, -20, 60))).toBe(true); // contains
    expect(rectIntersectsQuad(r, [])).toBe(false);
  });

  it("a rotated quad whose bounding box overlaps the rectangle but not the quad itself", () => {
    // Diamond centred at (14, 14) with radius 5: its box (9..19) overlaps the 0..10 square, the diamond does not.
    const diamond = [
      { x: 14, y: 9 },
      { x: 19, y: 14 },
      { x: 14, y: 19 },
      { x: 9, y: 14 },
    ];
    expect(rectIntersectsQuad({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, diamond)).toBe(false);
    expect(rectIntersectsQuad({ minX: 0, minY: 0, maxX: 12, maxY: 12 }, diamond)).toBe(true);
  });
});

describe("visibleIslands", () => {
  const islands = [
    { id: "a", position: { x: 0, y: 0 }, width: 40, height: 30 },
    { id: "b", position: { x: 200, y: 0 }, width: 40, height: 30 },
    { id: "c", position: { x: 0, y: 200 }, width: 40, height: 30 },
  ];

  it("keeps islands under the rotated camera footprint, in payload order", () => {
    const aspect = 412 / 915;
    // Near island a: only a.
    expect(visibleIslands(islands, groundFootprint({ x: 20, y: 15, half: 18, rotation: 0 }, aspect))).toEqual(["a"]);
    // Zoomed far out over the middle: everything.
    expect(visibleIslands(islands, groundFootprint({ x: 120, y: 120, half: 400, rotation: 0 }, aspect))).toEqual(["a", "b", "c"]);
  });

  it("the footprint's long axis turns with the rotation", () => {
    // A tall phone viewport: the footprint reaches far along screen up
    // (step 0: +x −y). An island in that direction is visible in step 0
    // and step 2 (opposite), not in the steps beside them.
    const aspect = 412 / 915;
    const probe = [{ id: "p", position: { x: 150, y: -25 }, width: 10, height: 10 }];
    const v = { x: 120, y: 15, half: 30 };
    const seen = [0, 1, 2, 3].map((r) => visibleIslands(probe, groundFootprint({ ...v, rotation: r }, aspect)).length);
    expect(seen).toEqual([1, 0, 1, 0]);
  });

  it("islandRect spans position to position + size", () => {
    expect(islandRect(islands[1]!)).toEqual({ minX: 200, minY: 0, maxX: 240, maxY: 30 });
  });
});

describe("focusedIsland", () => {
  const islands = [
    { id: "start", position: { x: 0, y: 0 }, width: 56, height: 40 },
    { id: "island2", position: { x: 72, y: 96 }, width: 40, height: 18 },
  ];
  it("the island under the target (1-tile margin), else the nearest by centre distance", () => {
    expect(focusedIsland(islands, { x: 10, y: 10 })).toBe("start");
    expect(focusedIsland(islands, { x: 56.5, y: 40.5 })).toBe("start");
    expect(focusedIsland(islands, { x: 90, y: 100 })).toBe("island2");
    expect(focusedIsland(islands, { x: 71.2, y: 95.5 })).toBe("island2");
    // Open sea: nearest centre.
    expect(focusedIsland(islands, { x: 80, y: 60 })).toBe("island2");
    expect(focusedIsland(islands, { x: 40, y: 60 })).toBe("start");
    expect(focusedIsland([], { x: 0, y: 0 })).toBe("");
  });
  it("never a skerry (D-058), not even under the target", () => {
    const withSkerry = [...islands, { id: "skerry", position: { x: 60, y: 60 }, width: 10, height: 10, scenic: true }];
    expect(focusedIsland(withSkerry, { x: 65, y: 65 })).toBe("island2");
    expect(focusedIsland(withSkerry, { x: 10, y: 10 })).toBe("start");
  });
});

describe("rectQuadOverlap", () => {
  const r = { minX: 0, minY: 0, maxX: 10, maxY: 20 };
  const square = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it("is the rectangle's area when the quad covers it, 0 when they are apart", () => {
    expect(rectQuadOverlap(r, square(-5, -5, 50, 50))).toBeCloseTo(200, 6);
    expect(rectQuadOverlap(r, square(20, 0, 30, 10))).toBe(0);
  });

  it("clips to the overlap, also for a turned footprint", () => {
    expect(rectQuadOverlap(r, square(5, 10, 50, 50))).toBeCloseTo(50, 6);
    // A diamond centred on the rectangle's corner (0, 0) with half-diagonal 4: a quarter of its area 32 lies inside.
    const diamond = [
      { x: 0, y: -4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
      { x: -4, y: 0 },
    ];
    expect(rectQuadOverlap(r, diamond)).toBeCloseTo(8, 6);
    // The real footprint at a 45° heading: within the rectangle's area and symmetric in the order of the corners.
    const fp = groundFootprint({ x: 5, y: 10, half: 6, rotation: 0.5 }, 1.6);
    const a = rectQuadOverlap(r, fp);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(200);
    expect(rectQuadOverlap(r, [...fp].reverse())).toBeCloseTo(a, 6);
  });
});
