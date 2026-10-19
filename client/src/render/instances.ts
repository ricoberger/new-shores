import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Sets the thin-instance matrices of a mesh. A mesh without thin instances
 * would render once at its own position, so it is hidden instead.
 */
export function setInstances(mesh: Mesh, matrices: Float32Array | null): void {
  if (!matrices || matrices.length === 0) {
    mesh.isVisible = false;
    mesh.thinInstanceSetBuffer("matrix", null, 16);
    return;
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
  mesh.isVisible = true;
}
