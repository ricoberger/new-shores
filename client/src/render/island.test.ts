import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentBuilding, IslandDisplay } from "../api/client";
import { buildDenseArchipelagoFixture } from "../dev/fixture";
import { RISE_MS } from "./buildings";
import { IslandDetail } from "./island";
import { ModelRegistry } from "./models";

// The merged static layers of an island (roads, footprints, trees and
// scatter) rebuild per island and only when their inputs changed,
// headless (NullEngine) on the dense-archipelago-8 fixture.

/** Canvas stand-in for the dynamic textures (foam, field patterns, status icons): drawing is a no-op. */
class FakeCanvas {
  constructor(
    public width = 1,
    public height = 1,
  ) {}
  getContext(): unknown {
    return new Proxy(
      { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined), set: () => true },
    );
  }
}
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= FakeCanvas;

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

function world() {
  engine = new NullEngine({ renderWidth: 320, renderHeight: 200, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const scene = new Scene(engine);
  const built = buildDenseArchipelagoFixture(0);
  const defs = new Map<string, ContentBuilding>(built.content.buildings.map((b) => [b.id, b]));
  const details = new Map<string, IslandDetail>();
  const show = (islands: readonly IslandDisplay[]) => {
    for (const is of islands) {
      let d = details.get(is.id);
      if (!d) {
        d = new IslandDetail(scene, is.id, is.position);
        details.set(is.id, d);
      }
      d.setStatics(built.islands.get(is.id)!);
      if (!d.builtWith(is, defs)) d.update(is, defs);
    }
  };
  return { islands: built.server.display.islands, defs, details, show };
}

/** A new payload: every island object replaced (as after JSON parsing), with an optional change to one island. */
function next(islands: readonly IslandDisplay[], change?: (is: IslandDisplay) => void): IslandDisplay[] {
  return islands.map((is) => {
    const copy = structuredClone(is);
    change?.(copy);
    return copy;
  });
}

describe("per-island merged-layer rebuilds", () => {
  it("skip payloads that change no layer input, on every island", () => {
    const w = world();
    w.show(w.islands);
    const before = [...w.details.values()].map((d) => ({ ...d.rebuilds }));
    expect(before.every((r) => r.roads === 1 && r.layout === 1 && r.decoration === 1)).toBe(true);
    // Stocks, statuses and cycle progress move; nothing that places a tree or a strip.
    w.show(
      next(w.islands, (is) => {
        for (const g of Object.values(is.inventory)) g.stock += 1_000;
        for (const b of is.buildings) b.cycle_progress_permille = ((b.cycle_progress_permille ?? 0) + 100) % 1000;
      }),
    );
    expect([...w.details.values()].map((d) => ({ ...d.rebuilds }))).toEqual(before);
  });

  it("rebuild only the island whose layout changed, and only its affected layers", () => {
    const w = world();
    w.show(w.islands);
    const moved = next(w.islands, (is) => {
      if (is.id !== "dense1") return;
      const house = is.buildings.find((b) => b.type === "house_settlers")!;
      house.rotation = house.rotation === 0 ? 180 : 0;
    });
    w.show(moved);
    for (const [id, d] of w.details) {
      expect(d.rebuilds, id).toEqual(id === "dense1" ? { roads: 1, layout: 2, decoration: 2 } : { roads: 1, layout: 1, decoration: 1 });
    }
    // A harvester's efficiency moves no tree any more: nothing rebuilds.
    w.show(
      next(moved, (is) => {
        if (is.id !== "dense2") return;
        is.buildings.find((b) => b.type === "lumberjack")!.efficiency_permille = 400;
      }),
    );
    expect(w.details.get("dense2")!.rebuilds).toEqual({ roads: 1, layout: 1, decoration: 1 });
    expect(w.details.get("dense1")!.rebuilds).toEqual({ roads: 1, layout: 2, decoration: 2 });
  });

  it("rebuild the roads and the trees when a road is added", () => {
    const w = world();
    w.show(w.islands);
    w.show(next(w.islands, (is) => is.id === "isle5" && is.roads.push({ x: 1, y: 1, type: "road" } as IslandDisplay["roads"][number])));
    expect(w.details.get("isle5")!.rebuilds).toEqual({ roads: 2, layout: 1, decoration: 2 });
    expect(w.details.get("isle7")!.rebuilds).toEqual({ roads: 1, layout: 1, decoration: 1 });
  });
});

describe("chunked static layers", () => {
  const road = (x: number, y: number) => ({ x, y, type: "road" }) as IslandDisplay["roads"][number];

  it("rebuild exactly the chunks a change touches (also a road join across a chunk's edge)", () => {
    const w = world();
    w.show(w.islands);
    // isle3: 40 × 30 tiles, chunks 0,0 (x 0–31) and 1,0 (x 32–39); no roads or buildings yet.
    const d = w.details.get("isle3")!;
    const st = buildDenseArchipelagoFixture(0).islands.get("isle3")!;
    // A forest tile well inside chunk 1,0: its trees give way to the road.
    let forest: { x: number; y: number } | null = null;
    for (let y = 4; y < st.height - 4 && !forest; y++) {
      for (let x = 34; x < st.width - 2 && !forest; x++) if (st.terrain[y * st.width + x] === "forest") forest = { x, y };
    }
    expect(forest).not.toBeNull();
    const one = next(w.islands, (is) => is.id === "isle3" && is.roads.push(road(forest!.x, forest!.y)));
    w.show(one);
    expect(d.chunkRebuilds.roads).toEqual(["1,0"]);
    expect(d.chunkRebuilds.decoration).toEqual(["1,0"]);
    // A road at x 31 next to one at x 32: the tile across the edge gains its arm, so both chunks rebuild.
    const two = next(one, (is) => is.id === "isle3" && is.roads.push(road(32, 20)));
    w.show(two);
    expect(d.chunkRebuilds.roads).toEqual(["1,0"]);
    w.show(next(two, (is) => is.id === "isle3" && is.roads.push(road(31, 20))));
    expect([...d.chunkRebuilds.roads].sort()).toEqual(["0,0", "1,0"]);
    // Other islands rebuilt nothing.
    expect(w.details.get("isle4")!.rebuilds).toEqual({ roads: 1, layout: 1, decoration: 1 });
  });

  it("culls per chunk: only the chunk nodes in view are enabled", () => {
    const w = world();
    w.show(w.islands);
    const d = w.details.get("dense1")!;
    const nodes = () => d.root.getChildTransformNodes(true).filter((n) => n.name.includes("_chunk_"));
    expect(nodes().map((n) => n.name.split("_chunk_")[1]).sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
    d.setVisibleChunks(new Set(["1,1"]));
    expect(nodes().filter((n) => n.isEnabled(false)).map((n) => n.name.split("_chunk_")[1])).toEqual(["1,1"]);
    d.setVisibleChunks(null);
    expect(nodes().every((n) => n.isEnabled(false))).toBe(true);
  });
});

describe("shadow casters with models", () => {
  it("lists the re-merged chunk meshes after a rise-in finishes (frame() reports the change)", async () => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 200, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
    const scene = new Scene(engine);
    const models = join(__dirname, "..", "..", "public", "models");
    const reg = new ModelRegistry(scene, {
      fetch: (url) => {
        const path = url.endsWith("manifest.json") ? "manifest.json" : (url.replace("/models/", "").split("?")[0] as string);
        return Promise.resolve(new Response(new Uint8Array(readFileSync(join(models, path))), { status: 200 }));
      },
    });
    await reg.loadManifest();
    const built = buildDenseArchipelagoFixture(0);
    const defs = new Map<string, ContentBuilding>(built.content.buildings.map((b) => [b.id, b]));
    const is = built.server.display.islands[0]!;
    const d = new IslandDetail(scene, is.id, is.position, reg);
    d.setStatics(built.islands.get(is.id)!);
    d.setShown(true, "near");
    d.update(is, defs);
    for (let i = 0; i < 400 && (reg.status().pending.length > 0 || reg.status().loaded.length === 0); i++) await new Promise((r) => setTimeout(r, 5));
    d.refreshModels();
    // A new house next to the first one rises in.
    const next = structuredClone(is);
    const first = next.buildings.find((b) => b.type === "house_settlers")!;
    next.buildings.push({ ...first, id: 999_999 });
    d.update(next, defs);
    const before = new Set(d.shadowCasters());
    expect(d.frame(1000)).toBe(false);
    expect(d.frame(1000 + RISE_MS + 1)).toBe(true);
    const after = d.shadowCasters();
    const fresh = after.filter((m) => !before.has(m));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((m) => m.name.startsWith("models_"))).toBe(true);
    expect([...before].some((m) => m.isDisposed())).toBe(true);
    expect(after.some((m) => m.isDisposed())).toBe(false);
    scene.dispose();
  });
});

describe("unsettled islands", () => {
  it("are drawn in the same colours as settled ones at every LOD (no grey far terrain, no muted scatter)", () => {
    engine = new NullEngine({ renderWidth: 320, renderHeight: 200, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
    const scene = new Scene(engine);
    const built = buildDenseArchipelagoFixture(0);
    const defs = new Map<string, ContentBuilding>(built.content.buildings.map((b) => [b.id, b]));
    const is = built.server.display.islands.find((x) => !x.settled)!;
    const saturation = (name: string) => {
      const m = scene.meshes.find((x) => x.name.startsWith(`${name}_${is.id}`))!;
      const c = m.getVerticesData("color")!;
      let s = 0;
      for (let i = 0; i < c.length; i += 4) s += Math.max(c[i]!, c[i + 1]!, c[i + 2]!) - Math.min(c[i]!, c[i + 1]!, c[i + 2]!);
      return s / (c.length / 4);
    };
    const d = new IslandDetail(scene, is.id, is.position);
    d.setStatics(built.islands.get(is.id)!);
    d.update(is, defs);
    d.setShown(true, "far");
    // The far (lite) ground has the near/mid (full) ground's colours.
    expect(saturation("terrain_lite")).toBeGreaterThan(saturation("terrain") * 0.8);
    const scatter = scene.materials.find((m) => m.name.startsWith("scatter_"))! as unknown as { diffuseColor: { r: number } };
    expect(scatter.diffuseColor.r).toBe(1);
  });
});

describe("incremental build (display/buildqueue.ts)", () => {
  /** Index counts of the meshes by name (what the island draws, independent of vertex order). */
  const geometry = (scene: Scene) =>
    Object.fromEntries(
      scene.meshes
        .filter((m) => !m.isDisposed() && m.getTotalIndices() > 0)
        .map((m) => [m.name, m.getTotalIndices()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  it("builds in head and chunk steps what setStatics and update build at once, hidden and without tiles until the last step", () => {
    const sync = world();
    const is = sync.islands.find((x) => x.id === "isle3")!;
    const st = buildDenseArchipelagoFixture(0).islands.get(is.id)!;
    const scene = new Scene(engine!);
    const once = new IslandDetail(scene, is.id, is.position);
    once.setStatics(st);
    once.update(is, sync.defs);
    const expected = geometry(scene);
    scene.dispose();

    const steps = new Scene(engine!);
    const d = new IslandDetail(steps, is.id, is.position);
    d.startBuild(st, is, sync.defs);
    d.setShown(false, "near");
    expect(d.hasTiles()).toBe(false);
    let n = 0;
    while (d.headPending()) {
      expect(d.buildStep(null)).toBe(false);
      n++;
    }
    expect(n).toBeGreaterThan(3);
    // Chunks in any order (here: last first); a started chunk finishes before the next one starts.
    const keys = d.pendingChunks().map((c) => c.key);
    expect(keys).toEqual(["0,0", "1,0"]);
    let done = false;
    for (const k of [...keys].reverse()) {
      while (d.pendingChunks().some((c) => c.key === k)) {
        expect(d.hasTiles()).toBe(false);
        done = d.buildStep(k);
      }
    }
    expect(done).toBe(true);
    expect(d.hasTiles()).toBe(true);
    expect(d.building()).toBeNull();
    expect(d.root.isEnabled(false)).toBe(false);
    expect(geometry(steps)).toEqual(expected);
    // Built with the payload: a change afterwards rebuilds only the chunks it touches.
    expect(d.builtWith(is, sync.defs)).toBe(true);
    const moved = structuredClone(is);
    // A road on a grass tile of chunk 1,0 (roads sink into the ground, never the beach).
    let tile = { x: 35, y: 3 };
    for (let y = 4; y < st.height - 4; y++) for (let x = 34; x < st.width - 2; x++) if (st.terrain[y * st.width + x] === "grass" && st.terrain[(y + 1) * st.width + x] === "grass") tile = { x, y };
    moved.roads.push({ ...tile, type: "road" } as IslandDisplay["roads"][number]);
    d.update(moved, sync.defs);
    expect(d.chunkRebuilds.roads).toEqual(["1,0"]);
    expect(d.rebuilds.roads).toBe(2);
    steps.dispose();
  });

  it("restarts with new static data and drops what the replaced build had made", () => {
    const w = world();
    const is = w.islands.find((x) => x.id === "isle3")!;
    const st = buildDenseArchipelagoFixture(0).islands.get(is.id)!;
    const scene = new Scene(engine!);
    const d = new IslandDetail(scene, is.id, is.position);
    d.startBuild(st, is, w.defs);
    while (d.headPending()) d.buildStep(null);
    while (d.pendingChunks().some((c) => c.key === "0,0")) d.buildStep("0,0");
    const terrain = () => scene.meshes.filter((m) => !m.isDisposed() && m.name.startsWith(`terrain_${is.id}_`)).length;
    expect(terrain()).toBe(1);
    d.startBuild({ ...st, revision: `${st.revision}b` }, is, w.defs);
    expect(terrain()).toBe(0);
    expect(d.building()?.statics.revision).toBe(`${st.revision}b`);
    expect(d.pendingChunks()).toHaveLength(2);
    while (d.building()) d.buildStep(d.pendingChunks()[0]?.key ?? null);
    expect(d.hasTiles()).toBe(true);
    expect(terrain()).toBe(2);
    scene.dispose();
  });
});
