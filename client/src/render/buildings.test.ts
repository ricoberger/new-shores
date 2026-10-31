import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { BuildingLayer, mergeItems, RISE_MS, scaffoldClass, stageClass, STAGES, stageMatrix, VISUAL_BUILD_MS } from "./buildings";
import { rotatedFootprint } from "../display/geometry";
import { type ModelData, type ModelManifest, ModelRegistry, parseGlb, placement } from "./models";

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
    ["market", 3, 3, "public"],
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


  it("leaves the field models out of the lite chunks: at far LOD fields are ground patches, counted as drawn", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    const withField = new Map(defs).set("wheat_field", { id: "wheat_field", width: 1, height: 1, category: "production", field: { farm: ["wheat_farm"] } } as unknown as ContentBuilding);
    layer.update([b(1, "sawmill", 0), b(2, "wheat_field", 4), b(3, "wheat_field", 5)], withField);
    await loaded(reg);
    layer.refresh();
    const saw = manifest.models.sawmill!.file!;
    const wheat = manifest.models.wheat_field!.file!;
    expect(wheat.lite).toBeUndefined();
    // Lite (far): the sawmill's lite model only; both fields drawn (as patches), so no field placeholder layer draws them.
    expect(layer.chunkTriangles()).toBe(saw.lite!.triangles);
    expect([...layer.modelled()].sort()).toEqual([1, 2, 3]);
    const meshes = scene.meshes.length;
    // Full (mid): the field models return, from the prebuilt chunk (no new geometry).
    layer.setDetail("full");
    expect(layer.chunkTriangles()).toBe(saw.triangles + 2 * wheat.triangles);
    expect([...layer.modelled()].sort()).toEqual([1, 2, 3]);
    expect(scene.meshes.length).toBe(meshes);
    layer.setDetail("lite");
    expect(layer.chunkTriangles()).toBe(saw.lite!.triangles);
    expect(scene.meshes.length).toBe(meshes);
    scene.dispose();
  });

  it("merges the lite models per group of chunks (far LOD's draw calls) and the full ones per chunk, each culled with its chunks", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    // Sawmills in chunks 0,0, 1,0 and 3,0 (one lite group) and 4,0 (the next group).
    layer.update([b(1, "sawmill", 0), b(2, "sawmill", 40), b(3, "sawmill", 100), b(4, "sawmill", 130)], defs);
    await loaded(reg);
    layer.refresh();
    expect(layer.chunkCount()).toBe(2);
    const enabled = () => layer.meshes().filter((m) => m.isEnabled()).length;
    layer.setVisibleChunks(new Set(["1,0"]));
    expect(enabled()).toBe(1);
    layer.setVisibleChunks(new Set(["1,0", "5,0"]));
    expect(enabled()).toBe(2);
    layer.setDetail("full");
    expect(layer.chunkCount()).toBe(4);
    expect(enabled()).toBe(1);
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
    // The alpha (the jitter class, render/jitter.ts) is not tinted.
    expect(paused[3]).toBe(active[3]);
    scene.dispose();
  });

  it("bakes a neutral grey tint into an inactive field (not_adjacent) and leaves an active one alone", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    const colours = async (active: boolean) => {
      layer.update([b(10, "sawmill", 0, { active, farm_id: 1 })], defs);
      await loaded(reg);
      layer.refresh();
      const mesh = layer.meshes().find((m) => m.name.startsWith("models_"))!;
      return [...(mesh.getVerticesData("color") as Float32Array)];
    };
    const on = await colours(true);
    const off = await colours(false);
    expect(off.length).toBe(on.length);
    expect(off[0]).toBeCloseTo((on[0] as number) * 0.62, 5);
    expect(off[1]).toBeCloseTo((on[1] as number) * 0.62, 5);
    expect(off[2]).toBeCloseTo((on[2] as number) * 0.58, 5);
    expect(off[3]).toBe(on[3]);
    scene.dispose();
  });

  it("raises a newly placed building over RISE_MS, then merges it; the first payload never animates", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.setDetail("full");
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

  it("shows the construction stages A → B → C over the visual build time, scaffolding from 3×3, then merges", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.setDetail("full");
    layer.update([b(1, "house_settlers", 0)], defs);
    await loaded(reg);
    layer.refresh();
    layer.update([b(1, "house_settlers", 0), b(2, "house_settlers", 4), b(3, "market", 8)], defs);
    await loaded(reg);
    layer.refresh();
    // The first frame requests the stage models; once loaded the stages run from the building's start.
    layer.frame(1000);
    await loaded(reg);
    layer.frame(1001);
    expect(layer.stageCounts()).toEqual({ stage_a: 2, stage_scaffolding: 1 });
    expect(scene.meshes.filter((m) => m.name.startsWith("rising_") && m.isVisible)).toHaveLength(0);
    layer.frame(1000 + VISUAL_BUILD_MS / 2);
    expect(layer.stageCounts()).toEqual({ stage_b: 2, stage_scaffolding: 1 });
    layer.frame(1000 + VISUAL_BUILD_MS - 1);
    expect(layer.stageCounts()).toEqual({ stage_c: 2, stage_scaffolding: 1 });
    // A clock that goes back (an unfrozen test clock, an offset correction) restarts the stages.
    layer.frame(500);
    expect(layer.stageCounts()).toEqual({ stage_a: 2, stage_scaffolding: 1 });
    expect(layer.frame(500 + VISUAL_BUILD_MS + 1)).toBe(true);
    layer.frame(500 + VISUAL_BUILD_MS + 2);
    expect(layer.stageCounts()).toEqual({});
    expect(layer.modelled().has(3)).toBe(true);
    scene.dispose();
  });

  it("shows no rise-in or construction stages at the lite detail (far LOD): a new building joins its lite chunk at once", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.update([b(1, "sawmill", 0)], defs);
    await loaded(reg);
    layer.refresh();
    const lite = manifest.models.sawmill!.file!.lite!.triangles;
    expect(layer.chunkTriangles()).toBe(lite);
    layer.update([b(1, "sawmill", 0), b(2, "sawmill", 4), b(3, "sawmill", 8)], defs);
    await loaded(reg);
    layer.refresh();
    layer.frame(1000);
    await loaded(reg);
    layer.frame(1001);
    expect(layer.stageCounts()).toEqual({});
    expect(scene.meshes.filter((m) => m.name.startsWith("rising_") && m.isVisible)).toHaveLength(0);
    expect([...layer.modelled()].sort()).toEqual([1, 2, 3]);
    expect(layer.chunkTriangles()).toBe(3 * lite);
    // Zooming out while a building rises at mid ends its stages at once.
    layer.setDetail("full");
    layer.update([b(1, "sawmill", 0), b(2, "sawmill", 4), b(3, "sawmill", 8), b(4, "sawmill", 12)], defs);
    await loaded(reg);
    layer.refresh();
    layer.frame(2000);
    await loaded(reg);
    layer.frame(2001);
    expect(Object.keys(layer.stageCounts())).toHaveLength(1);
    layer.setDetail("lite");
    expect(layer.stageCounts()).toEqual({});
    expect(layer.chunkTriangles()).toBe(4 * lite);
    scene.dispose();
  });

  it("keeps the rise-in without the life layer (?life=0)", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new BuildingLayer(scene, null, reg);
    layer.setDetail("full");
    layer.stages = false;
    layer.update([b(1, "house_settlers", 0)], defs);
    await loaded(reg);
    layer.refresh();
    layer.update([b(1, "house_settlers", 0), b(2, "house_settlers", 4)], defs);
    await loaded(reg);
    layer.refresh();
    layer.frame(1000);
    expect(layer.stageCounts()).toEqual({});
    expect(scene.meshes.find((m) => m.name.startsWith("rising_") && m.isVisible)).toBeDefined();
    expect(layer.frame(1000 + RISE_MS + 1)).toBe(true);
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
    layer.setDetail("full");
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
    expect(merged.getTotalIndices() / 3).toBe(2 * manifest.models.sawmill!.file!.triangles);
    // The caller refreshes the casters on `true` (engine.ts): the new chunk is in the render list.
    casters();
    expect(shadows.getShadowMap()!.renderList).toContain(merged);
    expect(shadows.getShadowMap()!.renderList).not.toContain(first);
    scene.dispose();
  });
});

describe("stageMatrix", () => {
  // A non-square footprint (3 × 2) shows whether a stage turns with the building.
  const def = { id: "sawmill", width: 3, height: 2, category: "production" } as unknown as ContentBuilding;
  const entry = manifest.models.sawmill!;
  const rotationOf = (m: Matrix) => {
    const q = new Quaternion();
    m.decompose(undefined, q, undefined);
    return q;
  };

  for (const rotation of [0, 90, 180, 270] as const) {
    it(`turns the stages and the scaffolding with the building at ${rotation}°`, () => {
      const b = { x: 4, y: 6, rotation };
      const p = placement(entry, def, b);
      const final = Matrix.Scaling(p.sx, 1, p.sz).multiply(Matrix.RotationY(p.yaw)).multiply(Matrix.Translation(p.cx, 0, p.cz));
      for (let k = 0; k <= STAGES; k++) {
        const q = rotationOf(stageMatrix(k, entry, def, b));
        // Same orientation as the final model (q and −q are the same rotation).
        expect(Math.abs(Quaternion.Dot(q, rotationOf(final)))).toBeCloseTo(1, 6);
      }
      // A stage covers the rotated footprint, centred on it.
      const [w, h] = rotatedFootprint(def.width, def.height, rotation);
      const m = stageMatrix(0, entry, def, b);
      const n = stageClass(def.width, def.height);
      const pts = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => Vector3.TransformCoordinates(new Vector3((sx * n) / 2, 0, (sz * n) / 2), m)));
      const xs = pts.map((v) => v.x);
      const zs = pts.map((v) => v.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(w, 6);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(h, 6);
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(p.cx, 6);
      expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(p.cz, 6);
    });
  }

  it("stands a stage on the building's base (terraces, D-058)", () => {
    const m = stageMatrix(0, entry, def, { x: 4, y: 6, rotation: 0 }, 0.5);
    expect(Vector3.TransformCoordinates(Vector3.Zero(), m).y).toBeCloseTo(0.5, 6);
  });

  it("lifts merged model instances by their base", () => {
    const data = { positions: new Float32Array([0, 0.25, 0]), normals: new Float32Array([0, 1, 0]), colors: new Float32Array([1, 1, 1, 1]), indices: new Uint32Array([0, 0, 0]) } as unknown as Parameters<typeof mergeItems>[0][number]["data"];
    const v = mergeItems([{ data, cx: 1, cy: 0.5, cz: -1, yaw: 0, sx: 1, sz: 1, tint: [1, 1, 1, 1] }]);
    expect(Array.from(v.positions!)).toEqual([1, 0.75, -1]);
  });

  it("picks the footprint class nearest the footprint, so the stage voxels stretch little", () => {
    expect([stageClass(1, 1), stageClass(2, 2), stageClass(3, 2), stageClass(4, 5), stageClass(3, 8), stageClass(12, 16)]).toEqual([2, 2, 2, 4, 4, 8]);
    expect([scaffoldClass(3, 3), scaffoldClass(4, 6), scaffoldClass(6, 9), scaffoldClass(12, 16)]).toEqual([3, 3, 8, 8]);
    for (const [w, h] of [[1, 1], [3, 4], [4, 6], [5, 6], [6, 9], [8, 12], [11, 14]] as const) {
      const n = stageClass(w, h);
      expect(Math.max(w, h) / n, `${w}×${h}`).toBeLessThanOrEqual(2);
      expect(Math.min(w, h) / n, `${w}×${h}`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("differs between rotations (the stage is not world-fixed)", () => {
    const at = (rotation: 0 | 90) => rotationOf(stageMatrix(1, entry, def, { x: 0, y: 0, rotation }));
    expect(Math.abs(Quaternion.Dot(at(0), at(90)))).toBeLessThan(0.9);
  });
});
