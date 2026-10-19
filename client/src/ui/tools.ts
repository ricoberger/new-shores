// Active tool of the island view (UI state only).
import type { Rotation } from "../display/geometry";

export type Tool =
  | { kind: "none" }
  | { kind: "build"; buildingType: string; rotation: Rotation }
  | { kind: "road"; roadType: string }
  | { kind: "demolish" };

export const NO_TOOL: Tool = { kind: "none" };
