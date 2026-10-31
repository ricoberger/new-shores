// Blob / contact shadows (ART_DIRECTION §2) at every LOD and quality,
// one draw call per object class: ships are thin instances of a plane
// with a shared radial alpha texture (few instances, moving); buildings
// get a soft rounded rectangle at their model's bounds (alpha in the
// vertices: a dense core that eases out past the outline) merged into one
// static mesh per island, because software renderers pay per instance and
// a dense town has hundreds (the phone perf budget; trees do the same in
// their own mesh). Purely visual, never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { setInstances } from "./instances";
import { SHADOW_LEAN } from "./lighting";
import { SHADOW } from "./palette";

/** Height of the blob planes: above roads and field tiles, below everything standing. */
export const BLOB_Y = 0.035;
const TEX = 64;

const textures = new WeakMap<Scene, RawTexture>();

/** Radial falloff texture (shadow colour, alpha from the centre outwards). */
function blobTexture(scene: Scene): RawTexture {
  let tex = textures.get(scene);
  if (tex) return tex;
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const dx = (x + 0.5) / TEX - 0.5;
      const dy = (y + 0.5) / TEX - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      // Smooth falloff: dense core, soft edge.
      const a = (1 - d * d) ** 2;
      const i = (y * TEX + x) * 4;
      data[i] = Math.round(SHADOW.r * 255);
      data[i + 1] = Math.round(SHADOW.g * 255);
      data[i + 2] = Math.round(SHADOW.b * 255);
      data[i + 3] = Math.round(a * 255);
    }
  }
  tex = RawTexture.CreateRGBATexture(data, TEX, TEX, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  textures.set(scene, tex);
  return tex;
}

/** Alpha of the building shadows inside their outline (falling to 0 at the rim). */
const SHADOW_CORE = 0.85;
/** Alpha at the model outline (the middle ring of the falloff). */
const SHADOW_EDGE = 0.45;
/** Points per rounded corner of a building shadow (quarter circle, both ends included). */
export const CORNER_POINTS = 5;
/** Triangles of one building shadow: the core fan and two bands (5 × 4 × CORNER_POINTS). */
export const SHADOW_TRIS = 5 * 4 * CORNER_POINTS;
/**
 * Triangles of one building shadow at far LOD (roundedShadows' `far`):
 * one point per corner (a chamfered rectangle) and a single band from
 * the core to the transparent rim — a corner radius and a two-step
 * falloff are about a pixel at the cap (D-048's far budget).
 */
export const FAR_SHADOW_TRIS = 3 * 4;

/** A building's shadow outline: centre x, z and size (island-local, already rotated) and the height it leans for. */
export interface ShadowRect {
  cx: number;
  cz: number;
  w: number;
  h: number;
  height?: number;
  /** The ground under the outline (tiles; terraces, D-058). */
  base?: number;
}

/**
 * Corner radius of a shadow outline of w × h tiles: about a third of the
 * short side (chunky buildings read as rounded), at least 0.15 and at
 * most 0.7 tiles.
 */
export function shadowRadius(w: number, h: number): number {
  return Math.min(0.7, Math.max(0.15, Math.min(w, h) * 0.32));
}

/**
 * One ring of a rounded rectangle (half extents ix, iz, corner radius r)
 * about (cx, cz): `points` per corner (CORNER_POINTS; 1: the corner's middle), counter-clockwise from the
 * +x/−z corner, so rings with the same parameters line up point by point.
 */
function ring(out: number[], cx: number, cz: number, ix: number, iz: number, r: number, y: number, points = CORNER_POINTS): void {
  const corners: [number, number, number][] = [
    [ix - r, -(iz - r), -Math.PI / 2],
    [ix - r, iz - r, 0],
    [-(ix - r), iz - r, Math.PI / 2],
    [-(ix - r), -(iz - r), Math.PI],
  ];
  for (const [ox, oz, a0] of corners) {
    for (let k = 0; k < points; k++) {
      // One point: the corner's middle (a chamfer).
      const a = a0 + (points === 1 ? Math.PI / 4 : ((Math.PI / 2) * k) / (points - 1));
      out.push(cx + ox + r * Math.cos(a), y, cz + oz + r * Math.sin(a));
    }
  }
}

/**
 * Vertex data of the soft rounded shadows of a set of building outlines
 * (one mesh): per rect a filled core (fan from the centre) inset by half
 * the rim, a middle ring just outside the outline and a transparent outer
 * ring `rim` outside it, all with the outline's rounded corners grown or
 * shrunk alike; each shifted away from the sun by its height × the shadow
 * lean. Alpha lives in the vertex colours (white RGB; the material is the
 * shadow colour). `far`: the far LOD's cheap outline (FAR_SHADOW_TRIS).
 */
export function roundedShadows(
  rects: readonly ShadowRect[],
  rim: number,
  height: number,
  y = BLOB_Y,
  far = false,
): { positions: number[]; colors: number[]; indices: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const points = far ? 1 : CORNER_POINTS;
  const n = 4 * points;
  for (const r of rects) {
    const lean = (r.height ?? height) * 0.35;
    const cx = r.cx + SHADOW_LEAN.x * lean;
    const cz = r.cz + SHADOW_LEAN.z * lean;
    const ix = r.w / 2;
    const iz = r.h / 2;
    const radius = Math.min(shadowRadius(r.w, r.h), ix, iz);
    const inset = Math.min(rim * 0.5, ix * 0.5, iz * 0.5);
    const base = positions.length / 3;
    const ry = y + (r.base ?? 0);
    positions.push(cx, ry, cz);
    colors.push(1, 1, 1, SHADOW_CORE);
    const rings: [number, number][] = far
      ? [
          [-inset, SHADOW_CORE],
          [rim * 0.7, 0],
        ]
      : [
          [-inset, SHADOW_CORE],
          [rim * 0.35, SHADOW_EDGE],
          [rim, 0],
        ];
    for (const [grow, alpha] of rings) {
      ring(positions, cx, cz, ix + grow, iz + grow, Math.max(0.02, radius + grow), ry, points);
      for (let k = 0; k < n; k++) colors.push(1, 1, 1, alpha);
    }
    // Core: a fan from the centre to the inner ring (convex).
    for (let k = 0; k < n; k++) indices.push(base, base + 1 + k, base + 1 + ((k + 1) % n));
    // Bands between consecutive rings.
    for (let q = 0; q < rings.length - 1; q++) {
      const a = base + 1 + q * n;
      const b = a + n;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        indices.push(a + k, b + k, b + k1, a + k, b + k1, a + k1);
      }
    }
  }
  return { positions, colors, indices };
}

/**
 * Writes the matrix of a blob of w × d tiles (world x, z extent before
 * the rotation) centred at (cx, cz), leaning away from the sun by
 * `height` × the shadow lean, turned by `yaw` (radians).
 */
export function blobMatrix(out: Float32Array, index: number, cx: number, cz: number, w: number, d: number, height: number, yaw = 0, y = BLOB_Y): void {
  const m = Matrix.Scaling(w, 1, d)
    .multiply(Matrix.RotationY(yaw))
    .multiply(Matrix.Translation(cx + SHADOW_LEAN.x * height * 0.35, y, cz + SHADOW_LEAN.z * height * 0.35));
  m.copyToArray(out, index * 16);
}

/** One class of blob shadows (thin instances of a unit plane with the radial texture; few instances, e.g. ships). */
export class BlobLayer {
  readonly mesh: Mesh;

  constructor(scene: Scene, name: string, parent: TransformNode | null, opacity: number) {
    const mat = new StandardMaterial(name, scene);
    this.mesh = CreateGround(name, { width: 1, height: 1 }, scene);
    mat.diffuseTexture = blobTexture(scene);
    mat.useAlphaFromDiffuseTexture = true;
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.alpha = opacity;
    mat.backFaceCulling = false;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.parent = parent;
    setInstances(this.mesh, null);
  }

  /** Static instances (rebuilt with the payload). */
  set(matrices: Float32Array | null): void {
    setInstances(this.mesh, matrices);
  }

  setEnabled(on: boolean): void {
    this.mesh.setEnabled(on);
  }
}

/**
 * Contact shadows of the buildings of one island: a soft rounded
 * rectangle (vertex alpha) at every model's rotated bounds, merged into
 * one static mesh — a single draw call without instances (software
 * renderers pay per instance), rebuilt with the payload. With a far name
 * a second mesh of the cheap far outlines (FAR_SHADOW_TRIS) is built
 * alongside; setFar toggles between them (no rebuild on a zoom).
 */
export class FootprintShadows {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private farMesh: Mesh | null = null;
  private far = false;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    private readonly parent: TransformNode | null,
    opacity: number,
    private readonly farName: string | null = null,
  ) {
    this.material = new StandardMaterial(name, scene);
    this.material.diffuseColor = SHADOW;
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.alpha = opacity;
    this.material.backFaceCulling = false;
  }

  /** Outlines (centre x, z and rotated size, island-local) with the height they lean for (per rect, else `height`). */
  update(rects: readonly ShadowRect[], rim: number, height: number): void {
    this.mesh?.dispose();
    this.farMesh?.dispose();
    this.mesh = null;
    this.farMesh = null;
    if (rects.length === 0) return;
    this.mesh = this.build(this.name, roundedShadows(rects, rim, height));
    if (this.farName) this.farMesh = this.build(this.farName, roundedShadows(rects, rim, height, BLOB_Y, true));
    this.setFar(this.far);
  }

  /** Triangles of the far outlines (0 without them). */
  farTriangles(): number {
    return this.farMesh ? this.farMesh.getTotalIndices() / 3 : 0;
  }

  /** Far LOD: the cheap outlines (when built) instead of the soft ones. */
  setFar(on: boolean): void {
    this.far = on;
    this.mesh?.setEnabled(!(on && this.farMesh));
    this.farMesh?.setEnabled(on);
  }

  private build(name: string, d: { positions: number[]; colors: number[]; indices: number[] }): Mesh {
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = d.positions;
    data.colors = d.colors;
    data.indices = d.indices;
    data.normals = d.positions.map((_, n) => (n % 3 === 1 ? 1 : 0));
    data.applyToMesh(mesh);
    mesh.hasVertexAlpha = true;
    mesh.material = this.material;
    mesh.parent = this.parent;
    mesh.isPickable = false;
    return mesh;
  }

  /** The merged shadow mesh drawn (tests; null without buildings). */
  current(): Mesh | null {
    return this.far && this.farMesh ? this.farMesh : this.mesh;
  }
}
