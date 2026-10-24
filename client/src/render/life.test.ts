import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { LifeAtLod, LifeBudget, LifePlan, LifeSink } from "../display/life";
import { CLS } from "../display/lifeplan";
import { LIFE_CLASSES, LifeLayer, writeMatrix } from "./life";
import { type ModelData, ModelRegistry, parseGlb } from "./models";

const MODELS = join(__dirname, "..", "..", "public", "models");

function registry(scene: Scene): ModelRegistry {
  return new ModelRegistry(scene, {
    fetch: (url) => {
      const path = url.endsWith("manifest.json") ? "manifest.json" : (url.replace("/models/", "").split("?")[0] as string);
      return Promise.resolve(new Response(new Uint8Array(readFileSync(join(MODELS, path))), { status: 200 }));
    },
    parse: (bytes, s): Promise<ModelData> => parseGlb(bytes, s),
  });
}

const engine = new NullEngine();
afterAll(() => engine.dispose());

/** A plan that writes n instances (within the budget) and k particles. */
function plan(n: number, k = 0): LifePlan & { seen: { at: LifeAtLod; budget: LifeBudget }[] } {
  const seen: { at: LifeAtLod; budget: LifeBudget }[] = [];
  return {
    seen,
    frame(_now: number, sink: LifeSink, at: LifeAtLod, budget: LifeBudget) {
      seen.push({ at, budget });
      const m = at.moving ? Math.min(n, budget.instances) : 0;
      for (let i = 0; i < m; i++) sink.add("box", i, 0, 0, 0, 1);
      const p = at.smoke ? Math.min(k, budget.particles) : 0;
      for (let i = 0; i < p; i++) sink.add("puff", i, 1, 0, 0, 0.2);
      return { instances: m, particles: p };
    },
  };
}

const CLASSES = {
  box: { geometry: (scene: Scene, name: string) => CreateBox(name, { size: 0.2 }, scene) },
  puff: { geometry: (scene: Scene, name: string) => CreateBox(name, { size: 0.1 }, scene), particle: true },
};

describe("LifeLayer", () => {
  it("draws the islands in view within the device class budget, one mesh per class", () => {
    const scene = new Scene(engine);
    const life = new LifeLayer(scene, CLASSES, "low");
    const meshes = scene.meshes.length;
    const a = plan(500, 100);
    const b = plan(3, 2);
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: a }, { origin: { x: 100, y: 0 }, plan: b }], "near");
    expect(life.lastStats()).toEqual({ instances: 153, particles: 66 });
    expect(life.counts()).toEqual({ box: 153, puff: 66 });
    expect(a.seen[0]?.budget).toEqual({ instances: 150, particles: 64 });
    life.setQuality("high");
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: a }], "near");
    expect(life.lastStats().instances).toBe(400);
    // The buffers grew in place: no mesh was created by the frames.
    expect(scene.meshes.length).toBe(meshes);
    expect(life.isParticle("puff")).toBe(true);
  });

  it("shows smoke only at mid, nothing at far, and nothing at all when off (?life=0)", () => {
    const scene = new Scene(engine);
    const life = new LifeLayer(scene, CLASSES, "low");
    const p = plan(5, 5);
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: p }], "mid");
    expect(life.counts()).toEqual({ puff: 5 });
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: p }], "far");
    expect(life.counts()).toEqual({});
    expect(p.seen.length).toBe(1);
    const off = new LifeLayer(scene, CLASSES, "low", false);
    off.frame(0, [{ origin: { x: 0, y: 0 }, plan: p }], "near");
    expect(off.counts()).toEqual({});
    expect(off.isEnabled()).toBe(false);
  });

  it("writes Scaling · RotationX · RotationY · Translation like Babylon", () => {
    const out = new Float32Array(32);
    writeMatrix(out, 1, 3, 0.5, -7, 0.7, 2, 1.3);
    const want = Matrix.Scaling(2, 2, 2).multiply(Matrix.RotationX(1.3)).multiply(Matrix.RotationY(0.7)).multiply(Matrix.Translation(3, 0.5, -7)).asArray();
    for (let i = 0; i < 16; i++) expect(out[16 + i]).toBeCloseTo(want[i] as number, 5);
  });

  it("offsets the instances by the island origin (world z = −tile y)", () => {
    const scene = new Scene(engine);
    const life = new LifeLayer(scene, CLASSES, "high");
    life.frame(0, [{ origin: { x: 10, y: 20 }, plan: plan(1) }], "near");
    const m = life.classMesh("box")?.mesh.thinInstanceGetWorldMatrices()[0];
    expect(m?.getTranslation().asArray()).toEqual([10, 0, -20]);
  });
});

describe("LifeLayer with models", () => {
  it("draws placeholders, then swaps in the models of the classes in use without creating meshes", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const life = new LifeLayer(scene, LIFE_CLASSES, "high", true, reg);
    const meshes = scene.meshes.length;
    const p: LifePlan = {
      frame(_now, sink) {
        sink.add(CLS.cart, 1, 0, 1, 0);
        sink.add(CLS.axle, 1, 0.1, 1.2, 0, 1, undefined, 0.5);
        return { instances: 2, particles: 0 };
      },
    };
    const placeholderVerts = life.classMesh(CLS.cart)?.mesh.getTotalVertices();
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: p }], "near");
    for (let i = 0; i < 200 && reg.status().pending.length > 0; i++) await new Promise((r) => setTimeout(r, 5));
    life.frame(0, [{ origin: { x: 0, y: 0 }, plan: p }], "near");
    expect(reg.status().loaded).toEqual(["life_cart.glb", "life_cart_axle.glb"]);
    expect(life.classMesh(CLS.cart)?.modelled).toBe(true);
    expect(life.classMesh(CLS.cartLoaded)?.modelled).toBe(false);
    expect(life.classMesh(CLS.cart)?.mesh.getTotalVertices()).not.toBe(placeholderVerts);
    expect(life.counts()).toEqual({ [CLS.cart]: 1, [CLS.axle]: 1 });
    expect(life.classMesh(CLS.cart)?.mesh.thinInstanceCount).toBe(1);
    // No attribute of the placeholder survives with its vertex count (it would break the draw).
    expect(life.classMesh(CLS.cart)?.mesh.getVerticesDataKinds()).not.toContain("uv");
    expect(scene.meshes.length).toBe(meshes);
  });
});
