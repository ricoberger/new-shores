// Active tool (UI state only). Tools act on any island at any zoom
// (D-048): pending tiles carry the island they lie on.
import { nextRotation, type Rotation, type TilePos } from "../display/geometry";

/** A tile of an island (local tile coordinates). */
export interface IslandTile extends TilePos {
  island: string;
}

export type Tool =
  | { kind: "none" }
  /** `pending`: the tile a touch tap put the ghost on, waiting for Confirm. */
  | { kind: "build"; buildingType: string; rotation: Rotation; pending?: IslandTile }
  | { kind: "road"; roadType: string }
  /** Moving a placed building (D-042); the ghost uses its footprint. */
  | { kind: "move"; buildingId: number; buildingType: string; rotation: Rotation; pending?: IslandTile }
  /** Placing the Trading Post of an unsettled island from a ship's cargo (D-051): the ship sails there first unless it is idle there. */
  | { kind: "found"; shipId: number; buildingType: string; rotation: Rotation; pending?: IslandTile }
  /**
   * Adding fields to one farm from its panel (D-051 part 4): the ghost of the
   * farm's field building (`buildingType`) follows the pointer, a click
   * places one (place_field) and the tool stays until the farm has its
   * maximum; Esc or a right click leaves it. `island`: the farm's island.
   */
  | { kind: "field"; farmId: number; island: string; buildingType: string; rotation: Rotation; pending?: IslandTile }
  | { kind: "demolish" };

export type GhostTool = Extract<Tool, { kind: "build" | "move" | "found" | "field" }>;

export const NO_TOOL: Tool = { kind: "none" };

/** The tool places a ghost (build, move, found, field). */
export function isGhostTool(t: Tool): t is GhostTool {
  return t.kind === "build" || t.kind === "move" || t.kind === "found" || t.kind === "field";
}

/** Rotation after `steps` quarter turns (negative: counter-clockwise), via nextRotation like key R. */
export function rotateSteps(r: Rotation, steps: number): Rotation {
  let out = r;
  for (let i = 0; i < (((steps % 4) + 4) % 4); i++) out = nextRotation(out);
  return out;
}
