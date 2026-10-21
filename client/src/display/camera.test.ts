import { describe, expect, it } from "vitest";
import {
  azimuthOf,
  BOUNDS_MARGIN,
  clampView,
  fitHalfHeight,
  footprintScreenFraction,
  groundAtNdc,
  groundFootprint,
  MIN_HALF_HEIGHT,
  NEAR_DEFAULT_HALF_HEIGHT,
  normRotation,
  screenAxes,
  seaMargin,
  targetBounds,
  zoomRange,
} from "./camera";

const DEV = { minX: 0, minY: 0, maxX: 112, maxY: 114 };

describe("zoom range", () => {
  it("at the maximum zoom-in a 2 × 2 footprint spans 25–50 % of the short side of a 360 × 640 phone", () => {
    const f = footprintScreenFraction(2, 2, MIN_HALF_HEIGHT, 360 / 640);
    expect(f).toBeGreaterThanOrEqual(0.25);
    expect(f).toBeLessThanOrEqual(0.5);
  });

  it("the maximum fits the whole archipelago; never below the near default", () => {
    const aspect = 1280 / 800;
    expect(zoomRange(DEV, aspect)).toEqual({ min: MIN_HALF_HEIGHT, max: fitHalfHeight(112, 114, aspect) });
    expect(zoomRange({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, aspect).max).toBe(NEAR_DEFAULT_HALF_HEIGHT);
    expect(zoomRange(null, aspect)).toEqual({ min: MIN_HALF_HEIGHT, max: NEAR_DEFAULT_HALF_HEIGHT });
  });
});

describe("clamping", () => {
  it("clamps the target to the bounds plus the margin and the zoom to the range", () => {
    const aspect = 412 / 915;
    const v = clampView({ x: -500, y: 500, half: 1, rotation: 5 }, DEV, aspect);
    expect(v).toEqual({ x: -BOUNDS_MARGIN, y: 114 + BOUNDS_MARGIN, half: MIN_HALF_HEIGHT, rotation: 1 });
    const far = clampView({ x: 50, y: 50, half: 10_000, rotation: -1 }, DEV, aspect);
    expect(far.half).toBeCloseTo(fitHalfHeight(112, 114, aspect), 6);
    expect(far.rotation).toBe(3);
    expect(clampView({ x: 10, y: 20, half: 18, rotation: 0 }, DEV, aspect)).toEqual({ x: 10, y: 20, half: 18, rotation: 0 });
  });

  it("normalises rotation steps", () => {
    expect([-5, -1, 0, 3, 4, 9].map(normRotation)).toEqual([3, 3, 0, 3, 0, 1]);
    expect(azimuthOf(0)).toBeCloseTo(Math.PI / 4, 9);
    expect(azimuthOf(2)).toBeCloseTo((5 * Math.PI) / 4, 9);
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
    for (let r = 0; r < 4; r++) {
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
    for (let r = 0; r < 4; r++) expect(groundAtNdc({ ...view, rotation: r }, aspect, 0, 0)).toEqual({ x: 40, y: 30 });
  });
});

describe("sea extent", () => {
  for (const [w, h] of [
    [1280, 800],
    [360, 640],
  ] as const) {
    it(`${w} × ${h}: the sea covers the viewport at every clamped target at the maximum zoom in every rotation`, () => {
      const aspect = w / h;
      const m = seaMargin(DEV, aspect);
      const sea = { minX: DEV.minX - m, minY: DEV.minY - m, maxX: DEV.maxX + m, maxY: DEV.maxY + m };
      const t = targetBounds(DEV);
      const half = zoomRange(DEV, aspect).max;
      for (const x of [t.minX, t.maxX]) {
        for (const y of [t.minY, t.maxY]) {
          for (let rotation = 0; rotation < 4; rotation++) {
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
