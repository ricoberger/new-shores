import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentBuilding } from "../api/client";
import { type ModelData, ModelRegistry, parseGlb } from "./models";
import { GOLD } from "./palette";
import { OUTLINE_WIDTH, PlanLayer, rectOutline, tilesOutline } from "./plans";

// The plan layer headless (NullEngine) with the committed models, as in ghost.test.ts.
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
const island = { x: 100, y: 50 };

describe("plan outlines", () => {
  it("outlines a footprint inside its edges", () => {
    const bands = rectOutline(4, 6, 3, 2, 1);
    expect(bands).toHaveLength(4);
    for (const b of bands) {
      expect(b.x0).toBeGreaterThanOrEqual(4);
      expect(b.x1).toBeLessThanOrEqual(7);
      expect(-b.z0).toBeGreaterThanOrEqual(6);
      expect(-b.z1).toBeLessThanOrEqual(8);
      expect(Math.min(b.x1 - b.x0, b.z0 - b.z1)).toBeCloseTo(OUTLINE_WIDTH);
      expect(b.y).toBeGreaterThan(1);
    }
  });

  it("outlines a planned road strip on its open sides only", () => {
    const tiles = [0, 1, 2].map((x) => ({ island, x, y: 3, base: 0 }));
    const bands = tilesOutline(tiles);
    // Top and bottom of each tile, plus the two ends.
    expect(bands).toHaveLength(8);
    expect(tilesOutline([{ island, x: 0, y: 0, base: 0 }])).toHaveLength(4);
  });
});

describe("PlanLayer", () => {
  it("draws plans as untinted ghost models with a gold outline and no slab or box under them", async () => {
    const scene = new Scene(engine);
    const reg = registry(scene);
    await reg.loadManifest();
    const layer = new PlanLayer(scene, reg);
    const spec = { id: 7, def: sawmill, island, x: 4, y: 6, rotation: 90 as const, base: 0 };
    layer.set("a", [spec], []);
    expect(layer.shown()).toBe(1);
    // No box or slab stands in for a model: until it has loaded only the outline shows.
    expect(scene.getMeshByName("plan_box")).toBeNull();
    expect(scene.getMeshByName("plan_outline")!.isEnabled()).toBe(true);
    await loaded(reg);
    layer.set("b", [spec, { ...spec, id: 8, x: 10 }], [{ island, x: 0, y: 0, base: 0 }]);
    expect(layer.shown()).toBe(3);
    const model = scene.meshes.find((m) => m.name.startsWith("plan_sawmill")) as Mesh;
    expect(model.thinInstanceCount).toBe(2);
    const mat = model.material as StandardMaterial;
    // Untinted: the model keeps its colours, translucent.
    expect([mat.diffuseColor.r, mat.diffuseColor.g, mat.diffuseColor.b]).toEqual([1, 1, 1]);
    expect(mat.alpha).toBeLessThan(1);
    const outline = scene.getMeshByName("plan_outline") as Mesh;
    expect(outline.isEnabled()).toBe(true);
    expect((outline.material as StandardMaterial).emissiveColor.equals(GOLD)).toBe(true);
    expect(scene.getMeshByName("plan_road")!.isEnabled()).toBe(true);
    // Nothing to draw: everything off.
    layer.set("", [], []);
    expect(layer.shown()).toBe(0);
    expect(outline.isEnabled()).toBe(false);
    expect(model.isEnabled()).toBe(false);
  });
});
