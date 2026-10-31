// Field placement hints and chain lookups (D-049, D-051 part 4). A field is
// placed from its farm's panel ("Add field"): the ghost is coloured from data
// the client already has (D-027) — the island's static terrain and fertility
// tags, the buildings and roads of the latest server display and the
// content field definition — and from the adjacency rule the server
// enforces: the footprint must touch (edges or corners) the farm or one of
// the farm's *active* fields. The colouring is a hint only: the client sends
// the place_field command wherever the user clicks and the server validates.
// No ownership, activity or efficiency is computed here; the farm and its
// fields show the server's `fields`, `farm_id` and `active`.
import type { BuildingDisplay, Content, ContentBuilding, Island } from "../api/client";
import { inSentence, t } from "../i18n";
import { rotatedFootprint, type TilePos, tileKey } from "./geometry";

/**
 * The field building a farm type owns (content `field.farms`, else
 * `field.farm`), if any: a field may serve several farm types (the cattle
 * pasture of the dairy and cattle farms, D-056 C4).
 */
export function fieldBuildingOf(content: Content, farmType: string): ContentBuilding | undefined {
  return content.buildings.find((b) => b.field && (b.field.farms ?? [b.field.farm]).includes(farmType));
}

/**
 * A building's size for the build menu and the Details rows (D-054):
 * "w×h" in tiles, the rows of it on water (piers), and for a farm its
 * fields at the maximum — "3×4 + 140 fields" for one-tile fields,
 * "3×3 + 3 pastures of 3×3" for modules.
 */
export function footprintText(def: Pick<ContentBuilding, "id" | "width" | "height" | "water_rows" | "fields">, content: Pick<Content, "buildings">): string {
  let text = `${def.width}×${def.height}`;
  if (def.water_rows) text += def.water_rows.min === def.water_rows.max
    ? t("field.onWater", { count: def.water_rows.min })
    : t("field.onWaterRange", def.water_rows);
  if (def.fields) {
    const field = fieldBuildingOf(content as Content, def.id);
    const max = def.fields.max;
    if (!field || (field.width === 1 && field.height === 1)) text += t("field.plain", { count: max });
    else text += t("field.modules", { count: max, name: inSentence(field.name), Name: field.name, w: field.width, h: field.height });
  }
  return text;
}

/** Whether two non-overlapping footprints share an edge segment (the server's 4-edge adjacency; a corner alone does not count). */
export function rectsTouch(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
  const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
  return (overlapY && (a.x + a.w === b.x || b.x + b.w === a.x)) || (overlapX && (a.y + a.h === b.y || b.y + b.h === a.y));
}

/** What the client knows about the island for the ghost hint. */
export interface FieldHintData {
  island: Pick<Island, "width" | "height" | "terrain" | "fertilities">;
  buildings: readonly BuildingDisplay[];
  roads: readonly TilePos[];
  defs: ReadonlyMap<string, ContentBuilding>;
}

/** Why the server would reject the field at the ghost's position. */
export type FieldHint = "bounds" | "terrain" | "occupied" | "fertility" | "not_adjacent" | "max_reached";

/**
 * The first rule the field ghost breaks (null: it looks valid), in the
 * server's order: maximum, bounds, terrain, occupied, fertility, adjacency.
 * `farm` is the farm display the field is placed from.
 */
export function fieldPlacementHint(farm: BuildingDisplay, field: ContentBuilding, x: number, y: number, rotation: number, data: FieldHintData): FieldHint | null {
  const f = field.field;
  if (!f || !farm.fields) return null;
  if (farm.fields.ids.length >= farm.fields.max) return "max_reached";
  const [w, h] = rotatedFootprint(field.width, field.height, rotation);
  const { island } = data;
  if (x < 0 || y < 0 || x + w > island.width || y + h > island.height) return "bounds";
  const occupied = new Set(data.roads.map(tileKey));
  for (const b of data.buildings) {
    const def = data.defs.get(b.type);
    if (!def) continue;
    const [bw, bh] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let ty = b.y; ty < b.y + bh; ty++) for (let tx = b.x; tx < b.x + bw; tx++) occupied.add(tileKey({ x: tx, y: ty }));
  }
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const terrain = island.terrain[ty * island.width + tx];
      if (terrain === undefined || !f.terrain.includes(terrain)) return "terrain";
      if (occupied.has(tileKey({ x: tx, y: ty }))) return "occupied";
    }
  }
  if (f.fertility && !island.fertilities.includes(f.fertility)) return "fertility";
  const rect = { x, y, w, h };
  const farmDef = data.defs.get(farm.type);
  if (farmDef) {
    const [fw, fh] = rotatedFootprint(farmDef.width, farmDef.height, farm.rotation);
    if (rectsTouch({ x: farm.x, y: farm.y, w: fw, h: fh }, rect)) return null;
  }
  for (const b of data.buildings) {
    if (b.farm_id !== farm.id || b.active !== true) continue;
    const def = data.defs.get(b.type);
    if (!def) continue;
    const [bw, bh] = rotatedFootprint(def.width, def.height, b.rotation);
    if (rectsTouch({ x: b.x, y: b.y, w: bw, h: bh }, rect)) return null;
  }
  return "not_adjacent";
}

/** Hint text of a rejected ghost. */
export function fieldHintText(hint: FieldHint, fieldName: string, farmName: string): string {
  // `name` is lower case for English sentences; German nouns keep their capital (`Name`, `Farm`).
  const params = { name: inSentence(fieldName), Name: fieldName, farm: inSentence(farmName), Farm: farmName };
  return t(`field.hint.${hint}`, params);
}

/** The farm of a field or the farm itself, and the farm's fields: the chain a selection highlights. */
export function farmChain(selected: BuildingDisplay, buildings: readonly BuildingDisplay[]): { farm: BuildingDisplay | undefined; fields: BuildingDisplay[] } {
  const farm = selected.fields ? selected : selected.farm_id !== undefined ? buildings.find((b) => b.id === selected.farm_id) : undefined;
  if (!farm) return { farm: undefined, fields: [] };
  return { farm, fields: buildings.filter((b) => b.farm_id === farm.id) };
}
