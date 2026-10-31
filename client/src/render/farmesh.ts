// Mask mesh (far view): an island drawn from its 1:4 terrain mask
// (display/mask.ts) instead of its full tiles — its flat outline: the
// mask cells as flat quads in the minimap's colours, greedy-merged per
// terrain run, the exact cell contour stepped down to one sand shelf
// (maskMeshData; ≈ 1 k triangles for a large island). No trees, buildings
// or life. Every island in view whose full tiles have not arrived yet is
// drawn this way, and at far LOD the islands in view other than the
// focused one (ART_DIRECTION §2 budget); all of them are merged into one
// static mesh (one draw call), rebuilt only when the set of islands drawn
// this way changes (off-screen islands are left out). An island whose
// tiles are built brings its own far columns instead (MaskIsland.tiles:
// its near field downsampled to one column per tile, render/terrain.ts),
// so its coast at far lines up with the one at mid — the largest on
// screen first, kept once given, while the far view stays within its
// budget (D-058's relief within D-048's far budget, farTerrainBudget,
// MaskLayer.show). Render data only.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { type DecodedMask, MASK_BLOCK, MASK_COAST, MASK_WATER } from "../display/mask";
import { ISLAND, TERRAIN, WATER } from "../theme/palette";
import { skyFill } from "./lighting";
import { mapLandColor, rgbOf } from "./mapcolors";
import { c3 } from "./palette";
import { Builder, FAR_QUANT } from "./terrain";
import { EMPTY, meshField, pack, SHELF_H } from "./voxelterrain";

/** D-048's far budget at the zoom cap (triangles). */
export const FAR_TRIS = 250_000;

/** Share of FAR_TRIS kept free: what the estimate leaves out (cargo, life props, rounding). */
export const FAR_RESERVE = 0.1;

/** Sea, haze, landmarks and the selection at far LOD: a few hundred triangles. */
export const FAR_SCENERY_TRIS = 1_000;

/** The far view's triangles that do not depend on the terrain choice (the islands drawn in detail and the fleet). */
export interface FarFixedCost {
  /** Lite building models (all chunks of the islands drawn in detail; the field patches are ground texture, 0). */
  models: number;
  /** Far tree crowns. */
  trees: number;
  /** Far contact shadows. */
  shadows: number;
  /** Every ship of the fleet at its model. */
  ships: number;
}

/**
 * The far view's terrain budget: what the fixed layers and the scenery
 * leave of FAR_TRIS less FAR_RESERVE. It is spent on the focused island's
 * relief first (homeTerrain), then on the other islands in view by
 * on-screen area (MaskLayer.show, reliefOrder), their flat outline the
 * last resort.
 */
export function farTerrainBudget(c: FarFixedCost): number {
  return Math.max(0, FAR_TRIS * (1 - FAR_RESERVE) - FAR_SCENERY_TRIS - c.models - c.trees - c.shadows - c.ships);
}

/**
 * The focused island's terrain at far LOD: its lite terrain (2 columns
 * per tile, full relief with corner shading) while it fits in `budget`
 * next to the flat outlines of the other islands in view (`outlines`,
 * always drawn), else its coarse terrain (1 column per tile; relief kept,
 * whatever it costs: the town stands on it).
 */
export function homeTerrain(budget: number, outlines: number, lite: number): "lite" | "coarse" {
  return lite + outlines <= budget ? "lite" : "coarse";
}

/** An island drawn in detail at far LOD, as the terrain allocation sees it (render/island.ts IslandDetail). */
export interface FarDetail {
  farFixedCost(): { models: number; trees: number; shadows: number };
  /** Triangles of its fine lite terrain (2 columns per tile), drawn or not. */
  fineTerrainTriangles(): number;
  /** Triangles of the lite terrain drawn (fine or coarse). */
  liteTerrainTriangles(): number;
  setCoarseTerrain(on: boolean): void;
}

/**
 * The far view's terrain by headroom (D-048): the islands drawn in detail
 * (the focused one) take their fine lite terrain while it fits next to the
 * other islands' outlines (`outlines`), else their coarse one; returns
 * what is left for the mask mesh (MaskLayer.show: outlines, then relief
 * by on-screen area). `ships`: the fleet's triangles.
 */
export function allocateFarTerrain(detailed: readonly FarDetail[], outlines: number, ships: number): number {
  const cost = { models: 0, trees: 0, shadows: 0, ships };
  for (const d of detailed) {
    const c = d.farFixedCost();
    cost.models += c.models;
    cost.trees += c.trees;
    cost.shadows += c.shadows;
  }
  let budget = farTerrainBudget(cost);
  for (const d of detailed) {
    d.setCoarseTerrain(homeTerrain(budget, outlines, d.fineTerrainTriangles()) === "coarse");
    budget -= d.liteTerrainTriangles();
  }
  return Math.max(0, budget);
}

/**
 * Share of the mask mesh's budget an island already in relief may run
 * over before it is dropped back to its outline (MaskLayer.show): within
 * FAR_RESERVE, so the far view stays within FAR_TRIS.
 */
export const RELIEF_HYSTERESIS = 0.1;

/** An island in view as the relief order sees it: its on-screen area (tiles², display/frustum.ts rectQuadOverlap) and its distance from the view's centre. */
export interface ReliefRank {
  id: string;
  area: number;
  dist: number;
}

/** Relief order of the islands in view (MaskLayer.show): on-screen area, largest first; ties nearest first, then by ID. */
export function reliefOrder<T extends ReliefRank>(islands: readonly T[]): T[] {
  return [...islands].sort((a, b) => b.area - a.area || a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One island of the mask mesh. */
export interface MaskIsland {
  id: string;
  /** Archipelago position of the island's tile (0, 0). */
  position: { x: number; y: number };
  mask: DecodedMask;
  /** Decoration seed of the island (display/scatter.ts islandSeed). */
  seed: number;
  /** The island's own far columns (island-local) when its tiles are built; drawn instead of the mask. */
  tiles?: { key: string; data: Builder } | null;
}

/** Colour of the mask outline's sand shelf (the 1-tile step off the cell contour). */
const SHELF = c3(TERRAIN.sand).scale(0.9);
/** Side colours of the outline: the land's step down to the shelf (sand under beach cells, earth under the rest) and the shelf's wall into the sea. */
const OUTLINE_SIDE = { sand: c3(TERRAIN.sand).scale(0.84), earth: Color3.Lerp(c3(TERRAIN.road_dirt), c3(ISLAND.rock_deep), 0.3), wet: Color3.Lerp(c3(TERRAIN.sand), c3(WATER.shallows), 0.22).scale(0.72) };
/** Side kinds of the outline's walls. */
const OUTLINE_EARTH = 0;
const OUTLINE_SAND = 1;
/** Foot of the outline's walls (steps): just under the sea surface (SEA_LEVEL −0.6 tiles = −4.8 steps). */
const OUTLINE_FOOT = -5;

/**
 * Vertex data of one island's mask mesh in island-local tiles (tile (x, y)
 * is (x, 0, −y)): the flat outline of its 1:4 mask, the shape the minimap
 * draws (Minimap.tsx). Every land cell covers MASK_BLOCK × MASK_BLOCK
 * tiles at height 0 in its terrain's minimap colour (render/mapcolors.ts
 * mapLandColor), greedy-merged into flat quads per terrain run; the coast
 * is the exact cell contour (no smoothing), stepped down to one 1-tile sand
 * shelf (SHELF_H) whose wall drops just under the sea. No per-tile columns
 * and no colour noise: a large island costs ≈ 1 k triangles (the shallows
 * around it are the sea shader's, render/archipelago.ts). Empty for an
 * all-water mask.
 */
export function maskMeshData(mask: DecodedMask): Builder {
  const b = new Builder();
  // Tiles of the mask plus a 1-tile border for the shelf: column (i, j) is tile (i − 1, j − 1).
  const nx = mask.width * MASK_BLOCK + 2;
  const ny = mask.height * MASK_BLOCK + 2;
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const kind = new Uint8Array(nx * ny);
  const land = new Uint8Array(nx * ny);
  let any = false;
  for (let my = 0; my < mask.height; my++) {
    for (let mx = 0; mx < mask.width; mx++) {
      const c = mask.cells[my * mask.width + mx] as number;
      if (c === MASK_WATER) continue;
      any = true;
      const [r, g, bl] = rgbOf(mapLandColor(c));
      const colour = pack({ r, g, b: bl });
      for (let y = 0; y < MASK_BLOCK; y++) {
        for (let x = 0; x < MASK_BLOCK; x++) {
          const k = (my * MASK_BLOCK + y + 1) * nx + mx * MASK_BLOCK + x + 1;
          land[k] = 1;
          h[k] = 0;
          top[k] = colour;
          kind[k] = c === MASK_COAST ? OUTLINE_SAND : OUTLINE_EARTH;
        }
      }
    }
  }
  if (!any) return b;
  // The shelf: every other tile touching land (8-neighbourhood, so convex corners stay square).
  const shelf = pack(SHELF);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (land[k]) continue;
      let touches = false;
      for (let dj = -1; dj <= 1 && !touches; dj++) for (let di = -1; di <= 1 && !touches; di++) touches = i + di >= 0 && j + dj >= 0 && i + di < nx && j + dj < ny && land[(j + dj) * nx + i + di] === 1;
      if (!touches) continue;
      h[k] = SHELF_H;
      top[k] = shelf;
      kind[k] = OUTLINE_SAND;
    }
  }
  const side = (z: number, k: number) => (z < SHELF_H ? OUTLINE_SIDE.wet : k === OUTLINE_SAND ? OUTLINE_SIDE.sand : OUTLINE_SIDE.earth);
  meshField(b, { nx, ny, x0: -1, y0: -1, s: 1, h, top, kind, bottom: OUTLINE_FOOT, side, quant: FAR_QUANT, flatTops: true }, 0, 0, nx, ny);
  return b;
}

/** The merged mask mesh of every island drawn from its mask (one draw call). */
export class MaskLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private key = "";
  /** Mask vertex data per island (island-local), by island ID and its mask inputs. */
  private readonly cache = new Map<string, { key: string; data: Builder }>();
  /** Islands drawn from their own far columns in the current mesh. */
  private fromTiles = new Set<string>();

  constructor(private readonly scene: Scene) {
    this.material = skyFill(new StandardMaterial("mask_terrain", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /**
   * Draws exactly these islands (rebuilt only when the set, an island's
   * inputs or the choice of far columns changed): every one at least as
   * its outline (whatever the budget), those with tiles in relief (their
   * own far columns) by this rule (D-048 within `budget` triangles):
   *
   * - an island already in relief keeps it while the mesh stays within
   *   `budget` × (1 + RELIEF_HYSTERESIS); above that the kept ones are
   *   dropped from the end of the order until it is within `budget`
   *   (tiles streaming in never cost a kept island its relief: its far
   *   columns do not change, and the newcomers only take what is free);
   * - then, if `grant`, the others in the given order (the engine's:
   *   on-screen area, largest first, ties nearest, reliefOrder) while the
   *   mesh stays within `budget`.
   *
   * `grant` false holds new relief back (the far view's cost is not final
   * yet: the focused island or models still loading, which would take
   * the room back a moment later).
   */
  show(islands: readonly MaskIsland[], budget = Infinity, grant = true): void {
    const masks = this.masks(islands);
    const tris = (b: Builder) => b.indices.length / 3;
    let total = 0;
    for (const b of masks.values()) total += tris(b);
    const extra = (is: MaskIsland) => tris((is.tiles as { data: Builder }).data) - tris(masks.get(is.id) as Builder);
    // Kept: in relief before and still drawn with tiles, in the given order.
    const kept = islands.filter((is) => is.tiles && this.fromTiles.has(is.id));
    for (const is of kept) total += extra(is);
    if (total > budget * (1 + RELIEF_HYSTERESIS)) {
      while (kept.length > 0 && total > budget) total -= extra(kept.pop() as MaskIsland);
    }
    const fromTiles = new Set(kept.map((is) => is.id));
    for (const is of grant ? islands : []) {
      if (!is.tiles || fromTiles.has(is.id)) continue;
      const e = extra(is);
      if (total + e > budget) continue;
      total += e;
      fromTiles.add(is.id);
    }
    const keyOf = (is: MaskIsland) => (is.tiles && fromTiles.has(is.id) ? `tiles:${is.tiles.key}` : (this.cache.get(is.id)?.key ?? ""));
    const key = islands.map((is) => `${is.id}@${is.position.x},${is.position.y}#${keyOf(is)}`).join(";");
    if (key === this.key) return;
    this.key = key;
    this.fromTiles = fromTiles;
    this.mesh?.dispose();
    this.mesh = null;
    const parts = islands.map((is) => ({ data: is.tiles && fromTiles.has(is.id) ? is.tiles.data : (masks.get(is.id) as Builder), x: is.position.x, y: is.position.y }));
    const merged = mergeParts(parts);
    if (merged.indices.length === 0) return;
    const mesh = new Mesh("mask_terrain", this.scene);
    const data = new VertexData();
    data.positions = merged.positions;
    data.colors = merged.colors;
    data.normals = merged.normals;
    data.indices = merged.indices;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    this.mesh = mesh;
  }

  /** Triangles of these islands' masks (their flat outlines: the mesh's least, whatever the budget). */
  outlineTriangles(islands: readonly MaskIsland[]): number {
    let n = 0;
    for (const b of this.masks(islands).values()) n += b.indices.length / 3;
    return n;
  }

  /** The islands' mask data (cached; islands not given are dropped from the cache). */
  private masks(islands: readonly MaskIsland[]): Map<string, Builder> {
    const keep = new Set<string>();
    const masks = new Map<string, Builder>();
    for (const is of islands) {
      const k = `${is.seed}|${is.mask.width}x${is.mask.height}|${maskString(is.mask)}`;
      let c = this.cache.get(is.id);
      if (!c || c.key !== k) this.cache.set(is.id, (c = { key: k, data: maskMeshData(is.mask) }));
      keep.add(is.id);
      masks.set(is.id, c.data);
    }
    for (const id of this.cache.keys()) if (!keep.has(id)) this.cache.delete(id);
    return masks;
  }

  /** Islands drawn from their masks (tests and stats). */
  islands(): string[] {
    return this.key === "" ? [] : this.key.split(";").map((p) => p.slice(0, p.indexOf("@")));
  }

  /** Islands of the mesh drawn from their own far columns (tests and stats). */
  tiled(): string[] {
    return [...this.fromTiles];
  }

  /** Triangles of the merged mesh. */
  triangles(): number {
    return this.mesh ? (this.mesh.getTotalIndices() / 3) | 0 : 0;
  }
}

function maskString(m: DecodedMask): string {
  let s = "";
  for (const c of m.cells) s += c;
  return s;
}

/** Concatenates island-local vertex data, moved to their archipelago positions. */
export function mergeParts(parts: readonly { data: Builder; x: number; y: number }[]): { positions: Float32Array; colors: Float32Array; normals: Float32Array; indices: Uint32Array } {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.data.positions.length / 3;
    ni += p.data.indices.length;
  }
  const positions = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const normals = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    const d = p.data;
    const n = d.positions.length / 3;
    for (let k = 0; k < n; k++) {
      positions[(v + k) * 3] = (d.positions[k * 3] as number) + p.x;
      positions[(v + k) * 3 + 1] = d.positions[k * 3 + 1] as number;
      positions[(v + k) * 3 + 2] = (d.positions[k * 3 + 2] as number) - p.y;
    }
    colors.set(d.colors, v * 4);
    normals.set(d.normals, v * 3);
    for (let k = 0; k < d.indices.length; k++) indices[i + k] = (d.indices[k] as number) + v;
    v += n;
    i += d.indices.length;
  }
  return { positions, colors, normals, indices };
}
