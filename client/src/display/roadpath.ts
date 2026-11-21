// Visual road paths (moved from render/carts.ts): the shortest path over
// road tiles between the road tiles next to two footprints, found by BFS
// for drawing only (carts, walkers, strollers). No gameplay number is
// derived from it; without a path nothing is drawn (LIFE_LAYER §3: the rule
// and the visual agree).
import type { BuildingDisplay } from "../api/client";
import { adjacentRoads, type FootprintDef, rotatedFootprint, type TilePos, tileKey } from "./geometry";

const NEIGHBOURS: readonly TilePos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Road tiles next to a building's rotated footprint. */
export function footprintRoads(roads: ReadonlySet<string>, b: Pick<BuildingDisplay, "x" | "y" | "rotation">, def: FootprintDef): TilePos[] {
  const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
  return adjacentRoads(roads, b.x, b.y, w, h);
}

/** Shortest road path (BFS) from one of the road tiles `from` to one of `to`. */
export function roadPath(roads: ReadonlySet<string>, from: readonly TilePos[], to: readonly TilePos[]): TilePos[] | null {
  const adjacent = (p: TilePos) => NEIGHBOURS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })).filter((q) => roads.has(tileKey(q)));
  const goals = new Set(to.map(tileKey));
  const prev = new Map<string, TilePos | null>();
  const queue: TilePos[] = [];
  for (const s of from) {
    if (prev.has(tileKey(s))) continue;
    prev.set(tileKey(s), null);
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as TilePos;
    if (goals.has(tileKey(cur))) {
      const path: TilePos[] = [];
      for (let p: TilePos | null | undefined = cur; p; p = prev.get(tileKey(p))) path.push(p);
      return path.reverse();
    }
    for (const n of adjacent(cur)) {
      if (!prev.has(tileKey(n))) {
        prev.set(tileKey(n), cur);
        queue.push(n);
      }
    }
  }
  return null;
}

/** A point on a tile path (tile centres) at fraction f ∈ [0, 1] of its length, with the heading (radians, tile x/y) of its segment. */
export function alongPath(path: readonly TilePos[], f: number, out: { x: number; y: number; heading: number }): void {
  const n = path.length - 1;
  if (n <= 0) {
    const p = path[0];
    out.x = (p?.x ?? 0) + 0.5;
    out.y = (p?.y ?? 0) + 0.5;
    out.heading = 0;
    return;
  }
  const pos = Math.min(Math.max(f, 0), 1) * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const a = path[i] as TilePos;
  const b = path[i + 1] as TilePos;
  const k = pos - i;
  out.x = a.x + (b.x - a.x) * k + 0.5;
  out.y = a.y + (b.y - a.y) * k + 0.5;
  out.heading = Math.atan2(b.y - a.y, b.x - a.x);
}

/** A building type as far as the root rule's hint needs it: its footprint and whether it is a Trading Post or a Warehouse. */
type RootDef = FootprintDef & { trading_post?: unknown; warehouse?: unknown };

/**
 * Ghost hint (UI.md §3, D-081): true when a Warehouse at (x, y) with the rotation would not be linked to the
 * island's Trading Post by road — no road path from a road tile next to its footprint to a road tile next to the
 * Trading Post's (the BFS above, the one the carts draw with). False for any other building. A display hint for
 * the ghost's colour; the server decides (`not_connected` on the built warehouse).
 */
export function unlinkedWarehouseHint(
  def: RootDef,
  roads: ReadonlySet<string>,
  x: number,
  y: number,
  rotation: number,
  buildings: readonly Pick<BuildingDisplay, "type" | "x" | "y" | "rotation">[],
  defs: ReadonlyMap<string, RootDef>,
): boolean {
  if (!def.warehouse) return false;
  const [w, h] = rotatedFootprint(def.width, def.height, rotation);
  const from = adjacentRoads(roads, x, y, w, h);
  if (from.length === 0) return true;
  for (const b of buildings) {
    const d = defs.get(b.type);
    if (!d?.trading_post) continue;
    if (roadPath(roads, from, footprintRoads(roads, b, d)) !== null) return false;
  }
  return true;
}
