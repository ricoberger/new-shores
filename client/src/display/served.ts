import type { BuildingDisplay, ContentBuilding } from "../api/client";

/**
 * The buildings shown together with the selected one: for a house the buildings that serve it, for a
 * service building (chapel, market, …) the houses it serves. The server decides (`served_by` of a house);
 * this only looks the relation up in both directions.
 */
export function servedRelated(selected: BuildingDisplay, buildings: readonly BuildingDisplay[], def: ContentBuilding | undefined): number[] {
  if (selected.served_by) return [...selected.served_by];
  if (!def?.service) return [];
  return buildings.filter((b) => b.served_by?.includes(selected.id)).map((b) => b.id);
}
