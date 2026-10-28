import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import type { Island, Terrain } from "../api/client";
import { coastline } from "../display/coastline";
import { buildTerrain, SEA_LEVEL } from "./terrain";

// The voxel terrain (D-057): ground columns at height 0, the coast's sand
// shelves stepping down below the sea surface within half a tile of the
// land, lit from the sky; a coarser lite detail for far LOD.

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

/** A 6 × 5 island: water around a 4 × 3 block of grass. */
function island(): Island {
  const width = 6;
  const height = 5;
  const terrain: Terrain[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terrain.push(x > 0 && y > 0 && x < width - 1 && y < height - 1 ? "grass" : "water");
  return { id: "t", width, height, revision: "1", terrain, fertilities: [], deposits: [] };
}

describe("island terrain", () => {
  it("drops from the ground to below the sea within the shelves' reach, with lit faces, in two details", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const is = island();
    const node = new TransformNode("chunk", scene);
    const { full, lite } = buildTerrain(scene, is, coastline(is), 7, () => node);
    expect(full.length).toBeGreaterThan(0);
    expect(lite).toHaveLength(1);
    let minY = Infinity;
    let maxY = -Infinity;
    let side = 0;
    let fullTris = 0;
    for (const mesh of full) {
      fullTris += mesh.getTotalIndices() / 3;
      const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const nor = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        // Land spans tiles 1..4 × 1..3, its contour through the tile edge midpoints (0.5 … 5.5, 0.5 … 4.5); two shelves of a quarter tile beyond.
        expect(x).toBeGreaterThan(0.5 - 0.75);
        expect(x).toBeLessThan(5.5 + 0.75);
        expect(-z).toBeLessThan(4.5 + 0.75);
        if (nor[i + 1]! < 0.95) side++;
        // Every normal points up or sideways (lit from the sky), never down.
        expect(nor[i + 1]!).toBeGreaterThan(0);
      }
    }
    expect(maxY).toBeLessThan(0.01);
    expect(minY).toBeLessThan(SEA_LEVEL);
    expect(side).toBeGreaterThan(0);
    expect(lite[0]!.getTotalIndices() / 3).toBeLessThan(fullTris);
  });
});
