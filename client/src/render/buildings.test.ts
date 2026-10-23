import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { BuildingLayer, RISE_MS } from "./buildings";
import { type ModelData, type ModelManifest, ModelRegistry, parseGlb } from "./models";

// The building layer headless (NullEngine) with the committed models: a
// fake fetch serves public/models, so the registry runs as in the browser.
const MODELS = join(__dirname, "..", "..", "public", "models");
const manifest = JSON.parse(readFileSync(join(MODELS, "manifest.json"), "utf8")) as ModelManifest;
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

const defs = new Map<string, ContentBuilding>(
  [
    ["house_settlers", 2, 2, "houses"],
    ["sawmill", 2, 2, "production"],
    ["temple", 2, 2, "public"],
  ].map(([id, w, h, category]) => [id as string, { id, width: w, height: h, category } as unknown as ContentBuilding]),
);

function b(id: number, type: string, x: number, extra: Partial<BuildingDisplay> = {}): BuildingDisplay {
  return { id, type, x, y: 2, rotation: 0, paused: false, paused_reason: "", status: "ok", ...extra } as BuildingDisplay;
}

async function loaded(reg: ModelRegistry): Promise<void> {
  for (let i = 0; i < 200 && (reg.status().pending.length > 0 || !reg.status().manifest); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("BuildingLayer with models", () => {
  it("draws placeholders until the models load, then merged chunks; IDs without a model keep the placeholder", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    const list = [b(1, "house_settlers", 0), b(2, "sawmill", 4, { paused: true }), b(3, "temple", 8)];
    layer.update(list, defs);
    expect([...layer.placeholders()].sort()).toEqual(["house_settlers", "sawmill", "temple"]);
    await loaded(reg);
    layer.refresh();
    expect([...layer.placeholders()]).toEqual(["temple"]);
    expect([...layer.modelled()].sort()).toEqual([1, 2]);
    expect(layer.chunkCount()).toBe(1);
    // Both details are requested and built up front.
    expect(reg.status().loaded.some((p) => p.includes(".lite."))).toBe(true);
    expect(reg.status().loaded.some((p) => p === "sawmill.glb")).toBe(true);
    // Without the lite tier only the full files are built.
    layer.setDetails(["full"]);
    layer.setDetail("full");
    expect(layer.chunkCount()).toBe(1);
    scene.dispose();
  });

  it("builds both detail chunks once and only toggles them on a detail change (rendered triangles)", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.update([b(1, "sawmill", 0)], defs);
    await loaded(reg);
    layer.refresh();
    const saw = manifest.models.sawmill!.file!;
    expect(layer.chunkTriangles()).toBe(saw.lite!.triangles);
    expect(layer.bridged()).toBe(0);
    const meshes = scene.meshes.length;
    // The switch draws the prebuilt full chunk at once, without new geometry.
    layer.setDetail("full");
    expect(layer.chunkTriangles()).toBe(saw.triangles);
    expect(scene.meshes.length).toBe(meshes);
    layer.setDetail("lite");
    expect(layer.chunkTriangles()).toBe(saw.lite!.triangles);
    expect(scene.meshes.length).toBe(meshes);
    scene.dispose();
  });


  it("bakes the paused tint into the chunk's vertex colours", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    const colours = async (paused: boolean) => {
      layer.update([b(10, "sawmill", 0, { paused })], defs);
      await loaded(reg);
      layer.refresh();
      const mesh = layer.meshes().find((m) => m.name.startsWith("models_"))!;
      return [...(mesh.getVerticesData("color") as Float32Array)];
    };
    const active = await colours(false);
    const paused = await colours(true);
    expect(paused.length).toBe(active.length);
    expect(paused[0]).toBeLessThan(active[0] as number);
    expect(paused[3]).toBe(1);
    scene.dispose();
  });

  it("raises a newly placed building over RISE_MS, then merges it; the first payload never animates", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.update([b(1, "house_settlers", 0)], defs);
    await loaded(reg);
    layer.refresh();
    const before = layer.meshes().filter((m) => m.name.startsWith("rising_")).length;
    expect(before).toBe(0);
    layer.update([b(1, "house_settlers", 0), b(2, "house_settlers", 4)], defs);
    await loaded(reg);
    layer.refresh();
    layer.frame(1000);
    const rising = scene.meshes.find((m) => m.name.startsWith("rising_") && m.isVisible);
    expect(rising).toBeDefined();
    layer.frame(1000 + RISE_MS / 2);
    expect(layer.modelled().has(2)).toBe(true);
    layer.frame(1000 + RISE_MS + 1);
    // Done: the building joined its chunk and the rising instances are gone.
    expect(scene.meshes.filter((m) => m.name.startsWith("rising_") && m.isVisible)).toHaveLength(0);
    expect(manifest.models.house_settlers).toBeDefined();
    scene.dispose();
  });

  it("reports the chunk rebuild when a rise-in finishes, and the new chunk mesh casts the sun shadow", async () => {
    const scene = new Scene(engine);
    new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
    const sun = new DirectionalLight("sun", new Vector3(-1, -2, -1), scene);
    const shadows = new ShadowGenerator(256, sun);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    const casters = () => {
      const list = shadows.getShadowMap()!.renderList!;
      list.length = 0;
      for (const m of layer.meshes()) shadows.addShadowCaster(m, false);
    };
    layer.update([b(1, "sawmill", 0)], defs);
    await loaded(reg);
    layer.refresh();
    casters();
    const first = layer.meshes().find((m) => m.name.startsWith("models_"))!;
    // A second sawmill in the same chunk rises in.
    layer.update([b(1, "sawmill", 0), b(2, "sawmill", 4)], defs);
    expect(layer.frame(1000)).toBe(false);
    expect(layer.frame(1000 + RISE_MS / 2)).toBe(false);
    expect(layer.frame(1000 + RISE_MS + 1)).toBe(true);
    expect(layer.frame(1000 + RISE_MS + 2)).toBe(false);
    const merged = layer.meshes().find((m) => m.name.startsWith("models_"))!;
    expect(merged).not.toBe(first);
    expect(merged.getTotalIndices() / 3).toBe(2 * manifest.models.sawmill!.file!.lite!.triangles);
    // The caller refreshes the casters on `true` (engine.ts): the new chunk is in the render list.
    casters();
    expect(shadows.getShadowMap()!.renderList).toContain(merged);
    expect(shadows.getShadowMap()!.renderList).not.toContain(first);
    scene.dispose();
  });
});
