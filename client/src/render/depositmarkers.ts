// Deposit markers (UI.md §3): while a mine or quarry is the build tool, a
// floating badge with the deposit's icon (the build menu's, theme/iconSet
// resourceIcon) above every free slot of its deposit, centred between the
// slot's two tiles (display/deposits.ts freeDepositSlots), in addition to the tile tint of
// the deposit highlight. Status-badge style: a parchment disc with an ink
// rim and the icon in ink, turned towards the camera like the status icons
// (the facing is baked into the thin-instance matrices). Drawn after the
// scene (rendering group 1) so rock and models never hide it; world
// coordinates; never pickable. One template mesh per deposit kind.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { azimuthOf, ELEVATION } from "../display/camera";
import { resourceIcon } from "../theme/iconSet";
import { ICON_VIEWBOX } from "../theme/icons";
import { UI } from "../theme/palette";
import { setInstances } from "./instances";

/** A marker: the scene's x, z of the point it floats over and the ground under it (tiles). */
export interface DepositMarker {
  cx: number;
  cz: number;
  base: number;
}

const SIZE = 128;
/** Badge size and height above the ground (tiles): readable at the mid view, clear of an outcrop. */
const BADGE = 2.2;
const LIFT = 3;

export class DepositMarkers {
  private readonly templates = new Map<string, Mesh>();
  private facing = Matrix.RotationYawPitchRoll(azimuthOf(0), ELEVATION, 0);
  private rotation = 0;
  private last: { kind: string | null; marks: readonly DepositMarker[] } = { kind: null, marks: [] };

  constructor(private readonly scene: Scene) {}

  private template(kind: string): Mesh {
    let mesh = this.templates.get(kind);
    if (mesh) return mesh;
    const tex = new DynamicTexture(`deposit_marker_${kind}`, { width: SIZE, height: SIZE }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const r = SIZE / 2 - 6;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = UI.parchment_light;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();
    ctx.fillStyle = UI.ink;
    const path = resourceIcon("deposit", kind);
    if (typeof Path2D !== "undefined" && path) {
      const k = (SIZE * 0.6) / ICON_VIEWBOX;
      ctx.save();
      ctx.translate(SIZE / 2 - (ICON_VIEWBOX * k) / 2, SIZE / 2 - (ICON_VIEWBOX * k) / 2);
      ctx.scale(k, k);
      ctx.fill(new Path2D(path));
      ctx.restore();
    }
    tex.update();
    const mat = new StandardMaterial(`deposit_marker_${kind}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = Color3.White();
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mesh = CreatePlane(`deposit_marker_${kind}`, { size: BADGE }, this.scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    setInstances(mesh, null);
    this.templates.set(kind, mesh);
    return mesh;
  }

  /** Camera rotation (quarter turns, continuous): the badges face the camera again. */
  setRotation(step: number): void {
    if (step === this.rotation) return;
    this.rotation = step;
    this.facing = Matrix.RotationYawPitchRoll(azimuthOf(step), ELEVATION, 0);
    this.set(this.last.kind, this.last.marks);
  }

  /** Draws the markers of one deposit kind (replacing the previous ones; null or empty clears). */
  set(kind: string | null, marks: readonly DepositMarker[]): void {
    this.last = { kind, marks };
    for (const [k, mesh] of this.templates) if (k !== kind || marks.length === 0) setInstances(mesh, null);
    if (!kind || marks.length === 0) return;
    const out = new Float32Array(marks.length * 16);
    marks.forEach((m, i) => out.set(this.facing.multiply(Matrix.Translation(m.cx, m.base + LIFT, m.cz)).asArray(), i * 16));
    setInstances(this.template(kind), out);
  }

  /** How many markers are drawn (tests and shots). */
  shown(): number {
    return this.last.kind ? this.last.marks.length : 0;
  }
}
