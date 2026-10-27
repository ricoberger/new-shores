import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentBuilding } from "../api/client";
import { buildDenseArchipelagoFixture } from "../dev/fixture";
import { isLandmark, LandmarkLayer, showsLandmarks } from "./landmarks";
import { ModelRegistry } from "./models";

// The Trading Posts and shipyards of the settled islands drawn from their
// mask at far LOD (headless, the committed models).

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

describe("landmark islands", () => {
  it("are the settled islands drawn from their mask at far LOD, except the focused one", () => {
    const home = { id: "a", settled: true };
    expect(showsLandmarks(home, "far", "b", true)).toBe(true);
    expect(showsLandmarks(home, "far", "a", true)).toBe(false);
    expect(showsLandmarks(home, "far", "b", false)).toBe(false);
    expect(showsLandmarks(home, "mid", "b", true)).toBe(false);
    expect(showsLandmarks({ id: "c", settled: false }, "far", "b", true)).toBe(false);
  });
});

describe("landmark layer", () => {
  it("draws the lite Trading Posts and shipyards of the islands in one mesh at their archipelago positions", async () => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 200, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
    const scene = new Scene(engine);
    const models = join(__dirname, "..", "..", "public", "models");
    const requested: string[] = [];
    const reg = new ModelRegistry(scene, {
      fetch: (url) => {
        const path = url.endsWith("manifest.json") ? "manifest.json" : (url.replace("/models/", "").split("?")[0] as string);
        requested.push(path);
        return Promise.resolve(new Response(new Uint8Array(readFileSync(join(models, path))), { status: 200 }));
      },
    });
    await reg.loadManifest();
    const built = buildDenseArchipelagoFixture(0);
    const defs = new Map<string, ContentBuilding>(built.content.buildings.map((b) => [b.id, b]));
    const islands = built.server.display.islands.filter((is) => is.settled).slice(0, 2);
    const expected = islands.flatMap((is) => is.buildings.filter((b) => isLandmark(defs.get(b.type))));
    expect(expected.length).toBeGreaterThanOrEqual(2);
    const layer = new LandmarkLayer(scene, reg);
    layer.show(islands, defs);
    // The models load first; refresh() (the renderer's model batch) draws them.
    for (let i = 0; i < 400 && reg.status().pending.length > 0; i++) await new Promise((r) => setTimeout(r, 5));
    layer.refresh();
    expect(layer.drawn()).toBe(expected.length);
    expect(layer.triangles()).toBeGreaterThan(0);
    expect(requested.filter((p) => p.endsWith(".glb")).every((p) => p.includes(".lite."))).toBe(true);
    const meshes = scene.meshes.filter((m) => m.name === "landmarks");
    expect(meshes).toHaveLength(1);
    // Inside the islands' bounds (archipelago tiles; z = −y).
    const pos = meshes[0]!.getVerticesData("position")!;
    const inIsland = (x: number, z: number) => islands.some((is) => x >= is.position.x - 1 && x <= is.position.x + is.width + 1 && -z >= is.position.y - 1 && -z <= is.position.y + is.height + 1);
    for (let i = 0; i < pos.length; i += 3) expect(inIsland(pos[i]!, pos[i + 2]!)).toBe(true);
    // Same input: nothing rebuilt; none: no mesh.
    layer.show(islands, defs);
    expect(scene.meshes.filter((m) => m.name === "landmarks")[0]).toBe(meshes[0]);
    layer.show([], defs);
    expect(layer.drawn()).toBe(0);
    expect(scene.meshes.some((m) => m.name === "landmarks" && !m.isDisposed())).toBe(false);
    scene.dispose();
  });
});
