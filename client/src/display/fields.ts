// Field placement hints (D-049). The rectangle drag of the field tool
// colours the tiles it covers from data the client already has (D-027):
// the island's static terrain and fertility tags, the buildings and roads
// of the latest server display, the content field definition and the
// accepting farms' positions with their content work radius (the same
// integer disc rule as the server). The colouring is a hint only: the
// client sends the tiles it shows as valid in one place_fields command and
// the server validates every tile (all or nothing). No assignment or
// efficiency is computed here; farms show the server's fields counts.
import type { BuildingDisplay, Content, ContentBuilding, Island } from "../api/client";
import { rotatedFootprint, type TilePos, tileKey } from "./geometry";

/** At most this many tiles per place_fields / demolish_fields command (server bound). */
export const MAX_FIELD_TILES = 256;

/** The tiles of the rectangle spanned by a and b (inclusive corners, any order), row by row. */
export function rectTiles(a: TilePos, b: TilePos): TilePos[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: TilePos[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/** A placed building with the footprint and radius the disc rule needs. */
interface FarmSite {
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * Whether the centre of tile (tx, ty) lies within the farm's work radius:
 * (2tx+1−(2x+W))² + (2ty+1−(2y+H))² ≤ (2r)² against the rotated footprint
 * (the server's disc rule in integer arithmetic).
 */
export function inFarmRadius(farm: FarmSite, tx: number, ty: number): boolean {
  const [w, h] = rotatedFootprint(farm.width, farm.height, farm.rotation);
  const dx = 2 * tx + 1 - (2 * farm.x + w);
  const dy = 2 * ty + 1 - (2 * farm.y + h);
  return dx * dx + dy * dy <= 4 * farm.radius * farm.radius;
}

/** The farms of an island that accept a field type (content `fields.type`), with their radius. */
export function acceptingFarms(
  buildings: readonly BuildingDisplay[],
  defs: ReadonlyMap<string, ContentBuilding>,
  fieldType: string,
): (BuildingDisplay & { def: ContentBuilding; radius: number })[] {
  const out: (BuildingDisplay & { def: ContentBuilding; radius: number })[] = [];
  for (const b of buildings) {
    const def = defs.get(b.type);
    if (def?.fields?.type === fieldType && def.work_area) out.push({ ...b, def, radius: def.work_area.radius });
  }
  return out;
}

/** The field building a farm type accepts (content), if any. */
export function fieldBuildingOf(content: Content, farmType: string): ContentBuilding | undefined {
  const farm = content.buildings.find((b) => b.id === farmType);
  const type = farm?.fields?.type;
  return type ? content.buildings.find((b) => b.field?.type === type) : undefined;
}

/** What the client knows about the island for the hint. */
export interface FieldHintData {
  island: Pick<Island, "width" | "height" | "terrain" | "fertilities">;
  buildings: readonly BuildingDisplay[];
  roads: readonly TilePos[];
  defs: ReadonlyMap<string, ContentBuilding>;
}

/**
 * Classification of candidate tiles for a field building: `valid` (green:
 * terrain, fertility, free and inside an accepting farm's radius) and
 * `outOfRange` (yellow: the only failing condition is the radius; shown,
 * never sent). Every other tile is dropped. Order follows the input.
 */
export function classifyFieldTiles(field: ContentBuilding, tiles: readonly TilePos[], data: FieldHintData): { valid: TilePos[]; outOfRange: TilePos[] } {
  const valid: TilePos[] = [];
  const outOfRange: TilePos[] = [];
  const f = field.field;
  if (!f) return { valid, outOfRange };
  const { island } = data;
  if (f.fertility && !island.fertilities.includes(f.fertility)) return { valid, outOfRange };
  const occupied = new Set(data.roads.map(tileKey));
  for (const b of data.buildings) {
    const def = data.defs.get(b.type);
    if (!def) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) occupied.add(tileKey({ x, y }));
  }
  const farms = acceptingFarms(data.buildings, data.defs, f.type);
  for (const t of tiles) {
    if (t.x < 0 || t.y < 0 || t.x >= island.width || t.y >= island.height) continue;
    const terrain = island.terrain[t.y * island.width + t.x];
    if (terrain === undefined || !f.terrain.includes(terrain)) continue;
    if (occupied.has(tileKey(t))) continue;
    const inRange = farms.some((farm) =>
      inFarmRadius({ x: farm.x, y: farm.y, rotation: farm.rotation, width: farm.def.width, height: farm.def.height, radius: farm.radius }, t.x, t.y),
    );
    (inRange ? valid : outOfRange).push(t);
  }
  return { valid, outOfRange };
}

/** The tiles to send for a rectangle (the valid ones, at most MAX_FIELD_TILES) and whether some were cut. */
export function fieldTilesToSend(valid: readonly TilePos[]): { tiles: TilePos[]; capped: boolean } {
  return { tiles: valid.slice(0, MAX_FIELD_TILES), capped: valid.length > MAX_FIELD_TILES };
}

/** Hint line of a field rectangle: counts of tiles to place and outside every ring. */
export function fieldRectHint(valid: number, outOfRange: number, fieldName: string): string {
  const parts: string[] = [];
  const name = fieldName.toLowerCase();
  if (valid === 0) parts.push(`No valid ${name} tile`);
  else parts.push(`${Math.min(valid, MAX_FIELD_TILES)} ${name}${valid === 1 ? "" : "s"}`);
  if (valid > MAX_FIELD_TILES) parts.push(`at most ${MAX_FIELD_TILES} per drag — ${valid - MAX_FIELD_TILES} not placed`);
  if (outOfRange > 0) parts.push(`${outOfRange} outside every farm's ring`);
  return parts.join(" · ");
}

/**
 * Build menu order: content order, with each field building listed right
 * after the first farm that accepts it.
 */
export function buildMenuOrder(buildings: readonly ContentBuilding[]): ContentBuilding[] {
  const out: ContentBuilding[] = [];
  const placed = new Set<string>();
  const fieldOf = new Map<string, ContentBuilding>();
  for (const b of buildings) if (b.field && !fieldOf.has(b.field.type)) fieldOf.set(b.field.type, b);
  const accepted = new Set(buildings.flatMap((b) => (b.fields ? [b.fields.type] : [])));
  for (const b of buildings) {
    if (b.field && accepted.has(b.field.type)) continue;
    if (!placed.has(b.id)) {
      out.push(b);
      placed.add(b.id);
    }
    const f = b.fields ? fieldOf.get(b.fields.type) : undefined;
    if (f && !placed.has(f.id)) {
      out.push(f);
      placed.add(f.id);
    }
  }
  return out;
}
