// The hidden tile grid (ART_DIRECTION §4): a subtle grid of tile lines
// fades in around the pointer only while a placement tool is active.
// Pure rule of the UI state; the overlay is decoration, never pickable,
// and has no influence on placement or hints.
import type { Tool } from "../ui/tools";

/** Radius (tiles) of the grid around the pointer; it fades out toward it. */
export const GRID_RADIUS = 8;

/** Tools that place something on tiles show the grid; no tool and demolish do not. */
export function gridOverlayVisible(kind: Tool["kind"]): boolean {
  return kind === "build" || kind === "road" || kind === "field" || kind === "move" || kind === "found";
}

/** Opacity of a grid line point at distance d (tiles) from the centre: full inside half the radius, 0 at the radius. */
export function gridFade(d: number, radius = GRID_RADIUS): number {
  const t = Math.min(1, Math.max(0, (d - radius * 0.35) / (radius * 0.65)));
  return 1 - t * t * (3 - 2 * t);
}
