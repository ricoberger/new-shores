// The reach ring (UI.md §3, D-069 §1): the outline of a collector's reach
// (display/served.ts reachOutline) as a thin band in the selection yellow,
// around a Warehouse or Trading Post ghost or the selected one; in gold the
// service radius of a public building or the market and a plan's ring
// (D-071). Like the
// deposit highlight it is drawn after the scene (rendering group 1, depth
// cleared) so terrain and models never hide it. One mesh, rebuilt when the
// outline changes; world coordinates; never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { GOLD, SELECTION } from "./palette";

/** A point of the ring: scene x, z and the height of the ground under it (tiles). */
export interface RingPoint {
  x: number;
  z: number;
  y: number;
}

/** Band width and lift above the ground (tiles). */
const WIDTH = 0.14;
const LIFT = 0.08;

/** Positions and indices of a closed band of the given width along the points (flat in x/z at each point's y). */
export function ringBand(points: readonly RingPoint[], width = WIDTH): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = points.length;
  if (n < 3) return { positions, indices };
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const p = points[i]!;
    const next = points[(i + 1) % n]!;
    // Normal of the averaged direction in the x/z plane.
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const nx = -dz * (width / 2);
    const nz = dx * (width / 2);
    positions.push(p.x - nx, p.y + LIFT, p.z - nz, p.x + nx, p.y + LIFT, p.z + nz);
    const a = 2 * i;
    const b = 2 * ((i + 1) % n);
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, indices };
}

export class ReachRing {
  private readonly mesh: Mesh;
  private key = "";

  constructor(scene: Scene) {
    this.mesh = new Mesh("reach_ring", scene);
    const mat = new StandardMaterial("reach_ring", scene);
    mat.disableLighting = true;
    mat.emissiveColor = SELECTION;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.alpha = 0.85;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  /**
   * Draws the ring through the points (key: rebuilt only when it changes);
   * null hides it. `gold`: the plan and service radius colour (D-071),
   * else the selection yellow of a collector's reach.
   */
  set(key: string, points: readonly RingPoint[] | null, gold = false): void {
    if (!points || points.length < 3) {
      this.key = "";
      this.mesh.setEnabled(false);
      return;
    }
    if (key === this.key) return;
    this.key = key;
    (this.mesh.material as StandardMaterial).emissiveColor = gold ? GOLD : SELECTION;
    const { positions, indices } = ringBand(points);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    data.applyToMesh(this.mesh, true);
    this.mesh.setEnabled(true);
  }

  /** Whether the ring is drawn (tests and shots). */
  shown(): boolean {
    return this.mesh.isEnabled();
  }

  /** Whether the drawn ring is the gold one (tests and shots). */
  gold(): boolean {
    return this.mesh.isEnabled() && (this.mesh.material as StandardMaterial).emissiveColor.equals(GOLD);
  }
}
