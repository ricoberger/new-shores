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

/** The buildings a placement ghost would be linked with, tinted like a selection's related buildings. */
type GhostContent = { buildings: readonly ContentBuilding[] };
type GhostState = { islands: readonly Pick<IslandDisplay, "id" | "buildings">[] };

/**
 * Ghost hint (UI.md §3, D-027): what the building under the ghost would be linked with, from the display only:
 * - a service building: the houses it would serve (`wouldServe`);
 * - a house: the service buildings on its island within their radius (each at its current level) of it;
 * - a Warehouse: every producer (building with a recipe) on the island, a producer: every Warehouse and
 *   Trading Post on the island. Who delivers to whom is the nearest collector by road, which needs connectivity
 *   the display lacks, so this marks the candidates, not the assignment.
 * The server's `served_by` and `assigned_warehouse_id` are the truth once the building stands.
 */
export function ghostRelated(ghost: ServiceGhost, content: GhostContent, state: GhostState): number[] {
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const def = defs.get(ghost.type);
  const island = state.islands.find((is) => is.id === ghost.island);
  if (!def || !island) return [];
  if (def.service) return wouldServe(ghost, content, state);
  const [gw, gh] = rotatedFootprint(def.width, def.height, ghost.rotation);
  const gap = (a: number, aw: number, b: number, bw: number) => Math.max(0, b - (a + aw - 1), a - (b + bw - 1));
  if (def.house) {
    return island.buildings
      .filter((b) => {
        const sd = defs.get(b.type);
        if (!sd?.service) return false;
        const radius = sd.service.levels[(b.level ?? 1) - 1]?.radius ?? sd.service.radius;
        const [w, h] = rotatedFootprint(sd.width, sd.height, b.rotation);
        const dx = gap(ghost.x, gw, b.x, w);
        const dy = gap(ghost.y, gh, b.y, h);
        return dx * dx + dy * dy <= radius * radius;
      })
      .map((b) => b.id);
  }
  const isCollector = (d: ContentBuilding | undefined) => !!d && (!!d.warehouse || !!d.trading_post);
  if (isCollector(def)) return island.buildings.filter((b) => !!defs.get(b.type)?.recipe).map((b) => b.id);
  if (def.recipe) return island.buildings.filter((b) => isCollector(defs.get(b.type))).map((b) => b.id);
  return [];
}
