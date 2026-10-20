// Active tool of the island view (UI state only).
import type { Rotation } from "../display/geometry";

export type Tool =
  | { kind: "none" }
  | { kind: "build"; buildingType: string; rotation: Rotation }
  | { kind: "road"; roadType: string }
  /** Moving a placed building (D-042); the ghost uses its footprint. */
  | { kind: "move"; buildingId: number; buildingType: string; rotation: Rotation }
  /** Placing the first warehouse of an unsettled island from a ship's cargo. */
  | { kind: "found"; shipId: number; buildingType: string; rotation: Rotation }
  | { kind: "demolish" };

export const NO_TOOL: Tool = { kind: "none" };
