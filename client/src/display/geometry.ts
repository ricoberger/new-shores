// The only client-side geometry (D-027): footprint rotation, the Manhattan
// L-path of road drags and road adjacency of a footprint over the server's
// road tiles (a display hint for the placement ghost and the cart paths,
// D-042). No placement, connectivity or work-area rule is evaluated here;
// the server is the only validator.

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
