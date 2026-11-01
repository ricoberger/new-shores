// Ship wakes (D-057 V2): a sailing ship trails flecks of foam voxels in a
// V behind its stern at near and mid LOD — two arms opening at WAKE_SPREAD
// and a trail along the keel, thinning and shrinking with distance. The
// flecks step (STEP_MS) instead of sliding: a hash per fleck and step
// decides which are shown, like the coast foam (render/terrain.ts). One
// thin-instance mesh for the scene (the life_wake model, a box until it
// has loaded); render data only, no game state.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { hash01 } from "../display/life";
import { WATER } from "../theme/palette";
import { skyFill } from "./lighting";
import { writeMatrix } from "./life";
import { lifeModel, type ModelRegistry } from "./models";
import { c3 } from "./palette";

/** A sailing ship's wake origin and direction (archipelago tiles; heading as display/ships.ts). */
export interface WakeShip {
  id: number;
  x: number;
  y: number;
  heading: number;
  /** Distance from the ship's origin back to its stern, the manifest's `wake` anchor (tiles). */
  stern: number;
  /** Width of the wake at the stern (tiles; the manifest's ship.wake_width, V7): the arms leave the stern's sides, half of it to each side. */
  width: number;
  /** The ship's instance scale: its voxels are that much larger than the world's, and so are the wake's. */
  scale: number;
}

/** Flecks per arm (and along the keel). */
export const WAKE_FLECKS = 8;
/** Spacing of the flecks along the wake (tiles per unit of ship scale). */
const SPACING = 0.16;
/** Half-angle of the V (radians). */
const WAKE_SPREAD = 0.32;
/** The flecks re-roll every STEP_MS. */
const STEP_MS = 280;
/** Height of the flecks: their foam voxels just above the sea (the sea plane is at seaY). */
const ABOVE = 0.005;
/** Height of a fleck model at scale 1 (one voxel at 16 per tile). */
const FLECK_H = 1 / 16;

export class ShipWake {
  readonly mesh: Mesh;
  private matrices = new Float32Array(0);
  private cap = 0;
  private n = 0;
  private modelled = false;

  constructor(
    scene: Scene,
    private readonly seaY: number,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.mesh = CreateBox("ship_wake", { width: 0.125, height: 0.0625, depth: 0.0625 }, scene);
    const foam = c3(WATER.foam);
    this.mesh.setVerticesData("color", new Array(this.mesh.getTotalVertices()).fill([foam.r, foam.g, foam.b, 1]).flat());
    const m = skyFill(new StandardMaterial("ship_wake", scene));
    m.specularColor = Color3.Black();
    this.mesh.material = m;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.isVisible = false;
  }

  /** Flecks drawn in the last frame (tests). */
  count(): number {
    return this.n;
  }

  /** Draws the wakes of the sailing ships at nowMs (none: hidden). */
  frame(ships: readonly WakeShip[], nowMs: number): void {
    this.swapModel(ships.length > 0);
    this.n = 0;
    const step = Math.floor(nowMs / STEP_MS);
    for (const s of ships) {
      const bx = -Math.cos(s.heading);
      const by = -Math.sin(s.heading);
      const nx = -by;
      const ny = bx;
      for (let i = 0; i < WAKE_FLECKS; i++) {
        // Behind the stern anchor.
        const t = i * SPACING * s.scale;
        const fade = 1 - i / WAKE_FLECKS;
        for (const arm of [-1, 0, 1]) {
          // The keel trail is short; the arms open out.
          if (arm === 0 && i > WAKE_FLECKS / 2) continue;
          if (hash01(s.id, i, arm, step) > 0.35 + 0.6 * fade) continue;
          // The arms leave the hull's sides at the stern and open out from there.
          const side = arm * (s.width / 2 + t * Math.tan(WAKE_SPREAD));
          const x = s.x + bx * (s.stern + t) + nx * side;
          const y = s.y + by * (s.stern + t) + ny * side;
          // Quarter turns only, so the voxels stay on the world's axes; snapped to the ship's voxel grid.
          const yaw = (Math.floor(hash01(s.id, i, arm, "yaw") * 4) * Math.PI) / 2;
          const g = 16 / s.scale;
          const k = (0.5 + 0.5 * fade) * s.scale;
          // Mostly under the surface: a low lump of foam, not a block.
          this.push(Math.round(x * g) / g, this.seaY + ABOVE - FLECK_H * k * 0.7, -Math.round(y * g) / g, yaw, k);
        }
      }
    }
    if (this.n === 0) {
      this.mesh.isVisible = false;
      return;
    }
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.isVisible = true;
  }

  private push(x: number, y: number, z: number, yaw: number, k: number): void {
    if (this.n >= this.cap) this.grow();
    writeMatrix(this.matrices, this.n, x, y, z, yaw, k);
    this.n++;
  }

  private grow(): void {
    const cap = Math.max(64, this.cap * 2);
    const m = new Float32Array(cap * 16);
    m.set(this.matrices);
    this.matrices = m;
    this.cap = cap;
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
  }

  /** The life_wake model replaces the box once loaded (requested when a ship first sails). */
  private swapModel(wanted: boolean): void {
    if (this.modelled || !wanted || !this.registry) return;
    const data = lifeModel(this.registry, "life_wake");
    if (!data) return;
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.colors = data.colors;
    vd.indices = data.indices;
    for (const kind of this.mesh.getVerticesDataKinds()) if (!["position", "normal", "color", "world0", "world1", "world2", "world3"].includes(kind)) this.mesh.removeVerticesData(kind);
    vd.applyToMesh(this.mesh);
    this.modelled = true;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
