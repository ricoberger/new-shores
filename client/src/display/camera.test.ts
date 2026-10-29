import { describe, expect, it } from "vitest";
import {
  archipelagoRect,
  azimuthOf,
  BOUNDS_MARGIN,
  clampView,
  FAR_REACH_HALF,
  fitHalfHeight,
  footprintScreenFraction,
  frameIslandView,
  groundAtNdc,
  groundFootprint,
  MIN_HALF_HEIGHT,
  NEAR_DEFAULT_HALF_HEIGHT,
  isSnapped,
  normRotation,
  rotationDelta,
  screenAxes,
  snapRotation,
  seaMargin,
  targetBounds,
  zoomRange,
} from "./camera";
import { FAR_ENTER_HALF } from "./lod";

const DEV = { minX: 0, minY: 0, maxX: 112, maxY: 114 };

describe("zoom range", () => {
  it("at the maximum zoom-in a 2 × 2 footprint spans 25–50 % of the short side of a 360 × 640 phone", () => {
    const f = footprintScreenFraction(2, 2, MIN_HALF_HEIGHT, 360 / 640);
    expect(f).toBeGreaterThanOrEqual(0.25);
    expect(f).toBeLessThanOrEqual(0.5);
  });

  it("the maximum fits the whole archipelago; never below the far-LOD reach", () => {
    const aspect = 1280 / 800;
    expect(zoomRange(DEV, 412 / 915)).toEqual({ min: MIN_HALF_HEIGHT, max: fitHalfHeight(112, 114, 412 / 915) });
    // The dev world fits at ≈ 54.9 on a desktop: the maximum still reaches past the far threshold.
    expect(zoomRange(DEV, aspect).max).toBe(Math.max(FAR_REACH_HALF, fitHalfHeight(112, 114, aspect)));
    expect(zoomRange(DEV, 16 / 9).max).toBe(FAR_REACH_HALF);
    expect(FAR_REACH_HALF).toBeGreaterThan(FAR_ENTER_HALF);
    expect(zoomRange({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, aspect).max).toBe(FAR_REACH_HALF);
    expect(zoomRange(null, aspect)).toEqual({ min: MIN_HALF_HEIGHT, max: NEAR_DEFAULT_HALF_HEIGHT });
  });

  it("the region's cap limits the maximum of a large archipelago, never below the far-LOD reach", () => {
    const big = { minX: 0, minY: 0, maxX: 848, maxY: 824 };
    const phone = 412 / 915;
    expect(fitHalfHeight(848, 824, phone)).toBeGreaterThan(120);
    expect(zoomRange(big, phone, 120)).toEqual({ min: MIN_HALF_HEIGHT, max: 120 });
    expect(zoomRange(big, phone, null).max).toBe(fitHalfHeight(848, 824, phone));
    // A world that fits below the cap keeps its fit (here lifted to the far-LOD reach).
    expect(zoomRange(DEV, 1280 / 800, 120).max).toBe(Math.max(FAR_REACH_HALF, fitHalfHeight(112, 114, 1280 / 800)));
    expect(zoomRange(DEV, phone, 120).max).toBe(120);
    // A cap below the far-LOD reach is lifted to it; a nonsensical cap is ignored.
    expect(zoomRange(big, phone, 20).max).toBe(FAR_REACH_HALF);
    expect(zoomRange(big, phone, 0).max).toBe(fitHalfHeight(848, 824, phone));
    expect(zoomRange(big, phone, Number.NaN).max).toBe(fitHalfHeight(848, 824, phone));
    expect(clampView({ x: 400, y: 400, half: 10_000, rotation: 0 }, big, phone, 120).half).toBe(120);
    expect(seaMargin(big, phone, 120)).toBeLessThan(seaMargin(big, phone));
  });
});

describe("clamping", () => {
  it("clamps the target to the bounds plus the margin and the zoom to the range", () => {
    const aspect = 412 / 915;
    const v = clampView({ x: -500, y: 500, half: 1, rotation: 5 }, DEV, aspect);
    expect(clampView({ x: 0, y: 0, half: 18, rotation: -0.75 }, DEV, aspect).rotation).toBeCloseTo(3.25, 12);
    expect(v).toEqual({ x: -BOUNDS_MARGIN, y: 114 + BOUNDS_MARGIN, half: MIN_HALF_HEIGHT, rotation: 1 });
    const far = clampView({ x: 50, y: 50, half: 10_000, rotation: -1 }, DEV, aspect);
    expect(far.half).toBeCloseTo(fitHalfHeight(112, 114, aspect), 6);
    expect(far.rotation).toBe(3);
    expect(clampView({ x: 10, y: 20, half: 18, rotation: 0 }, DEV, aspect)).toEqual({ x: 10, y: 20, half: 18, rotation: 0 });
  });

  it("normalises rotations continuously to [0, 4)", () => {
    expect([-5, -1, 0, 3, 4, 9].map(normRotation)).toEqual([3, 3, 0, 3, 0, 1]);
    expect(normRotation(-0.5)).toBe(3.5);
    expect(normRotation(1.3)).toBeCloseTo(1.3, 12);
    expect(normRotation(3.9999999999)).toBe(0);
    expect(normRotation(NaN)).toBe(0);
    expect(azimuthOf(0)).toBeCloseTo(Math.PI / 4, 9);
    expect(azimuthOf(2)).toBeCloseTo((5 * Math.PI) / 4, 9);
    expect(azimuthOf(0.5)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("snaps to the nearest 45° and measures the shortest way round", () => {
    expect([0.2, 0.26, 1.74, 3.8, -0.1].map(snapRotation)).toEqual([0, 0.5, 1.5, 0, 0]);
    expect(isSnapped(1.5)).toBe(true);
    expect(isSnapped(1.4)).toBe(false);
    expect(rotationDelta(3.75, 0.25)).toBeCloseTo(0.5, 12);
    expect(rotationDelta(0.25, 3.75)).toBeCloseTo(-0.5, 12);
    expect(rotationDelta(1, 3)).toBe(2);
  });

  it("the fit holds at every azimuth: the rectangle's corners stay in the viewport", () => {
    const aspect = 412 / 915;
    const half = fitHalfHeight(112, 40, aspect);
    for (let rotation = 0; rotation < 4; rotation += 0.125) {
      const { right, up } = screenAxes(rotation);
      for (const [x, y] of [
        [-56, -20],
        [56, -20],
        [56, 20],
        [-56, 20],
      ] as const) {
        // Screen coordinates (ortho units) of a ground offset: solve x·right + y'·up.
        const det = right.x * up.y - right.y * up.x;
        const u = (x * up.y - y * up.x) / det;
        const w = (right.x * y - right.y * x) / det;
        expect(Math.abs(u)).toBeLessThanOrEqual(half * aspect);
        expect(Math.abs(w)).toBeLessThanOrEqual(half);
      }
    }
  });
});

describe("ground footprint", () => {
  const view = { x: 40, y: 30, half: 20, rotation: 0 };
  const aspect = 1.6;

  it("is centred on the target and the screen axes are orthogonal on the ground (screen up stretched by 1/sin 30°)", () => {
    const fp = groundFootprint(view, aspect);
    const cx = fp.reduce((s, p) => s + p.x, 0) / 4;
    const cy = fp.reduce((s, p) => s + p.y, 0) / 4;
    expect(cx).toBeCloseTo(40, 9);
    expect(cy).toBeCloseTo(30, 9);
    for (let r = 0; r < 4; r += 0.25) {
      const { right, up } = screenAxes(r);
      expect(right.x * up.x + right.y * up.y).toBeCloseTo(0, 9);
      expect(Math.hypot(right.x, right.y)).toBeCloseTo(1, 9);
      expect(Math.hypot(up.x, up.y)).toBeCloseTo(2, 9);
    }
    // Step 0 (45°): screen right runs along +x +y, screen up along +x −y.
    expect(screenAxes(0).right.x).toBeGreaterThan(0);
    expect(screenAxes(0).right.y).toBeGreaterThan(0);
    expect(screenAxes(0).up.y).toBeLessThan(0);
  });

  it("each rotation step turns the footprint by 90° about the target", () => {
    for (let r = 0; r < 4; r++) {
      const a = groundFootprint({ ...view, rotation: r }, aspect);
      const b = groundFootprint({ ...view, rotation: r + 1 }, aspect);
      for (let i = 0; i < 4; i++) {
        const p = a[i]!;
        const q = b[i]!;
        // +90° azimuth: the ground offset (dx, dy) of a viewport corner becomes (−dy, dx).
        expect(q.x - view.x).toBeCloseTo(-(p.y - view.y), 9);
        expect(q.y - view.y).toBeCloseTo(p.x - view.x, 9);
      }
    }
  });

  it("the viewport centre is the target in every rotation", () => {
    for (let r = 0; r < 4; r += 0.5) expect(groundAtNdc({ ...view, rotation: r }, aspect, 0, 0)).toEqual({ x: 40, y: 30 });
  });
});

describe("sea extent", () => {
  for (const [w, h] of [
    [1280, 800],
    [360, 640],
  ] as const) {
    it(`${w} × ${h}: the sea covers the viewport at every clamped target at the maximum zoom at every azimuth`, () => {
      const aspect = w / h;
      const m = seaMargin(DEV, aspect);
      const sea = { minX: DEV.minX - m, minY: DEV.minY - m, maxX: DEV.maxX + m, maxY: DEV.maxY + m };
      const t = targetBounds(DEV);
      const half = zoomRange(DEV, aspect).max;
      for (const x of [t.minX, t.maxX]) {
        for (const y of [t.minY, t.maxY]) {
          for (let rotation = 0; rotation < 4; rotation += 0.125) {
            for (const p of groundFootprint({ x, y, half, rotation }, aspect)) {
              expect(p.x).toBeGreaterThanOrEqual(sea.minX);
              expect(p.x).toBeLessThanOrEqual(sea.maxX);
              expect(p.y).toBeGreaterThanOrEqual(sea.minY);
              expect(p.y).toBeLessThanOrEqual(sea.maxY);
            }
          }
        }
      }
    });
  }
});

describe("archipelagoRect", () => {
  it("turns the display bounds (D-053) into a rectangle, null without extent", () => {
    expect(archipelagoRect({ bounds: { x: 0, y: 0, width: 392, height: 346 } })).toEqual({ minX: 0, minY: 0, maxX: 392, maxY: 346 });
    expect(archipelagoRect({ bounds: { x: 5, y: -3, width: 10, height: 4 } })).toEqual({ minX: 5, minY: -3, maxX: 15, maxY: 1 });
    expect(archipelagoRect({ bounds: { x: 0, y: 0, width: 0, height: 0 } })).toBeNull();
    expect(archipelagoRect(undefined)).toBeNull();
  });
});

describe("framing an island for founding (D-058 round 4)", () => {
  const rect = { minX: 100, minY: 200, maxX: 160, maxY: 240 };
  const aspect = 1.6;
  const inside = (v: { x: number; y: number; half: number; rotation: number }) => {
    // Every corner of the island maps inside the viewport (NDC within ±1).
    const fp = groundFootprint(v, aspect);
    const { right, up } = screenAxes(v.rotation);
    const k = 1 / Math.sin(Math.PI / 6);
    return [
      [rect.minX, rect.minY],
      [rect.maxX, rect.minY],
      [rect.maxX, rect.maxY],
      [rect.minX, rect.maxY],
    ].every(([x, y]) => {
      const dx = x! - v.x;
      const dy = y! - v.y;
      const u = (dx * right.x + dy * right.y) / (v.half * aspect);
      const w = (dx * up.x + dy * up.y) / (k * k) / v.half;
      return fp.length === 4 && Math.abs(u) <= 1 + 1e-9 && Math.abs(w) <= 1 + 1e-9;
    });
  };

  it("keeps the camera when the island is wholly in view below the far zoom", () => {
    const v = { x: 130, y: 220, half: 45, rotation: 0 };
    expect(inside(v)).toBe(true);
    expect(frameIslandView(v, aspect, rect)).toBeNull();
  });

  it("frames the whole island at the current heading when it is not in view or the camera is far out", () => {
    for (const rotation of [0, 0.5, 1, 2.5]) {
      for (const v of [
        { x: 400, y: 400, half: 18, rotation },
        { x: 130, y: 220, half: 10, rotation },
        { x: 130, y: 220, half: FAR_ENTER_HALF + 100, rotation },
      ]) {
        const f = frameIslandView(v, aspect, rect)!;
        expect(f).not.toBeNull();
        expect(f.rotation).toBe(rotation);
        expect(f.x).toBe(130);
        expect(f.y).toBe(220);
        expect(inside(f)).toBe(true);
        // Fitted, not far out: 10 % margin only.
        expect(inside({ ...f, half: f.half / 1.2 })).toBe(false);
      }
    }
  });
});
