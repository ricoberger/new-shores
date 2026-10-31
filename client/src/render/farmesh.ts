// Mask mesh (far view): an island drawn from its 1:4 terrain mask
// (display/mask.ts) instead of its full tiles — coarse voxel terrain, one
// column per tile in the colour of its mask cell's terrain, with the
// coast's sand shelves (render/voxelterrain.ts). No trees, buildings or
// life. Every island in view whose full tiles have not arrived yet is
// drawn this way, and at far LOD the islands in view other than the
// focused one (ART_DIRECTION §2 budget); all of them are merged into one
// static mesh (one draw call), rebuilt only when the set of islands drawn
// this way changes (off-screen islands are left out). An island whose
// tiles are built brings its own far columns instead (MaskIsland.tiles:
// its near field downsampled to one column per tile, render/terrain.ts),
// so its coast at far lines up with the one at mid — nearest the view
// first, while the far view stays within its budget (D-058's relief
// within D-048's far budget, farTerrainBudget). Render data only.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Terrain } from "../api/client";
import { coastline } from "../display/coastline";
import { type DecodedMask, MASK_BLOCK, MASK_TERRAINS, MASK_WATER } from "../display/mask";
import { skyFill } from "./lighting";
import { Builder, FAR_QUANT } from "./terrain";
import { islandField, meshField } from "./voxelterrain";

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
 * relief first (homeTerrain), then on the other islands in view nearest
 * first (MaskLayer.show), their flat outline the last resort.
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
 * nearest first). `ships`: the fleet's triangles.
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

/**
 * Vertex data of one island's mask mesh in island-local tiles (tile (x, y)
 * is (x, 0, −y)): coarse voxel terrain — one column per tile over the
 * mask's land (each cell MASK_BLOCK × MASK_BLOCK tiles, its terrain's
 * colour at the tile), the coast a pixel outline of the smoothed cell
 * contour with the two sand shelves down below the sea. Empty for an
 * all-water mask.
 */
export function maskMeshData(mask: DecodedMask, seed: number): Builder {
  const b = new Builder();
  const width = mask.width * MASK_BLOCK;
  const height = mask.height * MASK_BLOCK;
  // Pseudo-island of tiles: tile (x, y) takes the cell floor(x / B) (cell c covers tiles c·B … c·B + B − 1, display/mask.ts).
  const terrain: Terrain[] = new Array<Terrain>(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = mask.cells[Math.floor(y / MASK_BLOCK) * mask.width + Math.floor(x / MASK_BLOCK)] as number;
      terrain[y * width + x] = c === MASK_WATER ? "water" : (MASK_TERRAINS[c] as Terrain);
    }
  }
  const pseudo = { width, height, terrain };
  const f = { ...islandField(pseudo, coastline(pseudo), seed, 1), quant: FAR_QUANT, flatTops: true };
  meshField(b, f, 0, 0, f.nx, f.ny);
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
   * inputs or the choice of far columns changed). Islands come in order
   * of priority (nearest the view first): those with tiles use them while
   * the mesh stays within `budget` triangles, the others their mask (the
   * masks are drawn whatever the budget).
   */
  show(islands: readonly MaskIsland[], budget = Infinity): void {
    const masks = this.masks(islands);
    const tris = (b: Builder) => b.indices.length / 3;
    let total = 0;
    for (const b of masks.values()) total += tris(b);
    const fromTiles = new Set<string>();
    for (const is of islands) {
      if (!is.tiles) continue;
      const extra = tris(is.tiles.data) - tris(masks.get(is.id) as Builder);
      if (total + extra > budget) continue;
      total += extra;
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
      if (!c || c.key !== k) this.cache.set(is.id, (c = { key: k, data: maskMeshData(is.mask, is.seed) }));
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
