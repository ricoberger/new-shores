// Mesh-first picking (UI.md §3 Selection): a tap picks the building whose
// model the view ray meets first, not the one whose footprint lies under
// the ray's ground point — at the isometric camera the ground point of a
// roof is a tile or two behind its house. The models are merged per chunk
// (render/buildings.ts), so the pick uses each building's model bounds
// (the shadow blobs' and the selection frame's box, render/models.ts
// placement): one axis-aligned box per building, the nearest hit wins.
// Pure geometry on plain numbers; the renderer supplies the ray and boxes.

/** A view ray: origin and direction (world coordinates; the direction need not be unit length). */
export interface Ray {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
}

/** An axis-aligned box (world coordinates) of a pickable thing. */
export interface PickBox<T> {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  item: T;
}

/** Ray parameter where the ray enters a box (slab test; `pad` grows the box on every side), or null when it misses. */
export function rayBox(ray: Ray, min: PickBox<unknown>["min"], max: PickBox<unknown>["max"], pad = 0): number | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const a of ["x", "y", "z"] as const) {
    const o = ray.origin[a];
    const d = ray.dir[a];
    const lo = min[a] - pad;
    const hi = max[a] + pad;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t1 < 0 ? null : Math.max(t0, 0);
}

/** The box the ray meets first (smallest entry parameter; ties: the earlier box), or undefined. `pad`: a touch's tolerance (tiles). */
export function pickNearest<T>(ray: Ray, boxes: Iterable<PickBox<T>>, pad = 0): T | undefined {
  let best: T | undefined;
  let bestT = Infinity;
  for (const b of boxes) {
    const t = rayBox(ray, b.min, b.max, pad);
    if (t !== null && t < bestT) {
      bestT = t;
      best = b.item;
    }
  }
  return best;
}
