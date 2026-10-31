// Fields at far LOD (the far budget, D-048): field tiles have full models
// only (210–3 070 triangles per field, no lite file), so at far LOD they
// are not drawn as models but as painted ground patches — one colour per
// field type in the lite terrain's ground texture and in the far view's
// columns (render/terrain.ts), the furrows ignored. The colour is the
// field model's own palette: the area-weighted colour of its up-facing
// faces in the upper part of the model (the crop's tops, what the far
// camera sees) when those cover enough of the footprint, else of all its
// up-facing faces (pens, sparse rows). Pastures take the field palette's
// lighter pasture green so they read against the grass, with their fence
// as a one-column timber line round the footprint (texture only: free);
// until a field's model has loaded its type falls back to the field
// palette. Render data only.
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { BUILDINGS, FIELDS, TERRAIN } from "../theme/palette";
import type { ModelData, ModelRegistry } from "./models";
import { c3 } from "./palette";
import { type FieldBase, fieldGround, type FieldTile } from "./roadvoxels";
import { type Field, pack, TERRAIN_VPT } from "./voxelterrain";

/** Up-facing faces from this fraction of the model's height up count as the crop's tops. */
export const CROP_TOP_FRACTION = 0.3;
/** The crop's tops stand for the field when they cover at least this share of its footprint. */
export const CROP_TOP_COVER = 0.3;

/** Patch colour of the pastures: the field palette's lighter pasture green. */
export const PASTURE_PATCH = c3(FIELDS.pasture_mark);

/** The pastures' fence line (the fence posts' timber). */
const FENCE = pack(c3(BUILDINGS.timber));

/** Patch colour of a field type whose model has not loaded (the field palette by its ground). */
export function fallbackPatchColor(type: string): Color3 {
  switch (fieldGround(type)) {
    case "pasture":
      return PASTURE_PATCH;
    case "orchard":
      return c3(FIELDS.orchard);
    default:
      return type === "tree_plot" ? c3(TERRAIN.tree_crown) : c3(FIELDS.wheat_mark);
  }
}

/**
 * The patch colour of a field model (model space, y up; `footprint` its
 * area in tiles): the area-weighted vertex colour of its up-facing faces
 * at or above CROP_TOP_FRACTION of its height when they cover
 * CROP_TOP_COVER of the footprint, else of all up-facing faces.
 */
export function fieldPatchColor(d: ModelData, footprint: number): Color3 {
  let maxY = 0;
  for (let i = 1; i < d.positions.length; i += 3) maxY = Math.max(maxY, d.positions[i] as number);
  const mean = (minY: number): { area: number; rgb: [number, number, number] } => {
    let area = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let t = 0; t < d.indices.length; t += 3) {
      const v = [d.indices[t] as number, d.indices[t + 1] as number, d.indices[t + 2] as number];
      if ((d.normals[(v[0] as number) * 3 + 1] as number) < 0.5) continue;
      const p = (i: number, k: number) => d.positions[(v[i] as number) * 3 + k] as number;
      if (Math.min(p(0, 1), p(1, 1), p(2, 1)) < minY) continue;
      const a = Math.abs((p(1, 0) - p(0, 0)) * (p(2, 2) - p(0, 2)) - (p(1, 2) - p(0, 2)) * (p(2, 0) - p(0, 0))) / 2;
      area += a;
      for (const i of v) {
        r += ((d.colors[i * 4] as number) * a) / 3;
        g += ((d.colors[i * 4 + 1] as number) * a) / 3;
        b += ((d.colors[i * 4 + 2] as number) * a) / 3;
      }
    }
    return { area, rgb: area > 0 ? [r / area, g / area, b / area] : [0, 0, 0] };
  };
  const tops = mean(maxY * CROP_TOP_FRACTION);
  const m = tops.area >= CROP_TOP_COVER * footprint ? tops : mean(-Infinity);
  return new Color3(m.rgb[0], m.rgb[1], m.rgb[2]);
}

/** Patch colours derived from the loaded field models (per model data; pure function of it). */
const derived = new WeakMap<ModelData, Color3>();

/**
 * The far patch colour of a field type: pastures PASTURE_PATCH, else the
 * colour of its model's main file when the registry has it loaded
 * (fieldPatchColor), else fallbackPatchColor. Never requests a file (the
 * building layer requests the full field models for the mid LOD anyway).
 */
export function farFieldColor(type: string, registry: ModelRegistry | null): Color3 {
  if (fieldGround(type) === "pasture") return PASTURE_PATCH;
  const entry = registry?.entry(type);
  const file = entry?.file ?? entry?.variants?.[0];
  const data = file ? registry?.peek(file) : null;
  if (!entry || !data) return fallbackPatchColor(type);
  let c = derived.get(data);
  if (!c) {
    const fp = entry.footprint ?? { w: 1, h: 1 };
    derived.set(data, (c = fieldPatchColor(data, fp.w * fp.h)));
  }
  return c;
}

/**
 * The near field's top colours with the field patches of the far view:
 * every column of a field's footprint (`w` × `h` tiles from its anchor,
 * 1 × 1 without) that paintFields paints — flat ground, no road — takes
 * the field's patch colour (`patch`, packed RGB; the fallback without),
 * a pasture's outermost columns its fence line. A copy; the near field
 * keeps its furrows.
 */
export function fieldPatchTops(f: Field, base: FieldBase, fields: readonly FieldTile[]): Uint32Array {
  const top = f.top.slice();
  const vpt = TERRAIN_VPT;
  for (const t of fields) {
    const color = t.patch ?? pack(fallbackPatchColor(t.type));
    const fenced = fieldGround(t.type) === "pasture";
    const [i0, j0, i1, j1] = [t.x * vpt, t.y * vpt, (t.x + (t.w ?? 1)) * vpt - 1, (t.y + (t.h ?? 1)) * vpt - 1];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) continue;
        const k = j * f.nx + i;
        const fl = f.flat ? (f.flat[k] as number) : 0;
        if ((f.h[k] as number) !== fl || (base.h[k] as number) !== fl) continue;
        top[k] = fenced && (i === i0 || i === i1 || j === j0 || j === j1) ? FENCE : color;
      }
    }
  }
  return top;
}
