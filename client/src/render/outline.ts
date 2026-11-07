// The thin footprint outline of plans (render/plans.ts) and of the placing
// ghost (render/ghost.ts): flat bands along the inside of a tile
// rectangle, a little above the ground, drawn as one unlit mesh.
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

/** Outline band width, its inset from the footprint edge and its height above the ground (tiles). */
export const OUTLINE_WIDTH = 0.14;
export const OUTLINE_INSET = 0.03;
export const OUTLINE_Y = 0.06;

/** An outline edge piece: a band along one side of a tile rectangle, in scene x/z at height y. */
export interface OutlineBand {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

/**
 * The bands outlining a rectangle of tiles (scene coordinates: x = tile x,
 * z = −tile y), inset so that the band lies inside the footprint.
 */
export function rectOutline(x: number, y: number, w: number, h: number, ground: number): OutlineBand[] {
  const i = OUTLINE_INSET;
  const d = OUTLINE_WIDTH;
  const yy = ground + OUTLINE_Y;
  const [l, r, t, b] = [x + i, x + w - i, -(y + i), -(y + h - i)];
  return [
    { x0: l, z0: t, x1: r, z1: t - d, y: yy },
    { x0: l, z0: b + d, x1: r, z1: b, y: yy },
    { x0: l, z0: t, x1: l + d, z1: b, y: yy },
    { x0: r - d, z0: t, x1: r, z1: b, y: yy },
  ];
}

/** Flat quads (two triangles each, both windings) of axis-aligned rectangles: x0 < x1, z0 > z1. */
export function outlineQuads(rects: readonly OutlineBand[]): VertexData | null {
  if (rects.length === 0) return null;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const q of rects) {
    const at = positions.length / 3;
    positions.push(q.x0, q.y, q.z0, q.x1, q.y, q.z0, q.x1, q.y, q.z1, q.x0, q.y, q.z1);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3, at, at + 2, at + 1, at, at + 3, at + 2);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  return vd;
}
