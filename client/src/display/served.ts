import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import { rotatedFootprint } from "./geometry";

/**
 * The buildings shown together with the selected one (tinted green):
 * - a house: the buildings that serve it; a service building (chapel, market, …): the houses it serves.
 *   The server decides (`served_by` of a house); this only looks the relation up in both directions.
 * - a producer: the Warehouse or Trading Post it delivers to (`assigned_warehouse_id`); a Warehouse or
 *   Trading Post: the producers delivering to it.
 */
export function servedRelated(selected: BuildingDisplay, buildings: readonly BuildingDisplay[], def: ContentBuilding | undefined): number[] {
  if (selected.served_by) return [...selected.served_by];
  const related: number[] = [];
  if (def?.service) related.push(...buildings.filter((b) => b.served_by?.includes(selected.id)).map((b) => b.id));
  if (selected.assigned_warehouse_id) related.push(selected.assigned_warehouse_id);
  related.push(...buildings.filter((b) => b.assigned_warehouse_id === selected.id && b.rates !== undefined).map((b) => b.id));
  return related;
}

/** A service building's placement ghost: its content type, the island and tile under the pointer, the rotation. */
export interface ServiceGhost {
  type: string;
  island: string;
  x: number;
  y: number;
  rotation: number;
  /** The level whose radius counts (1-based; a moved building keeps its own, a new one starts at 1). */
  level?: number;
}

/**
 * Ghost hint (UI.md §3, D-027): the houses on the ghost's island that a service building placed there would
 * serve, so the ghost can tint them like the selected building. A display hint, never a rule: a house counts
 * when the Euclidean distance between its nearest footprint tile and the ghost's nearest footprint tile is within
 * the building's radius at its level (content, level 1 for a new building; the server computes `served_by` with
 * the same measure once the building stands). The road connection, paused state and the house's own
 * connection are NOT checked (the display has no connectivity). Empty for anything but a service building.
 */
export function wouldServe(
  ghost: ServiceGhost,
  content: { buildings: readonly ContentBuilding[] },
  state: { islands: readonly Pick<IslandDisplay, "id" | "buildings">[] },
): number[] {
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const def = defs.get(ghost.type);
  if (!def?.service) return [];
  const radius = def.service.levels[(ghost.level ?? 1) - 1]?.radius ?? def.service.radius;
  const island = state.islands.find((is) => is.id === ghost.island);
  if (!island) return [];
  const [gw, gh] = rotatedFootprint(def.width, def.height, ghost.rotation);
  // Gap in whole tiles between two footprints on one axis (0 when they overlap): the nearest tiles' centre distance.
  const gap = (a: number, aw: number, b: number, bw: number) => Math.max(0, b - (a + aw - 1), a - (b + bw - 1));
  const out: number[] = [];
  for (const b of island.buildings) {
    const hd = defs.get(b.type);
    if (!hd?.house) continue;
    const [w, h] = rotatedFootprint(hd.width, hd.height, b.rotation);
    const dx = gap(ghost.x, gw, b.x, w);
    const dy = gap(ghost.y, gh, b.y, h);
    if (dx * dx + dy * dy <= radius * radius) out.push(b.id);
  }
  return out;
}

/**
 * The collector reach of a Trading Post or Warehouse at a 1-based level (content, D-069; clamped to the last
 * level): tiles, 0 for no limit; null for any other building.
 */
export function collectorReach(def: ContentBuilding | undefined, level = 1): number | null {
  const levels = def?.trading_post?.levels ?? def?.warehouse?.levels;
  if (!levels || levels.length === 0) return null;
  return levels[Math.min(Math.max(level, 1), levels.length) - 1]?.reach ?? 0;
}

/** Gap in whole tiles between two footprints on one axis (0 when they overlap): the nearest tiles' centre distance. */
function gap(a: number, aw: number, b: number, bw: number): number {
  return Math.max(0, b - (a + aw - 1), a - (b + bw - 1));
}

/** A footprint on an island (tiles; width and height already rotated). */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The two footprints' nearest tiles are within r tiles (Euclidean; the server's reach and radius measure); r 0 is no limit. */
function within(a: Rect, b: Rect, r: number): boolean {
  if (r <= 0) return true;
  const dx = gap(a.x, a.w, b.x, b.w);
  const dy = gap(a.y, a.h, b.y, b.h);
  return dx * dx + dy * dy <= r * r;
}

/**
 * The outline of the tiles within reach r of a footprint (tile edge coordinates of the island, closed, clockwise
 * from the top-left arc): the footprint grown by r with quarter circles of radius r around its corner tiles
 * (D-069 §1 reach ring). The ring is a hint of the measure; a tile counts when its centre's gap is within r.
 */
export function reachOutline(fp: Rect, r: number, arcSteps = 8): { x: number; y: number }[] {
  // Centres of the corner tiles; the outline lies r + 0.5 from them (the outer edge of the last tile in reach).
  const R = r + 0.5;
  const x0 = fp.x + 0.5;
  const y0 = fp.y + 0.5;
  const x1 = fp.x + fp.w - 0.5;
  const y1 = fp.y + fp.h - 0.5;
  const corners: [number, number, number][] = [
    [x0, y0, Math.PI],
    [x1, y0, 1.5 * Math.PI],
    [x1, y1, 0],
    [x0, y1, 0.5 * Math.PI],
  ];
  const out: { x: number; y: number }[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= arcSteps; i++) {
      const a = a0 + (i / arcSteps) * (Math.PI / 2);
      out.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
  }
  return out;
}

/** The buildings a placement ghost would be linked with, tinted like a selection's related buildings. */
type GhostContent = { buildings: readonly ContentBuilding[] };
type GhostState = { islands: readonly Pick<IslandDisplay, "id" | "buildings">[] };

/**
 * Ghost hint (UI.md §3, D-027): what the building under the ghost would be linked with, from the display only:
 * - a service building: the houses it would serve (`wouldServe`);
 * - a house: the service buildings on its island within their radius (each at its current level) of it;
 * - a Warehouse or Trading Post: the producers (buildings with a recipe) on the island within its reach at its
 *   level (D-069: nearest footprint tiles, like a service radius); a producer: the Warehouses and Trading Posts on
 *   the island whose reach at their current level covers it. Who delivers to whom is the nearest of those by road,
 *   which needs connectivity the display lacks, so this marks the candidates in reach, not the assignment.
 * The server's `served_by` and `assigned_warehouse_id` are the truth once the building stands.
 */
export function ghostRelated(ghost: ServiceGhost, content: GhostContent, state: GhostState): number[] {
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const def = defs.get(ghost.type);
  const island = state.islands.find((is) => is.id === ghost.island);
  if (!def || !island) return [];
  if (def.service) return wouldServe(ghost, content, state);
  const [gw, gh] = rotatedFootprint(def.width, def.height, ghost.rotation);
  const g: Rect = { x: ghost.x, y: ghost.y, w: gw, h: gh };
  const rectOf = (b: BuildingDisplay, d: ContentBuilding): Rect => {
    const [w, h] = rotatedFootprint(d.width, d.height, b.rotation);
    return { x: b.x, y: b.y, w, h };
  };
  if (def.house) {
    return island.buildings
      .filter((b) => {
        const sd = defs.get(b.type);
        if (!sd?.service) return false;
        const radius = sd.service.levels[(b.level ?? 1) - 1]?.radius ?? sd.service.radius;
        const r = rectOf(b, sd);
        const dx = gap(g.x, g.w, r.x, r.w);
        const dy = gap(g.y, g.h, r.y, r.h);
        return dx * dx + dy * dy <= radius * radius;
      })
      .map((b) => b.id);
  }
  const reach = collectorReach(def, ghost.level ?? 1);
  if (reach !== null) {
    return island.buildings
      .filter((b) => {
        const d = defs.get(b.type);
        return !!d?.recipe && within(g, rectOf(b, d), reach);
      })
      .map((b) => b.id);
  }
  if (def.recipe) {
    return island.buildings
      .filter((b) => {
        const d = defs.get(b.type);
        const r = collectorReach(d, b.level ?? 1);
        return r !== null && !!d && within(g, rectOf(b, d), r);
      })
      .map((b) => b.id);
  }
  return [];
}
