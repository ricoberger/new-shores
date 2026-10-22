// Roads (ART_DIRECTION §4): the road tiles of an island as continuous
// strips with proper joins and a light border, dirt and paved distinct,
// one static mesh per island (near and mid LOD), and the translucent
// preview of a road drag (thin-instance slabs, world coordinates).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { TilePos } from "../display/geometry";
import { TERRAIN } from "../theme/palette";
import { setInstances } from "./instances";
import { skyFill } from "./lighting";
import { c3, GHOST } from "./palette";

function slabs(tiles: readonly TilePos[], y: number): Float32Array | null {
  if (tiles.length === 0) return null;
  const out = new Float32Array(tiles.length * 16);
  tiles.forEach((t, i) => out.set(Matrix.Translation(t.x + 0.5, y, -(t.y + 0.5)).asArray(), i * 16));
  return out;
}

/** Road surface and border half-widths (tiles from the tile centre). */
const SURFACE_HALF = 0.34;
const BORDER_HALF = 0.43;
const ROAD_Y = 0.02;
const BORDER_Y = 0.012;

const DIRT = c3(TERRAIN.road_dirt);
const PAVED = c3(TERRAIN.road_paved);
const BORDER = c3(TERRAIN.road_border);

/** A road tile with its content type (dirt unless the type is paved). */
export type RoadTile = TilePos & { type?: string };

/**
 * One road tile as rectangles (island-local tiles, x right, y down): the
 * centre square of half-width `half` plus an arm to every edge with a road
 * neighbour. Arms of neighbouring tiles meet exactly on the shared edge,
 * so corners, T-junctions and crossings join without seams or overlaps.
 */
export function roadPieces(t: TilePos, has: (x: number, y: number) => boolean, half: number): [number, number, number, number][] {
  const cx = t.x + 0.5;
  const cy = t.y + 0.5;
  const out: [number, number, number, number][] = [[cx - half, cy - half, cx + half, cy + half]];
  if (has(t.x, t.y - 1)) out.push([cx - half, t.y, cx + half, cy - half]);
  if (has(t.x, t.y + 1)) out.push([cx - half, cy + half, cx + half, t.y + 1]);
  if (has(t.x - 1, t.y)) out.push([t.x, cy - half, cx - half, cy + half]);
  if (has(t.x + 1, t.y)) out.push([cx + half, cy - half, t.x + 1, cy + half]);
  return out;
}

/**
 * The road tiles of one island (under the island's node, local tiles):
 * continuous strips with joins and a light border, dirt and paved in
 * their palette tones; one static vertex-coloured mesh per island (near
 * and mid LOD).
 */
export class RoadLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
  ) {
    this.material = skyFill(new StandardMaterial("roads", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  update(tiles: readonly RoadTile[]): void {
    this.mesh?.dispose();
    this.mesh = null;
    if (tiles.length === 0) return;
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const has = (x: number, y: number) => set.has(`${x},${y}`);
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const rect = (r: [number, number, number, number], y: number, c: Color3) => {
      const v = positions.length / 3;
      positions.push(r[0], y, -r[1], r[2], y, -r[1], r[2], y, -r[3], r[0], y, -r[3]);
      for (let i = 0; i < 4; i++) {
        colors.push(c.r, c.g, c.b, 1);
        normals.push(0, 1, 0);
      }
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    for (const t of tiles) {
      const surface = t.type === "road_paved" ? PAVED : DIRT;
      for (const r of roadPieces(t, has, BORDER_HALF)) rect(r, BORDER_Y, BORDER);
      for (const r of roadPieces(t, has, SURFACE_HALF)) rect(r, ROAD_Y, surface);
    }
    const mesh = new Mesh("roads", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.colors = colors;
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.parent = this.parent;
    mesh.freezeWorldMatrix();
    this.mesh = mesh;
  }
}

/** Preview of a road drag (tiles in world, i.e. archipelago, coordinates). */
export class RoadPreview {
  private readonly preview: Mesh;

  constructor(scene: Scene) {
    this.preview = CreateBox("road_preview", { width: 0.9, height: 0.06, depth: 0.9 }, scene);
    const pm = skyFill(new StandardMaterial("road_preview", scene));
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
