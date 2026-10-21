// Status icons: a billboard above every building whose status is not ok,
// with both a colour and a glyph (UI.md §7). Unpaid and player pauses use
// distinct glyphs.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { STATUS_STYLES, type StatusKey, statusKey } from "../display/status";
import { footprintBox } from "./coords";

const SIZE = 128;

export class IconLayer {
  private readonly templates = new Map<StatusKey, Mesh>();
  private icons: Mesh[] = [];

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
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    this.templates.set(key, mesh);
    return mesh;
  }

  update(buildings: BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    for (const m of this.icons) m.dispose(false, false);
    this.icons = [];
    for (const b of buildings) {
      if (b.status === "ok") continue;
      const def = defs.get(b.type);
      if (!def) continue;
      const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const icon = this.template(statusKey(b)).clone(`icon_${b.id}`, this.parent);
      icon.position.set(cx, 1.6, cz);
      icon.setEnabled(true);
      this.icons.push(icon);
    }
  }
}
