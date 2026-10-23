import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import type { ModelData } from "./models";
import { Decoration, ModelMerger } from "./trees";

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

describe("Decoration far-LOD thinning", () => {
  it("draws every stride-th tree when thinned, by shortening the index range of the pre-built mesh", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const d = new Decoration(scene, "t", null);
    const trees = Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 3, scale: 1, yaw: 0, variant: i }));
    d.update(trees, [], [], () => 0, 2);
    const all = d.treeRange();
    expect(all.drawn).toBe(all.all);
    d.setThinned(true);
    const thin = d.treeRange();
    expect(thin.all).toBe(all.all);
    expect(thin.drawn).toBeGreaterThan(0);
    expect(thin.drawn).toBeLessThan(all.all);
    // Five of ten trees (the variants alternate, so roughly half the triangles).
    expect(thin.drawn / all.all).toBeGreaterThan(0.3);
    expect(thin.drawn / all.all).toBeLessThan(0.7);
    expect(scene.meshes.length).toBeGreaterThan(0);
    const meshes = scene.meshes.length;
    d.setThinned(false);
    expect(d.treeRange().drawn).toBe(all.all);
    expect(scene.meshes.length).toBe(meshes);
    engine.dispose();
  });
});
