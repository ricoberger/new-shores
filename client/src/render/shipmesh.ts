// Low-poly placeholder ship (procedural, no asset): a hull box and a sail
// plane merged into one mesh with vertex colours, drawn as thin instances
// with a per-instance colour (white = as is, grey = anchored unpaid).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";

// Wood tones chosen so that SHIP_UNPAID turns them neutral grey (r × 0.6 =
// g × 0.68 = b × 0.8) and the sail a dim blue-grey.
const HULL = new Color4(0.36, 0.32, 0.27, 1);
const DECK = new Color4(0.53, 0.47, 0.4, 1);
const SAIL = new Color4(0.97, 0.95, 0.88, 1);

/** Instance colour of a ship that runs. */
export const SHIP_ACTIVE: readonly [number, number, number, number] = [1, 1, 1, 1];
/** Instance colour of an anchored_unpaid ship: multiplies the wood tones to grey (greyed out). */
export const SHIP_UNPAID: readonly [number, number, number, number] = [0.6, 0.68, 0.8, 1];

/**
 * Ship template of unit length (bow along +X), sitting on Y = 0. One per
 * ship type; the type only changes the name today (one type, the sloop).
 */
export function shipTemplate(scene: Scene, name: string): Mesh {
  const hull = CreateBox(`${name}_hull`, { width: 1, height: 0.22, depth: 0.38, faceColors: [HULL, HULL, HULL, HULL, DECK, HULL] }, scene);
  hull.position.y = 0.11;
  const bow = CreateBox(`${name}_bow`, { width: 0.27, height: 0.22, depth: 0.27, faceColors: [HULL, HULL, HULL, HULL, DECK, HULL] }, scene);
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0.5, 0.11, 0);
  const sail = CreateBox(`${name}_sail`, { width: 0.5, height: 0.7, depth: 0.03, faceColors: [SAIL, SAIL, SAIL, SAIL, SAIL, SAIL] }, scene);
  sail.position.set(0.02, 0.6, 0);
  sail.rotation.y = Math.PI / 2;
  const mesh = Mesh.MergeMeshes([hull, bow, sail], true, true);
  if (!mesh) throw new Error(`cannot build ship mesh ${name}`);
  mesh.name = name;
  const mat = new StandardMaterial(name, scene);
  mat.specularColor = Color3.Black();
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

const scratchQ = new Quaternion();
const scratchS = new Vector3();
const scratchT = new Vector3();
const scratchM = new Matrix();

/**
 * Writes the matrix of a ship instance into `out` at `index`: scaled by
 * `scale`, turned to `heading` (radians in archipelago tiles: x right, y
 * down; world Z is −y) and placed at world (x, y, z).
 */
export function shipMatrix(out: Float32Array, index: number, x: number, y: number, z: number, heading: number, scale: number): void {
  Quaternion.RotationYawPitchRollToRef(heading, 0, 0, scratchQ);
  scratchS.set(scale, scale, scale);
  scratchT.set(x, y, z);
  Matrix.ComposeToRef(scratchS, scratchQ, scratchT, scratchM);
  scratchM.copyToArray(out, index * 16);
}

/**
 * Thin instances with a per-instance colour whose matrices change every
 * frame: buffers are reallocated only when the count changes, otherwise
 * updated in place.
 */
export class ColoredInstances {
  matrices = new Float32Array(0);
  colors = new Float32Array(0);
  private count = -1;

  constructor(readonly mesh: Mesh) {
    this.resize(0);
  }

  /** Prepares buffers for n instances (contents are rewritten by the caller). */
  resize(n: number): void {
    if (n === this.count) return;
    this.count = n;
    this.matrices = new Float32Array(n * 16);
    this.colors = new Float32Array(n * 4);
    if (n === 0) {
      this.mesh.isVisible = false;
      this.mesh.thinInstanceSetBuffer("matrix", null, 16);
      this.mesh.thinInstanceSetBuffer("color", null, 4);
      return;
    }
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.mesh.isVisible = true;
  }

  setColor(i: number, c: readonly number[]): void {
    this.colors.set(c, i * 4);
  }

  /** Uploads the rewritten buffers. */
  commit(): void {
    if (this.count <= 0) return;
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.thinInstanceBufferUpdated("color");
  }

  size(): number {
    return Math.max(0, this.count);
  }
}
