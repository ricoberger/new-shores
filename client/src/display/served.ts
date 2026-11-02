import type { BuildingDisplay, ContentBuilding } from "../api/client";

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
