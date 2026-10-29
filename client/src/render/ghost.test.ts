import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentBuilding } from "../api/client";
import { GHOST_LIFT, ghostTint, PlacementGhost } from "./ghost";
import { type ModelData, ModelRegistry, parseGlb } from "./models";
import { GHOST, GHOST_INVALID, GHOST_NO_ROAD } from "./palette";

// The placement ghost headless (NullEngine) with the committed models, as
// in buildings.test.ts: the model once loaded, the box before and without.
const MODELS = join(__dirname, "..", "..", "public", "models");
const engine = new NullEngine();
afterAll(() => engine.dispose());

function registry(scene: Scene): ModelRegistry {
  return new ModelRegistry(scene, {
    fetch: (url) => {
      const path = url.endsWith("manifest.json") ? "manifest.json" : (url.replace("/models/", "").split("?")[0] as string);
      return Promise.resolve(new Response(new Uint8Array(readFileSync(join(MODELS, path))), { status: 200 }));
    },
    parse: (bytes, s): Promise<ModelData> => parseGlb(bytes, s),
  });
}

async function loaded(reg: ModelRegistry): Promise<void> {
  for (let i = 0; i < 200 && reg.status().pending.length > 0; i++) await new Promise((r) => setTimeout(r, 5));
}

const sawmill = { id: "sawmill", width: 2, height: 2, category: "production" } as unknown as ContentBuilding;
const temple = { id: "temple", width: 2, height: 2, category: "public" } as unknown as ContentBuilding;

describe("PlacementGhost", () => {
  it("draws the box until the model has loaded, then the full model at the footprint and rotation", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const ghost = new PlacementGhost(scene, reg);
    const spec = { def: sawmill, island: { x: 100, y: 50 }, x: 4, y: 6, rotation: 90 as const };
    ghost.show(spec, GHOST);
    expect(ghost.kind()).toBe("box");
    await loaded(reg);
    // Only the full file is asked for.
    expect(reg.status().loaded).toEqual(["sawmill.glb"]);
    ghost.show(spec, GHOST);
    expect(ghost.kind()).toBe("model");
    const mesh = scene.meshes.find((m) => m.name === "ghost_sawmill.glb")!;
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.position.x).toBeCloseTo(105);
    expect(mesh.position.z).toBeCloseTo(-57);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(scene.meshes.find((m) => m.name === "ghost")!.isEnabled()).toBe(false);
    // Validity tint on the translucent model material (depth pre-pass: only the front surface shows).
    ghost.show(spec, GHOST_INVALID);
    const mat = mesh.material as StandardMaterial;
    expect(mat.diffuseColor.equals(ghostTint(GHOST_INVALID).diffuse)).toBe(true);
    expect(mat.alpha).toBeLessThan(1);
    expect(mat.needDepthPrePass).toBe(true);
    ghost.hide();
    expect(ghost.kind()).toBeNull();
    expect(mesh.isEnabled()).toBe(false);
    scene.dispose();
  });

  it("draws a field's model too (pasture)", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const ghost = new PlacementGhost(scene, reg);
    const spec = { def: { id: "pasture", width: 2, height: 2, category: "production" } as unknown as ContentBuilding, island: { x: 0, y: 0 }, x: 2, y: 2, rotation: 0 as const };
    ghost.show(spec, GHOST);
    await loaded(reg);
    ghost.show(spec, GHOST);
    expect(ghost.kind()).toBe("model");
    scene.dispose();
  });

  it("keeps the box for content IDs without a model and without a registry", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const ghost = new PlacementGhost(scene, reg);
    ghost.show({ def: temple, island: { x: 0, y: 0 }, x: 0, y: 0, rotation: 0 }, GHOST_NO_ROAD);
    expect(ghost.kind()).toBe("box");
    const bare = new PlacementGhost(scene, null);
    bare.show({ def: sawmill, island: { x: 0, y: 0 }, x: 0, y: 0, rotation: 0 }, GHOST);
    expect(bare.kind()).toBe("box");
    // On a terrace (D-058) the box stands on the footprint's base.
    bare.show({ def: sawmill, island: { x: 0, y: 0 }, x: 0, y: 0, rotation: 0, base: 0.5 }, GHOST);
    expect(scene.meshes.filter((m) => m.name === "ghost").at(-1)!.position.y).toBeCloseTo(0.8 + GHOST_LIFT, 4);
    expect(GHOST_LIFT).toBeGreaterThan(0);
    expect(GHOST_LIFT).toBeLessThan(0.03);
    scene.dispose();
  });

  it("tints toward the validity colour without losing the model's own colours", () => {
    const red = ghostTint(GHOST_INVALID);
    const neutral = ghostTint(GHOST);
    expect(red.diffuse.r).toBeGreaterThan(red.diffuse.g);
    expect(Math.min(neutral.diffuse.r, neutral.diffuse.g, neutral.diffuse.b)).toBeGreaterThan(0.9);
    // Warnings tint harder than the neutral ghost.
    expect(ghostTint(GHOST_NO_ROAD).emissive.r).toBeGreaterThan(neutral.emissive.r);
  });
});
