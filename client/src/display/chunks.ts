// Island chunks (render culling and partial rebuilds): an island's tiles
// are cut into CHUNK × CHUNK squares from its tile (0, 0); every static
// layer (terrain, trees, scatter, roads, fields, building models) is one
// mesh set per chunk, culled per chunk against the camera's ground
// footprint and rebuilt only for the chunks whose inputs changed. Pure
// geometry, no game rule (D-027).
import type { Rect } from "./camera";
import { rectIntersectsQuad } from "./frustum";

/** Chunk side (tiles). */
export const CHUNK = 32;

/**
 * Margin (tiles) around a chunk for the visibility test: the footprint is
 * the ground plane, and models, trees and the coast columns stand above or below
 * it and reach a little over the chunk's edge.
 */
export const CHUNK_VIEW_MARGIN = 8;

/** Key of chunk (cx, cy). */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Key of the chunk holding island-local tile (or point) (x, y). Points
 * outside a width × height island (the coast's sand shelves) go to the
 * nearest edge chunk.
 */
export function chunkAt(x: number, y: number, width = Infinity, height = Infinity): string {
  const last = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.ceil(n / CHUNK) - 1) : Infinity);
  const cx = Math.min(last(width), Math.max(0, Math.floor(x / CHUNK)));
  const cy = Math.min(last(height), Math.max(0, Math.floor(y / CHUNK)));
  return chunkKey(cx, cy);
}

/** One chunk: its key and island-local tile rectangle (clipped to the island). */
export interface ChunkRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The chunks covering a width × height island, row by row (each tile in exactly one). */
export function islandChunks(width: number, height: number): ChunkRect[] {
  const out: ChunkRect[] = [];
  for (let y = 0; y < height; y += CHUNK) {
    for (let x = 0; x < width; x += CHUNK) {
      out.push({ key: chunkKey(x / CHUNK, y / CHUNK), x, y, width: Math.min(CHUNK, width - x), height: Math.min(CHUNK, height - y) });
    }
  }
  return out;
}

/**
 * The chunks of an island that intersect the camera's ground footprint
 * (archipelago tiles), each grown by `margin` tiles.
 */
export function visibleChunks(
  island: { position: { x: number; y: number }; width: number; height: number },
  footprint: readonly { x: number; y: number }[],
  margin = CHUNK_VIEW_MARGIN,
): Set<string> {
  const out = new Set<string>();
  for (const c of islandChunks(island.width, island.height)) {
    const r: Rect = {
      minX: island.position.x + c.x - margin,
      minY: island.position.y + c.y - margin,
      maxX: island.position.x + c.x + c.width + margin,
      maxY: island.position.y + c.y + c.height + margin,
    };
    if (rectIntersectsQuad(r, footprint)) out.add(c.key);
  }
  return out;
}

/** Groups items by the chunk of their island-local position. */
export function byChunk<T>(items: Iterable<T>, at: (it: T) => { x: number; y: number }): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const p = at(it);
    const k = chunkAt(p.x, p.y);
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(it);
  }
  return out;
}

/**
 * The chunks to rebuild: those whose input signature differs between the
 * last build and now, including chunks that lost or gained all their
 * input (a missing signature counts as empty). `prev` null: all of `next`.
 */
export function changedChunks(prev: ReadonlyMap<string, string> | null, next: ReadonlyMap<string, string>): string[] {
  if (!prev) return [...next.keys()].filter((k) => next.get(k) !== "");
  const out = new Set<string>();
  for (const [k, sig] of next) if ((prev.get(k) ?? "") !== sig) out.add(k);
  for (const [k, sig] of prev) if (!next.has(k) && sig !== "") out.add(k);
  return [...out];
}
