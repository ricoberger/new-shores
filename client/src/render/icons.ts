// Status icons: a camera-facing quad above every building whose status is
// not ok, with both a colour and the status icon of the HUD set drawn into
// the texture (UI.md §7; the text glyph when Path2D is unavailable).
// Unpaid and player pauses use distinct icons. One mesh per status and island with thin
// instances (one draw call per status, not per building); the facing
// rotation of the camera's azimuth is baked into the instance matrices
// (re-baked whenever the camera turns, also during a free turn: a few
// hundred matrices at most) instead of a per-mesh billboard.
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
import { statusIcon } from "../theme/iconSet";
import { ICON_VIEWBOX } from "../theme/icons";
import { UI } from "../theme/palette";
import { footprintBox } from "./coords";
import { setInstances } from "./instances";

const SIZE = 128;
const ICON_Y = 1.6;

export class IconLayer {
  private readonly templates = new Map<StatusKey, Mesh>();
  /** Rotation that turns the quad towards the camera. */
  private facing = Matrix.RotationYawPitchRoll(azimuthOf(0), ELEVATION, 0);
  private rotation = 0;
  private last: { buildings: readonly BuildingDisplay[]; defs: ReadonlyMap<string, ContentBuilding>; heightOf?: (b: BuildingDisplay) => number } | null = null;

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
    // The HUD's wax seal (InfoPanel StatusIcon, .seal): the status colour,
    // a pressed light inner ring, a darker lower half and an ink rim, with
    // the same icon at the same share of the disc.
    const r = SIZE / 2 - 6;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // The seal's lower shade: ink bands deepening towards the bottom (up to
    // about 30 %; stacked rects rather than a gradient, which not every
    // 2D context the engine runs with supports).
    ctx.fillStyle = UI.ink;
    ctx.globalAlpha = 0.085;
    for (let i = 0; i < 4; i++) ctx.fillRect(0, SIZE * (0.6 + i * 0.09), SIZE, SIZE);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r - 9, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = UI.parchment_light;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();
    ctx.fillStyle = UI.ink;
    const path = statusIcon(key);
    if (typeof Path2D !== "undefined" && path) {
      // The icon (512 units) scaled into the disc.
      const k = (SIZE * 0.55) / ICON_VIEWBOX;
      ctx.save();
      ctx.translate(SIZE / 2 - (ICON_VIEWBOX * k) / 2, SIZE / 2 - (ICON_VIEWBOX * k) / 2);
      ctx.scale(k, k);
      ctx.fill(new Path2D(path));
      ctx.restore();
    } else {
      ctx.font = "bold 64px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(style.glyph, SIZE / 2, SIZE / 2 + 4);
    }
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

  /** Camera rotation (quarter turns, continuous): the icons are turned towards the camera again. */
  setRotation(step: number): void {
    if (step === this.rotation) return;
    this.rotation = step;
    this.facing = Matrix.RotationYawPitchRoll(azimuthOf(step), ELEVATION, 0);
    if (this.last) this.update(this.last.buildings, this.last.defs, this.last.heightOf);
  }

  /** Icons above every building whose status is not ok, at heightOf (the model's status anchor) or ICON_Y. */
  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>, heightOf?: (b: BuildingDisplay) => number): void {
    this.last = { buildings, defs, heightOf };
    const byKey = new Map<StatusKey, number[]>();
    for (const b of buildings) {
      if (b.status === "ok") continue;
      const def = defs.get(b.type);
      if (!def) continue;
      const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const key = statusKey(b);
      let arr = byKey.get(key);
      if (!arr) byKey.set(key, (arr = []));
      for (const v of this.facing.multiply(Matrix.Translation(cx, heightOf?.(b) ?? ICON_Y, cz)).asArray()) arr.push(v);
    }
    for (const [key, mesh] of this.templates) if (!byKey.has(key)) setInstances(mesh, null);
    for (const [key, arr] of byKey) setInstances(this.template(key), new Float32Array(arr));
  }
}
