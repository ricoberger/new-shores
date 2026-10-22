import { describe, expect, it } from "vitest";
import type { ModelData } from "./models";
import { ModelMerger } from "./trees";

// Merged decoration (restyle): copies of indexed kit models are moved,
// scaled, turned and shaded into one indexed mesh.

const TRI: ModelData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
  colors: new Float32Array([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

describe("ModelMerger", () => {
  it("offsets indices, transforms positions and normals and shades colours", () => {
    const m = new ModelMerger();
    for (let i = 0; i < 400; i++) m.add(TRI, i, 0, 0, 1, 0);
    m.add(TRI, 10, 2, -3, 2, Math.PI / 2, 0.5);
    expect(m.triangles()).toBe(401);
    const internal = m as unknown as { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array };
    const v = 400 * 3;
    expect(Array.from(internal.indices.subarray(400 * 3, 401 * 3))).toEqual([v, v + 1, v + 2]);
    // (1, 0, 0) scaled 2 and turned 90° about y → (0, 0, −2), moved to (10, 2, −3).
    const p = internal.positions.subarray((v + 1) * 3, (v + 1) * 3 + 3);
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(2);
    expect(p[2]).toBeCloseTo(-5);
    const n = internal.normals.subarray(v * 3, v * 3 + 3);
    expect(n[0]).toBeCloseTo(0);
    expect(n[2]).toBeCloseTo(-1);
    expect(internal.colors[v * 4]).toBeCloseTo(0.25);
  });
});
