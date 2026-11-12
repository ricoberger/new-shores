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
 * `ok`: a new road tile; `replace`: a land road of a lower type (an earlier tier) the new one replaces (MECHANICS §3);
 * `skip`: a road of this or a higher type is already there (not sent); `bad`: the server would reject the tile
 * (terrain, a building, off the shallows for a quay).
 */
export type RoadDragHint = "ok" | "replace" | "skip" | "bad";

export interface RoadDragTile extends TilePos {
  hint: RoadDragHint;
}

/** What the hint reads: the island's terrain, its buildings and roads, the content footprints. */
export interface RoadDragData {
  island: ShallowsInput;
  buildings: readonly Pick<BuildingDisplay, "type" | "x" | "y" | "rotation">[];
  roads: readonly { x: number; y: number; type: string }[];
  defs: ReadonlyMap<string, FootprintDef & { tier?: string; road?: { shallows?: boolean } | null; paint_family?: { road_crossing?: boolean; ground?: string } }>;
  /** The content tiers (progression order by index): a road replaces one of an earlier tier. Without: nothing is replaced. */
  tiers?: readonly { id: string; index: number }[];
}

/** Whether a road of type `next` replaces the road of type `old` on a tile: both land roads, `old` of an earlier tier. */
export function replacesRoad(old: string, next: string, data: Pick<RoadDragData, "defs" | "tiers">): boolean {
  const a = data.defs.get(old);
  const b = data.defs.get(next);
  if (!a?.road || !b?.road || a.road.shallows || b.road.shallows) return false;
  const index = (tier: string | undefined) => data.tiers?.find((t) => t.id === tier)?.index;
  const ia = index(a.tier);
  const ib = index(b.tier);
  return ia !== undefined && ib !== undefined && ia < ib;
}

/** Terrain a land road may stand on: the buildable terrain and rivers (a bridge, D-058). */
const ROAD_TERRAIN = new Set(["coast", "grass", "forest", "river"]);

/** Terrain a paint-family tile may stand on (D-077 §2–§3): the buildable land of a 1×1 building. */
const PAINT_TERRAIN = new Set(["coast", "grass", "forest"]);

/** Whether `type` is a paint family (hedge, garden wall, city wall, square; D-077): painted with the road tool. */
export function isPaintType(defs: RoadDragData["defs"], type: string): boolean {
  return defs.get(type)?.paint_family !== undefined;
}

/**
 * The drag of a paint family (D-077 §2–§3; a display mirror of the
 * server's 1×1 placement): a tile of the same family is skipped; another
 * building or plan, a road (but a land road under a road-crossing family,
 * the city wall) or terrain off the buildable land is `bad`.
 */
function planPaintDrag(start: TilePos, end: TilePos, type: string, data: RoadDragData): RoadDragTile[] {
  const crossing = data.defs.get(type)?.paint_family?.road_crossing === true;
  const roads = new Map(data.roads.map((r) => [`${r.x},${r.y}`, r.type]));
  const { width, height, terrain } = data.island;
  return lPath(start, end).map((p) => {
    const at = { x: p.x, y: p.y };
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return { ...at, hint: "bad" };
    const b = buildingAt(data.buildings, data.defs, p.x, p.y);
    if (b) return { ...at, hint: b.type === type ? "skip" : "bad" };
    const road = roads.get(`${p.x},${p.y}`);
    if (road !== undefined && !(crossing && data.defs.get(road)?.road?.shallows !== true)) return { ...at, hint: "bad" };
    return { ...at, hint: PAINT_TERRAIN.has(terrain[p.y * width + p.x] ?? "") ? "ok" : "bad" };
  });
}

/**
 * The drag's tiles from `start` to `end` (L-path, horizontal first), each with its hint for road type `roadType`;
 * a paint family (D-077) has its own hints (planPaintDrag).
 */
export function planRoadDrag(start: TilePos, end: TilePos, roadType: string, data: RoadDragData): RoadDragTile[] {
  if (isPaintType(data.defs, roadType)) return planPaintDrag(start, end, roadType, data);
  const quay = data.defs.get(roadType)?.road?.shallows === true;
  const roads = new Map(data.roads.map((r) => [`${r.x},${r.y}`, r.type]));
  const { width, height, terrain } = data.island;
  const tiles: RoadDragTile[] = lPath(start, end).map((p) => {
    const at = { x: p.x, y: p.y };
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return { ...at, hint: "bad" };
    const old = roads.get(`${p.x},${p.y}`);
    if (old !== undefined) return { ...at, hint: replacesRoad(old, roadType, data) ? "replace" : "skip" };
    if (buildingAt(data.buildings, data.defs, p.x, p.y)) return { ...at, hint: "bad" };
    const ok = quay ? isShallow(data.island, p.x, p.y) : ROAD_TERRAIN.has(terrain[p.y * width + p.x] ?? "");
    return { ...at, hint: ok ? "ok" : "bad" };
  });
  return quay ? anchorQuays(tiles, data) : tiles;
}

/** Own land of an island for a quay's anchor (D-077 §8): neither water, river nor islet. */
const NOT_LAND = new Set(["water", "river", "islet", ""]);

/**
 * The quay drag's connectivity (D-077 §8, a mirror of the server's
 * checkQuaysConnected): a new quay tile must reach the island's own land or
 * a building over edge-adjacent quay tiles, the drag's and the island's;
 * a tile that does not is `bad` (the server rejects the whole drag).
 */
function anchorQuays(tiles: RoadDragTile[], data: RoadDragData): RoadDragTile[] {
  const { width, height, terrain } = data.island;
  const key = (x: number, y: number) => `${x},${y}`;
  const quays = new Set<string>();
  for (const r of data.roads) if (data.defs.get(r.type)?.road?.shallows === true) quays.add(key(r.x, r.y));
  for (const tl of tiles) if (tl.hint === "ok") quays.add(key(tl.x, tl.y));
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && (!NOT_LAND.has(terrain[y * width + x] ?? "") || buildingAt(data.buildings, data.defs, x, y) !== undefined);
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const anchored = new Set<string>();
  const queue: TilePos[] = [];
  for (const k of quays) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (steps.some(([dx, dy]) => solid(x + dx, y + dy))) {
      anchored.add(k);
      queue.push({ x, y });
    }
  }
  while (queue.length > 0) {
    const p = queue.shift() as TilePos;
    for (const [dx, dy] of steps) {
      const k = key(p.x + dx, p.y + dy);
      if (quays.has(k) && !anchored.has(k)) {
        anchored.add(k);
        queue.push({ x: p.x + dx, y: p.y + dy });
      }
    }
  }
  return tiles.map((tl) => (tl.hint === "ok" && !anchored.has(key(tl.x, tl.y)) ? { ...tl, hint: "bad" } : tl));
}

/** The tiles the road tool sends for a drag: every tile but the skipped ones, replaced ones included (the server answers for the rest). */
export function roadDragSend(tiles: readonly RoadDragTile[]): TilePos[] {
  return tiles.filter((t) => t.hint !== "skip").map(({ x, y }) => ({ x, y }));
}
