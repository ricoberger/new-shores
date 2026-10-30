import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentBuilding } from "../api/client";
import { GHOST_LIFT, ghostPlinth, ghostTint, PlacementGhost } from "./ghost";
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

describe("ghost plinth on terrace edges", () => {
  const foot = { x: 2, y: 3, w: 2, h: 2 };
  // Level 1 (0.5 tiles) on the tile (3, 3), the rest of the island flat at 0.
  const ground = (x: number, y: number) => (x === 3 && y === 3 ? 0.5 : 0);

  it("has none on a single level", () => {
    expect(ghostPlinth(foot, 0, () => 0)).toBeNull();
    expect(ghostPlinth(foot, 0.5, () => 0.5)).toBeNull();
  });

  it("fills every lower tile up to the highest level, with walls only on the sides toward the outside", () => {
    // One tile of four at 0.5: the three lower tiles each have two sides toward the outside → 6 walls of 4 courses (0.5 / 0.125), 4 vertices each.
    const p = ghostPlinth(foot, 0.5, ground)!;
    expect(p.positions.length / 3).toBe(6 * 4 * 4);
    // Everything lies between the lower ground and the model's lifted base.
    const ys = p.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(0.5 + GHOST_LIFT);
    // Walls stay inside the footprint's rectangle.
    const xs = p.positions.filter((_, i) => i % 3 === 0);
    const zs = p.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...xs)).toBeCloseTo(4);
    expect(Math.min(...zs)).toBeCloseTo(-5);
    expect(Math.max(...zs)).toBeCloseTo(-3);
  });

  it("starts a wall at the outside tile's higher ground", () => {
    // The tile west of the footprint stands at 0.25: the wall of tile (2, 3) toward it starts there.
    const p = ghostPlinth({ x: 2, y: 3, w: 1, h: 1 }, 0.5, (x, y) => (x === 1 && y === 3 ? 0.25 : x === 2 && y === 3 ? 0 : 0.5))!;
    const west = [];
    for (let i = 0; i < p.positions.length; i += 3) if (p.positions[i] === 2 && p.normals[i] === -1) west.push(p.positions[i + 1] as number);
    expect(Math.min(...west)).toBeCloseTo(0.25);
  });

  it("shows under a building ghost across an edge only, and goes with the ghost", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const ghost = new PlacementGhost(scene, reg);
    const spec = { def: sawmill, island: { x: 10, y: 20 }, x: 2, y: 3, rotation: 0 as const, base: 0.5, ground };
    ghost.show(spec, GHOST);
    await loaded(reg);
    ghost.show(spec, GHOST);
    const plinth = scene.meshes.find((m) => m.name === "ghost_plinth")!;
    expect(plinth.isEnabled()).toBe(true);
    expect(plinth.position.x).toBe(10);
    expect(plinth.position.z).toBe(-20);
    // On one level there is none.
    ghost.show({ ...spec, base: 0, ground: () => 0 }, GHOST);
    expect(scene.meshes.find((m) => m.name === "ghost_plinth")).toBeUndefined();
    ghost.show(spec, GHOST);
    ghost.hide();
    expect(scene.meshes.find((m) => m.name === "ghost_plinth")!.isEnabled()).toBe(false);
    scene.dispose();
  });
});
