// Roads (ART_DIRECTION §4): the road tiles are voxel paths in the island's
// terrain (render/roadvoxels.ts, render/terrain.ts); this module keeps
// their tile type and the translucent preview of a road drag
// (thin-instance slabs, world coordinates).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { TilePos } from "../display/geometry";
import { setInstances } from "./instances";
import { previewOffset, skyFill } from "./lighting";
import { GHOST } from "./palette";

function slabs(tiles: readonly TilePos[], y: number): Float32Array | null {
  if (tiles.length === 0) return null;
  const out = new Float32Array(tiles.length * 16);
  tiles.forEach((t, i) => out.set(Matrix.Translation(t.x + 0.5, y, -(t.y + 0.5)).asArray(), i * 16));
  return out;
}

/** A road tile with its content type (dirt unless the type is paved). */
export type RoadTile = TilePos & { type?: string };

/** Preview of a road drag (tiles in world, i.e. archipelago, coordinates). */
export class RoadPreview {
  private readonly preview: Mesh;

  constructor(scene: Scene) {
    this.preview = CreateBox("road_preview", { width: 0.9, height: 0.06, depth: 0.9 }, scene);
    const pm = previewOffset(skyFill(new StandardMaterial("road_preview", scene)));
    pm.diffuseColor = GHOST;
    pm.alpha = 0.6;
    pm.specularColor = Color3.Black();
    this.preview.material = pm;
    this.preview.isPickable = false;
    setInstances(this.preview, null);
  }

  set(tiles: readonly TilePos[]): void {
    setInstances(this.preview, slabs(tiles, 0.05));
  }
}
