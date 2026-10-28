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
    wake.frame([{ id: 3, x: 10, y: 5, heading: 0, stern: 2, scale: 1 }], 1000);
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
      wake.frame([{ id: 3, x: 10, y: 5, heading: 0, stern: 2, scale: 1 }], t);
      return Array.from(m.subarray(0, wake.count() * 16)).join();
    };
    expect(at(1000)).toBe(at(1010));
    expect([at(1300), at(1600), at(1900)].some((s) => s !== at(1000))).toBe(true);
  });
});
