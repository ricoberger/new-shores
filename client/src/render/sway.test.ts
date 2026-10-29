import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { addSway, anchorBob, SAILING_ALPHA, sailing, setSwayTime, SwayPlugin, swayClock, waiting } from "./sway";

const engine = new NullEngine();
const scene = new Scene(engine);
afterAll(() => engine.dispose());

/** Swaying vertices (COLOR_0 alpha byte below 248: 248..255 are the jitter classes) of a shipped model file (GLB: JSON chunk, then BIN). */
function swaying(file: string): { n: number; of: number } {
  const buf = readFileSync(join(__dirname, "../../public/models", file));
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView: number; count: number }[];
    bufferViews: { byteOffset: number }[];
  };
  const bin = 20 + jsonLen + 8;
  const acc = doc.accessors[doc.meshes[0]!.primitives[0]!.attributes["COLOR_0"]!]!;
  const at = bin + doc.bufferViews[acc.bufferView]!.byteOffset;
  let n = 0;
  for (let i = 0; i < acc.count; i++) if ((buf[at + i * 4 + 3] as number) < 248) n++;
  return { n, of: acc.count };
}

describe("cloth sway", () => {
  it("wraps the clock and silences the sway with life off", () => {
    setSwayTime(600_000 + 1500, true);
    expect(swayClock).toEqual({ t: 1.5, amp: 1 });
    setSwayTime(-500, false);
    expect(swayClock.t).toBeCloseTo(599.5);
    expect(swayClock.amp).toBe(0);
  });

  it("fills the sails only under way", () => {
    expect(sailing({ leg: {} }, { atSea: true })).toBe(true);
    expect(sailing({ leg: {} }, { atSea: false })).toBe(false);
    expect(sailing({}, { atSea: true })).toBe(false);
    expect(sailing({ leg: {} }, null)).toBe(false);
  });

  it("bobs ships waiting at anchor, deterministically, not those on a leg or moored", () => {
    expect(waiting({}, undefined)).toBe(true);
    expect(waiting({ leg: {} }, undefined)).toBe(false);
    expect(waiting({}, { queued: true })).toBe(true);
    expect(waiting({}, {})).toBe(false);
    const a = { ...anchorBob(3, 12_345) };
    expect(anchorBob(3, 12_345)).toEqual(a);
    expect(anchorBob(4, 12_345)).not.toEqual(a);
    expect(Math.abs(a.dy)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(a.rock)).toBeLessThanOrEqual(0.05);
  });

  it("adds the plugin once and moves only masked vertices", () => {
    const m = addSway(addSway(new StandardMaterial("m", scene)));
    expect(m.pluginManager?.getPlugin("Sway")).toBeInstanceOf(SwayPlugin);
    const code = (m.pluginManager?.getPlugin("Sway") as SwayPlugin).getCustomCode("vertex") ?? {};
    expect(code["CUSTOM_VERTEX_UPDATE_WORLDPOS"]).toContain("1.0 - color.a");
    expect(code["CUSTOM_VERTEX_MAIN_END"]).toContain(SAILING_ALPHA.toFixed(2));
    expect((m.pluginManager?.getPlugin("Sway") as SwayPlugin).getCustomCode("fragment")).toBeNull();
  });

  it("is marked exactly on the models whose manifest entry lists sway groups", () => {
    // In sync with the manifest (assets/voxel: the recipes' sail, flag and cloth groups, canopies), not a fixed list.
    type FileInfo = { path: string };
    type Entry = { sway?: string[]; file?: FileInfo; variants?: FileInfo[]; levels?: Record<string, FileInfo> };
    const manifest = JSON.parse(readFileSync(join(__dirname, "../../public/models/manifest.json"), "utf8")) as Record<"models" | "decor" | "life", Record<string, Entry>>;
    let swayingModels = 0;
    for (const group of ["models", "decor", "life"] as const) {
      for (const [id, e] of Object.entries(manifest[group])) {
        const files = [e.file, ...(e.variants ?? []), ...Object.values(e.levels ?? {})].filter((f): f is FileInfo => !!f).map((f) => swaying(f.path));
        if (e.sway?.length) {
          swayingModels++;
          // Some level or variant sways (trading post: level 4 only), and never the whole model.
          expect(files.some((f) => f.n > 0), id).toBe(true);
          for (const f of files) expect(f.n, id).toBeLessThan(f.of);
        } else for (const f of files) expect(f.n, id).toBe(0);
      }
    }
    // The ships, the cloth makers (wool, linen, sails), the trading post, the warehouse's awning and flag and the trees at least.
    expect(swayingModels).toBeGreaterThanOrEqual(8);
    for (const id of ["weaver_wool", "weaver_linen", "sailmaker", "warehouse", "trading_post"]) expect(manifest.models[id]?.sway?.length, id).toBeGreaterThan(0);
    expect(manifest.models["brig"]?.sway).toContain("sail");
    expect(manifest.decor["decor_tree_a"]?.sway).toEqual(["canopy"]);
  });
});
