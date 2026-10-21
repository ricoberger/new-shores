// Mid-LOD buildings (D-048): every building and field of an island as a
// flat footprint block tinted by its content category (one colour per
// category), merged into one static mesh with vertex colours per island —
// one draw call and four vertices per building (the phone budget at mid
// LOD is the vertex count of two dense towns). Roads are the road layer's
// flat strips.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { BUILDINGS, TERRAIN } from "../theme/palette";
import { footprintBox } from "./coords";
import { colorTuple } from "./palette";

const BLOCK_Y = 0.15;
const FIELD_Y = 0.05;
/** Blocks are inset by this much (tiles) on every side, so neighbours stay apart. */
const INSET = 0.06;

/** Tint per content category (RGBA from the building palette). */
export const CATEGORY_TINTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  houses: colorTuple(BUILDINGS.terracotta),
  production: colorTuple(BUILDINGS.ochre),
  public: colorTuple(BUILDINGS.plaster),
  harbour: colorTuple(BUILDINGS.slate),
  roads: colorTuple(TERRAIN.road_dirt),
  other: colorTuple(BUILDINGS.stone),
};
/** Fields are a flatter block in the dry-grass tone. */
const FIELD_TINT = colorTuple(TERRAIN.dry);

export class BlockLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
  ) {
    this.material = new StandardMaterial("blocks", scene);
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const b of buildings) {
      const def = defs.get(b.type);
      // Roads are the road layer's strips.
      if (!def || def.category === "roads") continue;
      const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const y = def.field ? FIELD_Y : BLOCK_Y;
      const hx = w / 2 - INSET;
      const hz = h / 2 - INSET;
      const v = positions.length / 3;
      positions.push(cx - hx, y, cz + hz, cx + hx, y, cz + hz, cx + hx, y, cz - hz, cx - hx, y, cz - hz);
      const c = def.field ? FIELD_TINT : (CATEGORY_TINTS[def.category] ?? CATEGORY_TINTS.other ?? [1, 1, 1, 1]);
      for (let i = 0; i < 4; i++) {
        colors.push(c[0], c[1], c[2], c[3]);
        normals.push(0, 1, 0);
      }
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    this.mesh?.dispose();
    this.mesh = null;
    if (indices.length === 0) return;
    const mesh = new Mesh("blocks", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.colors = colors;
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.parent = this.parent;
    this.mesh = mesh;
  }
}
