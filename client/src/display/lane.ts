// Harbour lanes (D-078 §1; a display mirror of the server's
// internal/sim/lane.go, hints only, D-027): every berth holder (content
// `harbour_lane`), built or planned, keeps a lane in front of its water
// edge — its width plus one tile on each side, LANE_DEPTH rows deep, every
// tile on the island. No quay, shore building or paint tile may lie on
// another holder's lane, and a holder's own lane may cover none. The
// server validates (`harbour_lane`).
import { rotatedFootprint, type TilePos } from "./geometry";

/** The lane's depth in rows (D-078 §1; server laneDepth). */
export const LANE_DEPTH = 4;

/** What the lane mirror reads of a content definition. */
export interface LaneDef {
  width: number;
  height: number;
  harbour_lane?: boolean;
  placement?: string;
  paint_family?: unknown;
  road?: { shallows?: boolean } | null;
}

/** A building or plan on the island (plans as buildings, display/plans.ts planAsBuilding). */
export interface LaneBuilding {
  id?: number;
  type: string;
  x: number;
  y: number;
  rotation: number;
}

/** The island and what stands on it. */
export interface LaneSite {
  width: number;
  height: number;
  buildings: readonly LaneBuilding[];
  /** Roads and planned roads with their type (a quay is a road with `shallows`). */
  roads: readonly { x: number; y: number; type: string }[];
  defs: ReadonlyMap<string, LaneDef>;
}

/** The tile of a footprint's column and row (row < 0: in front of the water edge), rotation-aware like water rows. */
function lanePosition(def: LaneDef, x: number, y: number, rotation: number, column: number, row: number): TilePos {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: x + def.height - 1 - row, y: y + column };
    case 180:
      return { x: x + column, y: y + def.height - 1 - row };
    case 270:
      return { x: x + row, y: y + column };
  }
  return { x: x + column, y: y + row };
}

/** The lane of a berth holder at (x, y) with the rotation, in island bounds (empty for a building without a lane). */
export function laneTiles(def: LaneDef, x: number, y: number, rotation: number, width: number, height: number): TilePos[] {
  if (!def.harbour_lane) return [];
  const out: TilePos[] = [];
  for (let row = 1; row <= LANE_DEPTH; row++) {
    for (let column = -1; column <= def.width; column++) {
      const p = lanePosition(def, x, y, rotation, column, -row);
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) out.push(p);
    }
  }
  return out;
}

/** The lane's tile rectangle (the gold outline of a selected holder), null without a lane. */
export function laneRect(def: LaneDef, x: number, y: number, rotation: number, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const tiles = laneTiles(def, x, y, rotation, width, height);
  if (tiles.length === 0) return null;
  const xs = tiles.map((p) => p.x);
  const ys = tiles.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1 };
}

/** Whether a building of def is kept off harbour lanes: a shore building or a paint family (quays: isQuayDef). */
export function laneBound(def: LaneDef | undefined): boolean {
  return def !== undefined && (def.placement === "shore" || def.paint_family !== undefined);
}

function isQuayDef(def: LaneDef | undefined): boolean {
  return def?.road?.shallows === true;
}

const key = (x: number, y: number) => `${x},${y}`;

/** The lane tiles ("x,y") of the island's berth holders, built and planned, but the one with id `skip`. */
export function harbourLanes(site: LaneSite, skip?: number): Set<string> {
  const out = new Set<string>();
  for (const b of site.buildings) {
    const def = site.defs.get(b.type);
    if (!def?.harbour_lane || (skip !== undefined && b.id === skip)) continue;
    for (const p of laneTiles(def, b.x, b.y, b.rotation, site.width, site.height)) out.add(key(p.x, p.y));
  }
  return out;
}

/** A tile of the lane ghost: the placed holder's own lane, or a footprint tile on another holder's lane. */
export interface LaneGhostTile extends TilePos {
  /** True when the server would refuse it (`harbour_lane`). */
  blocked: boolean;
  /** Whether the tile is the placed building's own lane (false: its footprint). */
  lane: boolean;
}

/**
 * The lane ghost of placing or moving a building of def at (x, y)
 * (`self`: the moved building or plan, which never blocks itself): a
 * lane-bound building's footprint tiles on another holder's lane, and a
 * holder's own lane with the tiles that cover a quay, a shore building or
 * a paint tile blocked.
 */
export function laneGhost(def: LaneDef, x: number, y: number, rotation: number, site: LaneSite, self?: number): LaneGhostTile[] {
  const out: LaneGhostTile[] = [];
  if (laneBound(def)) {
    const lanes = harbourLanes(site, self);
    const [w, h] = rotatedFootprint(def.width, def.height, rotation);
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (lanes.has(key(tx, ty))) out.push({ x: tx, y: ty, blocked: true, lane: false });
      }
    }
  }
  const lane = laneTiles(def, x, y, rotation, site.width, site.height);
  if (lane.length === 0) return out;
  const bound = new Set<string>();
  for (const b of site.buildings) {
    const bd = site.defs.get(b.type);
    if ((self !== undefined && b.id === self) || !bd || !laneBound(bd)) continue;
    const [w, h] = rotatedFootprint(bd.width, bd.height, b.rotation);
    for (let ty = b.y; ty < b.y + h; ty++) for (let tx = b.x; tx < b.x + w; tx++) bound.add(key(tx, ty));
  }
  for (const r of site.roads) if (isQuayDef(site.defs.get(r.type))) bound.add(key(r.x, r.y));
  for (const p of lane) out.push({ ...p, blocked: bound.has(key(p.x, p.y)), lane: true });
  return out;
}
