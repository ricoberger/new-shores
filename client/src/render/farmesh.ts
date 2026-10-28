// Mask mesh (far view): an island drawn from its 1:4 terrain mask
// (display/mask.ts) instead of its full tiles — coarse voxel terrain, one
// column per tile in the colour of its mask cell's terrain, with the
// coast's sand shelves (render/voxelterrain.ts). No trees, buildings or
// life. Every island whose full tiles have not arrived yet is drawn this
// way, and at far LOD the islands other than the focused one
// (ART_DIRECTION §2 budget); all of them are merged into one static mesh
// (one draw call), rebuilt only when the set of islands drawn this way
// changes. An island whose tiles are built brings its own far columns
// instead (MaskIsland.tiles: its near field downsampled to one column per
// tile, render/terrain.ts), so its coast at far lines up with the one at
// mid. Render data only.
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
  const f = { ...islandField(pseudo, coastline(pseudo), seed, 1), quant: FAR_QUANT };
  meshField(b, f, 0, 0, f.nx, f.ny);
  return b;
}

/** The merged mask mesh of every island drawn from its mask (one draw call). */
export class MaskLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private key = "";
  /** Vertex data per island (island-local), by island ID and its inputs. */
  private readonly cache = new Map<string, { key: string; data: Builder }>();

  constructor(private readonly scene: Scene) {
    this.material = skyFill(new StandardMaterial("mask_terrain", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /** Draws exactly these islands from their masks (rebuilt only when the set or an island's inputs changed). */
  show(islands: readonly MaskIsland[]): void {
    const keyOf = (is: MaskIsland) => (is.tiles ? `tiles:${is.tiles.key}` : `${is.seed}|${is.mask.width}x${is.mask.height}|${maskString(is.mask)}`);
    const key = islands.map((is) => `${is.id}@${is.position.x},${is.position.y}#${keyOf(is)}`).join(";");
    if (key === this.key) return;
    this.key = key;
    this.mesh?.dispose();
    this.mesh = null;
    const parts: { data: Builder; x: number; y: number }[] = [];
    const keep = new Set<string>();
    for (const is of islands) {
      const k = keyOf(is);
      let c = this.cache.get(is.id);
      if (!c || c.key !== k) this.cache.set(is.id, (c = { key: k, data: is.tiles?.data ?? maskMeshData(is.mask, is.seed) }));
      keep.add(is.id);
      parts.push({ data: c.data, x: is.position.x, y: is.position.y });
    }
    for (const id of this.cache.keys()) if (!keep.has(id)) this.cache.delete(id);
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

  /** Islands drawn from their masks (tests and stats). */
  islands(): string[] {
    return this.key === "" ? [] : this.key.split(";").map((p) => p.slice(0, p.indexOf("@")));
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
