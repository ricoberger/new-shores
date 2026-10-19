// Roads: one flat slab per road tile (thin instances), plus the translucent
// preview of a road drag.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { TilePos } from "../display/geometry";
import { setInstances } from "./instances";
import { GHOST, ROAD } from "./palette";

function slabs(tiles: readonly TilePos[], y: number): Float32Array | null {
  if (tiles.length === 0) return null;
  const out = new Float32Array(tiles.length * 16);
  tiles.forEach((t, i) => out.set(Matrix.Translation(t.x + 0.5, y, -(t.y + 0.5)).asArray(), i * 16));
  return out;
}

export class RoadLayer {
  private readonly roads: Mesh;
  private readonly preview: Mesh;

  constructor(scene: Scene) {
    this.roads = CreateBox("roads", { width: 0.96, height: 0.04, depth: 0.96 }, scene);
    const mat = new StandardMaterial("roads", scene);
    mat.diffuseColor = ROAD;
    mat.specularColor = Color3.Black();
    this.roads.material = mat;
    this.roads.isPickable = false;
    setInstances(this.roads, null);

    this.preview = CreateBox("road_preview", { width: 0.9, height: 0.06, depth: 0.9 }, scene);
    const pm = new StandardMaterial("road_preview", scene);
    pm.diffuseColor = GHOST;
    pm.alpha = 0.6;
    pm.specularColor = Color3.Black();
    this.preview.material = pm;
    this.preview.isPickable = false;
    setInstances(this.preview, null);
  }

  update(tiles: readonly TilePos[]): void {
    setInstances(this.roads, slabs(tiles, 0.02));
  }

  setPreview(tiles: readonly TilePos[]): void {
    setInstances(this.preview, slabs(tiles, 0.05));
  }
}
