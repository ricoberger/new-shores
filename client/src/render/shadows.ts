// Blob / contact shadows (ART_DIRECTION §2): a soft dark ellipse under
// every building, tree and ship at near and mid LOD and at every quality.
// One thin-instanced ground plane per object class (and island for
// buildings and trees); the radial alpha texture is shared per scene.
// Purely visual, never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
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

/** One class of blob shadows (thin instances of a unit plane). */
export class BlobLayer {
  readonly mesh: Mesh;

  constructor(scene: Scene, name: string, parent: TransformNode | null, opacity: number) {
    this.mesh = CreateGround(name, { width: 1, height: 1 }, scene);
    const mat = new StandardMaterial(name, scene);
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
