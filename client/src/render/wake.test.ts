import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { ShipWake, WAKE_FLECKS } from "./wake";

const engine = new NullEngine();
afterAll(() => engine.dispose());

describe("ship wake", () => {
  it("trails stepped foam flecks behind a sailing ship, none without one", () => {
    const wake = new ShipWake(new Scene(engine), -0.6);
    wake.frame([], 0);
    expect(wake.count()).toBe(0);
    expect(wake.mesh.isVisible).toBe(false);
    // Heading east (0): the wake lies to the west of the stern.
    wake.frame([{ id: 3, x: 10, y: 5, heading: 0, stern: 2, width: 0.8, scale: 1 }], 1000);
    const n = wake.count();
    expect(n).toBeGreaterThan(WAKE_FLECKS);
    expect(n).toBeLessThanOrEqual(WAKE_FLECKS * 3);
    const m = (wake as unknown as { matrices: Float32Array }).matrices;
    for (let i = 0; i < n; i++) {
      expect(m[i * 16 + 12]).toBeLessThan(10 - 1.8);
      expect(m[i * 16 + 13]).toBeLessThan(-0.595);
      expect(m[i * 16 + 13]).toBeGreaterThan(-0.65);
      // On the voxel grid (1/16 tile).
      expect((m[i * 16 + 12] as number) * 16).toBeCloseTo(Math.round((m[i * 16 + 12] as number) * 16), 4);
    }
    // Stepped: the same within a step, re-rolled in the next.
    const at = (t: number) => {
      wake.frame([{ id: 3, x: 10, y: 5, heading: 0, stern: 2, width: 0.8, scale: 1 }], t);
      return Array.from(m.subarray(0, wake.count() * 16)).join();
    };
    expect(at(1000)).toBe(at(1010));
    expect([at(1300), at(1600), at(1900)].some((s) => s !== at(1000))).toBe(true);
  });

  it("starts at the stern anchor, as wide as the hull, and grows with the ship", () => {
    const wake = new ShipWake(new Scene(engine), -0.6);
    const extent = (ship: { stern: number; width: number; scale: number }) => {
      let nearest = Infinity;
      let widest = 0;
      for (let step = 0; step < 6; step++) {
        wake.frame([{ id: 1, x: 0, y: 0, heading: 0, ...ship }], step * 300);
        const mm = (wake as unknown as { matrices: Float32Array }).matrices;
        for (let i = 0; i < wake.count(); i++) {
          nearest = Math.min(nearest, Math.abs(mm[i * 16 + 12] as number));
          widest = Math.max(widest, Math.abs(mm[i * 16 + 14] as number));
        }
      }
      return { nearest, widest };
    };
    const small = extent({ stern: 1, width: 0.4, scale: 1 });
    const big = extent({ stern: 1.6, width: 0.64, scale: 1.6 });
    // Nothing between the hull centre and the stern.
    expect(small.nearest).toBeGreaterThan(0.9);
    expect(big.nearest).toBeGreaterThan(1.5);
    // The arms leave the hull's sides at the stern: at least half the width out.
    expect(small.widest).toBeGreaterThan(0.2);
    expect(big.widest).toBeGreaterThan(small.widest * 1.5);
  });

  it("opens from the ship's own stern width (manifest ship.wake_width, V7)", () => {
    const wake = new ShipWake(new Scene(engine), -0.6);
    // The narrowest arm offset over the first flecks: the stern's half-width plus the V's first opening.
    const inner = (width: number) => {
      let least = Infinity;
      for (let step = 0; step < 12; step++) {
        wake.frame([{ id: 1, x: 0, y: 0, heading: 0, stern: 1, width, scale: 1 }], step * 300);
        const mm = (wake as unknown as { matrices: Float32Array }).matrices;
        for (let i = 0; i < wake.count(); i++) {
          const side = Math.abs(mm[i * 16 + 14] as number);
          if (side > 0.03) least = Math.min(least, side);
        }
      }
      return least;
    };
    // Snapped to the 1/16 voxel grid: within a voxel of half the width.
    expect(inner(0.7)).toBeCloseTo(0.35, 1);
    expect(inner(1.1)).toBeCloseTo(0.55, 1);
    expect(inner(1.1) - inner(0.7)).toBeGreaterThan(0.15);
  });
});
