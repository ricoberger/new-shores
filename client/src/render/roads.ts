// Roads: the road tiles of an island merged into flat strips, one static
// mesh per island (near and mid LOD; four vertices per strip, so that two
// dense towns stay within the phone budget at mid LOD), and the
// translucent preview of a road drag (thin-instance slabs, world
// coordinates).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { roadStrips, type TilePos } from "../display/geometry";
import { setInstances } from "./instances";
import { GHOST, ROAD } from "./palette";

function slabs(tiles: readonly TilePos[], y: number): Float32Array | null {
  if (tiles.length === 0) return null;
  const out = new Float32Array(tiles.length * 16);
  tiles.forEach((t, i) => out.set(Matrix.Translation(t.x + 0.5, y, -(t.y + 0.5)).asArray(), i * 16));
  return out;
}

/** Margin (tiles) between a strip and its tiles' edges, so neighbouring strips stay apart. */
const STRIP_INSET = 0.02;
const ROAD_Y = 0.02;

/** The road tiles of one island as flat strips (under the island's node, local tiles). */
export class RoadLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
  ) {
    this.material = new StandardMaterial("roads", scene);
    this.material.diffuseColor = ROAD;
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  update(tiles: readonly TilePos[]): void {
    this.mesh?.dispose();
    this.mesh = null;
    const strips = roadStrips(tiles);
    if (strips.length === 0) return;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const s of strips) {
      const x0 = s.x0 + STRIP_INSET;
      const x1 = s.x1 + 1 - STRIP_INSET;
      const z0 = -(s.y0 + STRIP_INSET);
      const z1 = -(s.y1 + 1 - STRIP_INSET);
      const v = positions.length / 3;
      positions.push(x0, ROAD_Y, z0, x1, ROAD_Y, z0, x1, ROAD_Y, z1, x0, ROAD_Y, z1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const mesh = new Mesh("roads", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.parent = this.parent;
    this.mesh = mesh;
  }
}

/** Preview of a road drag (tiles in world, i.e. archipelago, coordinates). */
export class RoadPreview {
  private readonly preview: Mesh;

  constructor(scene: Scene) {
    this.preview = CreateBox("road_preview", { width: 0.9, height: 0.06, depth: 0.9 }, scene);
    const pm = new StandardMaterial("road_preview", scene);
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
