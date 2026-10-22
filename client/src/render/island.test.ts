import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentBuilding, IslandDisplay } from "../api/client";
import { buildDenseArchipelagoFixture } from "../dev/fixture";
import { IslandDetail } from "./island";

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
      const house = is.buildings.find((b) => b.type === "house")!;
      house.rotation = house.rotation === 0 ? 180 : 0;
    });
    w.show(moved);
    for (const [id, d] of w.details) {
      expect(d.rebuilds, id).toEqual(id === "dense1" ? { roads: 1, layout: 2, decoration: 2 } : { roads: 1, layout: 1, decoration: 1 });
    }
    // A forest harvester's efficiency changes the thinning: trees only.
    w.show(
      next(moved, (is) => {
        if (is.id !== "dense2") return;
        is.buildings.find((b) => b.type === "woodcutter")!.efficiency_permille = 400;
      }),
    );
    expect(w.details.get("dense2")!.rebuilds).toEqual({ roads: 1, layout: 1, decoration: 2 });
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
