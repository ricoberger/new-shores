// Terrain: flat tiles in chunks of CHUNK x CHUNK tiles, one mesh per chunk
// with per-vertex colours. Chunks are large (a whole island of the current
// content is one chunk): several islands can be in view at once, and draw
// calls, not vertices, are the phone budget.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Island, Terrain } from "../api/client";
import { TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";

export const CHUNK = 64;

export function buildTerrain(scene: Scene, island: Island, parent: TransformNode | null = null): Mesh[] {
  const material = new StandardMaterial("terrain", scene);
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  const meshes: Mesh[] = [];
  for (let cy = 0; cy < island.height; cy += CHUNK) {
    for (let cx = 0; cx < island.width; cx += CHUNK) {
      const positions: number[] = [];
      const colors: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      for (let y = cy; y < Math.min(cy + CHUNK, island.height); y++) {
        for (let x = cx; x < Math.min(cx + CHUNK, island.width); x++) {
          const terrain = island.terrain[y * island.width + x] as Terrain | undefined;
          const base = (terrain && TERRAIN_COLORS[terrain]) || UNKNOWN_TERRAIN;
          // Subtle checker so that the grid is readable.
          const shade = (x + y) % 2 === 0 ? 1 : 0.95;
          const level = terrain === "water" ? -0.05 : 0;
          const v = positions.length / 3;
          positions.push(x, level, -y, x + 1, level, -y, x + 1, level, -(y + 1), x, level, -(y + 1));
          for (let i = 0; i < 4; i++) {
            colors.push(base.r * shade, base.g * shade, base.b * shade, 1);
            normals.push(0, 1, 0);
          }
          indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
        }
      }
      const mesh = new Mesh(`terrain_${cx}_${cy}`, scene);
      const data = new VertexData();
      data.positions = positions;
      data.indices = indices;
      data.colors = colors;
      data.normals = normals;
      data.applyToMesh(mesh);
      mesh.material = material;
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      meshes.push(mesh);
    }
  }
  return meshes;
}
