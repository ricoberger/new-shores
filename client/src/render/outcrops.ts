// Deposit outcrops (ART_DIRECTION §4, restyle): a voxel rock cluster
// (the decor_outcrop_<kind> model, tinted per deposit kind in the asset
// build) on every deposit tile of an island, standing on the plateau the
// tile belongs to; until the model has loaded (or without one) a
// procedural low-poly cluster in mountain grey tinted per kind. One
// template mesh per kind with thin instances; turned and scaled per tile
// from the island seed. Shown at near and mid LOD.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { hash2 } from "../display/noise";
import { BUILDINGS, TERRAIN } from "../theme/palette";
import { setInstances } from "./instances";
import { decorModel, modelMesh, type ModelRegistry } from "./models";
import { c3 } from "./palette";
import { addJitter, MODEL_VPT } from "./jitter";
import { skyFill } from "./lighting";

/** Tint of each known deposit kind (mixed into the mountain grey). */
const KIND_TINTS: Readonly<Record<string, string>> = { stone: BUILDINGS.stone, iron: TERRAIN.deposit_iron };

/** Outcrop colour of a deposit kind. */
export function outcropColor(kind: string): Color3 {
  const tint = KIND_TINTS[kind];
  return tint ? Color3.Lerp(c3(TERRAIN.mountain), c3(tint), 0.7) : c3(TERRAIN.mountain);
}

/** The rock cluster of unit size, sitting on y = 0. */
function template(scene: Scene, kind: string): Mesh {
  const a = CreateIcoSphere(`outcrop_${kind}_a`, { radius: 0.32, subdivisions: 1, flat: true }, scene);
  a.scaling.set(1.1, 0.75, 0.95);
  a.position.set(-0.08, 0.16, 0.04);
  const b = CreateIcoSphere(`outcrop_${kind}_b`, { radius: 0.22, subdivisions: 1, flat: true }, scene);
  b.scaling.set(0.9, 0.8, 1.15);
  b.position.set(0.2, 0.1, -0.14);
  const c = CreatePolyhedron(`outcrop_${kind}_c`, { type: 1, size: 0.14 }, scene);
  c.position.set(0.14, 0.07, 0.22);
  const m = Mesh.MergeMeshes([a, b, c], true, true);
  if (!m) throw new Error(`cannot build outcrop ${kind}`);
  m.name = `outcrop_${kind}`;
  const mat = skyFill(new StandardMaterial(`outcrop_${kind}`, scene));
  mat.diffuseColor = outcropColor(kind);
  mat.specularColor = Color3.Black();
  m.material = mat;
  m.isPickable = false;
  return m;
}

export class OutcropLayer {
  /** Template per kind and whether it is the voxel model (false: the procedural fallback). */
  private readonly templates = new Map<string, { mesh: Mesh; model: boolean }>();
  private readonly material: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.material = addJitter(skyFill(new StandardMaterial("outcrops", scene)), MODEL_VPT);
    this.material.specularColor = Color3.Black();
  }

  private template(kind: string): Mesh {
    const data = decorModel(this.registry, `decor_outcrop_${kind}`);
    const cur = this.templates.get(kind);
    if (cur && (cur.model || !data)) return cur.mesh;
    cur?.mesh.dispose();
    const mesh = data ? modelMesh(this.scene, `outcrop_${kind}`, data, this.material) : template(this.scene, kind);
    mesh.parent = this.parent;
    this.templates.set(kind, { mesh, model: !!data });
    return mesh;
  }

  /**
   * Rock clusters on the deposit tiles, except inside a building footprint
   * (`blocked` tile keys "x,y": mines and quarries are not pierced), at the
   * ground height of their tile (plateaus).
   */
  update(
    deposits: readonly { x: number; y: number; kind: string }[],
    seed: number,
    blocked: ReadonlySet<string> = new Set(),
    heightAt: (x: number, y: number) => number = () => 0,
  ): void {
    const byKind = new Map<string, number[]>();
    for (const d of deposits) {
      if (blocked.has(`${d.x},${d.y}`)) continue;
      const kind = KIND_TINTS[d.kind] ? d.kind : "other";
      let arr = byKind.get(kind);
      if (!arr) byKind.set(kind, (arr = []));
      const yaw = hash2(d.x, d.y, seed) * Math.PI * 2;
      const s = 0.85 + 0.3 * hash2(d.y, d.x, seed + 1);
      const m = Matrix.Scaling(s, s, s)
        .multiply(Matrix.RotationY(yaw))
        .multiply(Matrix.Translation(d.x + 0.5, heightAt(d.x, d.y), -(d.y + 0.5)));
      for (const v of m.asArray()) arr.push(v);
    }
    for (const [kind, t] of this.templates) if (!byKind.has(kind)) setInstances(t.mesh, null);
    for (const [kind, arr] of byKind) setInstances(this.template(kind), new Float32Array(arr));
  }
}
