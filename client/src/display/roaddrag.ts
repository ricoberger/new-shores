// The road tool's drag (UI.md §3): the Manhattan L-path of the drag with a
// display hint per tile, for the ghost tint and for what the tool sends.
// A mirror of the server's road rules for hints only (D-027; MECHANICS §3,
// server/internal/sim/apply.go placeRoad): the server validates every
// placement. Bridge shapes over rivers are not mirrored (a river tile is
// shown valid; the server may still reject a bridge).
import type { BuildingDisplay } from "../api/client";
import { buildingAt, type FootprintDef, lPath, type TilePos } from "./geometry";
import { isShallow, type ShallowsInput } from "./quay";

/**
 * `ok`: a new road tile; `skip`: a road of this or a better type is already there (not sent);
 * `bad`: the server would reject the tile (terrain, a building, off the shallows for a quay).
 */
export type RoadDragHint = "ok" | "skip" | "bad";

export interface RoadDragTile extends TilePos {
  hint: RoadDragHint;
}

/** What the hint reads: the island's terrain, its buildings and roads, the content footprints. */
export interface RoadDragData {
  island: ShallowsInput;
  buildings: readonly Pick<BuildingDisplay, "type" | "x" | "y" | "rotation">[];
  roads: readonly { x: number; y: number; type: string }[];
  defs: ReadonlyMap<string, FootprintDef & { road?: { shallows?: boolean } | null }>;
}

/** Terrain a land road may stand on: the buildable terrain and rivers (a bridge, D-058). */
const ROAD_TERRAIN = new Set(["coast", "grass", "forest", "river"]);

/** The drag's tiles from `start` to `end` (L-path, horizontal first), each with its hint for road type `roadType`. */
export function planRoadDrag(start: TilePos, end: TilePos, roadType: string, data: RoadDragData): RoadDragTile[] {
  const quay = data.defs.get(roadType)?.road?.shallows === true;
  const roads = new Map(data.roads.map((r) => [`${r.x},${r.y}`, r.type]));
  const { width, height, terrain } = data.island;
  return lPath(start, end).map((p) => {
    const at = { x: p.x, y: p.y };
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return { ...at, hint: "bad" };
    if (roads.has(`${p.x},${p.y}`)) return { ...at, hint: "skip" };
    if (buildingAt(data.buildings, data.defs, p.x, p.y)) return { ...at, hint: "bad" };
    const ok = quay ? isShallow(data.island, p.x, p.y) : ROAD_TERRAIN.has(terrain[p.y * width + p.x] ?? "");
    return { ...at, hint: ok ? "ok" : "bad" };
  });
}

/** The tiles the road tool sends for a drag: every tile but the skipped ones (the server answers for the rest). */
export function roadDragSend(tiles: readonly RoadDragTile[]): TilePos[] {
  return tiles.filter((t) => t.hint !== "skip").map(({ x, y }) => ({ x, y }));
}
