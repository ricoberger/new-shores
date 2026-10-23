// Mid- and far-LOD buildings (D-048, restyle diorama): every building of
// an island as a low block over its footprint — sides tinted by its
// content category, the top in its roof colour — and every field as a
// flat plot in its field colour with row hints (stripes or dots in its
// mark colour). Warehouses and shipyards, the landmarks seen from afar,
// are taller blocks under a hip roof. All merged into one static mesh
// with vertex colours per island: one draw call, ~20 vertices per
// building (the phone budget at mid LOD is the vertex count of two dense
// towns). Roads are the road layer's flat strips.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { BUILDINGS, TERRAIN } from "../theme/palette";
import { footprintBox } from "./coords";
import { appendCanopy, type CanopyBlob } from "./canopy";
import { lookOf } from "./fields";
import { colorTuple, roofColor } from "./palette";
import { skyFill } from "./lighting";

const FIELD_Y = 0.04;
/** Blocks are inset by this much (tiles) on every side, so neighbours stay apart. */
const INSET = 0.12;
/** Block height per category (tiles); landmarks are taller and get a hip roof. */
const HEIGHTS: Readonly<Record<string, number>> = { houses: 0.6, production: 0.55, public: 0.8, harbour: 0.7 };
const LANDMARK_HEIGHT = 1.0;
const LANDMARK_ROOF = 0.7;

/** Tint per content category (RGBA from the building palette): the block sides. */
export const CATEGORY_TINTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  houses: colorTuple(BUILDINGS.plaster),
  production: colorTuple(BUILDINGS.ochre),
  public: colorTuple(BUILDINGS.stone),
  harbour: colorTuple(BUILDINGS.timber),
  roads: colorTuple(TERRAIN.road_dirt),
  other: colorTuple(BUILDINGS.stone),
};

type Rgb = readonly [number, number, number] | readonly number[];

/** Mesh data of the blocks under construction. */
class Blocks {
  positions: number[] = [];
  colors: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  landmarks = 0;

  constructor(private readonly tint: (c: Color3) => Color3) {}

  quad(p: readonly (readonly [number, number, number])[], n: readonly [number, number, number], c: Rgb): void {
    const v = this.positions.length / 3;
    for (const q of p) {
      this.positions.push(q[0], q[1], q[2]);
      this.normals.push(n[0], n[1], n[2]);
      const t = this.tint(new Color3(c[0] as number, c[1] as number, c[2] as number));
      this.colors.push(t.r, t.g, t.b, 1);
    }
    // Babylon's front faces wind clockwise seen from the outside (left-handed).
    if (p.length === 4) this.indices.push(v, v + 2, v + 1, v, v + 3, v + 2);
    else this.indices.push(v, v + 2, v + 1);
  }

  /** A box from y0 to y1 over [x0, x1] × [z0, z1]: four sides and the top. */
  box(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, side: Rgb, top: Rgb): void {
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], top);
    const s = (k: number) => [side[0] as number * k, side[1] as number * k, side[2] as number * k];
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], s(0.92));
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], s(0.8));
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], s(0.86));
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], s(0.86));
  }

  /** A hip roof (four triangles to a ridge-less apex) over [x0, x1] × [z0, z1] from y0 up by h. */
  hip(x0: number, x1: number, z0: number, z1: number, y0: number, h: number, c: Rgb): void {
    const ax = (x0 + x1) / 2;
    const az = (z0 + z1) / 2;
    const apex: [number, number, number] = [ax, y0 + h, az];
    const s = (k: number) => [c[0] as number * k, c[1] as number * k, c[2] as number * k];
    const hx = (x1 - x0) / 2;
    const hz = (z1 - z0) / 2;
    const n = (dx: number, dz: number, half: number): [number, number, number] => {
      const l = Math.hypot(h, half);
      return [(dx * h) / l, half / l, (dz * h) / l];
    };
    this.quad([[x0, y0, z1], [x1, y0, z1], apex], n(0, 1, hz), s(1.0));
    this.quad([[x1, y0, z0], [x0, y0, z0], apex], n(0, -1, hz), s(0.82));
    this.quad([[x1, y0, z1], [x1, y0, z0], apex], n(1, 0, hx), s(0.9));
    this.quad([[x0, y0, z0], [x0, y0, z1], apex], n(-1, 0, hx), s(0.9));
  }
}

/** Fills the blocks of an island's buildings and fields (island-local coordinates). */
export function buildBlocks(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>, canopy: readonly CanopyBlob[] = [], tint: (c: Color3) => Color3 = (c) => c): Blocks {
  const out = new Blocks(tint);
  appendCanopy(out, canopy, tint);
  for (const b of buildings) {
    const def = defs.get(b.type);
    if (!def || def.category === "roads") continue;
    const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
    if (def.field) {
      const look = lookOf(b.type);
      const c = Color3.FromHexString(look.color);
      const m = Color3.FromHexString(look.mark);
      const hx = w / 2 - 0.04;
      const hz = h / 2 - 0.04;
      out.quad([[cx - hx, FIELD_Y, cz + hz], [cx + hx, FIELD_Y, cz + hz], [cx + hx, FIELD_Y, cz - hz], [cx - hx, FIELD_Y, cz - hz]], [0, 1, 0], [c.r, c.g, c.b]);
      const y = FIELD_Y + 0.01;
      if (look.pattern === "stripes") {
        for (const t of [-0.25, 0.08]) {
          const z0 = cz - hz + (t + 0.5) * 2 * hz * 0.9;
          out.quad([[cx - hx * 0.9, y, z0 + 0.12], [cx + hx * 0.9, y, z0 + 0.12], [cx + hx * 0.9, y, z0], [cx - hx * 0.9, y, z0]], [0, 1, 0], [m.r, m.g, m.b]);
        }
      } else if (look.pattern === "dots") {
        for (const [dx, dz] of [[-0.2, -0.2], [0.2, 0.15]] as const) {
          out.quad([[cx + dx - 0.1, y, cz + dz + 0.1], [cx + dx + 0.1, y, cz + dz + 0.1], [cx + dx + 0.1, y, cz + dz - 0.1], [cx + dx - 0.1, y, cz + dz - 0.1]], [0, 1, 0], [m.r, m.g, m.b]);
        }
      }
      continue;
    }
    const side = CATEGORY_TINTS[def.category] ?? CATEGORY_TINTS.other ?? [1, 1, 1, 1];
    const roof = roofColor(def.id, def.category);
    const r = [roof.r, roof.g, roof.b];
    const x0 = cx - w / 2 + INSET;
    const x1 = cx + w / 2 - INSET;
    const z0 = cz - h / 2 + INSET;
    const z1 = cz + h / 2 - INSET;
    if (def.warehouse || def.shipyard) {
      out.box(x0, x1, z0, z1, 0, LANDMARK_HEIGHT, colorTuple(def.shipyard ? BUILDINGS.timber : BUILDINGS.plaster), r);
      out.hip(x0 - 0.1, x1 + 0.1, z0 - 0.1, z1 + 0.1, LANDMARK_HEIGHT, LANDMARK_ROOF, colorTuple(def.shipyard ? BUILDINGS.terracotta : BUILDINGS.thatch));
      out.landmarks++;
      continue;
    }
    out.box(x0, x1, z0, z1, 0, HEIGHTS[def.category] ?? 0.55, side, r);
  }
  return out;
}

export class BlockLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private landmarkCount = 0;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
    /** Colour transform (the far silhouettes of unsettled islands are desaturated). */
    private readonly tint: (c: Color3) => Color3 = (c) => c,
  ) {
    this.material = skyFill(new StandardMaterial("blocks", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = true;
  }

  /** Rebuilds the mesh: the buildings' blocks and the forest canopies. */
  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>, canopy: readonly CanopyBlob[] = []): void {
    const b = buildBlocks(buildings, defs, canopy, this.tint);
    this.landmarkCount = b.landmarks;
    this.mesh?.dispose();
    this.mesh = null;
    if (b.indices.length === 0) return;
    const mesh = new Mesh("blocks", this.scene);
    const data = new VertexData();
    data.positions = b.positions;
    data.indices = b.indices;
    data.colors = b.colors;
    data.normals = b.normals;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.parent = this.parent;
    this.mesh = mesh;
  }

  /** Warehouses and shipyards drawn as landmark blocks in the last update. */
  landmarks(): number {
    return this.landmarkCount;
  }

  dispose(): void {
    this.mesh?.dispose();
    this.mesh = null;
  }
}
