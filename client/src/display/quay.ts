// Quays (D-060; MECHANICS §3): the client's mirror of the server's
// shallows rule (server/internal/sim/quay.go), for hints only — the
// server validates every placement. Shallows are the water tiles of the
// island's grid within SHALLOWS_REACH tiles (Chebyshev) of its own land:
// a tile that is neither water, river nor islet. Tested against the
// shared fixture server/testdata/quay/shallows.json.
import type { TilePos } from "./geometry";

/** Distance (tiles, Chebyshev) from the island's own land within which water is shallow. */
export const SHALLOWS_REACH = 3;

/** The terrain rows an island's shallows are derived from. */
export interface ShallowsInput {
  width: number;
  height: number;
  /** Row-major terrain IDs. */
  terrain: readonly string[];
}

const ownLand = (t: string | undefined) => t !== undefined && t !== "water" && t !== "river" && t !== "islet";

/** Whether the tile (island tiles) is shallow water. */
export function isShallow(is: ShallowsInput, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= is.width || y >= is.height || is.terrain.length !== is.width * is.height) return false;
  if (is.terrain[y * is.width + x] !== "water") return false;
  for (let ty = Math.max(y - SHALLOWS_REACH, 0); ty <= Math.min(y + SHALLOWS_REACH, is.height - 1); ty++) {
    for (let tx = Math.max(x - SHALLOWS_REACH, 0); tx <= Math.min(x + SHALLOWS_REACH, is.width - 1); tx++) {
      if (ownLand(is.terrain[ty * is.width + tx])) return true;
    }
  }
  return false;
}

/** The tiles of a quay drag that are not shallows (the hint of the road tool; empty: the drag may fit). */
export function offShallows(is: ShallowsInput, tiles: readonly TilePos[]): TilePos[] {
  return tiles.filter((t) => !isShallow(is, t.x, t.y));
}

/** Whether a road type is a quay (its content road block stands on the shallows). */
export function isQuayType(defs: ReadonlyMap<string, { road?: { shallows?: boolean } | null }>, type: string): boolean {
  return defs.get(type)?.road?.shallows === true;
}

/** The roads on an island's water tiles ("x,y" keys): its quays (only a quay stands on water), for the minimap. */
export function roadsOnWater(is: ShallowsInput, roads: readonly { x: number; y: number }[]): Set<string> {
  const out = new Set<string>();
  for (const r of roads) if (is.terrain[r.y * is.width + r.x] === "water") out.add(`${r.x},${r.y}`);
  return out;
}
