// The deposit highlight (UI.md §3): while a mine or quarry is the build
// tool, a flat translucent tile in the selection yellow on every tile of
// its deposit kind on the islands drawn in detail, lying on the tile's
// rock where the outcrop stands (display/deposits.ts picks the tiles).
// The outcrop and the rock around it would hide a flat tile, so the
// highlight is drawn after the scene (rendering group 1, depth cleared):
// always visible, like the HUD. One mesh with thin instances, world
// coordinates; nothing here is pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { setInstances } from "./instances";
import { previewOffset, skyFill } from "./lighting";
import { SELECTION } from "./palette";

/** A highlighted tile: the scene's x, z of its centre and the ground under it (tiles). */
export interface DepositMark {
  cx: number;
  cz: number;
  base: number;
}

/** Lift above the rock (tiles) and the gap left between neighbouring tiles. */
const LIFT = 0.06;
const INSET = 0.04;

export class DepositHighlight {
  private readonly mesh: Mesh;
  private count = 0;

  constructor(scene: Scene) {
    this.mesh = CreateBox("deposit_highlight", { width: 1, height: 0.04, depth: 1 }, scene);
    const mat = previewOffset(skyFill(new StandardMaterial("deposit_highlight", scene)));
    mat.diffuseColor = SELECTION;
    mat.emissiveColor = SELECTION.scale(0.8);
    mat.specularColor = Color3.Black();
    mat.alpha = 0.75;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    setInstances(this.mesh, null);
  }

  /** Draws the marks (replacing the previous ones; empty clears). */
  set(marks: readonly DepositMark[]): void {
    this.count = marks.length;
    if (marks.length === 0) {
      setInstances(this.mesh, null);
      return;
    }
    const out = new Float32Array(marks.length * 16);
    const scale = Matrix.Scaling(1 - INSET, 1, 1 - INSET);
    marks.forEach((m, i) => out.set(scale.multiply(Matrix.Translation(m.cx, m.base + LIFT, m.cz)).asArray(), i * 16));
    setInstances(this.mesh, out);
  }

  /** How many tiles are highlighted. */
  shown(): number {
    return this.count;
  }
}
