// The group move (D-074 §5, `move_group`): the Move tool's rectangle
// picks everything whose footprint lies fully inside it — buildings,
// fields, paint tiles, plans, road and planned road tiles — and the group
// ghost shows it at the pointer, turned with R. Display hints only
// (D-027): the frame mirrors the server's (sim/group.go, checked against
// the shared fixture server/testdata/group/frames.json); the per-piece
// tint is a client guess (bounds, terrain, overlap, harbour lane) and the
// server validates the move, all or nothing.
import type { BuildingDisplay, IslandDisplay } from "../api/client";
import { type Rotation, rotatedFootprint, type TilePos, tileKey } from "./geometry";
import { harbourLanes, type LaneDef, laneGhost, type LaneSite } from "./lane";
import { planAsBuilding } from "./plans";

/** A tile rectangle with inclusive, ordered corners. */
export interface GroupRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle between two corner tiles (any order). */
export function groupRect(a: TilePos, b: TilePos): GroupRect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** Maps the source rectangle's tiles to the target: (dx, dy) moves its top-left, rot turns it clockwise. */
export interface GroupFrame {
  x0: number;
  y0: number;
  w: number;
  h: number;
  tx: number;
  ty: number;
  rot: Rotation;
}

export function groupFrame(r: GroupRect, dx: number, dy: number, rot: Rotation): GroupFrame {
  return { x0: r.x0, y0: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1, tx: r.x0 + dx, ty: r.y0 + dy, rot };
}

/** The new top-left of a tile rectangle (x, y, w × h) inside the source, as the server maps it (sim.groupFrame.rect). */
export function frameRect(f: GroupFrame, x: number, y: number, w: number, h: number): TilePos {
  let u = x - f.x0;
  let v = y - f.y0;
  switch (f.rot) {
    case 90:
      [u, v] = [f.h - v - h, u];
      break;
    case 180:
      [u, v] = [f.w - u - w, f.h - v - h];
      break;
    case 270:
      [u, v] = [v, f.w - u - w];
      break;
  }
  return { x: f.tx + u, y: f.ty + v };
}

/** The offset that centres the (turned) rectangle on the pointer tile. */
export function groupOffset(r: GroupRect, rot: Rotation, at: TilePos): { dx: number; dy: number } {
  const [w, h] = rotatedFootprint(r.x1 - r.x0 + 1, r.y1 - r.y0 + 1, rot);
  return { dx: at.x - Math.floor(w / 2) - r.x0, dy: at.y - Math.floor(h / 2) - r.y0 };
}

/** What the group mirror reads of a content definition. */
export interface GroupDef extends LaneDef {
  water_rows?: unknown;
}

/** A building or plan of the group. */
export interface GroupPiece {
  id: number;
  type: string;
  x: number;
  y: number;
  rotation: number;
  plan: boolean;
}

/** A road or planned road tile of the group. */
export interface GroupRoad extends TilePos {
  type: string;
  planned: boolean;
}

export interface GroupSelection {
  pieces: GroupPiece[];
  roads: GroupRoad[];
}

type GroupIsland = Pick<IslandDisplay, "buildings" | "plans" | "roads" | "planned_roads">;

function inside(r: GroupRect, x: number, y: number, w: number, h: number): boolean {
  return x >= r.x0 && y >= r.y0 && x + w - 1 <= r.x1 && y + h - 1 <= r.y1;
}

/** Everything the rectangle moves: buildings and plans fully inside it (in ID order, like the server), road tiles in it. */
export function groupSelection(r: GroupRect, is: GroupIsland, defs: ReadonlyMap<string, GroupDef>): GroupSelection {
  const pieces: GroupPiece[] = [];
  const add = (b: { id: number; type: string; x: number; y: number; rotation: number }, plan: boolean) => {
    const def = defs.get(b.type);
    if (!def) return;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    if (inside(r, b.x, b.y, w, h)) pieces.push({ id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, plan });
  };
  for (const b of is.buildings) add(b, false);
  for (const p of is.plans ?? []) add(p, true);
  pieces.sort((a, b) => a.id - b.id);
  const roads: GroupRoad[] = [];
  for (const t of is.roads) if (inside(r, t.x, t.y, 1, 1)) roads.push({ x: t.x, y: t.y, type: t.type, planned: false });
  for (const seg of is.planned_roads ?? []) {
    for (const t of seg.tiles) if (inside(r, t.x, t.y, 1, 1)) roads.push({ x: t.x, y: t.y, type: seg.type, planned: true });
  }
  return { pieces, roads };
}

/** The number of things a selection moves (buildings, plans and road tiles). */
export function groupSize(sel: GroupSelection): number {
  return sel.pieces.length + sel.roads.length;
}

/** A piece of the group ghost at its new site. `id`: the building or plan (absent for a road tile). */
export interface GroupGhostTile extends TilePos {
  w: number;
  h: number;
  id?: number;
  ok: boolean;
}

/** What the ghost reads of the island beyond its display. */
export interface GroupSite {
  width: number;
  height: number;
  terrain: (x: number, y: number) => string;
  defs: ReadonlyMap<string, GroupDef>;
}

/**
 * The group at its new site with a hint per piece: out of the island,
 * a land building or road over water (a quay over land), overlap with what
 * stays, or the harbour lane (D-078 §1) mark it bad. `failed` (the building
 * the server named) is always bad.
 */
export function groupGhost(f: GroupFrame, sel: GroupSelection, is: GroupIsland, site: GroupSite, failed?: number): GroupGhostTile[] {
  const moving = new Set(sel.pieces.map((p) => `${p.plan ? "p" : "b"}${p.id}`));
  const movedRoads = new Set(sel.roads.map((t) => `${t.planned ? "p" : "r"}${tileKey(t)}`));
  const staying: BuildingDisplay[] = [...is.buildings.filter((b) => !moving.has(`b${b.id}`)), ...(is.plans ?? []).filter((p) => !moving.has(`p${p.id}`)).map((p) => planAsBuilding(p, false))];
  const stayingRoads = [
    ...is.roads.filter((t) => !movedRoads.has(`r${tileKey(t)}`)).map((t) => ({ x: t.x, y: t.y, type: t.type })),
    ...(is.planned_roads ?? []).flatMap((s) => s.tiles.filter((t) => !movedRoads.has(`p${tileKey(t)}`)).map((t) => ({ x: t.x, y: t.y, type: s.type }))),
  ];
  const taken = new Set<string>(stayingRoads.map(tileKey));
  for (const b of staying) {
    const def = site.defs.get(b.type);
    if (!def) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) taken.add(tileKey({ x, y }));
  }
  const pieces = sel.pieces.map((p) => {
    const def = site.defs.get(p.type) as GroupDef;
    const [w, h] = rotatedFootprint(def.width, def.height, p.rotation);
    const at = frameRect(f, p.x, p.y, w, h);
    const rotation = def.paint_family !== undefined ? 0 : (p.rotation + f.rot) % 360;
    const [tw, th] = rotatedFootprint(def.width, def.height, rotation);
    return { p, def, x: at.x, y: at.y, w: tw, h: th, rotation };
  });
  const roads = sel.roads.map((t) => ({ t, ...frameRect(f, t.x, t.y, 1, 1) }));
  // The island after the move, for the lane mirror.
  const after: LaneSite = {
    width: site.width,
    height: site.height,
    buildings: [...staying, ...pieces.map((m) => ({ id: m.p.id, type: m.p.type, x: m.x, y: m.y, rotation: m.rotation }))],
    roads: [...stayingRoads, ...roads.map((r) => ({ x: r.x, y: r.y, type: r.t.type }))],
    defs: site.defs,
  };
  const out = (x: number, y: number) => x < 0 || y < 0 || x >= site.width || y >= site.height;
  const isQuay = (type: string) => site.defs.get(type)?.road?.shallows === true;
  const lanes = harbourLanes(after);
  const ghost: GroupGhostTile[] = [];
  for (const r of roads) {
    const water = !out(r.x, r.y) && site.terrain(r.x, r.y) === "water";
    const ok = !out(r.x, r.y) && !taken.has(tileKey(r)) && (!isQuay(r.t.type) || (water && !lanes.has(tileKey(r))));
    ghost.push({ x: r.x, y: r.y, w: 1, h: 1, ok });
  }
  for (const m of pieces) {
    let ok = m.p.id !== failed;
    const wet = m.def.water_rows !== undefined || m.def.placement === "shore" || m.def.placement === "water";
    for (let y = m.y; ok && y < m.y + m.h; y++) {
      for (let x = m.x; ok && x < m.x + m.w; x++) {
        if (out(x, y) || taken.has(tileKey({ x, y })) || (!wet && site.terrain(x, y) === "water")) ok = false;
      }
    }
    if (ok && (m.def.harbour_lane || m.def.placement === "shore" || m.def.paint_family !== undefined)) {
      ok = !laneGhost(m.def, m.x, m.y, m.rotation, after, m.p.id).some((l) => l.blocked);
    }
    ghost.push({ x: m.x, y: m.y, w: m.w, h: m.h, id: m.p.id, ok });
  }
  return ghost;
}
