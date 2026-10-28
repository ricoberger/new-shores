// Voxel art-style prototype switch (?voxel=1; .experiment/voxel/NOTES.md):
// models from /models-voxel/ (assets/voxel), stepped voxel terrain and
// voxel decor placement. Additive: with the flag off nothing changes.
// Render data only.

/** Whether the URL asks for the voxel prototype (?voxel=1). */
export function voxelEnabled(search: string): boolean {
  return new URLSearchParams(search).get("voxel") === "1";
}

/** The flag of this page load (false outside a browser). */
export const VOXEL: boolean = voxelEnabled(typeof location === "undefined" ? "" : location.search);

/** URL prefix of the model files and thumbnails of a mode. */
export function modelBase(voxel: boolean): string {
  return voxel ? "/models-voxel/" : "/models/";
}
