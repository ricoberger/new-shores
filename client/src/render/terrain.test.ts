import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import type { Island, Terrain } from "../api/client";
import { coastline } from "../display/coastline";
import { buildIslandMeshes, SEA_LEVEL, SLAB_REACH, terrainColors } from "./terrain";

// The diorama slab (restyle): the land's edge drops from the ground to
// below the sea surface in layered bands, flat-shaded, and stays within
// SLAB_REACH of the coastline.

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

describe("island slab", () => {
  it("drops from the ground to below the sea within the slab's reach, with lit faces", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const is = island();
    const meshes = buildIslandMeshes(scene, is, coastline(is), 7, terrainColors(7), new StandardMaterial("m", scene), null, "terrain");
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0]!;
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const nor = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    let minY = Infinity;
    let maxY = -Infinity;
    let side = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // Land spans tiles 1..4 × 1..3, its contour through the tile edge midpoints (0.5 … 5.5, 0.5 … 4.5).
      expect(x).toBeGreaterThan(0.5 - SLAB_REACH * 1.3 - 1e-6);
      expect(x).toBeLessThan(5.5 + SLAB_REACH * 1.3 + 1e-6);
      expect(-z).toBeLessThan(4.5 + SLAB_REACH * 1.3 + 1e-6);
      if (nor[i + 1]! < 0.95) side++;
      // Every normal points up or sideways (lit from the sky), never down.
      expect(nor[i + 1]!).toBeGreaterThan(0);
    }
    expect(maxY).toBeLessThan(0.01);
    expect(minY).toBeLessThan(SEA_LEVEL);
    expect(side).toBeGreaterThan(0);
  });
});
