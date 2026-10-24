// Life layer (docs/LIFE_LAYER.md): the meshes. One thin-instance mesh per
// element class for the whole scene (world coordinates; LIFE_LAYER §1
// "one instanced mesh per element class"), created once with the
// renderer — a model that finishes loading replaces the vertex data of
// the existing mesh, so zooming or loading never creates a mesh. Every
// frame the plans of the islands in view (display/lifeplan.ts) write their
// instances through a LifeSink within the per-island budget of the device
// class; the buffers grow (doubling) but are never reallocated per frame.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, type Color4 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { lifeAtLod, lifeBudget, type LifePlan, type LifeSink, type LifeStats } from "../display/life";
import { CLS, VILLAGER_VARIANTS } from "../display/lifeplan";
import type { Lod } from "../display/lod";
import type { Quality } from "../display/quality";
import { BUILDINGS, WATER } from "../theme/palette";
import { skyFill } from "./lighting";
import { lifeModel, type ModelData, type ModelRegistry } from "./models";
import { c4, mix } from "./palette";

const WHITE = [1, 1, 1, 1] as const;

/** Writes Scaling(k) · RotationX(roll) · RotationY(yaw) · Translation(x, y, z) (Babylon row-major) at index i. */
export function writeMatrix(out: Float32Array, i: number, x: number, y: number, z: number, yaw: number, k: number, roll = 0): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const o = i * 16;
  out[o] = c * k;
  out[o + 1] = 0;
  out[o + 2] = -s * k;
  out[o + 3] = 0;
  out[o + 4] = sr * s * k;
  out[o + 5] = cr * k;
  out[o + 6] = sr * c * k;
  out[o + 7] = 0;
  out[o + 8] = cr * s * k;
  out[o + 9] = -sr * k;
  out[o + 10] = cr * c * k;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** Vertex attributes a model swap keeps (thin-instance buffers) or sets anew. */
const KEEP_KINDS = new Set(["position", "normal", "color", "world0", "world1", "world2", "world3", "instanceColor"]);

/** One element class: a mesh drawn with thin instances (matrix + colour), refilled every frame. */
export class LifeMesh {
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private cap = 0;
  private n = 0;
  private uploaded = -1;
  /** Whether the model replaced the placeholder geometry. */
  modelled = false;

  constructor(readonly mesh: Mesh) {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isVisible = false;
  }

  begin(): void {
    this.n = 0;
  }

  push(x: number, y: number, z: number, yaw: number, k: number, color: readonly number[], roll: number): void {
    if (this.n >= this.cap) this.grow();
    writeMatrix(this.matrices, this.n, x, y, z, yaw, k, roll);
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

  /** Archipelago positions (tiles: x, y = −world z) and heights of the instances drawn in the last frame. */
  positions(): { x: number; y: number; h: number }[] {
    const out: { x: number; y: number; h: number }[] = [];
    for (let i = 0; i < this.count(); i++) out.push({ x: this.matrices[i * 16 + 12] as number, y: -(this.matrices[i * 16 + 14] as number), h: this.matrices[i * 16 + 13] as number });
    return out;
  }

  /** Replaces the geometry (a model loaded) in place: no new mesh. */
  setGeometry(data: ModelData): void {
    // The placeholder's other attributes (uv) would outlive it with the wrong vertex count.
    for (const kind of this.mesh.getVerticesDataKinds()) if (!KEEP_KINDS.has(kind)) this.mesh.removeVerticesData(kind);
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

/** A class: its placeholder, its model (manifest life entry and variant) and whether it counts as particles. */
export interface LifeClassDef {
  geometry: LifeGeometry;
  model?: { id: string; variant?: number };
  particle?: boolean;
}

/**
 * The life layer of a scene: the class meshes and the per-frame pass over
 * the plans of the islands in view.
 */
export class LifeLayer {
  private readonly classes = new Map<string, LifeMesh>();
  private readonly particleClasses = new Set<string>();
  private readonly models = new Map<string, { id: string; variant?: number }>();
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
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.quality = quality;
    this.enabled = enabled;
    this.material = skyFill(new StandardMaterial("life", scene));
    this.material.specularColor = Color3.Black();
    for (const [id, def] of Object.entries(defs)) this.define(id, def);
    this.sink = {
      add: (cls, x, h, y, yaw, k = 1, color = WHITE, roll = 0) => {
        this.classes.get(cls)?.push(this.origin.x + x, h, -(this.origin.y + y), yaw, k, color, roll);
      },
    };
  }

  private define(id: string, def: LifeClassDef): void {
    const mesh = def.geometry(this.scene, `life_${id}`);
    if (!mesh.material) mesh.material = this.material;
    this.classes.set(id, new LifeMesh(mesh));
    if (def.particle) this.particleClasses.add(id);
    if (def.model) this.models.set(id, def.model);
  }

  /** Replaces the placeholder of the classes drawn with their model once it has loaded (requested on first use). */
  private swapModels(): void {
    if (!this.registry) return;
    for (const [id, m] of this.models) {
      const c = this.classes.get(id) as LifeMesh;
      if (c.modelled || c.count() === 0) continue;
      const data = lifeModel(this.registry, m.id, m.variant);
      if (!data) continue;
      c.setGeometry(data);
      c.modelled = true;
    }
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
    this.swapModels();
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

  /** Archipelago positions of a class's instances in the last frame (tests, e2e). */
  positions(id: string): { x: number; y: number; h: number }[] {
    return this.classes.get(id)?.positions() ?? [];
  }

  /** Whether a class counts as particles. */
  isParticle(id: string): boolean {
    return this.particleClasses.has(id);
  }
}

/** A box placeholder (until the model has loaded) standing on y = 0 or centred, in one colour. */
function box(w: number, h: number, d: number, color: Color4, centred = false): LifeGeometry {
  return (scene, name) => {
    const m = CreateBox(name, { width: w, height: h, depth: d, faceColors: new Array(6).fill(color) }, scene);
    if (!centred) {
      m.position.y = h / 2;
      m.bakeCurrentTransformIntoVertices();
    }
    return m;
  };
}

/**
 * A gull: two wing quads in a V (span along x, chord along z) and a small
 * body, both windings so it reads from above and below; `lift` raises the
 * wing tips (up stroke) or lowers them (down stroke).
 */
function gull(lift: number): LifeGeometry {
  return (scene, name) => {
    const span = 0.2;
    const chord = 0.07;
    const tip = 0.03;
    const p: number[] = [];
    const quad = (sx: number) => {
      // Root front, root back, tip back, tip front (tips swept back a little).
      p.push(0, 0, chord, 0, 0, -chord, sx * span, lift, -chord - tip, sx * span, lift, chord * 0.3 - tip);
    };
    quad(1);
    quad(-1);
    // Body: a thin diamond along z.
    p.push(0, 0.015, 0.12, 0.025, 0, 0, 0, 0.015, -0.1, -0.025, 0, 0);
    // Both sides: the quads again with their own vertices (separate normals) and the reverse winding.
    p.push(...p);
    const idx: number[] = [];
    for (let q = 0; q < 3; q++) {
      const o = q * 4;
      const r = 12 + o;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3, r, r + 2, r + 1, r, r + 3, r + 2);
    }
    const c: number[] = [];
    for (let i = 0; i < 24; i++) {
      const v = i % 12;
      const col = v >= 8 ? GULL_BODY : v % 4 >= 2 ? GULL_TIP : GULL_WING;
      c.push(col.r, col.g, col.b, 1);
    }
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = p;
    vd.indices = idx;
    vd.colors = c;
    const normals: number[] = [];
    VertexData.ComputeNormals(p, idx, normals);
    vd.normals = normals;
    vd.applyToMesh(m);
    return m;
  };
}

/** A low-poly puff (unit diameter, flat-shaded) in one colour: smoke. */
function puff(color: Color4): LifeGeometry {
  return (scene, name) => {
    const m = CreateIcoSphere(name, { radius: 0.5, subdivisions: 1, flat: true }, scene);
    m.setVerticesData("color", new Array(m.getTotalVertices()).fill([color.r, color.g, color.b, 1]).flat());
    return m;
  };
}

const TIMBER = c4(BUILDINGS.timber);
/** Smoke grey: between the stone role and the foam white (no palette entry of its own). */
const SMOKE = mix(BUILDINGS.stone, WATER.foam, 0.7).toColor4(1);
const GULL_WING = c4(WATER.foam);
const GULL_TIP = mix(BUILDINGS.stone, WATER.foam, 0.2).toColor4(1);
const GULL_BODY = mix(BUILDINGS.stone, WATER.foam, 0.8).toColor4(1);
const CANVAS = c4(BUILDINGS.canvas);

function villagers(tier: "settlers" | "citizens", color: Color4): Record<string, LifeClassDef> {
  const out: Record<string, LifeClassDef> = {};
  for (let v = 0; v < VILLAGER_VARIANTS; v++) {
    out[CLS.villager(tier, v)] = { geometry: box(0.16, 0.46, 0.12, color), model: { id: `life_villager_${tier}`, variant: v } };
  }
  return out;
}

/** The element classes of the life layer: placeholder and model (assets/recipes/life_*.json). */
export const LIFE_CLASSES: Readonly<Record<string, LifeClassDef>> = {
  [CLS.cart]: { geometry: box(0.46, 0.45, 1.0, TIMBER), model: { id: "life_cart" } },
  [CLS.cartLoaded]: { geometry: box(0.46, 0.7, 1.0, CANVAS), model: { id: "life_cart_merchant" } },
  [CLS.axle]: { geometry: box(0.57, 0.18, 0.18, TIMBER, true), model: { id: "life_cart_axle" } },
  ...villagers("settlers", c4(BUILDINGS.thatch)),
  ...villagers("citizens", c4(BUILDINGS.terracotta)),
  [CLS.smoke]: { geometry: puff(SMOKE), particle: true },
  [CLS.boat]: { geometry: box(0.3, 0.12, 0.8, TIMBER), model: { id: "life_boat" } },
  [CLS.crate]: { geometry: box(0.24, 0.24, 0.24, TIMBER), model: { id: "life_crate" } },
  [CLS.gullUp]: { geometry: gull(0.07) },
  [CLS.gullDown]: { geometry: gull(-0.06) },
};
