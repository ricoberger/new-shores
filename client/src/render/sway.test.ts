import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { addSway, SAILING_ALPHA, sailing, setSwayTime, SwayPlugin, swayClock } from "./sway";

const engine = new NullEngine();
const scene = new Scene(engine);
afterAll(() => engine.dispose());

/** Swaying vertices (COLOR_0 alpha byte below 255) of a shipped model file (GLB: JSON chunk, then BIN). */
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
  for (let i = 0; i < acc.count; i++) if ((buf[at + i * 4 + 3] as number) < 255) n++;
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

  it("adds the plugin once and moves only masked vertices", () => {
    const m = addSway(addSway(new StandardMaterial("m", scene)));
    expect(m.pluginManager?.getPlugin("Sway")).toBeInstanceOf(SwayPlugin);
    const code = (m.pluginManager?.getPlugin("Sway") as SwayPlugin).getCustomCode("vertex") ?? {};
    expect(code["CUSTOM_VERTEX_UPDATE_WORLDPOS"]).toContain("1.0 - color.a");
    expect(code["CUSTOM_VERTEX_MAIN_END"]).toContain(SAILING_ALPHA.toFixed(2));
    expect((m.pluginManager?.getPlugin("Sway") as SwayPlugin).getCustomCode("fragment")).toBeNull();
  });

  it("is marked on the sloop's sails, the cloth and the flags, nowhere else", () => {
    for (const f of ["sloop.glb", "sailmaker.glb", "weaver_wool.glb", "weaver_linen.glb", "trading_post.l4.glb", "warehouse.l3.glb"]) {
      const s = swaying(f);
      expect(s.n, f).toBeGreaterThan(0);
      expect(s.n, f).toBeLessThan(s.of);
    }
    for (const f of ["house_settlers.v0.glb", "lumberjack.glb", "trading_post.l1.glb", "pasture.glb"]) expect(swaying(f).n, f).toBe(0);
  });
});
