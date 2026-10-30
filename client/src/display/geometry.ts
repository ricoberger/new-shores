// The only client-side geometry (D-027): footprint rotation, the Manhattan
// L-path of road drags, road adjacency of a footprint over the server's
// road tiles (a display hint for the placement ghost and the cart paths,
// D-042) and lookups of the island's fertility tags and deposit tiles for
// the ghost hints. No placement, connectivity or work-area rule is
// evaluated here; the server is the only validator.

export interface TilePos {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Footprint size at a rotation: 90 and 270 swap width and height. */
export function rotatedFootprint(width: number, height: number, rotation: number): [number, number] {
  return rotation === 90 || rotation === 270 ? [height, width] : [width, height];
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Whether a footprint placed at (bx, by) covers tile (x, y). */
export function covers(bx: number, by: number, width: number, height: number, rotation: number, x: number, y: number): boolean {
  const [w, h] = rotatedFootprint(width, height, rotation);
  return x >= bx && x < bx + w && y >= by && y < by + h;
}

/**
 * Manhattan L-path from a to b: horizontal first, then vertical, both ends
 * inclusive (same as the scenario runner's lPath).
 */
export function lPath(a: TilePos, b: TilePos): TilePos[] {
  const out: TilePos[] = [];
  const dx = b.x < a.x ? -1 : 1;
  for (let x = a.x; ; x += dx) {
    out.push({ x, y: a.y });
    if (x === b.x) break;
  }
  const dy = b.y < a.y ? -1 : 1;
  for (let y = a.y; y !== b.y; ) {
    y += dy;
    out.push({ x: b.x, y });
  }
  return out;
}

/** Footprint data the picking needs (content width/height at rotation 0). */
export interface FootprintDef {
  width: number;
  height: number;
}

/** The building whose rotated footprint covers tile (x, y), if any. */
export function buildingAt<B extends { type: string; x: number; y: number; rotation: number }>(
  buildings: readonly B[],
  defs: ReadonlyMap<string, FootprintDef>,
  x: number,
  y: number,
): B | undefined {
  return buildings.find((b) => {
    const d = defs.get(b.type);
    return d !== undefined && covers(b.x, b.y, d.width, d.height, b.rotation, x, y);
  });
}

/** Key of a tile in road sets ("x,y"). */
export function tileKey(p: TilePos): string {
  return `${p.x},${p.y}`;
}

/**
 * Road tiles 4-adjacent to the footprint [x, x+w) × [y, y+h), given the
 * server's road tiles as a set of tileKey strings.
 */
export function adjacentRoads(roads: ReadonlySet<string>, x: number, y: number, w: number, h: number): TilePos[] {
  const ring: TilePos[] = [];
  for (let tx = x; tx < x + w; tx++) ring.push({ x: tx, y: y - 1 }, { x: tx, y: y + h });
  for (let ty = y; ty < y + h; ty++) ring.push({ x: x - 1, y: ty }, { x: x + w, y: ty });
  return ring.filter((p) => roads.has(tileKey(p)));
}

/**
 * Placement ghost hint (UI.md §3, D-042): true when a building that
 * requires a road would have no road tile next to its rotated footprint, so
 * the ghost shows yellow ("not connected"). Never a validity decision.
 */
export function missingRoadHint(
  def: FootprintDef & { requires_road: boolean },
  roads: ReadonlySet<string>,
  x: number,
  y: number,
  rotation: number,
): boolean {
  if (!def.requires_road) return false;
  const [w, h] = rotatedFootprint(def.width, def.height, rotation);
  return adjacentRoads(roads, x, y, w, h).length === 0;
}

/**
 * Placement ghost hint (UI.md §3): true when a building that requires a
 * deposit covers no deposit tile of its kind with its rotated footprint
 * (the server's island deposits, keyed by tileKey with the kind as value).
 * A lookup for the ghost colour and hint text, never a validity decision.
 */
export function missingDepositHint(
  def: FootprintDef & { requires_deposit?: string },
  deposits: ReadonlyMap<string, string>,
  x: number,
  y: number,
  rotation: number,
): boolean {
  const kind = def.requires_deposit;
  if (!kind) return false;
  const [w, h] = rotatedFootprint(def.width, def.height, rotation);
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (deposits.get(tileKey({ x: tx, y: ty })) === kind) return false;
    }
  }
  return true;
}

/** Per-column water depth (D-062); absent on inland buildings. */
export interface WaterEdgeDef extends FootprintDef {
  water_rows?: { min: number; max: number };
}

/**
 * The maximum water band, for pier display geometry only. This is not the
 * actual coast: waterEdgeTiles resolves each column independently.
 */
export function waterRows(
  def: WaterEdgeDef,
  x: number,
  y: number,
  rotation: number,
): { x: number; y: number; w: number; h: number } | null {
  const n = def.water_rows?.max ?? 0;
  if (n <= 0) return null;
  const [w, h] = rotatedFootprint(def.width, def.height, rotation);
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: x + w - n, y, w: n, h };
    case 180:
      return { x, y: y + h - n, w, h: n };
    case 270:
      return { x, y, w: n, h };
  }
  return { x, y, w, h: n };
}

export interface WaterEdgeTile extends TilePos {
  /** Whether this tile is in the column's chosen water prefix. */
  water: boolean;
  problem: "front" | "land" | null;
}

/**
 * Per-tile water-edge preview from server terrain (quays read as "quay").
 * A column's contiguous water prefix is clamped to min..max. Non-water in
 * that prefix is red; non-buildable terrain after it is red too. A river
 * never counts as water, nor does water behind an intervening land tile.
 * This is a display mirror, not placement authority.
 */
export function waterEdgeTiles(
  def: WaterEdgeDef,
  terrain: (x: number, y: number) => string,
  x: number,
  y: number,
  rotation: number,
): WaterEdgeTile[] {
  const rows = def.water_rows;
  if (!rows) return [];
  const r = ((rotation % 360) + 360) % 360;
  const pos = (column: number, row: number): TilePos => {
    switch (r) {
      case 90: return { x: x + def.height - 1 - row, y: y + column };
      case 180: return { x: x + column, y: y + def.height - 1 - row };
      case 270: return { x: x + row, y: y + column };
      default: return { x: x + column, y: y + row };
    }
  };
  const out: WaterEdgeTile[] = [];
  for (let column = 0; column < def.width; column++) {
    let k = 0;
    while (k < rows.max) {
      const p = pos(column, k);
      if (terrain(p.x, p.y) !== "water") break;
      k++;
    }
    k = Math.max(k, rows.min);
    for (let row = 0; row < def.height; row++) {
      const p = pos(column, row);
      const t = terrain(p.x, p.y);
      const water = row < k;
      const valid = water ? t === "water" : t === "coast" || t === "grass" || t === "forest" || t === "quay";
      out.push({ ...p, water, problem: valid ? null : water ? "front" : "land" });
    }
  }
  return out;
}

/** The legacy error precedence for the ghost text: required water first. */
export function waterEdgeHint(
  def: WaterEdgeDef,
  terrain: (x: number, y: number) => string,
  x: number,
  y: number,
  rotation: number,
): "front" | "land" | null {
  const tiles = waterEdgeTiles(def, terrain, x, y, rotation);
  if (tiles.some((p) => p.problem === "front")) return "front";
  return tiles.some((p) => p.problem === "land") ? "land" : null;
}

/** A run of road tiles drawn as one strip: from (x0, y0) to (x1, y1) inclusive, horizontal or vertical. */
export interface Strip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Road tiles merged into strips (drawing only): horizontal runs of two or
 * more tiles first (by row, then column), the remaining tiles as vertical
 * runs. Every tile is in exactly one strip.
 */
export function roadStrips(tiles: readonly TilePos[]): Strip[] {
  const set = new Set(tiles.map(tileKey));
  const sorted = [...new Set(tiles.map(tileKey))].map((k) => {
    const [x, y] = k.split(",").map(Number) as [number, number];
    return { x, y };
  });
  sorted.sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Set<string>();
  const out: Strip[] = [];
  for (const t of sorted) {
    if (used.has(tileKey(t))) continue;
    let x1 = t.x;
    while (set.has(tileKey({ x: x1 + 1, y: t.y })) && !used.has(tileKey({ x: x1 + 1, y: t.y }))) x1++;
    if (x1 === t.x) continue;
    for (let x = t.x; x <= x1; x++) used.add(tileKey({ x, y: t.y }));
    out.push({ x0: t.x, y0: t.y, x1, y1: t.y });
  }
  const rest = sorted.filter((t) => !used.has(tileKey(t))).sort((a, b) => a.x - b.x || a.y - b.y);
  for (const t of rest) {
    if (used.has(tileKey(t))) continue;
    let y1 = t.y;
    while (set.has(tileKey({ x: t.x, y: y1 + 1 })) && !used.has(tileKey({ x: t.x, y: y1 + 1 }))) y1++;
    for (let y = t.y; y <= y1; y++) used.add(tileKey({ x: t.x, y }));
    out.push({ x0: t.x, y0: t.y, x1: t.x, y1 });
  }
  return out;
}
