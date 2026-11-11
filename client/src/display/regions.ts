// Regions of one world (D-076): every region is its own archipelago with
// its own map. The renderer, the minimap and the map overlays show one
// region at a time (regionView); ships, routes, quests and warnings stay
// world-wide and name their region. With one region every function here
// is the identity, so a single-region world looks exactly as before.
import type { Content, DisplayState, Island, ShipDisplay } from "../api/client";

/** The home region's ID (the first region; "" for a payload without regions). */
export function homeRegionId(d: Pick<DisplayState, "regions">): string {
  return d.regions[0]?.id ?? "";
}

/** The region shown: the chosen one while the world has it unlocked, else the home region. */
export function currentRegionId(d: Pick<DisplayState, "regions">, chosen: string | null): string {
  if (chosen !== null && d.regions.some((r) => r.id === chosen && r.unlocked)) return chosen;
  return homeRegionId(d);
}

/** The switcher appears only once the world has more than one unlocked region (D-076 §6). */
export function showRegionSwitcher(d: Pick<DisplayState, "regions">): boolean {
  return d.regions.filter((r) => r.unlocked).length > 1;
}

/** A region's name: the home region's from the content's top level, a later one's from its own catalogue. */
export function regionName(content: Content | null, id: string): string {
  if (!content) return id;
  if (content.region.id === id) return content.region.name;
  return content.regions?.find((r) => r.id === id)?.catalogue?.region.name ?? id;
}

/** A ship on a passage leg between two regions: on no map, in the ship list only. */
export function betweenRegions(s: Pick<ShipDisplay, "region_id">): boolean {
  return s.region_id === null;
}

/**
 * The display of one region: its islands, the ships on its map, the routes
 * whose stops all lie in it and the archipelago framed on the region (its
 * seed and bounds, so the renderer re-places the camera on a switch).
 * With one region it returns d itself.
 */
export function regionView(d: DisplayState, regionId: string): DisplayState {
  if (d.regions.length <= 1 && d.ships.every((s) => !betweenRegions(s))) return d;
  const region = d.regions.find((r) => r.id === regionId);
  const islands = d.islands.filter((is) => is.region_id === regionId);
  const home = region !== undefined && region.id === homeRegionId(d);
  return {
    ...d,
    islands,
    ships: d.ships.filter((s) => s.region_id === regionId),
    routes: d.routes.filter((r) => r.stops.every((st) => st.region_id === regionId)),
    archipelago: region
      ? { ...d.archipelago, seed: region.seed, roll: home ? d.archipelago.roll : 0, rerollable: home && d.archipelago.rerollable, bounds: region.bounds }
      : d.archipelago,
  };
}

/** The static island data of one region's islands (the renderer picks islands among them). */
export function regionStatics(statics: ReadonlyMap<string, Island>, view: Pick<DisplayState, "islands">): ReadonlyMap<string, Island> {
  if (view.islands.length >= statics.size && view.islands.every((is) => statics.has(is.id))) return statics;
  const out = new Map<string, Island>();
  for (const is of view.islands) {
    const st = statics.get(is.id);
    if (st) out.set(is.id, st);
  }
  return out;
}

/** The number of warnings per region (buildings and ships with a status other than ok name their region). */
export function warningsByRegion(entries: readonly { regionId: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) out.set(e.regionId, (out.get(e.regionId) ?? 0) + 1);
  return out;
}
