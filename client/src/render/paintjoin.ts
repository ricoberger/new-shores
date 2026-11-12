// The join pieces of the paint families (D-077 §2–§3; ART_DIRECTION §7
// wall set): each hedge, garden wall or city wall tile is drawn with the
// piece of its family whose arms meet its neighbours — straight, end,
// corner, T or cross, the model `<id>.<piece>` of the manifest (the
// straight piece is the family's own model) — turned to fit, like roads
// join. A city wall also joins a military building next to it (tower,
// gatehouse, castle: their wall stubs), and a straight city wall tile over
// a land road is the `arch`. Render data only: the server stores each tile
// as a 1 × 1 building at rotation 0.
import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { rotateXZ, rotationYaw, toWorld } from "./models";

export type JoinPiece = "straight" | "arch" | "end" | "corner" | "t" | "cross";

/** A building as drawn: `model` is the manifest ID of its join piece (absent: its type's own model). */
export type DrawnBuilding = BuildingDisplay & { model?: string };
type Rotation = BuildingDisplay["rotation"];

/** The arms of each piece in recipe space (x, y toward the front): assets/voxel/nsvoxel/parts_d077.py JOIN_ARMS. */
const RECIPE_ARMS: Record<Exclude<JoinPiece, "arch">, readonly (readonly [number, number])[]> = {
  straight: [
    [-1, 0],
    [1, 0],
  ],
  end: [[1, 0]],
  corner: [
    [1, 0],
    [0, 1],
  ],
  t: [
    [-1, 0],
    [1, 0],
    [0, 1],
  ],
  cross: [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ],
};

/** Neighbour bits of a tile (island directions). */
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** The island direction bit of a recipe-space arm at a rotation: the model placement's own transform (glTF → world → island). */
export function armBit(rx: number, ry: number, rotation: number): number {
  // Recipe (x, y, z up) → glTF (x, z, −y) → world (render/models.ts toWorld) → turned by the rotation; island y is −world z.
  const w = toWorld("building", [rx, 0, -ry]);
  const [wx, wz] = rotateXZ(w[0], w[2], rotationYaw(rotation));
  const dx = Math.round(wx);
  const dy = Math.round(-wz);
  return dx > 0 ? E : dx < 0 ? W : dy > 0 ? S : N;
}

/** Piece and rotation per neighbour mask (0..15). */
const TABLE: readonly { piece: Exclude<JoinPiece, "arch">; rotation: Rotation }[] = (() => {
  const out: { piece: Exclude<JoinPiece, "arch">; rotation: Rotation }[] = [];
  for (const piece of ["straight", "end", "corner", "t", "cross"] as const) {
    for (const rotation of [0, 90, 180, 270] as const) {
      const mask = RECIPE_ARMS[piece].reduce((m, [x, y]) => m | armBit(x, y, rotation), 0);
      out[mask] ??= { piece, rotation };
    }
  }
  // An isolated tile: the straight piece.
  out[0] = { piece: "straight", rotation: 0 };
  return out;
})();

/** The piece and rotation of a tile with these neighbour bits (N 1, E 2, S 4, W 8). */
export function joinPiece(mask: number): { piece: Exclude<JoinPiece, "arch">; rotation: Rotation } {
  return TABLE[mask & 15] as { piece: Exclude<JoinPiece, "arch">; rotation: Rotation };
}

/** Whether a building is a joining paint family (not a ground kind like the square). */
export function joins(def: ContentBuilding | undefined): boolean {
  return !!def?.paint_family && !def.paint_family.ground;
}

/**
 * The island's buildings as drawn: each joining paint-family tile with the
 * model ID of its piece and the piece's rotation; every other building as
 * it is (the same object).
 */
export function joinedBuildings(display: Pick<IslandDisplay, "buildings" | "roads">, defs: ReadonlyMap<string, ContentBuilding>): DrawnBuilding[] {
  if (!display.buildings.some((b) => joins(defs.get(b.type)))) return display.buildings as DrawnBuilding[];
  const at = new Map<string, string>();
  for (const b of display.buildings) {
    const def = defs.get(b.type);
    if (!def) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) at.set(`${x},${y}`, b.type);
  }
  const landRoad = new Set(display.roads.filter((r) => r.type !== "quay").map((r) => `${r.x},${r.y}`));
  return display.buildings.map((b) => {
    const def = defs.get(b.type);
    if (!joins(def)) return b;
    const wall = !!def?.paint_family?.road_crossing;
    const meets = (x: number, y: number) => {
      const t = at.get(`${x},${y}`);
      if (t === undefined) return false;
      if (t === b.type) return true;
      const other = defs.get(t);
      // The city wall meets the wall stubs of the military buildings.
      return wall && other?.category === "military" && !other.paint_family;
    };
    const mask = (meets(b.x, b.y - 1) ? N : 0) | (meets(b.x + 1, b.y) ? E : 0) | (meets(b.x, b.y + 1) ? S : 0) | (meets(b.x - 1, b.y) ? W : 0);
    const { piece, rotation } = joinPiece(mask);
    const arch = wall && piece === "straight" && landRoad.has(`${b.x},${b.y}`);
    const model = arch ? `${b.type}.arch` : piece === "straight" ? undefined : `${b.type}.${piece}`;
    return { ...b, rotation, model };
  });
}
