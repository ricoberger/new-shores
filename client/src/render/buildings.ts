// Buildings: one procedural low-poly template mesh per content ID, drawn
// with thin instances sized to the rotated footprint, a door marker in the
// middle of the front edge (purely visual; rotation has no gameplay effect,
// D-042) and a selection frame.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { footprintBox } from "./coords";
import { setInstances } from "./instances";
import { buildingColor, DOOR, ROOF, SELECTION } from "./palette";

function faces(c: Color4, n: number): Color4[] {
  return Array.from({ length: n }, () => c);
}

/** Builds the unit-footprint template of a building (scaled per instance). */
function template(scene: Scene, def: ContentBuilding): Mesh {
  const body = buildingColor(def.id);
  const parts: Mesh[] = [];
  const box = (w: number, h: number, d: number, y: number, c: Color4, x = 0, z = 0) => {
    const m = CreateBox(`${def.id}_part`, { width: w, height: h, depth: d, faceColors: faces(c, 6) }, scene);
    m.position.set(x, y, z);
    parts.push(m);
  };
  const cyl = (top: number, bottom: number, h: number, tess: number, y: number, c: Color4, x = 0, z = 0) => {
    const m = CreateCylinder(
      `${def.id}_part`,
      { diameterTop: top, diameterBottom: bottom, height: h, tessellation: tess, faceColors: faces(c, 3) },
      scene,
    );
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  switch (def.category) {
    case "houses": {
      box(0.8, 0.45, 0.8, 0.225, body);
      const roof = cyl(0, 0.95, 0.8, 4, 0.65, ROOF);
      roof.rotation.y = Math.PI / 4;
      break;
    }
    case "production":
      box(0.85, 0.4, 0.85, 0.2, body);
      cyl(0.12, 0.15, 0.5, 6, 0.55, ROOF, 0.25, 0.25);
      break;
    case "public":
      box(0.85, 0.35, 0.85, 0.175, body);
      cyl(0, 0.5, 0.7, 6, 0.7, ROOF);
      break;
    case "harbour":
      box(0.92, 0.5, 0.92, 0.25, body);
      box(0.95, 0.06, 0.95, 0.53, ROOF);
      break;
    default:
      box(0.8, 0.4, 0.8, 0.2, body);
  }
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`cannot build mesh for ${def.id}`);
  merged.name = `building_${def.id}`;
  merged.isPickable = false;
  return merged;
}

export class BuildingLayer {
  private readonly templates = new Map<string, Mesh>();
  private readonly material: StandardMaterial;
  private readonly doors: Mesh;
  private readonly selection: Mesh;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
  ) {
    this.material = new StandardMaterial("buildings", scene);
    this.material.specularColor = Color3.Black();
    this.doors = CreateBox("doors", { width: 0.35, height: 0.3, depth: 0.12 }, scene);
    const doorMat = new StandardMaterial("doors", scene);
    doorMat.diffuseColor = DOOR;
    doorMat.specularColor = Color3.Black();
    this.doors.material = doorMat;
    this.doors.isPickable = false;
    this.doors.parent = parent;
    setInstances(this.doors, null);
    this.selection = CreateBox("selection", { size: 1 }, scene);
    const selMat = new StandardMaterial("selection", scene);
    selMat.emissiveColor = SELECTION;
    selMat.disableLighting = true;
    selMat.wireframe = true;
    this.selection.material = selMat;
    this.selection.isPickable = false;
    this.selection.parent = parent;
    this.selection.setEnabled(false);
  }

  update(buildings: BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    const byType = new Map<string, number[]>();
    const doors: number[] = [];
    for (const b of buildings) {
      const def = defs.get(b.type);
      if (!def || def.category === "roads") continue;
      const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const m = Matrix.Scaling(w, 1, h).multiply(Matrix.Translation(cx, 0, cz));
      let arr = byType.get(b.type);
      if (!arr) byType.set(b.type, (arr = []));
      for (const v of m.asArray()) arr.push(v);
      // Door: in the middle of the front edge of the footprint.
      const [dx, dz, rot] = frontOffset(b.rotation);
      const ex = cx + dx * (w / 2 - 0.05);
      const ez = cz + dz * (h / 2 - 0.05);
      const dm = Matrix.RotationY(rot).multiply(Matrix.Translation(ex, 0.15, ez));
      for (const v of dm.asArray()) doors.push(v);
    }
    for (const [id, mesh] of this.templates) {
      if (!byType.has(id)) setInstances(mesh, null);
    }
    for (const [id, arr] of byType) {
      let mesh = this.templates.get(id);
      if (!mesh) {
        const def = defs.get(id);
        if (!def) continue;
        mesh = template(this.scene, def);
        mesh.material = this.material;
        mesh.parent = this.parent;
        this.templates.set(id, mesh);
      }
      setInstances(mesh, new Float32Array(arr));
    }
    setInstances(this.doors, doors.length ? new Float32Array(doors) : null);
  }

  select(b: BuildingDisplay | undefined, def: ContentBuilding | undefined): void {
    if (!b || !def) {
      this.selection.setEnabled(false);
      return;
    }
    const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
    this.selection.scaling.set(w + 0.1, 1.1, h + 0.1);
    this.selection.position.set(cx, 0.5, cz);
    this.selection.setEnabled(true);
  }
}

/** Unit direction (world x, z) of a building's front and the door rotation. */
function frontOffset(rotation: number): [number, number, number] {
  switch (rotation) {
    case 90:
      return [-1, 0, Math.PI / 2];
    case 180:
      return [0, 1, 0];
    case 270:
      return [1, 0, Math.PI / 2];
    default:
      return [0, -1, 0];
  }
}
