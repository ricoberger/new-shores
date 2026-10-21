// Trees and ground scatter (ART_DIRECTION §4) of one island at near LOD:
// three procedural low-poly tree variants (≤ 24 triangles each: a timber
// trunk and crowns in forest-floor / tree-crown / grass shades) on the
// forest tiles, a soft blob shadow under each, and tufts, flowers and
// small rocks (≤ 4 triangles each) on free grass and coast — placed by
// display/scatter.ts from the island seed. Each layer is one merged
// static mesh (see meshdata.ts), rebuilt with the payload. Decoration is
// never pickable and holds no state.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Placed, ScatterKind } from "../display/scatter";
import { BUILDINGS, TERRAIN, UI, WATER } from "../theme/palette";
import { SHADOW_LEAN, skyFill } from "./lighting";
import { bipyramid, cone, prism, type Tri, TriBuilder } from "./meshdata";
import { c3, SHADOW } from "./palette";
import { BLOB_Y } from "./shadows";

const TRUNK = c3(BUILDINGS.timber);
const FOREST = c3(TERRAIN.forest_floor);
const CROWN = c3(TERRAIN.tree_crown);
const GRASS_A = c3(TERRAIN.grass_a);

/** The tree variants (model space, y up, about one tile tall). */
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

function decorMaterial(scene: Scene, name: string): StandardMaterial {
  const m = skyFill(new StandardMaterial(name, scene));
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}

/** Trees, their blob shadows and the ground scatter of one island (under its near node). */
export class Decoration {
  private readonly material: StandardMaterial;
  private readonly shadowMaterial: StandardMaterial;
  private trees: Mesh | null = null;
  private shadows: Mesh | null = null;
  private scatter: Mesh | null = null;
  private count = { trees: 0, scatter: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
    private readonly parent: TransformNode | null,
  ) {
    this.material = decorMaterial(scene, `decor_${name}`);
    this.shadowMaterial = new StandardMaterial(`tree_shadows_${name}`, scene);
    this.shadowMaterial.diffuseColor = Color3.White();
    this.shadowMaterial.specularColor = Color3.Black();
    this.shadowMaterial.disableLighting = true;
    this.shadowMaterial.backFaceCulling = false;
  }

  update(trees: readonly Placed[], ground: readonly (Placed & { kind: ScatterKind })[]): void {
    this.trees?.dispose();
    this.shadows?.dispose();
    this.scatter?.dispose();
    const t = new TriBuilder();
    const sh = new TriBuilder();
    for (const p of trees) {
      const tris = TREE_VARIANTS[p.variant] ?? TREE_VARIANTS[0] ?? [];
      // Slight per-tree tint so a forest is not one flat green.
      const shade = 0.92 + 0.16 * ((p.yaw / (Math.PI * 2)) % 1);
      for (const tri of tris) t.add(tri, p.x, 0, -p.y, p.scale, p.yaw, tri.color === TRUNK ? 1 : shade);
      blob(sh, p.x + SHADOW_LEAN.x * p.scale * 0.3, -p.y + SHADOW_LEAN.z * p.scale * 0.3, 0.34 * p.scale);
    }
    const g = new TriBuilder();
    for (const p of ground) {
      const tris = p.kind === "tuft" ? TUFT : p.kind === "flower" ? flower(FLOWER_PETALS[Math.floor(p.scale * 10) % FLOWER_PETALS.length] as Color3) : ROCK;
      for (const tri of tris) g.add(tri, p.x, 0, -p.y, p.scale, p.yaw);
    }
    this.count = { trees: trees.length, scatter: ground.length };
    this.trees = t.build(`trees_${this.name}`, this.scene, this.material, this.parent);
    this.shadows = sh.build(`tree_shadows_${this.name}`, this.scene, this.shadowMaterial, this.parent, true);
    if (this.shadows) this.shadows.hasVertexAlpha = true;
    this.scatter = g.build(`scatter_${this.name}`, this.scene, this.material, this.parent);
    if (this.trees) this.trees.receiveShadows = false;
  }

  /** Meshes casting into the sun shadow map (the trees). */
  casters(): AbstractMesh[] {
    return this.trees ? [this.trees] : [];
  }

  /** Trees and scatter items drawn (tests and the perf notes). */
  counts(): { trees: number; scatter: number } {
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
