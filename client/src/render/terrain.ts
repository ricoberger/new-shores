// Terrain (ART_DIRECTION §4; D-057 voxel style), render-only: the island's
// ground as voxel columns (render/voxelterrain.ts) — 4 per tile with the
// full models (near and mid LOD), 2 per tile with the lite models (far) —
// in noise-tinted ground colours per terrain, a sand rim on the outermost
// land column and two sand shelves stepping down into the sea. One full
// mesh per chunk (display/chunks.ts, CHUNK × CHUNK tiles), culled per
// chunk, and one lite mesh per island. The foam line (FoamLine) is a
// separate animated strip off the coast at near LOD.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Island, Terrain } from "../api/client";
import { type ChunkRect, islandChunks } from "../display/chunks";
import { type CoastLoop, outwardNormal } from "../display/coastline";
import { fbm } from "../display/noise";
import { TERRAIN, WATER } from "../theme/palette";
import { c3, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";
import { skyFill } from "./lighting";
import { type Field, islandField, meshField, TERRAIN_VPT, tileRange } from "./voxelterrain";

/** Height of the sea surface: the coast's columns drop from the ground (0) to below it. */
export const SEA_LEVEL = -0.6;
/** Columns per tile of the far (lite) terrain. */
const LITE_VPT = 2;

const SAND = c3(TERRAIN.sand);
const GRASS_A = c3(TERRAIN.grass_a);
const GRASS_B = c3(TERRAIN.grass_b);
const DRY = c3(TERRAIN.dry);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground colour at a tile centre: noise-tinted per terrain (deterministic per island seed). */
export function groundColor(terrain: Terrain | undefined, x: number, y: number, seed: number): Color3 {
  const n = fbm(x / 5, y / 5, seed);
  switch (terrain) {
    case "grass": {
      const base = Color3.Lerp(GRASS_A, GRASS_B, smoothstep(0.3, 0.7, n));
      const dry = smoothstep(0.6, 0.78, fbm(x / 9 + 31, y / 9 + 7, seed + 1)) * 0.85;
      return Color3.Lerp(base, DRY, dry);
    }
    case "forest":
      return TERRAIN_COLORS.forest.scale(0.92 + 0.14 * n);
    case "mountain":
      return TERRAIN_COLORS.mountain.scale(0.93 + 0.12 * n);
    case "coast":
      return SAND.scale(0.97 + 0.05 * n);
    case "water":
      return TERRAIN_COLORS.water;
    default:
      return UNKNOWN_TERRAIN;
  }
}

/** Outward normals of a loop averaged over ±w points (weights w+1−|d|): steps and kinks blend into their neighbours. */
export function smoothNormals(loop: CoastLoop, w: number): { x: number; y: number }[] {
  const n = loop.length;
  const normals = loop.map((_, k) => outwardNormal(loop, k));
  return normals.map((_, k) => {
    let x = 0;
    let y = 0;
    for (let d = -w; d <= w; d++) {
      const q = normals[(k + d + n) % n] as { x: number; y: number };
      const wt = w + 1 - Math.abs(d);
      x += q.x * wt;
      y += q.y * wt;
    }
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  });
}

/** Mesh data under construction (positions, colours, normals, indices) with shared vertices by key. */
export class Builder {
  positions: number[] = [];
  colors: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  private readonly shared = new Map<string, number>();

  vertex(x: number, y: number, z: number, c: Color3, share: string | null = null): number {
    if (share !== null) {
      const v = this.shared.get(share);
      if (v !== undefined) return v;
    }
    const v = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.colors.push(c.r, c.g, c.b, 1);
    this.normals.push(0, 1, 0);
    if (share !== null) this.shared.set(share, v);
    return v;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  mesh(name: string, scene: Scene, material: StandardMaterial, parent: TransformNode | null): Mesh | null {
    if (this.indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    data.colors = this.colors;
    data.normals = this.normals;
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }
}

/**
 * The island's terrain in two details, both built once: `lite` (far LOD,
 * with the lite models; one mesh for the island under `liteParent`, the
 * far view shows whole islands) and `full` (near and mid LOD, with the
 * full models; per chunk under `parent`'s chunk nodes). Exactly one set
 * is enabled at a time. Settled or not, an island is drawn in the same
 * colours.
 */
export function buildTerrain(
  scene: Scene,
  island: Island,
  loops: readonly CoastLoop[],
  seed: number,
  parent: (chunk: string) => TransformNode,
  liteParent: TransformNode | null = null,
): { lite: Mesh[]; full: Mesh[] } {
  const b = new TerrainBuild(scene, island, loops, seed, parent, liteParent);
  for (const c of islandChunks(island.width, island.height)) b.chunk(c);
  return b.finish();
}

function terrainMaterial(scene: Scene): StandardMaterial {
  const material = skyFill(new StandardMaterial("terrain", scene));
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}

/**
 * buildTerrain in steps (the incremental island build,
 * render/buildqueue.ts): the columns of each chunk in both details with
 * its full mesh (`chunk`, any order), then the island's one lite mesh
 * (`finish`). The result equals buildTerrain's but for the order of
 * vertices.
 */
export class TerrainBuild {
  private readonly material: StandardMaterial;
  private readonly lite = new Builder();
  private readonly meshes: Mesh[] = [];
  /** The column fields of the full (4 per tile) and lite (2 per tile) terrain. */
  private readonly fields: { full: Field; lite: Field };

  constructor(
    private readonly scene: Scene,
    private readonly island: Island,
    loops: readonly CoastLoop[],
    seed: number,
    private readonly parent: (chunk: string) => TransformNode,
    private readonly liteParent: TransformNode | null,
  ) {
    this.material = terrainMaterial(scene);
    this.fields = { full: islandField(island, loops, seed, TERRAIN_VPT), lite: islandField(island, loops, seed, LITE_VPT) };
  }

  /** The columns of a chunk in both details, and its full mesh. */
  chunk(c: ChunkRect): void {
    const b = new Builder();
    meshField(b, this.fields.full, ...tileRange(c.x, c.y, c.width, c.height, TERRAIN_VPT));
    meshField(this.lite, this.fields.lite, ...tileRange(c.x, c.y, c.width, c.height, LITE_VPT));
    const mesh = b.mesh(`terrain_${this.island.id}_${c.key}`, this.scene, this.material, this.parent(c.key));
    if (!mesh) return;
    mesh.metadata = { chunk: c.key };
    mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
  }

  /** Disposes the meshes built so far (a replaced build). */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
  }

  /** The lite mesh; the full meshes built so far. */
  finish(): { lite: Mesh[]; full: Mesh[] } {
    const lite = this.lite.mesh(`terrain_lite_${this.island.id}_all`, this.scene, this.material, this.liteParent);
    lite?.freezeWorldMatrix();
    return { lite: lite ? [lite] : [], full: this.meshes };
  }
}


const FOAM_TEX_W = 128;
const FOAM_TEX_H = 32;
/** Foam band: from this far off the coastline (tiles, over the sand shelves) to FOAM_OUT, on the sea surface. */
const FOAM_IN = 0.252;
const FOAM_OUT = 0.91;
const FOAM_Y = SEA_LEVEL + 0.015;

/** Foam texture: a broken white band across v, varying along u (wraps in u). */
function foamTexture(scene: Scene, seed: number): DynamicTexture {
  const tex = new DynamicTexture("foam", { width: FOAM_TEX_W, height: FOAM_TEX_H }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(FOAM_TEX_W, FOAM_TEX_H);
  const foam = c3(WATER.foam);
  for (let y = 0; y < FOAM_TEX_H; y++) {
    for (let x = 0; x < FOAM_TEX_W; x++) {
      const v = y / (FOAM_TEX_H - 1);
      const band = Math.exp(-(((v - 0.42) / 0.2) ** 2)) + 0.35 * Math.exp(-(((v - 0.8) / 0.08) ** 2));
      const breaks = smoothstep(0.25, 0.65, fbm((x / FOAM_TEX_W) * 8, v * 2, seed));
      const a = Math.min(1, band * (0.3 + 0.5 * breaks));
      const i = (y * FOAM_TEX_W + x) * 4;
      img.data[i] = foam.r * 255;
      img.data[i + 1] = foam.g * 255;
      img.data[i + 2] = foam.b * 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** The moving foam line along an island's coastline (near LOD). */
export class FoamLine {
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
    seed: number,
  ) {
    this.material = skyFill(new StandardMaterial("foam", scene));
    this.texture = foamTexture(scene, seed);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = c3(WATER.foam).scale(0.35);
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /** Rebuilds the strip along the loops (island-local tiles). */
  update(loops: readonly CoastLoop[]): void {
    this.mesh?.dispose();
    this.mesh = null;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const loop of loops) {
      const n = loop.length;
      if (n < 3) continue;
      const first = positions.length / 3;
      let along = 0;
      const smooth = smoothNormals(loop, 3);
      for (let k = 0; k <= n; k++) {
        const p = loop[k % n] as CoastLoop[number];
        if (k > 0) {
          const q = loop[k - 1] as CoastLoop[number];
          along += Math.hypot(p.x - q.x, p.y - q.y);
        }
        const o = smooth[k % n] as { x: number; y: number };
        positions.push(p.x + o.x * FOAM_IN, FOAM_Y, -(p.y + o.y * FOAM_IN), p.x + o.x * FOAM_OUT, FOAM_Y, -(p.y + o.y * FOAM_OUT));
        const u = along / 3;
        uvs.push(u, 0, u, 1);
        if (k > 0) {
          const v = first + k * 2;
          indices.push(v - 2, v, v + 1, v - 2, v + 1, v - 1);
        }
      }
    }
    if (indices.length === 0) return;
    const mesh = new Mesh("foam", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.uvs = uvs;
    data.indices = indices;
    data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.parent = this.parent;
    mesh.isPickable = false;
    mesh.alphaIndex = 1;
    this.mesh = mesh;
  }

  /** Advances and pulls back the foam slowly (server time nowMs). */
  frame(nowMs: number): void {
    const t = nowMs / 1000;
    this.texture.uOffset = (t * 0.02) % 1;
    this.texture.vOffset = Math.sin((t * 2 * Math.PI) / 7) * 0.12;
  }
}
