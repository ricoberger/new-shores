// Field painting (D-054): a dragged rectangle of field anchors, its ghost
// colouring and the live count. The colouring is a hint from data the client
// already has (D-027), with the server's batch rules replayed on the latest
// display: every anchor is checked with the one-field rules
// (fieldPlacementHint's order — maximum, bounds, terrain, occupied,
// fertility, adjacency), the anchors the rectangle accepts count as active
// fields for the ones after them, and the passes repeat while one accepts
// an anchor, until the farm's maximum. The server validates the command and
// its per-tile results are what counts; nothing here is a rule.
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import type { FieldHint, FieldHintData } from "./fields";
import { rotatedFootprint, type TilePos, tileKey } from "./geometry";

/** Tiles of one place_fields / demolish_fields command (the server's MaxFieldTiles). */
export const MAX_PAINT_TILES = 512;

/** A painted rectangle: the tile the drag started on and the tile under the pointer. */
export interface PaintDrag {
  start: TilePos;
  end: TilePos;
}

/**
 * The field anchors (top-left tiles) of a dragged rectangle for a field of
 * w × h tiles (rotated): a grid of whole fields aligned on the start tile —
 * every grid cell the rectangle from `start` to `end` reaches — ordered by
 * rows from the start. More than MAX_PAINT_TILES anchors are clipped to a
 * rectangle of at most that many, kept at the start corner (`clipped`).
 */
export function paintAnchors(drag: PaintDrag, w: number, h: number): { anchors: TilePos[]; clipped: boolean } {
  const { start, end } = drag;
  const kx = Math.floor((end.x - start.x) / w);
  const ky = Math.floor((end.y - start.y) / h);
  let cols = Math.abs(kx) + 1;
  let rows = Math.abs(ky) + 1;
  const clipped = cols * rows > MAX_PAINT_TILES;
  if (clipped) [cols, rows] = clipGrid(cols, rows);
  const sx = kx < 0 ? -1 : 1;
  const sy = ky < 0 ? -1 : 1;
  const anchors: TilePos[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) anchors.push({ x: start.x + sx * i * w, y: start.y + sy * j * h });
  return { anchors, clipped };
}

/** The largest columns × rows ≤ MAX_PAINT_TILES with the drag's aspect (both shrink by the same factor). */
function clipGrid(cols: number, rows: number): [number, number] {
  const k = Math.sqrt(MAX_PAINT_TILES / (cols * rows));
  let c = Math.max(1, Math.min(cols, Math.floor(cols * k)));
  let r = Math.max(1, Math.min(rows, Math.floor(MAX_PAINT_TILES / c)));
  // A very thin drag: give the columns what the rows cannot use.
  c = Math.max(1, Math.min(cols, Math.floor(MAX_PAINT_TILES / r)));
  r = Math.max(1, Math.min(rows, Math.floor(MAX_PAINT_TILES / c)));
  return [c, r];
}

/** Every tile of a dragged rectangle (demolish rectangles), clipped like paintAnchors. */
export function paintTiles(drag: PaintDrag): { tiles: TilePos[]; clipped: boolean } {
  const { anchors, clipped } = paintAnchors(drag, 1, 1);
  return { tiles: anchors, clipped };
}

/** One anchor of a painted rectangle: null hint = the server is expected to place a field there. */
export interface PaintTile extends TilePos {
  hint: FieldHint | null;
}

/** The ghost of a painted rectangle. */
export interface PaintPlan {
  tiles: PaintTile[];
  /** Field footprint (rotated). */
  w: number;
  h: number;
  /** Fields the farm has, fields the rectangle would add, and its maximum. */
  placed: number;
  adding: number;
  max: number;
  /** Anchors red only because the maximum is reached ("max"). */
  overMax: number;
  clipped: boolean;
}

/**
 * The ghost of `anchors` (in the order they are sent) for the field
 * building `field` of `farm`: each anchor's hint after replaying the
 * server's passes (see the file comment), the count it would reach.
 */
export function planPaint(farm: BuildingDisplay, field: ContentBuilding, anchors: readonly TilePos[], rotation: number, data: FieldHintData, clipped = false): PaintPlan {
  const [w, h] = rotatedFootprint(field.width, field.height, rotation);
  const max = farm.fields?.max ?? 0;
  const placed = farm.fields?.ids.length ?? 0;
  const f = field.field;
  const { island } = data;
  const occupied = new Set(data.roads.map(tileKey));
  // Tiles of the farm and its active fields: a field must share an edge with one.
  const active = new Set<string>();
  const cover = (x: number, y: number, bw: number, bh: number, into: Set<string>) => {
    for (let ty = y; ty < y + bh; ty++) for (let tx = x; tx < x + bw; tx++) into.add(tileKey({ x: tx, y: ty }));
  };
  for (const b of data.buildings) {
    const def = data.defs.get(b.type);
    if (!def) continue;
    const [bw, bh] = rotatedFootprint(def.width, def.height, b.rotation);
    cover(b.x, b.y, bw, bh, occupied);
    if (b.id === farm.id || (b.farm_id === farm.id && b.active === true)) cover(b.x, b.y, bw, bh, active);
  }
  const fertile = !f?.fertility || island.fertilities.includes(f.fertility);
  // The rules that do not change while the rectangle is placed (its anchors never overlap).
  const fixed = anchors.map((a): FieldHint | null => {
    if (!f) return "terrain";
    if (a.x < 0 || a.y < 0 || a.x + w > island.width || a.y + h > island.height) return "bounds";
    for (let ty = a.y; ty < a.y + h; ty++) {
      for (let tx = a.x; tx < a.x + w; tx++) {
        const terrain = island.terrain[ty * island.width + tx];
        if (terrain === undefined || !f.terrain.includes(terrain)) return "terrain";
        if (occupied.has(tileKey({ x: tx, y: ty }))) return "occupied";
      }
    }
    return fertile ? null : "fertility";
  });
  const touches = (a: TilePos) => {
    for (let tx = a.x; tx < a.x + w; tx++) if (active.has(tileKey({ x: tx, y: a.y - 1 })) || active.has(tileKey({ x: tx, y: a.y + h }))) return true;
    for (let ty = a.y; ty < a.y + h; ty++) if (active.has(tileKey({ x: a.x - 1, y: ty })) || active.has(tileKey({ x: a.x + w, y: ty }))) return true;
    return false;
  };
  const hints: (FieldHint | null)[] = anchors.map(() => "not_adjacent");
  const done = anchors.map(() => false);
  let count = placed;
  for (let progress = true; progress; ) {
    progress = false;
    anchors.forEach((a, i) => {
      if (done[i]) return;
      const hint = count >= max ? "max_reached" : (fixed[i] ?? (touches(a) ? null : "not_adjacent"));
      hints[i] = hint;
      if (hint !== null) return;
      done[i] = true;
      progress = true;
      count++;
      cover(a.x, a.y, w, h, active);
    });
  }
  const tiles = anchors.map((a, i) => ({ x: a.x, y: a.y, hint: hints[i] ?? null }));
  return { tiles, w, h, placed, adding: count - placed, max, overMax: tiles.filter((t) => t.hint === "max_reached").length, clipped };
}

/** The live count of a painted rectangle: "n / max" after it, and why some anchors are red. */
export function paintCountText(plan: PaintPlan): string {
  const parts = [`${plan.placed + plan.adding} / ${plan.max}`];
  if (plan.adding > 0) parts.push(`+${plan.adding}`);
  if (plan.overMax > 0) parts.push(`${plan.overMax} over the max`);
  if (plan.clipped) parts.push(`clipped to ${MAX_PAINT_TILES} tiles`);
  return parts.join(" · ");
}

/**
 * The fields of the farm `farmId` (any farm: null) a rectangle of tiles
 * covers, and per farm the tiles of the rectangle on its fields (what a
 * demolish_fields sends: a field covered by several tiles goes once).
 */
export function fieldsUnder(tiles: readonly TilePos[], buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>, farmId: number | null): Map<number, { fields: BuildingDisplay[]; tiles: TilePos[] }> {
  const byTile = new Map<string, BuildingDisplay>();
  for (const b of buildings) {
    if (b.farm_id === undefined || (farmId !== null && b.farm_id !== farmId)) continue;
    const def = defs.get(b.type);
    if (!def?.field) continue;
    const [bw, bh] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let ty = b.y; ty < b.y + bh; ty++) for (let tx = b.x; tx < b.x + bw; tx++) byTile.set(tileKey({ x: tx, y: ty }), b);
  }
  const out = new Map<number, { fields: BuildingDisplay[]; tiles: TilePos[] }>();
  for (const t of tiles) {
    const b = byTile.get(tileKey(t));
    if (!b || b.farm_id === undefined) continue;
    let e = out.get(b.farm_id);
    if (!e) out.set(b.farm_id, (e = { fields: [], tiles: [] }));
    if (!e.fields.includes(b)) e.fields.push(b);
    e.tiles.push({ x: t.x, y: t.y });
  }
  return out;
}
