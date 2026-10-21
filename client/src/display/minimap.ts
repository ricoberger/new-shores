// Minimap projection (D-048, UI only): north-up, the archipelago's
// bounding box plus a margin scaled uniformly into the minimap canvas and
// centred. Pure; the Minimap component draws with it and maps clicks back.
import type { Rect } from "./camera";
import type { ArchPoint } from "./ships";

/** Margin (tiles) around the islands shown on the minimap. */
export const MINIMAP_MARGIN = 12;

export interface MinimapProjection {
  /** Canvas pixels per archipelago tile. */
  scale: number;
  /** Canvas pixel of archipelago (0, 0). */
  offsetX: number;
  offsetY: number;
}

/** The projection of the bounds (plus MINIMAP_MARGIN) into a width × height canvas. */
export function minimapProjection(bounds: Rect, width: number, height: number): MinimapProjection {
  const minX = bounds.minX - MINIMAP_MARGIN;
  const minY = bounds.minY - MINIMAP_MARGIN;
  const w = Math.max(1, bounds.maxX - bounds.minX + 2 * MINIMAP_MARGIN);
  const h = Math.max(1, bounds.maxY - bounds.minY + 2 * MINIMAP_MARGIN);
  const scale = Math.min(width / w, height / h);
  return { scale, offsetX: (width - w * scale) / 2 - minX * scale, offsetY: (height - h * scale) / 2 - minY * scale };
}

/** Canvas pixel of an archipelago point. */
export function toMinimap(m: MinimapProjection, p: ArchPoint): ArchPoint {
  return { x: m.offsetX + p.x * m.scale, y: m.offsetY + p.y * m.scale };
}

/** Archipelago point of a canvas pixel. */
export function fromMinimap(m: MinimapProjection, px: ArchPoint): ArchPoint {
  return { x: (px.x - m.offsetX) / m.scale, y: (px.y - m.offsetY) / m.scale };
}

/** Canvas size (CSS px) of the minimap: at most `maxSide` and 25 % of the shorter viewport side, keeping the bounds' aspect. */
export function minimapSize(bounds: Rect, viewportW: number, viewportH: number, maxSide = 180): { width: number; height: number } {
  const side = Math.max(48, Math.floor(Math.min(maxSide, 0.25 * Math.min(viewportW, viewportH))));
  const w = bounds.maxX - bounds.minX + 2 * MINIMAP_MARGIN;
  const h = bounds.maxY - bounds.minY + 2 * MINIMAP_MARGIN;
  if (w >= h) return { width: side, height: Math.max(24, Math.round((side * h) / w)) };
  return { width: Math.max(24, Math.round((side * w) / h)), height: side };
}
