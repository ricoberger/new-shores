// Grid overlay (ART_DIRECTION §4): subtle tile lines in a disc of
// GRID_RADIUS tiles around the pointer, fading out with the distance, only
// while a placement tool is active (display/grid.ts). One static mesh with
// vertex alpha, moved to the tile corner nearest the pointer; tile lines
// lie on integer archipelago coordinates, which are island tile edges of
// every island (island positions are whole tiles). Never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { GRID_RADIUS, gridFade } from "../display/grid";
import type { ArchPoint } from "../display/ships";
import { UI } from "../theme/palette";
import { c3 } from "./palette";

const LINE = 0.035;
const GRID_Y = 0.045;
const OPACITY = 0.55;

export class GridOverlay {
  private readonly mesh: Mesh;
  private shown = false;

  constructor(scene: Scene) {
    const R = GRID_RADIUS;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const quad = (x0: number, z0: number, x1: number, z1: number, a0: number, a1: number, alongX: boolean) => {
      const v = positions.length / 3;
      const h = LINE / 2;
      if (alongX) positions.push(x0, 0, z0 - h, x1, 0, z1 - h, x1, 0, z1 + h, x0, 0, z0 + h);
      else positions.push(x0 - h, 0, z0, x1 - h, 0, z1, x1 + h, 0, z1, x0 + h, 0, z0);
      for (const a of [a0, a1, a1, a0]) colors.push(1, 1, 1, a * OPACITY);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j < R; j++) {
        // Line x = i from z = j to j + 1, and line z = i from x = j to j + 1.
        quad(i, j, i, j + 1, gridFade(Math.hypot(i, j)), gridFade(Math.hypot(i, j + 1)), false);
        quad(j, i, j + 1, i, gridFade(Math.hypot(j, i)), gridFade(Math.hypot(j + 1, i)), true);
      }
    }
    this.mesh = new Mesh("grid_overlay", scene);
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.indices = indices;
    data.normals = positions.map((_, n) => (n % 3 === 1 ? 1 : 0));
    data.applyToMesh(this.mesh);
    this.mesh.hasVertexAlpha = true;
    const mat = new StandardMaterial("grid_overlay", scene);
    mat.disableLighting = true;
    mat.emissiveColor = c3(UI.grid);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.setEnabled(false);
  }

  /** Shows the grid around an archipelago point (null: hidden). */
  set(at: ArchPoint | null): void {
    this.shown = at !== null;
    this.mesh.setEnabled(this.shown);
    if (at) this.mesh.position.set(Math.round(at.x), GRID_Y, -Math.round(at.y));
  }

  visible(): boolean {
    return this.shown;
  }
}
