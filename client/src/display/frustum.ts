// Island culling of the continuous world (D-048): an island is rendered
// only when its rectangle intersects the camera's ground footprint (a
// parallelogram that turns with the rotation). Pure geometry: separating
// axis test of two convex polygons in archipelago tiles.
import type { Rect } from "./camera";
import type { ArchPoint } from "./ships";

function project(points: readonly ArchPoint[], ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Whether the rectangle and the convex quadrilateral (corners in order) overlap (touching counts). */
export function rectIntersectsQuad(r: Rect, quad: readonly ArchPoint[]): boolean {
  if (quad.length === 0) return false;
  // Axes of the rectangle.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of quad) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (maxX < r.minX || minX > r.maxX || maxY < r.minY || minY > r.maxY) return false;
  // Edge normals of the quadrilateral.
  const corners: ArchPoint[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i] as ArchPoint;
    const b = quad[(i + 1) % quad.length] as ArchPoint;
    const ax = -(b.y - a.y);
    const ay = b.x - a.x;
    if (ax === 0 && ay === 0) continue;
    const [q0, q1] = project(quad, ax, ay);
    const [r0, r1] = project(corners, ax, ay);
    if (q1 < r0 || r1 < q0) return false;
  }
  return true;
}

/** An island's rectangle in archipelago tiles. */
export function islandRect(is: { position: { x: number; y: number }; width: number; height: number }): Rect {
  return { minX: is.position.x, minY: is.position.y, maxX: is.position.x + is.width, maxY: is.position.y + is.height };
}

/** IDs of the islands whose rectangle intersects the footprint, in payload order. */
export function visibleIslands(
  islands: readonly { id: string; position: { x: number; y: number }; width: number; height: number }[],
  footprint: readonly ArchPoint[],
): string[] {
  return islands.filter((is) => rectIntersectsQuad(islandRect(is), footprint)).map((is) => is.id);
}

/**
 * The focused island (UI only, no game rule): the island whose rectangle
 * plus a 1-tile margin contains the point (the camera target; the first
 * such island in payload order), else the island whose centre is nearest.
 * "" without islands.
 */
export function focusedIsland(
  islands: readonly { id: string; position: { x: number; y: number }; width: number; height: number }[],
  p: ArchPoint,
): string {
  let best = "";
  let bestD = Infinity;
  for (const is of islands) {
    const r = islandRect(is);
    if (p.x >= r.minX - 1 && p.x <= r.maxX + 1 && p.y >= r.minY - 1 && p.y <= r.maxY + 1) return is.id;
    const d = Math.hypot(p.x - (r.minX + r.maxX) / 2, p.y - (r.minY + r.maxY) / 2);
    if (d < bestD) {
      bestD = d;
      best = is.id;
    }
  }
  return best;
}
