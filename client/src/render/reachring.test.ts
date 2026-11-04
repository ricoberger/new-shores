import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { ReachRing, ringBand } from "./reachring";

describe("reach ring band", () => {
  it("is a closed band: two vertices and two triangles per point, lifted above the ground", () => {
    const square = [
      { x: 0, z: 0, y: 1 },
      { x: 4, z: 0, y: 1 },
      { x: 4, z: 4, y: 2 },
      { x: 0, z: 4, y: 2 },
    ];
    const { positions, indices } = ringBand(square, 0.2);
    expect(positions).toHaveLength(4 * 2 * 3);
    expect(indices).toHaveLength(4 * 6);
    // The last segment wraps to the first point.
    expect(indices.slice(-6)).toEqual([6, 0, 7, 7, 0, 1]);
    for (let i = 1; i < positions.length; i += 3) expect(positions[i]).toBeGreaterThan(1);
    expect(ringBand(square.slice(0, 2)).positions).toHaveLength(0);
  });
});

describe("reach ring colour (D-071)", () => {
  it("is the selection yellow for a collector's reach, gold for a plan or a service radius", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ring = new ReachRing(scene);
    const pts = [
      { x: 0, z: 0, y: 0 },
      { x: 4, z: 0, y: 0 },
      { x: 4, z: 4, y: 0 },
    ];
    ring.set("a", pts);
    expect(ring.shown()).toBe(true);
    expect(ring.gold()).toBe(false);
    ring.set("b", pts, true);
    expect(ring.gold()).toBe(true);
    ring.set("", null);
    expect(ring.shown()).toBe(false);
    expect(ring.gold()).toBe(false);
    engine.dispose();
  });
});
