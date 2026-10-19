// The only client-side geometry (D-027): footprint rotation and the
// Manhattan L-path of road drags. No placement, connectivity or work-area
// rule is evaluated here.

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
