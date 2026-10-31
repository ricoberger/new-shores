import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { Island, Terrain } from "../api/client";
import { coastline } from "../display/coastline";
import { BUILDINGS, FIELDS, TERRAIN } from "../theme/palette";
import { fallbackPatchColor, farFieldColor, fieldPatchColor, fieldPatchTops, PASTURE_PATCH } from "./farfields";
import { type ModelEntry, type ModelManifest, parseGlb } from "./models";
import { c3 } from "./palette";
import { fieldBase, fieldGround } from "./roadvoxels";
import { buildTerrain } from "./terrain";
import { islandField, pack, TERRAIN_VPT } from "./voxelterrain";

// Fields at far LOD are painted ground patches in the field model's colour
// (render/farfields.ts); the near field keeps its furrows.

const MODELS = join(__dirname, "..", "..", "public", "models");
const manifest = JSON.parse(readFileSync(join(MODELS, "manifest.json"), "utf8")) as ModelManifest;
const engine = new NullEngine();
afterAll(() => engine.dispose());

const fieldEntries = Object.entries(manifest.models).filter(([, e]) => (e as ModelEntry).kind === "field") as [string, ModelEntry][];
const luma = (c: Color3) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
const dist = (a: Color3, b: Color3) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

async function patchColors(): Promise<Map<string, Color3>> {
  const scene = new Scene(engine);
  const out = new Map<string, Color3>();
  for (const [id, e] of fieldEntries) {
    const d = await parseGlb(new Uint8Array(readFileSync(join(MODELS, e.file!.path))), scene);
    out.set(id, fieldPatchColor(d, (e.footprint?.w ?? 1) * (e.footprint?.h ?? 1)));
  }
  scene.dispose();
  return out;
}

describe("far field patch colours", () => {
  it("take the crop's colour from the field model: wheat gold, hemp green, tree plots a dark green", async () => {
    const colors = await patchColors();
    expect(fieldEntries.length).toBeGreaterThanOrEqual(8);
    // The crops' tops are the field palette's mark colours (the recipes use them).
    expect(dist(colors.get("wheat_field")!, c3(FIELDS.wheat_mark))).toBeLessThan(0.04);
    expect(dist(colors.get("hemp_field")!, c3(FIELDS.hemp_mark))).toBeLessThan(0.04);
    // Planted trees read as a dark green patch: darker than the meadow grass around them.
    const tree = colors.get("tree_plot")!;
    expect(tree.g).toBeGreaterThan(tree.r);
    expect(luma(tree)).toBeLessThan(luma(c3(TERRAIN.grass_a)) - 0.05);
    // Every crop has a colour of its own (no two field types share a patch).
    const crops = fieldEntries.filter(([id]) => fieldGround(id) !== "pasture").map(([id]) => colors.get(id)!);
    for (let i = 0; i < crops.length; i++) for (let j = i + 1; j < crops.length; j++) expect(dist(crops[i]!, crops[j]!)).toBeGreaterThan(0.01);
  });

  it("pastures are the palette's lighter pasture green, also before their model loads", () => {
    expect(farFieldColor("pasture", null)).toBe(PASTURE_PATCH);
    expect(farFieldColor("cattle_pasture", null)).toBe(PASTURE_PATCH);
    expect(luma(PASTURE_PATCH)).toBeGreaterThan(luma(c3(TERRAIN.grass_b)));
    expect(farFieldColor("wheat_field", null)).toEqual(fallbackPatchColor("wheat_field"));
  });

  it("covers the whole rotated footprint, keeps the roads and leaves the near field's furrows alone", () => {
    const width = 8;
    const height = 8;
    const terrain: Terrain[] = new Array<Terrain>(width * height).fill("grass");
    const is: Island = { id: "f", width, height, revision: "1", terrain, fertilities: [], deposits: [] };
    const f = islandField(is, coastline(is), 3, TERRAIN_VPT);
    const base = fieldBase(f);
    // A road column inside the footprint (one voxel down).
    const road = (2 * TERRAIN_VPT + 1) * f.nx + 3 * TERRAIN_VPT + 1;
    f.h[road] = (f.h[road] as number) - 1;
    const before = f.top.slice();
    const patch = pack(c3(FIELDS.pasture_mark));
    const tops = fieldPatchTops(f, base, [{ x: 2, y: 1, type: "pasture", w: 3, h: 2, patch }]);
    expect([...f.top]).toEqual([...before]);
    const at = (tx: number, ty: number) => tops[(ty * TERRAIN_VPT + 1) * f.nx + tx * TERRAIN_VPT + 2];
    // The pasture's fence: its outermost columns.
    const fence = pack(c3(BUILDINGS.timber));
    expect(tops[TERRAIN_VPT * f.nx + 2 * TERRAIN_VPT + 2]).toBe(fence);
    expect(tops[(3 * TERRAIN_VPT - 1) * f.nx + 5 * TERRAIN_VPT - 1]).toBe(fence);
    expect(tops[(TERRAIN_VPT + 1) * f.nx + 2 * TERRAIN_VPT + 1]).toBe(patch);
    for (const [tx, ty] of [
      [2, 1],
      [4, 1],
      [2, 2],
      [4, 2],
    ] as const)
      expect(at(tx, ty)).toBe(patch);
    expect(at(5, 1)).not.toBe(patch);
    expect(at(2, 3)).not.toBe(patch);
    expect(tops[road]).toBe(before[road]);
  });

  it("gives the lite terrain its own ground texture while the island has fields (the near one keeps the furrows)", () => {
    const scene = new Scene(engine);
    const width = 12;
    const height = 10;
    const terrain: Terrain[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terrain.push(x > 0 && y > 0 && x < width - 1 && y < height - 1 ? "grass" : "water");
    const is: Island = { id: "p", width, height, revision: "1", terrain, fertilities: [], deposits: [] };
    const node = new TransformNode("chunk", scene);
    const t = buildTerrain(scene, is, coastline(is), 5, () => node);
    const texOf = (m: { material: unknown }) => (m.material as { pluginManager?: { getPlugin(n: string): { binding?: { texture: RawTexture } } | null } }).pluginManager?.getPlugin("Ground")?.binding?.texture;
    const nearTex = texOf(t.full[0]!);
    expect(texOf(t.lite[0]!)).toBe(nearTex);
    const versionBefore = t.farVersion;
    const patch = pack(c3(FIELDS.wheat_mark));
    t.setRoads([], [{ x: 4, y: 4, type: "wheat_field", w: 1, h: 1, patch }]);
    const liteTex = texOf(t.lite[0]!);
    expect(liteTex).toBeDefined();
    expect(liteTex).not.toBe(nearTex);
    // The far columns follow the patches.
    expect(t.farVersion).not.toBe(versionBefore);
    // Without fields the lite mesh shares the near texture again.
    t.setRoads([], []);
    expect(texOf(t.lite[0]!)).toBe(nearTex);
    scene.dispose();
  });
});
