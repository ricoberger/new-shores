// Status icons: a camera-facing quad above every building whose status is
// not ok, with both a colour and a glyph (UI.md §7). Unpaid and player
// pauses use distinct glyphs. One mesh per status and island with thin
// instances (one draw call per status, not per building); the camera turns
// only in 90° steps, so the facing rotation of the current step is baked
// into the instance matrices (re-baked on a rotation) instead of a
// per-mesh billboard.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { STATUS_STYLES, type StatusKey, statusKey } from "../display/status";
import { azimuthOf, ELEVATION } from "../display/camera";
import { footprintBox } from "./coords";
import { setInstances } from "./instances";

const SIZE = 128;
const ICON_Y = 1.6;

export class IconLayer {
  private readonly templates = new Map<StatusKey, Mesh>();
  /** Rotation that turns the quad towards the camera. */
  private facing = Matrix.RotationYawPitchRoll(azimuthOf(0), ELEVATION, 0);
  private rotation = 0;
  private last: { buildings: BuildingDisplay[]; defs: ReadonlyMap<string, ContentBuilding> } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
  ) {}

  private template(key: StatusKey): Mesh {
    let mesh = this.templates.get(key);
    if (mesh) return mesh;
    const style = STATUS_STYLES[key];
    const tex = new DynamicTexture(`icon_${key}`, { width: SIZE, height: SIZE }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 6, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#1b1b1b";
    ctx.stroke();
    ctx.fillStyle = "#111111";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.glyph, SIZE / 2, SIZE / 2 + 4);
    tex.update();
    const mat = new StandardMaterial(`icon_${key}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mesh = CreatePlane(`icon_${key}`, { size: 0.9 }, this.scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.parent = this.parent;
    setInstances(mesh, null);
    this.templates.set(key, mesh);
    return mesh;
  }

  /** Camera rotation step: the icons are turned towards the camera again. */
  setRotation(step: number): void {
    if (step === this.rotation) return;
    this.rotation = step;
    this.facing = Matrix.RotationYawPitchRoll(azimuthOf(step), ELEVATION, 0);
    if (this.last) this.update(this.last.buildings, this.last.defs);
  }

  update(buildings: BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    this.last = { buildings, defs };
    const byKey = new Map<StatusKey, number[]>();
    for (const b of buildings) {
      if (b.status === "ok") continue;
      const def = defs.get(b.type);
      if (!def) continue;
      const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const key = statusKey(b);
      let arr = byKey.get(key);
      if (!arr) byKey.set(key, (arr = []));
      for (const v of this.facing.multiply(Matrix.Translation(cx, ICON_Y, cz)).asArray()) arr.push(v);
    }
    for (const [key, mesh] of this.templates) if (!byKey.has(key)) setInstances(mesh, null);
    for (const [key, arr] of byKey) setInstances(this.template(key), new Float32Array(arr));
  }
}
