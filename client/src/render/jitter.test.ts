import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { addJitter, JITTER_CLASSES, JitterPlugin, jitterClass, jitterRequested, jitterShade, MODEL_VPT, setJitterLod } from "./jitter";

const engine = new NullEngine();
const scene = new Scene(engine);
afterAll(() => engine.dispose());

/** The COLOR_0 alpha bytes of a shipped model file (GLB: JSON chunk, then BIN). */
function alphas(file: string): Set<number> {
  const buf = readFileSync(join(__dirname, "../../public/models", file));
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView: number; count: number }[];
    bufferViews: { byteOffset: number }[];
  };
  const acc = doc.accessors[doc.meshes[0]!.primitives[0]!.attributes["COLOR_0"]!]!;
  const at = 20 + jsonLen + 8 + doc.bufferViews[acc.bufferView]!.byteOffset;
  const out = new Set<number>();
  for (let i = 0; i < acc.count; i++) out.add(buf[at + i * 4 + 3] as number);
  return out;
}

describe("voxel colour jitter", () => {
  it("decodes the material class from the vertex alpha (rigid 255 − class, swaying below)", () => {
    expect(jitterClass(1)).toBe(0);
    expect(jitterClass(254 / 255)).toBe(1);
    expect(jitterClass(248 / 255)).toBe(7);
    expect(jitterClass(245 / 255)).toBe(8);
    expect(jitterClass(0.6)).toBe(8);
    expect(JITTER_CLASSES).toHaveLength(9);
  });

  it("is stronger on stone and roofs than on plaster, none on glass", () => {
    const v = (c: number) => (JITTER_CLASSES[c] as readonly [number, number])[0];
    expect(v(0)).toBe(0);
    expect(v(1)).toBeGreaterThan(v(5));
    expect(v(2)).toBeGreaterThan(v(5));
    expect(v(3)).toBeLessThan(v(5));
    expect(v(4)).toBeGreaterThan(v(3));
  });

  it("uses the models' voxel grid", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "../../public/models/manifest.json"), "utf8")) as { voxels_per_tile: number };
    expect(MODEL_VPT).toBe(manifest.voxels_per_tile);
  });

  it("finds the classes in the shipped models", () => {
    // A Settler house: stone, roof (thatch), plaster and timber; a window has none.
    const house = new Set([...alphas("house_settlers.v0.glb")].map((a) => jitterClass(a / 255)));
    for (const c of [1, 2, 3, 4]) expect(house.has(c), `class ${c}`).toBe(true);
    // A tree's leaves sway (class 8), its trunk is wood.
    const tree = new Set([...alphas("decor_tree_a.glb")].map((a) => jitterClass(a / 255)));
    expect(tree.has(8)).toBe(true);
    expect(tree.has(4)).toBe(true);
  });

  it("is on by default, off with ?jitter=0 and at far LOD", () => {
    expect(jitterRequested("")).toBe(true);
    expect(jitterRequested("?life=0")).toBe(true);
    expect(jitterRequested("?jitter=0")).toBe(false);
    const was = jitterShade.enabled;
    setJitterLod(false);
    expect(jitterShade.amount).toBe(1);
    setJitterLod(true);
    expect(jitterShade.amount).toBe(0);
    jitterShade.enabled = false;
    setJitterLod(false);
    expect(jitterShade.amount).toBe(0);
    jitterShade.enabled = was;
    setJitterLod(false);
  });

  it("adds the plugin once with the model grid", () => {
    const m = addJitter(addJitter(new StandardMaterial("j", scene), MODEL_VPT), 2);
    const p = m.pluginManager?.getPlugin("Jitter") as JitterPlugin;
    expect(p).toBeInstanceOf(JitterPlugin);
    expect(p.getCustomCode("fragment")?.["CUSTOM_FRAGMENT_UPDATE_DIFFUSE"]).toContain("floor(vJitP - jitIn * 0.5)");
  });
});
