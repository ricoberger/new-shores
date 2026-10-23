// Trees and ground scatter (ART_DIRECTION §4, restyle) of one island at
// near LOD: KayKit Forest trees (four species, decor_tree_a–d) on the
// forest tiles, a soft blob shadow under each, stumps of the felled trees
// inside lumberjack radii (decor_stump_a/b), grass tufts, bushes and rocks
// (decor_tuft_*, decor_bush_*, decor_rock_*) on grass, along the coast and
// on the plateaus (at their height), and small procedural flowers —
// placed by display/scatter.ts from the island seed. The kit pieces come
// from the asset manifest's decor models; until they have loaded (or
// without them) the procedural low-poly trees, tufts and rocks stand in,
// and the layer is rebuilt when they arrive (needsModels). Each layer is
// one merged static mesh per island (indexed, typed arrays), rebuilt
// with the payload. Decoration is never pickable and holds no state.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Placed, ScatterKind } from "../display/scatter";
import { BUILDINGS, TERRAIN, UI, WATER } from "../theme/palette";
import { SHADOW_LEAN, skyFill } from "./lighting";
import { bipyramid, cone, prism, type Tri, TriBuilder } from "./meshdata";
import { decorModel, type ModelData, type ModelRegistry } from "./models";
import { c3, SHADOW } from "./palette";
import { BLOB_Y } from "./shadows";

const TRUNK = c3(BUILDINGS.timber);
const FOREST = c3(TERRAIN.forest_floor);
const CROWN = c3(TERRAIN.tree_crown);
const GRASS_A = c3(TERRAIN.grass_a);

/**
 * Far-LOD tree thinning: every FAR_TREE_STRIDE-th tree of an island stays
 * at far LOD (1: all). The kept trees lead the merged mesh, so thinning
 * only shortens the drawn index range of the pre-built mesh (no rebuild,
 * no extra draw call).
 */
export const FAR_TREE_STRIDE = 1;

/** Decor models of the tree species (variant index → manifest decor ID). */
export const TREE_MODELS = ["decor_tree_a", "decor_tree_b", "decor_tree_c", "decor_tree_d"] as const;
const STUMP_MODELS = ["decor_stump_a", "decor_stump_b"] as const;
const SCATTER_MODELS: Partial<Record<ScatterKind, readonly string[]>> = {
  tuft: ["decor_tuft_a", "decor_tuft_b"],
  rock: ["decor_rock_a", "decor_rock_b"],
  bush: ["decor_bush_a", "decor_bush_b"],
};

/** The procedural fallback tree variants (model space, y up, about one tile tall). */
export const TREE_VARIANTS: readonly Tri[][] = [
  // Conifer: two stacked cones.
  [...prism(4, 0.05, 0, 0.25, TRUNK), ...cone(6, 0.3, 0.18, 0.72, FOREST.scale(1.05), 0, 0.85), ...cone(6, 0.22, 0.48, 0.98, FOREST.scale(1.12), 0.5, 0.85)],
  // Broadleaf: two rounded crowns.
  [...prism(4, 0.055, 0, 0.32, TRUNK), ...bipyramid(4, 0.3, 0.3, 0.55, 0.85, CROWN, 0.4), ...bipyramid(4, 0.2, 0.5, 0.68, 0.92, GRASS_A.scale(0.82), 1.2)],
  // Poplar: a tall narrow spindle.
  [...prism(4, 0.045, 0, 0.2, TRUNK), ...bipyramid(6, 0.17, 0.15, 0.5, 1.15, FOREST.scale(1.18), 0.3)],
];

const TUFT: Tri[] = [
  { a: [-0.05, 0, 0], b: [0.05, 0, 0], c: [-0.02, 0.17, 0.01], color: GRASS_A.scale(0.9) },
  { a: [0, 0, -0.05], b: [0, 0, 0.05], c: [0.04, 0.13, 0.02], color: c3(TERRAIN.grass_b).scale(0.95) },
  { a: [-0.04, 0, 0.03], b: [0.04, 0, -0.03], c: [0.01, 0.15, -0.04], color: GRASS_A.scale(1.0) },
];
const FLOWER_PETALS = [c3(TERRAIN.flower), c3(WATER.foam), c3(UI.brass_light)];
const flower = (petal: Color3): Tri[] => [
  { a: [-0.02, 0, 0], b: [0.02, 0, 0], c: [0, 0.14, 0], color: GRASS_A.scale(0.75) },
  { a: [0, 0, -0.03], b: [0, 0, 0.03], c: [0.03, 0.1, 0], color: GRASS_A.scale(0.85) },
  { a: [-0.04, 0.13, 0], b: [0.04, 0.13, 0], c: [0, 0.17, 0.03], color: petal },
  { a: [-0.04, 0.13, 0], b: [0.04, 0.13, 0], c: [0, 0.17, -0.03], color: petal.scale(0.9) },
];
const ROCK: Tri[] = (() => {
  const r = c3(TERRAIN.mountain);
  const top: [number, number, number] = [0.01, 0.09, 0.0];
  const p: [number, number, number][] = [
    [-0.09, 0, -0.05],
    [0.08, 0, -0.06],
    [0.06, 0, 0.07],
    [-0.07, 0, 0.06],
  ];
  return p.map((q, i) => ({ a: q, b: p[(i + 1) % 4] as [number, number, number], c: top, color: r.scale(0.92 + 0.06 * i) }));
})();
const BUSH: Tri[] = bipyramid(5, 0.16, 0, 0.12, 0.28, FOREST.scale(1.1), 0.3);

function decorMaterial(scene: Scene, name: string): StandardMaterial {
  const m = skyFill(new StandardMaterial(name, scene));
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}

/** Accumulates copies of indexed model data (moved, scaled, turned, shaded) into one indexed mesh. */
export class ModelMerger {
  private positions = new Float32Array(512 * 3);
  private normals = new Float32Array(512 * 3);
  private colors = new Float32Array(512 * 4);
  private indices = new Uint32Array(1024);
  private nv = 0;
  private ni = 0;

  private grow(vertices: number, indices: number): void {
    const capV = this.positions.length / 3;
    if (this.nv + vertices > capV) {
      const v = Math.max(this.nv + vertices, capV * 2);
      const p = new Float32Array(v * 3);
      p.set(this.positions);
      this.positions = p;
      const n = new Float32Array(v * 3);
      n.set(this.normals);
      this.normals = n;
      const c = new Float32Array(v * 4);
      c.set(this.colors);
      this.colors = c;
    }
    if (this.ni + indices > this.indices.length) {
      const i = new Uint32Array(Math.max(this.ni + indices, this.indices.length * 2));
      i.set(this.indices);
      this.indices = i;
    }
  }

  /** Adds one copy of world-oriented model data at (x, y, z), scaled by s, turned by yaw about y, colours × shade. */
  add(d: ModelData, x: number, y: number, z: number, s: number, yaw: number, shade = 1): void {
    const vc = d.positions.length / 3;
    this.grow(vc, d.indices.length);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const base = this.nv;
    for (let v = 0; v < vc; v++) {
      const px = d.positions[v * 3] as number;
      const py = d.positions[v * 3 + 1] as number;
      const pz = d.positions[v * 3 + 2] as number;
      const nx = d.normals[v * 3] as number;
      const nz = d.normals[v * 3 + 2] as number;
      const o = (base + v) * 3;
      this.positions[o] = x + (px * cos + pz * sin) * s;
      this.positions[o + 1] = y + py * s;
      this.positions[o + 2] = z + (-px * sin + pz * cos) * s;
      this.normals[o] = nx * cos + nz * sin;
      this.normals[o + 1] = d.normals[v * 3 + 1] as number;
      this.normals[o + 2] = -nx * sin + nz * cos;
      const c = (base + v) * 4;
      this.colors[c] = (d.colors[v * 4] as number) * shade;
      this.colors[c + 1] = (d.colors[v * 4 + 1] as number) * shade;
      this.colors[c + 2] = (d.colors[v * 4 + 2] as number) * shade;
      this.colors[c + 3] = 1;
    }
    for (let i = 0; i < d.indices.length; i++) this.indices[this.ni + i] = base + (d.indices[i] as number);
    this.nv += vc;
    this.ni += d.indices.length;
  }

  /** Adds the triangles of a TriBuilder (procedural pieces) as they are. */
  addTris(t: TriBuilder): void {
    const vc = t.positions.length / 3;
    if (vc === 0) return;
    this.grow(vc, vc);
    const base = this.nv;
    this.positions.set(t.positions, base * 3);
    this.normals.set(t.normals, base * 3);
    this.colors.set(t.colors, base * 4);
    for (let i = 0; i < vc; i++) this.indices[this.ni + i] = base + i;
    this.nv += vc;
    this.ni += vc;
  }

  /** Triangles accumulated. */
  triangles(): number {
    return this.ni / 3;
  }

  /** Indices accumulated (the end of the range drawn so far). */
  indexCount(): number {
    return this.ni;
  }

  build(name: string, scene: Scene, material: StandardMaterial, parent: TransformNode | null): Mesh | null {
    if (this.ni === 0) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions.subarray(0, this.nv * 3);
    data.normals = this.normals.subarray(0, this.nv * 3);
    data.colors = this.colors.subarray(0, this.nv * 4);
    data.indices = this.indices.subarray(0, this.ni);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }
}

/** Trees, stumps, their blob shadows and the ground scatter of one island (under its near node). */
export class Decoration {
  private readonly material: StandardMaterial;
  private readonly shadowMaterial: StandardMaterial;
  private trees: Mesh | null = null;
  private shadows: Mesh | null = null;
  private scatter: Mesh | null = null;
  private count = { trees: 0, scatter: 0, stumps: 0, triangles: 0 };
  /** Index counts of the trees and their shadows: kept at far LOD (FAR_TREE_STRIDE) and all. */
  private ranges = { trees: { kept: 0, all: 0 }, shadows: { kept: 0, all: 0 } };
  private thinned = false;
  /** The last build used a fallback for a decor model that has loaded since (or might load): rebuild on the next model refresh. */
  private fallback = false;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    private readonly parent: TransformNode | null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.material = decorMaterial(scene, `decor_${name}`);
    this.shadowMaterial = new StandardMaterial(`tree_shadows_${name}`, scene);
    this.shadowMaterial.diffuseColor = Color3.White();
    this.shadowMaterial.specularColor = Color3.Black();
    this.shadowMaterial.disableLighting = true;
    this.shadowMaterial.backFaceCulling = false;
  }

  /** A decor model by ID (null: not available yet; marks the build as a fallback when the manifest lists it). */
  private model(id: string): ModelData | null {
    const d = decorModel(this.registry, id);
    const entry = this.registry?.decor(id);
    if (!d && entry && !this.registry?.failed(entry.file)) this.fallback = true;
    return d;
  }

  update(
    trees: readonly Placed[],
    ground: readonly (Placed & { kind: ScatterKind })[],
    stumps: readonly Placed[] = [],
    heightAt: (x: number, y: number) => number = () => 0,
    stride = FAR_TREE_STRIDE,
  ): void {
    this.trees?.dispose();
    this.shadows?.dispose();
    this.scatter?.dispose();
    this.fallback = false;
    const t = new ModelMerger();
    const sh = new TriBuilder();
    // The trees kept at far LOD first, then the others.
    const ordered = [...trees.filter((_, i) => i % stride === 0), ...trees.filter((_, i) => i % stride !== 0)];
    const kept = Math.ceil(trees.length / stride);
    let keptTrees = 0;
    let keptShadows = 0;
    for (const [i, p] of ordered.entries()) {
      if (i === kept) {
        keptTrees = t.indexCount();
        keptShadows = sh.positions.length / 3;
      }
      // Slight per-tree tint so a forest is not one flat green.
      const shade = 0.92 + 0.16 * ((p.yaw / (Math.PI * 2)) % 1);
      const m = this.model(TREE_MODELS[p.variant % TREE_MODELS.length] as string);
      if (m) t.add(m, p.x, 0, -p.y, p.scale, p.yaw, shade);
      else {
        // The procedural stand-in, in tree order too (thinning keeps its range).
        const tp = new TriBuilder();
        for (const tri of TREE_VARIANTS[p.variant % TREE_VARIANTS.length] ?? []) tp.add(tri, p.x, 0, -p.y, p.scale, p.yaw, tri.color === TRUNK ? 1 : shade);
        t.addTris(tp);
      }
      blob(sh, p.x + SHADOW_LEAN.x * p.scale * 0.3, -p.y + SHADOW_LEAN.z * p.scale * 0.3, 0.42 * p.scale);
    }
    if (kept >= ordered.length) {
      keptTrees = t.indexCount();
      keptShadows = sh.positions.length / 3;
    }
    for (const p of stumps) {
      const m = this.model(STUMP_MODELS[p.variant % STUMP_MODELS.length] as string);
      if (m) t.add(m, p.x, 0, -p.y, p.scale, p.yaw);
    }
    const g = new ModelMerger();
    const gp = new TriBuilder();
    for (const p of ground) {
      const y = heightAt(Math.floor(p.x), Math.floor(p.y));
      const ids = SCATTER_MODELS[p.kind];
      const m = ids ? this.model(ids[Math.floor(p.scale * 13) % ids.length] as string) : null;
      if (m) {
        g.add(m, p.x, y, -p.y, p.scale, p.yaw, 0.94 + 0.12 * ((p.yaw / (Math.PI * 2)) % 1));
        continue;
      }
      const tris =
        p.kind === "tuft" ? TUFT : p.kind === "flower" ? flower(FLOWER_PETALS[Math.floor(p.scale * 10) % FLOWER_PETALS.length] as Color3) : p.kind === "bush" ? BUSH : ROCK;
      for (const tri of tris) gp.add(tri, p.x, y, -p.y, p.scale, p.yaw);
    }
    g.addTris(gp);
    this.count = { trees: trees.length, scatter: ground.length, stumps: stumps.length, triangles: t.triangles() + g.triangles() };
    this.trees = t.build(`trees_${this.name}`, this.scene, this.material, this.parent);
    this.shadows = sh.build(`tree_shadows_${this.name}`, this.scene, this.shadowMaterial, this.parent, true);
    if (this.shadows) this.shadows.hasVertexAlpha = true;
    this.scatter = g.build(`scatter_${this.name}`, this.scene, this.material, this.parent);
    if (this.trees) this.trees.receiveShadows = false;
    const all = (m: Mesh | null) => m?.getTotalIndices() ?? 0;
    this.ranges = { trees: { kept: keptTrees, all: all(this.trees) }, shadows: { kept: keptShadows, all: all(this.shadows) } };
    this.applyThinning();
  }

  /** Far LOD: draw only the kept trees (and their shadows) — a toggle of the drawn index range. */
  setThinned(on: boolean): void {
    if (on === this.thinned) return;
    this.thinned = on;
    this.applyThinning();
  }

  private applyThinning(): void {
    const set = (m: Mesh | null, r: { kept: number; all: number }) => {
      const sub = m?.subMeshes?.[0];
      if (sub) sub.indexCount = this.thinned ? r.kept : r.all;
    };
    set(this.trees, this.ranges.trees);
    set(this.shadows, this.ranges.shadows);
  }

  /** Trees drawn (index range) of the trees mesh: kept and all (tests). */
  treeRange(): { drawn: number; all: number } {
    return { drawn: this.trees?.subMeshes?.[0]?.indexCount ?? 0, all: this.ranges.trees.all };
  }

  /** Whether the last build stood in for a decor model that may have loaded since (rebuild on the next model refresh). */
  needsModels(): boolean {
    return this.fallback;
  }

  /** Meshes casting into the sun shadow map (the trees). */
  casters(): AbstractMesh[] {
    return this.trees ? [this.trees] : [];
  }

  /** Trees, scatter items and stumps drawn and their triangles (tests and the perf notes). */
  counts(): { trees: number; scatter: number; stumps: number; triangles: number } {
    return this.count;
  }
}

/** A soft round contact shadow (fan of 8 triangles, alpha 0.5 → 0) in island-local world coordinates. */
function blob(b: TriBuilder, x: number, z: number, r: number): void {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    b.raw([x, BLOB_Y, z], [x + Math.cos(a0) * r, BLOB_Y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, BLOB_Y, z + Math.sin(a1) * r], SHADOW, [0.5, 0, 0]);
  }
}
