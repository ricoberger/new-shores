// Blob / contact shadows (ART_DIRECTION §2) at near and mid LOD and at
// every quality, one draw call per object class: ships are thin instances
// of a plane with a shared radial alpha texture (few instances, moving);
// buildings get a soft-edged frame around their footprint (alpha in the
// vertices, the covered footprint left out) merged into one static mesh
// per island, because software renderers pay per instance and a dense
// town has hundreds (the phone perf budget; trees do the same in their
// own mesh). Purely visual, never pickable.
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

/** Alpha of the footprint shadows at the footprint edge (falling to 0 at the rim). */
const FRAME_CORE = 0.85;

/**
 * Writes the matrix of a blob of w × d tiles (world x, z extent before
 * the rotation) centred at (cx, cz), leaning away from the sun by
 * `height` × the shadow lean, turned by `yaw` (radians).
 */
export function blobMatrix(out: Float32Array, index: number, cx: number, cz: number, w: number, d: number, height: number, yaw = 0): void {
  const m = Matrix.Scaling(w, 1, d)
    .multiply(Matrix.RotationY(yaw))
    .multiply(Matrix.Translation(cx + SHADOW_LEAN.x * height * 0.35, BLOB_Y, cz + SHADOW_LEAN.z * height * 0.35));
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
 * Contact shadows of the buildings of one island: a soft frame (vertex
 * alpha) around every rotated footprint, merged into one static mesh — a
 * single draw call without instances (software renderers pay per
 * instance), rebuilt with the payload.
 */
export class FootprintShadows {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    private readonly parent: TransformNode | null,
    opacity: number,
  ) {
    this.material = new StandardMaterial(name, scene);
    this.material.diffuseColor = SHADOW;
    this.material.specularColor = Color3.Black();
    this.material.disableLighting = true;
    this.material.alpha = opacity;
    this.material.backFaceCulling = false;
  }

  /** Footprints (centre x, z and rotated size, island-local) with the height they lean for (per rect, else `height`). */
  update(rects: readonly { cx: number; cz: number; w: number; h: number; height?: number }[], rim: number, height: number): void {
    this.mesh?.dispose();
    this.mesh = null;
    if (rects.length === 0) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (const r of rects) {
      const lx = SHADOW_LEAN.x * (r.height ?? height) * 0.35;
      const lz = SHADOW_LEAN.z * (r.height ?? height) * 0.35;
      const base = positions.length / 3;
      const cx = r.cx + lx;
      const cz = r.cz + lz;
      const ix = r.w / 2;
      const iz = r.h / 2;
      const ox = ix + rim;
      const oz = iz + rim;
      const cut = rim * 0.6;
      const inner = [
        [-ix, -iz],
        [ix, -iz],
        [ix, iz],
        [-ix, iz],
      ];
      const outer = [
        [-ox + cut, -oz],
        [ox - cut, -oz],
        [ox, -oz + cut],
        [ox, oz - cut],
        [ox - cut, oz],
        [-ox + cut, oz],
        [-ox, oz - cut],
        [-ox, -oz + cut],
      ];
      for (const [x, z] of inner) {
        positions.push(cx + (x as number), BLOB_Y, cz + (z as number));
        colors.push(1, 1, 1, FRAME_CORE);
      }
      for (const [x, z] of outer) {
        positions.push(cx + (x as number), BLOB_Y, cz + (z as number));
        colors.push(1, 1, 1, 0);
      }
      for (let k = 0; k < 4; k++) {
        const a = base + k;
        const b = base + ((k + 1) % 4);
        const o1 = base + 4 + ((2 * k + 7) % 8);
        const o2 = base + 4 + 2 * k;
        const o3 = base + 4 + 2 * k + 1;
        indices.push(a, o2, o1, a, o3, o2, a, b, o3);
      }
    }
    const mesh = new Mesh(this.name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.indices = indices;
    data.normals = positions.map((_, n) => (n % 3 === 1 ? 1 : 0));
    data.applyToMesh(mesh);
    mesh.hasVertexAlpha = true;
    mesh.material = this.material;
    mesh.parent = this.parent;
    mesh.isPickable = false;
    this.mesh = mesh;
  }
}
