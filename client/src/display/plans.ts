// Plans (D-071, MECHANICS §2 "Planning"): planned buildings, fields and
// road tiles from the island's display (`plans`, `planned_roads`, a real
// farm's `planned_fields`). A plan reserves its footprint and is invisible
// to every rule, so the client's placement hints treat it as taken and
// every other display helper ignores it — plans are in their own arrays,
// never in `buildings` or `roads`. Display hints only (D-027): the server
// validates every placement and every plan command.
import type { BuildingDisplay, IslandDisplay, PlanDisplay } from "../api/client";
import type { RoadDragTile } from "./roaddrag";
import { type TilePos, tileKey } from "./geometry";

/**
 * A plan as a building of the hint data (footprint only). `chain`: a
 * planned field counts for its farm's field chain, as the server's
 * planned placements see it (planning mode); else it only reserves its
 * tiles.
 */
export function planAsBuilding(p: PlanDisplay, chain: boolean): BuildingDisplay {
  return {
    id: p.id,
    type: p.type,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    paused: false,
    paused_reason: "",
    status: "ok",
    efficiency_permille: 0,
    throughput_factor_permille: 0,
    ...(p.farm_id !== undefined ? { farm_id: p.farm_id, active: chain } : {}),
  };
}

/** The planned road tiles of an island. */
export function plannedRoadTiles(is: Pick<IslandDisplay, "planned_roads">): TilePos[] {
  return (is.planned_roads ?? []).flatMap((r) => r.tiles.map(({ x, y }) => ({ x, y })));
}

/** How many plans an island carries: planned buildings and fields, and planned road tiles. */
export function planCount(is: Pick<IslandDisplay, "plans" | "planned_roads">): number {
  return (is.plans ?? []).length + plannedRoadTiles(is).length;
}

/**
 * The buildings and roads the field hints read (display/fields.ts,
 * fieldpaint.ts): plans reserve their footprints like buildings, planned
 * road tiles like roads. In planning mode a planned field also chains its
 * farm (the server validates a planned field against the island with its
 * plans built).
 */
export function hintSite(is: Pick<IslandDisplay, "buildings" | "roads" | "plans" | "planned_roads">, planning: boolean): { buildings: BuildingDisplay[]; roads: TilePos[] } {
  return {
    buildings: [...is.buildings, ...(is.plans ?? []).map((p) => planAsBuilding(p, planning))],
    roads: [...is.roads, ...plannedRoadTiles(is)],
  };
}

/**
 * The farm the field tool adds to, as the hints count it: in planning mode
 * its planned fields count toward the maximum like built ones (the server
 * caps fields and planned fields together). A planned farm is the plan with
 * its planned fields.
 */
export function hintFarm(farm: BuildingDisplay, is: Pick<IslandDisplay, "plans">, planning: boolean): BuildingDisplay {
  if (!planning || !farm.fields) return farm;
  const planned = (is.plans ?? []).filter((p) => p.farm_id === farm.id).map((p) => p.id);
  if (planned.length === 0) return farm;
  return { ...farm, fields: { ...farm.fields, ids: [...farm.fields.ids, ...planned] } };
}

/**
 * The road drag's tiles in planning mode (D-071): a planned road goes on
 * free tiles only, so a tile carrying a road or a planned road is skipped
 * (not sent). Planned buildings and fields reserve their tiles in both
 * modes (pass `hintSite` buildings to planRoadDrag); outside planning mode
 * a real road over a planned road replaces the plan, so the drag is
 * unchanged.
 */
export function planningRoadDrag(tiles: readonly RoadDragTile[], is: Pick<IslandDisplay, "roads" | "planned_roads">): RoadDragTile[] {
  const taken = new Set([...is.roads.map(tileKey), ...plannedRoadTiles(is).map(tileKey)]);
  return tiles.map((tl) => (taken.has(tileKey(tl)) ? { ...tl, hint: "skip" } : tl));
}
