// Voxel art-style prototype switch (?voxel=1; .experiment/voxel/NOTES.md):
// stepped voxel terrain and voxel decor placement. The models (/models/)
// are the voxel build's in both modes (D-057 V1). Render data only.

/** Whether the URL asks for the voxel prototype (?voxel=1). */
export function voxelEnabled(search: string): boolean {
  return new URLSearchParams(search).get("voxel") === "1";
}

/** The flag of this page load (false outside a browser). */
export const VOXEL: boolean = voxelEnabled(typeof location === "undefined" ? "" : location.search);
