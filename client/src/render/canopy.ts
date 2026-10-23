// Forest canopies for the mid and far LOD (restyle diorama): instead of
// single trees, every 2 × 2 cell of an island's tile grid that holds
// forest becomes one low-poly canopy blob — a squat dome in the tree
// colours, lighter on top and darkened toward its foot (baked AO toward
// the crown's shadow tone), sized by how many forest tiles of the cell
// are free (not under a building). Deterministic from the island seed;
// visual only. Merged into the island's block mesh.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Island } from "../api/client";
import { hash2 } from "../display/noise";
import { SHADOWS, TERRAIN } from "../theme/palette";
import { c3 } from "./palette";

/** Cluster size (tiles) of one canopy blob. */
export const CANOPY_CELL = 2;
/** Dome segments around and rings up (low poly: 7 × 2 → 21 triangles). */
const SEGMENTS = 7;
const CROWN = c3(TERRAIN.tree_crown);
const CROWN_LIGHT = c3(TERRAIN.grass_a);
const CROWN_SHADOW = c3(SHADOWS.tree_crown);

export interface CanopyBlob {
  /** Centre (island tiles). */
  x: number;
  y: number;
  /** Radius and height (tiles). */
  r: number;
  h: number;
  /** Colour variation 0..1. */
  tone: number;
}

/**
 * One blob per CANOPY_CELL² cell with at least two free forest tiles,
 * centred on those tiles (jittered), its radius growing with their count.
 */
export function canopyBlobs(island: Pick<Island, "width" | "height" | "terrain">, blocked: ReadonlySet<string>, seed: number): CanopyBlob[] {
  const out: CanopyBlob[] = [];
  const { width, height, terrain } = island;
  for (let cy = 0; cy < height; cy += CANOPY_CELL) {
    for (let cx = 0; cx < width; cx += CANOPY_CELL) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = cy; y < Math.min(height, cy + CANOPY_CELL); y++) {
        for (let x = cx; x < Math.min(width, cx + CANOPY_CELL); x++) {
          if (terrain[y * width + x] !== "forest" || blocked.has(`${x},${y}`)) continue;
          n++;
          sx += x + 0.5;
          sy += y + 0.5;
        }
      }
      if (n < 2) continue;
      const j = (k: number) => (hash2(cx, cy, seed + k) - 0.5) * 0.3;
      out.push({
        x: sx / n + j(1),
        y: sy / n + j(2),
        r: 0.55 + 0.22 * n + 0.15 * hash2(cx, cy, seed + 3),
        h: 1.0 + 0.35 * hash2(cx, cy, seed + 4),
        tone: hash2(cx, cy, seed + 5),
      });
    }
  }
  return out;
}

/** Vertex data the canopies are appended to (the mid/far block mesh). */
export interface MeshSink {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

/**
 * Appends canopy blobs to `out` (island-local coordinates: tile (x, y) →
 * (x, 0, −y)); `tint` adjusts the colours (desaturated for unsettled
 * islands).
 */
export function appendCanopy(out: MeshSink, blobs: readonly CanopyBlob[], tint: (c: Color3) => Color3 = (c) => c): void {
  const { positions, normals, colors, indices } = out;
  const push = (p: [number, number, number], n: [number, number, number], c: Color3) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    colors.push(c.r, c.g, c.b, 1);
    return positions.length / 3 - 1;
  };
  for (const b of blobs) {
    const base = Color3.Lerp(CROWN, CROWN_LIGHT, 0.15 + 0.3 * b.tone);
    const foot = tint(Color3.Lerp(base, CROWN_SHADOW, 0.65));
    const mid = tint(base);
    const top = tint(Color3.Lerp(base, CROWN_LIGHT, 0.35));
    const rot = b.tone * Math.PI * 2;
    // Rings: the foot (slightly sunk, full radius), the shoulder and the apex.
    const ring = (rr: number, y: number, c: Color3, ny: number) =>
      Array.from({ length: SEGMENTS }, (_, k) => {
        const a = rot + (k / SEGMENTS) * Math.PI * 2;
        const wob = 1 + 0.12 * Math.sin(a * 3 + b.tone * 7);
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const l = Math.hypot(dx, ny, dz);
        return push([b.x + dx * rr * wob, y, -(b.y + dz * rr * wob)], [dx / l, ny / l, -dz / l], c);
      });
    const r0 = ring(b.r, -0.05, foot, 0.2);
    const r1 = ring(b.r * 0.82, b.h * 0.55, mid, 0.9);
    const apex = push([b.x, b.h, -b.y], [0, 1, 0], top);
    for (let k = 0; k < SEGMENTS; k++) {
      const k1 = (k + 1) % SEGMENTS;
      const a0 = r0[k] as number;
      const a1 = r0[k1] as number;
      const b0 = r1[k] as number;
      const b1 = r1[k1] as number;
      indices.push(a0, b0, b1, a0, b1, a1, b0, apex, b1);
    }
  }
}
