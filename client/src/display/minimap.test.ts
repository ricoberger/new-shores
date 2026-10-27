import { describe, expect, it } from "vitest";
import { groundFootprint } from "./camera";
import { fromMinimap, islandsBounds, MINIMAP_MARGIN, MINIMAP_UNSETTLED_KEY, minimapCollapsedAtStart, minimapLandKey, minimapProjection, minimapSize, rememberMinimapCollapsed, toMinimap } from "./minimap";

const BOUNDS = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

describe("minimap projection", () => {
  it("fits the bounds plus margin into the canvas, north-up and centred", () => {
    const m = minimapProjection(BOUNDS, 180, 180);
    const w = 200 + 2 * MINIMAP_MARGIN;
    expect(m.scale).toBeCloseTo(180 / w, 9);
    // The bounds' top-left corner sits at the margin; x grows right, y grows down.
    const tl = toMinimap(m, { x: 0, y: 0 });
    const br = toMinimap(m, { x: 200, y: 100 });
    expect(tl.x).toBeCloseTo(MINIMAP_MARGIN * m.scale, 9);
    expect(br.x).toBeGreaterThan(tl.x);
    expect(br.y).toBeGreaterThan(tl.y);
    // Vertically centred (the box is wider than tall).
    expect((tl.y + br.y) / 2).toBeCloseTo(90, 9);
  });

  it("round-trips archipelago points and canvas pixels", () => {
    const m = minimapProjection(BOUNDS, 120, 70);
    for (const p of [
      { x: 0, y: 0 },
      { x: 37.5, y: 81.25 },
      { x: -12, y: 112 },
    ]) {
      const back = fromMinimap(m, toMinimap(m, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("the viewport quadrilateral turns with the camera while the map stays north-up", () => {
    const m = minimapProjection(BOUNDS, 180, 180);
    const q0 = groundFootprint({ x: 100, y: 50, half: 20, rotation: 0 }, 1.6).map((p) => toMinimap(m, p));
    const q1 = groundFootprint({ x: 100, y: 50, half: 20, rotation: 1 }, 1.6).map((p) => toMinimap(m, p));
    const c = toMinimap(m, { x: 100, y: 50 });
    // Each corner turns by 90° about the target's pixel.
    for (let i = 0; i < 4; i++) {
      expect(q1[i]!.x - c.x).toBeCloseTo(-(q0[i]!.y - c.y), 6);
      expect(q1[i]!.y - c.y).toBeCloseTo(q0[i]!.x - c.x, 6);
    }
    // The island bounds project the same whatever the rotation (north-up).
    expect(toMinimap(m, { x: 200, y: 0 })).toEqual(toMinimap(minimapProjection(BOUNDS, 180, 180), { x: 200, y: 0 }));
  });

  it("size: at most 25 % of the shorter viewport side, keeping the aspect", () => {
    expect(minimapSize(BOUNDS, 360, 640).width).toBe(90);
    expect(minimapSize(BOUNDS, 360, 640).height).toBeLessThan(90);
    expect(minimapSize(BOUNDS, 1280, 800)).toMatchObject({ width: 180 });
    const tall = minimapSize({ minX: 0, minY: 0, maxX: 50, maxY: 300 }, 1280, 800);
    expect(tall.height).toBe(180);
    expect(tall.width).toBeLessThan(180);
  });
});

describe("minimap land cache key", () => {
  const islands = [
    { id: "a", position: { x: 0, y: 0 }, width: 40, height: 30, settled: true, terrain_mask: "g".repeat(80), inventory: { fish: { stock: 1 } } },
    { id: "b", position: { x: 80, y: 60 }, width: 20, height: 10, settled: false, terrain_mask: "w".repeat(15), inventory: {} },
  ];

  it("ignores display numbers (an extrapolated model update keeps the key)", () => {
    const next = islands.map((is) => ({ ...is, inventory: { fish: { stock: 999 } } }));
    expect(minimapLandKey(next)).toBe(minimapLandKey(islands));
  });

  it("changes with geometry and settlement", () => {
    const key = minimapLandKey(islands);
    expect(minimapLandKey([islands[0]!, { ...islands[1]!, settled: true }])).not.toBe(key);
    expect(minimapLandKey([islands[0]!, { ...islands[1]!, position: { x: 81, y: 60 } }])).not.toBe(key);
    expect(minimapLandKey([islands[0]!])).not.toBe(key);
    // A reroll (new terrain under the same ID and bounds).
    expect(minimapLandKey([islands[0]!, { ...islands[1]!, terrain_mask: "g".repeat(15) }])).not.toBe(key);
  });

  it("islandsBounds spans every island", () => {
    expect(islandsBounds(islands)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 70 });
    expect(islandsBounds([])).toBeNull();
  });
});

describe("phone minimap while no island is settled", () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
  };

  it("opens expanded, remembers a collapse for the session and applies the layout default once settled", () => {
    const s = storage();
    // Phone portrait default: collapsed. Unsettled: expanded.
    expect(minimapCollapsedAtStart(true, true, s)).toBe(false);
    rememberMinimapCollapsed(true, true, s);
    expect(s.map.get(MINIMAP_UNSETTLED_KEY)).toBe("1");
    expect(minimapCollapsedAtStart(true, true, s)).toBe(true);
    rememberMinimapCollapsed(false, true, s);
    expect(minimapCollapsedAtStart(true, true, s)).toBe(false);
    // Settled: the default, and toggles are not remembered.
    expect(minimapCollapsedAtStart(true, false, s)).toBe(true);
    expect(minimapCollapsedAtStart(false, false, s)).toBe(false);
    rememberMinimapCollapsed(true, false, s);
    expect(s.map.get(MINIMAP_UNSETTLED_KEY)).toBe("0");
    // No storage: expanded.
    expect(minimapCollapsedAtStart(true, true, null)).toBe(false);
  });
});
