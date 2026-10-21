// Active tool of the island view (UI state only).
import { nextRotation, type Rotation, type TilePos } from "../display/geometry";

export type Tool =
  | { kind: "none" }
  /** `pending`: the tile a touch tap put the ghost on, waiting for Confirm. */
  | { kind: "build"; buildingType: string; rotation: Rotation; pending?: TilePos }
  | { kind: "road"; roadType: string }
  /** Moving a placed building (D-042); the ghost uses its footprint. */
  | { kind: "move"; buildingId: number; buildingType: string; rotation: Rotation; pending?: TilePos }
  /** Placing the first warehouse of an unsettled island from a ship's cargo. */
  | { kind: "found"; shipId: number; buildingType: string; rotation: Rotation; pending?: TilePos }
  | { kind: "demolish" };

export type GhostTool = Extract<Tool, { kind: "build" | "move" | "found" }>;

export const NO_TOOL: Tool = { kind: "none" };

/** The tool places a ghost (build, move, found). */
export function isGhostTool(t: Tool): t is GhostTool {
  return t.kind === "build" || t.kind === "move" || t.kind === "found";
}

/** Rotation after `steps` quarter turns (negative: counter-clockwise), via nextRotation like key R. */
export function rotateSteps(r: Rotation, steps: number): Rotation {
  let out = r;
  for (let i = 0; i < (((steps % 4) + 4) % 4); i++) out = nextRotation(out);
  return out;
}
