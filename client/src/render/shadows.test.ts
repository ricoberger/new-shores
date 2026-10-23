import { describe, expect, it } from "vitest";
import { SHADOW_LEAN } from "./lighting";
import { BLOB_Y, CORNER_POINTS, roundedShadows, shadowRadius } from "./shadows";

// Building contact shadows (polish pass): a soft rounded rectangle at the
// model's bounds — filled core, a ring at the outline, a transparent rim.

const N = 4 * CORNER_POINTS;

function alphaAt(colors: number[], v: number): number {
  return colors[v * 4 + 3] as number;
}

describe("roundedShadows", () => {
  it("builds a filled core and two soft bands per outline", () => {
    const g = roundedShadows([{ cx: 0, cz: 0, w: 2, h: 2, height: 0 }], 0.4, 0.7);
    // Centre + three rings.
    expect(g.positions.length / 3).toBe(1 + 3 * N);
    // Fan (N) + two bands (2N each).
    expect(g.indices.length / 3).toBe(N + 4 * N);
    expect(alphaAt(g.colors, 0)).toBeGreaterThan(0.5);
    expect(alphaAt(g.colors, 1 + 2 * N)).toBe(0);
    for (let i = 1; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(BLOB_Y);
  });

  it("rounds the corners and covers the outline plus the rim", () => {
    const rim = 0.4;
    const g = roundedShadows([{ cx: 0, cz: 0, w: 3, h: 2, height: 0 }], rim, 0);
    const outer: [number, number][] = [];
    for (let k = 0; k < N; k++) {
      const v = 1 + 2 * N + k;
      outer.push([g.positions[v * 3] as number, g.positions[v * 3 + 2] as number]);
    }
    const xs = outer.map((p) => p[0]);
    const zs = outer.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(1.5 + rim);
    expect(Math.min(...zs)).toBeCloseTo(-1 - rim);
    // No point sits on the sharp corner: the corners are rounded.
    const r = shadowRadius(3, 2) + rim;
    for (const [x, z] of outer) {
      const dx = Math.max(0, Math.abs(x) - (1.5 + rim - r));
      const dz = Math.max(0, Math.abs(z) - (1 + rim - r));
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(r + 1e-6);
    }
  });

  it("leans away from the sun by the outline's height", () => {
    const g = roundedShadows([{ cx: 5, cz: -5, w: 2, h: 2, height: 2 }], 0.4, 0.7);
    expect(g.positions[0]).toBeCloseTo(5 + SHADOW_LEAN.x * 2 * 0.35);
    expect(g.positions[2]).toBeCloseTo(-5 + SHADOW_LEAN.z * 2 * 0.35);
  });

  it("merges outlines with offset indices and scales the radius with the outline", () => {
    const g = roundedShadows(
      [
        { cx: 0, cz: 0, w: 1, h: 1 },
        { cx: 4, cz: 0, w: 4, h: 4 },
      ],
      0.4,
      0.7,
    );
    const per = 1 + 3 * N;
    expect(Math.min(...g.indices.slice(g.indices.length / 2))).toBe(per);
    expect(shadowRadius(1, 1)).toBeLessThan(shadowRadius(2, 2));
    expect(shadowRadius(10, 10)).toBe(0.7);
    expect(shadowRadius(0.2, 0.2)).toBe(0.15);
  });
});
