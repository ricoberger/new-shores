// Active tool (UI state only). Tools act on any island at any zoom
// (D-048): pending tiles carry the island they lie on.
import { nextRotation, type Rotation, type TilePos } from "../display/geometry";
import type { GroupRect } from "../display/group";

/** A tile of an island (local tile coordinates). */
export interface IslandTile extends TilePos {
  island: string;
}

export type Tool =
  | { kind: "none" }
  /** `pending`: the tile a touch tap put the ghost on, waiting for Confirm. */
  | { kind: "build"; buildingType: string; rotation: Rotation; pending?: IslandTile }
  | { kind: "road"; roadType: string }
  /**
   * Moving a placed building (D-042); the ghost uses its footprint. `pick`:
   * started from the build bar's Move tool, which comes back for the next
   * building after a move.
   */
  | { kind: "move"; buildingId: number; buildingType: string; rotation: Rotation; pending?: IslandTile; pick?: boolean }
  /** The build bar's Move tool before a building is picked: a click on one starts its move, a dragged rectangle a group move (UI.md §3). */
  | { kind: "movePick" }
  /**
   * Moving a group (D-074 §5): everything fully inside `rect` on `island`
   * follows the pointer (the rectangle centred on it), turned by
   * `rotation`; a click sends one move_group. `failed`: the building the
   * server named in its last refusal (drawn red).
   */
  | { kind: "moveGroup"; island: string; rect: GroupRect; rotation: Rotation; pending?: IslandTile; failed?: number }
  /** Placing the Trading Post of an unsettled island from a ship's cargo (D-051): the ship sails there first unless it is idle there. */
  | { kind: "found"; shipId: number; buildingType: string; rotation: Rotation; pending?: IslandTile }
  /**
   * Adding fields to one farm from its panel (D-051 part 4, D-054): the ghost
   * of the farm's field building (`buildingType`) follows the pointer, a
   * click places one (place_field), a dragged rectangle paints many (one
   * place_fields), and the tool stays until the farm has its maximum; Esc
   * or a right click leaves it (during a drag: drops the rectangle).
   * `remove`: "Remove fields" — a click or rectangle removes the farm's
   * fields under it (demolish_fields). `island`: the farm's island.
   */
  | { kind: "field"; farmId: number; island: string; buildingType: string; rotation: Rotation; pending?: IslandTile; remove?: boolean }
  | { kind: "demolish" };

export type GhostTool = Extract<Tool, { kind: "build" | "move" | "found" | "field" }>;

export type GroupTool = Extract<Tool, { kind: "moveGroup" }>;

/** A tool with a rotation and a touch-pending tile: the ghost tools and the group move. */
export type TurnTool = GhostTool | GroupTool;

export const NO_TOOL: Tool = { kind: "none" };

/** The tool places a ghost (build, move, found, field). */
export function isGhostTool(t: Tool): t is GhostTool {
  return t.kind === "build" || t.kind === "move" || t.kind === "found" || t.kind === "field";
}

/** The tool turns with R and pends a tile on touch (a ghost tool or the group move). */
export function isTurnTool(t: Tool): t is TurnTool {
  return isGhostTool(t) || t.kind === "moveGroup";
}

/** Esc or a right click: the group move steps back to the Move tool's pick; every other tool ends. */
export function leaveTool(t: Tool): Tool {
  return t.kind === "moveGroup" ? { kind: "movePick" } : NO_TOOL;
}

/** Rotation after `steps` quarter turns (negative: counter-clockwise), via nextRotation like key R. */
export function rotateSteps(r: Rotation, steps: number): Rotation {
  let out = r;
  for (let i = 0; i < (((steps % 4) + 4) % 4); i++) out = nextRotation(out);
  return out;
}
