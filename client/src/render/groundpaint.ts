// Ground cover as paint (D-068; ART_DIRECTION §4): yards, roads and field
// ground are colours in the island's ground texture (one texel per terrain
// column, render/groundshader.ts), flush with the terrace — never voxels,
// never a height change. This module holds the colours of the ground kinds
// (shared by the yards here and the roads, render/roadvoxels.ts) and paints
// the buildings' yards: a model's manifest `ground` (one kind per footprint
// tile, rows = footprint y at rotation 0) turned and placed with the model
// onto the island's tiles (groundTiles), then painted into the near field's
// top colours (paintYards) — from the roadless, fieldless base, so a moved or
// demolished building's yard returns to the terrain colour on the next paint.
// Render data only.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { hash2 } from "../display/noise";
import { BUILDINGS, ISLAND, TERRAIN } from "../theme/palette";
import { type GroundKind, type ModelEntry, placement, rotateXZ, toWorld } from "./models";
import { c3 } from "./palette";
import { type Field, pack, TERRAIN_VPT } from "./voxelterrain";

/** The base (roadless, yardless) top colours and heights a paint starts from (roadvoxels.ts FieldBase). */
export interface PaintBase {
  h: Int8Array;
  top: Uint32Array;
}

export const DIRT = c3(TERRAIN.road_dirt);
export const PAVED = c3(TERRAIN.road_paved);
export const KERB = c3(TERRAIN.road_border);
export const STONE = c3(ISLAND.rock_light);
export const STONE_DARK = c3(ISLAND.rock);
export const SAND = c3(TERRAIN.sand);
/** Planks: the recipes' plank shade (nsvoxel mats PLANK, timber × 1.62) — the palette has no plank role, timber is the nearest. */
export const PLANKS = c3(BUILDINGS.timber).scale(1.62);

/** Packed earth with stones (a road's path, a dirt yard): `r` a hash of the column, `s` a second one. */
export function dirtTop(r: number, s: number): number {
  return pack(r < 0.05 ? STONE_DARK : r < 0.13 ? STONE : DIRT.scale(0.93 + 0.1 * s));
}

/** Cobbles in three shades, a dark joint now and then (the paved road, a paved yard). */
export function cobbleTop(r: number): number {
  const shade = r < 0.33 ? 0.88 : r < 0.66 ? 0.97 : 1.05;
  return pack(r > 0.95 ? STONE_DARK.scale(0.9) : PAVED.scale(shade));
}

/** A colour (packed) mixed toward another by t. */
export function mixTop(p: number, c: Color3, t: number): number {
  const r = ((p >> 16) & 255) / 255;
  const g = ((p >> 8) & 255) / 255;
  const b = (p & 255) / 255;
  return pack({ r: r + (c.r - r) * t, g: g + (c.g - g) * t, b: b + (c.b - b) * t });
}

/** A yard tile on the island: its kind (never "none"). */
export interface YardTile {
  x: number;
  y: number;
  kind: Exclude<GroundKind, "none">;
}

/**
 * The island tiles of a model's ground map at a building's placement: each
 * footprint tile's centre in model space turned, stretched and moved like
 * the model (render/models.ts placement), so the yard lies where the model's
 * yard side stands at every rotation. "none" tiles are left out.
 */
export function groundTiles(
  entry: Pick<ModelEntry, "kind" | "footprint" | "bounds">,
  def: Pick<ContentBuilding, "width" | "height">,
  b: Pick<BuildingDisplay, "x" | "y" | "rotation">,
  ground: readonly (readonly GroundKind[])[],
): YardTile[] {
  const p = placement(entry as ModelEntry, def as ContentBuilding, b);
  const fw = entry.footprint?.w ?? def.width;
  const fh = entry.footprint?.h ?? def.height;
  const out: YardTile[] = [];
  ground.forEach((row, gy) =>
    row.forEach((kind, gx) => {
      if (kind === "none") return;
      // Recipe space (x, y toward the front) → glTF (x, up, −y) → world.
      const w = toWorld(entry.kind, [gx + 0.5 - fw / 2, 0, -(gy + 0.5 - fh / 2)]);
      const [x, z] = rotateXZ(w[0] * p.sx, w[2] * p.sz, p.yaw);
      out.push({ x: Math.floor(p.cx + x), y: Math.floor(-(p.cz + z)), kind });
    }),
  );
  return out;
}

/**
 * Paints the yards into the field's top colours (after the roads and the
 * fields): paved yards cobbles, dirt yards packed earth with stones whose
 * edge toward a non-yard column frays into the ground, sand and planks.
 * Only columns on their tile's flat ground whose colour is still the base's
 * (no road, no field) take the paint.
 */
export function paintYards(f: Field, base: PaintBase, yards: readonly YardTile[], seed: number): void {
  const vpt = TERRAIN_VPT;
  const tw = Math.ceil(f.nx / vpt);
  const kinds = new Map<number, YardTile["kind"]>();
  for (const t of yards) if (t.x >= 0 && t.y >= 0 && t.x < tw) kinds.set(t.y * tw + t.x, t.kind);
  const kindAt = (i: number, j: number) => (i < 0 || j < 0 || i >= f.nx || j >= f.ny ? undefined : kinds.get(Math.floor(j / vpt) * tw + Math.floor(i / vpt)));
  for (const t of yards) {
    for (let b = 0; b < vpt; b++) {
      for (let a = 0; a < vpt; a++) {
        const i = t.x * vpt + a;
        const j = t.y * vpt + b;
        if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) continue;
        const k = j * f.nx + i;
        const fl = f.flat ? (f.flat[k] as number) : 0;
        if ((f.h[k] as number) !== fl || (base.h[k] as number) !== fl || f.top[k] !== base.top[k]) continue;
        const r = hash2(i, j, seed + 81);
        switch (t.kind) {
          case "paved":
            f.top[k] = cobbleTop(r);
            break;
          case "dirt": {
            const edge = kindAt(i - 1, j) !== "dirt" || kindAt(i + 1, j) !== "dirt" || kindAt(i, j - 1) !== "dirt" || kindAt(i, j + 1) !== "dirt";
            const top = dirtTop(r, hash2(i, j, seed + 82));
            // The yard's rim frays: some edge columns stay ground, some take a part of the earth.
            const w = hash2(i, j, seed + 83);
            f.top[k] = edge && w < 0.3 ? (base.top[k] as number) : edge && w < 0.6 ? mixTop(base.top[k] as number, DIRT, 0.55) : top;
            break;
          }
          case "sand":
            f.top[k] = pack(SAND.scale(0.95 + 0.08 * r));
            break;
          case "planks":
            // Boards along the tile's x, one column wide, two shades.
            f.top[k] = pack(PLANKS.scale((b % 2 === 0 ? 1.0 : 0.9) + 0.04 * r));
            break;
        }
      }
    }
  }
}
