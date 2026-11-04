// Plans (D-071, MECHANICS §2 "Planning"): planned buildings, fields and
// road tiles from the island's display (`plans`, `planned_roads`, a real
// farm's `planned_fields`). A plan reserves its footprint and is invisible
// to every rule, so the client's placement hints treat it as taken and
// every other display helper ignores it — plans are in their own arrays,
// never in `buildings` or `roads`. Display hints only (D-027): the server
// validates every placement and every plan command.
import type { BuildingDisplay, ContentBuilding, IslandDisplay, PlanCostDisplay, PlanDisplay, PlannedRoadDisplay } from "../api/client";
import type { CostPart } from "./buildMenu";
import type { RoadDragTile } from "./roaddrag";
import { buildingAt, type FootprintDef, rotatedFootprint, type TilePos, tileKey } from "./geometry";

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
  // A planned farm (plannedFarmAsBuilding) already lists its planned fields.
  const planned = (is.plans ?? []).filter((p) => p.farm_id === farm.id && !farm.fields?.ids.includes(p.id)).map((p) => p.id);
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

/** The planned building or field whose footprint covers a tile, or undefined. */
export function planAt(is: Pick<IslandDisplay, "plans">, defs: ReadonlyMap<string, FootprintDef>, x: number, y: number): PlanDisplay | undefined {
  return buildingAt(is.plans ?? [], defs, x, y);
}

/** The planned road segment (the server's 4-connected planned tiles of one road type) through a tile, or undefined. */
export function plannedRoadAt(is: Pick<IslandDisplay, "planned_roads">, x: number, y: number): PlannedRoadDisplay | undefined {
  return (is.planned_roads ?? []).find((r) => r.tiles.some((t) => t.x === x && t.y === y));
}

/** The planned buildings (not fields) a set of tiles covers: what the Demolish tool's rectangle removes besides fields. */
export function plansUnder(tiles: readonly TilePos[], is: Pick<IslandDisplay, "plans">, defs: ReadonlyMap<string, ContentBuilding>): PlanDisplay[] {
  const out: PlanDisplay[] = [];
  for (const t of tiles) {
    const p = planAt(is, defs, t.x, t.y);
    if (p && p.farm_id === undefined && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The farm a planned field belongs to: a real farm (its card builds the
 * planned fields) or a planned farm (built with them).
 */
export function planFarmOf(is: Pick<IslandDisplay, "buildings" | "plans">, field: PlanDisplay): { building?: BuildingDisplay; plan?: PlanDisplay } {
  if (field.farm_id === undefined) return {};
  const building = is.buildings.find((b) => b.id === field.farm_id);
  if (building) return { building };
  const plan = (is.plans ?? []).find((p) => p.id === field.farm_id);
  return plan ? { plan } : {};
}

/**
 * A planned farm as the farm the field tool adds to (D-071 §4): its
 * planned fields are its fields (none active: nothing is built), the
 * content's maximum. Undefined for a plan that is not a farm.
 */
export function plannedFarmAsBuilding(p: PlanDisplay, is: Pick<IslandDisplay, "plans">, def: ContentBuilding | undefined): BuildingDisplay | undefined {
  if (!def?.fields) return undefined;
  const ids = (is.plans ?? []).filter((f) => f.farm_id === p.id).map((f) => f.id);
  return { ...planAsBuilding(p, false), fields: { active: 0, required: def.fields.required, max: def.fields.max, ids } };
}

/** The tiles of a plan's footprint (island tiles, rotated). */
export function planFootprint(p: Pick<PlanDisplay, "x" | "y" | "rotation">, def: FootprintDef): { x: number; y: number; w: number; h: number } {
  const [w, h] = rotatedFootprint(def.width, def.height, p.rotation);
  return { x: p.x, y: p.y, w, h };
}

/**
 * A plan's cost in build-menu format (D-071 §5): the server's total (a
 * farm's planned fields included) with the parts the island cannot cover
 * right now marked short (shown red, never disabled: the server decides).
 */
export function planCostParts(cost: PlanCostDisplay, gold: number, stock: (good: string) => number): { gold: { amount: number; short: boolean }; materials: CostPart[] } {
  return {
    gold: { amount: cost.gold, short: cost.gold > gold },
    materials: Object.entries(cost.materials)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([good, amount]) => ({ good, amount, short: amount > stock(good) })),
  };
}
