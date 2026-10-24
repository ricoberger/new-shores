// Life layer (docs/LIFE_LAYER.md): the meshes. One thin-instance mesh per
// element class for the whole scene (world coordinates; LIFE_LAYER §1
// "one instanced mesh per element class"), created once with the
// renderer — a model that finishes loading replaces the vertex data of
// the existing mesh, so zooming or loading never creates a mesh. Every
// frame the plans of the islands in view (display/lifeplan.ts) write their
// instances through a LifeSink within the per-island budget of the device
// class; the buffers grow (doubling) but are never reallocated per frame.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { lifeAtLod, lifeBudget, type LifePlan, type LifeSink, type LifeStats } from "../display/life";
import type { Lod } from "../display/lod";
import type { Quality } from "../display/quality";
import { skyFill } from "./lighting";
import type { ModelData } from "./models";

const WHITE = [1, 1, 1, 1] as const;

/** Writes Scaling(sx, sy, sz) · RotationY(yaw) · Translation(x, y, z) (Babylon row-major) at index i. */
export function writeMatrix(out: Float32Array, i: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const o = i * 16;
  out[o] = c * sx;
  out[o + 1] = 0;
  out[o + 2] = -s * sx;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * sz;
  out[o + 9] = 0;
  out[o + 10] = c * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** One element class: a mesh drawn with thin instances (matrix + colour), refilled every frame. */
export class LifeMesh {
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private cap = 0;
  private n = 0;
  private uploaded = -1;

  constructor(readonly mesh: Mesh) {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isVisible = false;
  }

  begin(): void {
    this.n = 0;
  }

  push(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, color: readonly number[]): void {
    if (this.n >= this.cap) this.grow();
    writeMatrix(this.matrices, this.n, x, y, z, yaw, sx, sy, sz);
    this.colors.set(color, this.n * 4);
    this.n++;
  }

  private grow(): void {
    const cap = Math.max(16, this.cap * 2);
    const m = new Float32Array(cap * 16);
    m.set(this.matrices);
    const c = new Float32Array(cap * 4);
    c.set(this.colors);
    this.matrices = m;
    this.colors = c;
    this.cap = cap;
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
  }

  /** Uploads this frame's instances (hidden when there are none). */
  commit(): void {
    if (this.n === 0) {
      this.mesh.isVisible = false;
      this.uploaded = 0;
      return;
    }
    this.mesh.thinInstanceCount = this.n;
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.thinInstanceBufferUpdated("color");
    this.mesh.isVisible = true;
    this.uploaded = this.n;
  }

  /** Instances drawn in the last frame. */
  count(): number {
    return Math.max(0, this.uploaded);
  }

  /** Replaces the geometry (a model loaded) in place: no new mesh. */
  setGeometry(data: ModelData): void {
    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    vd.colors = data.colors;
    vd.indices = data.indices;
    vd.applyToMesh(this.mesh);
  }
}

/** Builds the placeholder geometry of a class (procedural, until or without a model). */
export type LifeGeometry = (scene: Scene, name: string) => Mesh;

/** A class: its placeholder and the classes that count as particles. */
export interface LifeClassDef {
  geometry: LifeGeometry;
  particle?: boolean;
}

/**
 * The life layer of a scene: the class meshes and the per-frame pass over
 * the plans of the islands in view.
 */
export class LifeLayer {
  private readonly classes = new Map<string, LifeMesh>();
  private readonly particleClasses = new Set<string>();
  private readonly material: StandardMaterial;
  private quality: Quality;
  private enabled: boolean;
  private stats: LifeStats = { instances: 0, particles: 0 };
  private origin = { x: 0, y: 0 };
  private readonly sink: LifeSink;

  constructor(
    private readonly scene: Scene,
    defs: Readonly<Record<string, LifeClassDef>>,
    quality: Quality,
    enabled = true,
  ) {
    this.quality = quality;
    this.enabled = enabled;
    this.material = skyFill(new StandardMaterial("life", scene));
    this.material.specularColor = Color3.Black();
    for (const [id, def] of Object.entries(defs)) this.define(id, def);
    this.sink = {
      add: (cls, x, h, y, yaw, sx, sy = sx, sz = sx, color = WHITE) => {
        this.classes.get(cls)?.push(this.origin.x + x, h, -(this.origin.y + y), yaw, sx, sy, sz, color);
      },
    };
  }

  private define(id: string, def: LifeClassDef): void {
    const mesh = def.geometry(this.scene, `life_${id}`);
    if (!mesh.material) mesh.material = this.material;
    this.classes.set(id, new LifeMesh(mesh));
    if (def.particle) this.particleClasses.add(id);
  }

  /** The mesh of a class (tests; model swaps). */
  classMesh(id: string): LifeMesh | undefined {
    return this.classes.get(id);
  }

  setQuality(q: Quality): void {
    this.quality = q;
  }

  /** ?life=0 turns the layer off (nothing drawn, no work per frame). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Draws the plans of the islands in view at server time nowMs: each
   * island's instances within the budget of the device class, only what
   * the LOD shows.
   */
  frame(nowMs: number, islands: Iterable<{ origin: { x: number; y: number }; plan: LifePlan }>, lod: Lod): void {
    for (const c of this.classes.values()) c.begin();
    let instances = 0;
    let particles = 0;
    const at = lifeAtLod(lod);
    if (this.enabled && (at.moving || at.smoke || at.props)) {
      const budget = lifeBudget(this.quality);
      for (const { origin, plan } of islands) {
        this.origin = origin;
        const s = plan.frame(nowMs, this.sink, at, budget);
        instances += s.instances;
        particles += s.particles;
      }
    }
    for (const c of this.classes.values()) c.commit();
    this.stats = { instances, particles };
  }

  /** Instances and particles drawn in the last frame. */
  lastStats(): LifeStats {
    return this.stats;
  }

  /** Instances drawn per class in the last frame (tests, e2e). */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, c] of this.classes) if (c.count() > 0) out[id] = c.count();
    return out;
  }

  /** Whether a class counts as particles. */
  isParticle(id: string): boolean {
    return this.particleClasses.has(id);
  }
}

/** The element classes of the life layer (filled by the element steps). */
export const LIFE_CLASSES: Readonly<Record<string, LifeClassDef>> = {};
