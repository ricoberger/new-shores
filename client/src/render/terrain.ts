// Terrain (ART_DIRECTION §4; D-057 voxel style), render-only: the island's
// ground as voxel columns (render/voxelterrain.ts) — 4 per tile with the
// full models (near and mid LOD), 2 per tile with the lite models (far),
// 1 per tile for the far view of the islands around the focused one
// (render/farmesh.ts) — the coarser ones the near field downsampled, so
// the coast does not jump at a LOD switch. The near/mid columns take
// their top colours from the island's ground texture (one texel per
// column: the smooth blend between tiles, pebbles, wet sand) and every
// voxel a brightness jitter (render/groundshader.ts). One full mesh per
// chunk (display/chunks.ts, CHUNK × CHUNK tiles), culled per chunk, and
// one lite mesh per island. The coast water (CoastWater) — the pixel
// shallows and the foam on the stepped coast — is a separate pair of
// meshes at near and mid LOD.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Island, Terrain } from "../api/client";
import { type ChunkRect, islandChunks } from "../display/chunks";
import type { CoastLoop } from "../display/coastline";
import { fbm, hash2 } from "../display/noise";
import { TERRAIN, WATER } from "../theme/palette";
import { addGround } from "./groundshader";
import { c3, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";
import { skyFill } from "./lighting";
import { downsampleField, EMPTY, type Field, groundTexels, islandField, meshField, TERRAIN_VPT, tileRange } from "./voxelterrain";

/** Height of the sea surface: the coast's columns drop from the ground (0) to below it. */
export const SEA_LEVEL = -0.6;
/** Columns per tile of the far (lite) terrain. */
const LITE_VPT = 2;
/** Columns per tile of the far view of the other islands (farmesh.ts). */
export const FAR_VPT = 1;
/** Colour levels per channel of the far view's columns (coarse: neighbours merge; a tile is a pixel or two there). */
export const FAR_QUANT = 20;

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

/** An island's built terrain: the meshes of both details, the near field (coast water) and the far view's mesh data. */
export interface TerrainMeshes {
  lite: Mesh[];
  full: Mesh[];
  /** The near/mid column field (4 per tile). */
  field: Field | null;
  /** The far view's columns (FAR_VPT per tile, island-local), merged with the other islands (farmesh.ts). */
  far: Builder | null;
  dispose(): void;
}

/** No terrain. */
export const NO_TERRAIN: TerrainMeshes = { lite: [], full: [], field: null, far: null, dispose: () => undefined };

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
): TerrainMeshes {
  const b = new TerrainBuild(scene, island, loops, seed, parent, liteParent);
  for (const c of islandChunks(island.width, island.height)) b.chunk(c);
  return b.finish();
}

function terrainMaterial(scene: Scene, name: string): StandardMaterial {
  const material = skyFill(new StandardMaterial(name, scene));
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}

/**
 * buildTerrain in steps (the incremental island build,
 * render/buildqueue.ts): the fields and the ground texture first (the
 * constructor), the full mesh of each chunk (`chunk`, any order), then
 * the island's one lite mesh and the far view's data (`finish`). The
 * result equals buildTerrain's but for the order of vertices.
 */
export class TerrainBuild {
  private readonly material: StandardMaterial;
  private readonly texture: RawTexture;
  private readonly meshes: Mesh[] = [];
  /** The column fields of the full (4 per tile, textured) and lite (2 per tile, downsampled) terrain. */
  private readonly fields: { full: Field; lite: Field };

  constructor(
    private readonly scene: Scene,
    private readonly island: Island,
    loops: readonly CoastLoop[],
    seed: number,
    private readonly parent: (chunk: string) => TransformNode,
    private readonly liteParent: TransformNode | null,
  ) {
    const full: Field = { ...islandField(island, loops, seed, TERRAIN_VPT), textured: true };
    // The lite tops sample the same ground texture (their colours need no vertex colour: they merge into large rectangles).
    this.fields = { full, lite: { ...downsampleField(full, TERRAIN_VPT / LITE_VPT), textured: true } };
    this.texture = new RawTexture(groundTexels(full), full.nx, full.ny, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    this.texture.name = `ground_${island.id}`;
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.material = addGround(terrainMaterial(scene, "terrain"), { texture: this.texture, width: full.nx, height: full.ny, vpt: TERRAIN_VPT });
  }

  /** The full mesh of a chunk. */
  chunk(c: ChunkRect): void {
    const b = new Builder();
    meshField(b, this.fields.full, ...tileRange(c.x, c.y, c.width, c.height, TERRAIN_VPT));
    const mesh = b.mesh(`terrain_${this.island.id}_${c.key}`, this.scene, this.material, this.parent(c.key));
    if (!mesh) return;
    mesh.metadata = { chunk: c.key };
    mesh.freezeWorldMatrix();
    this.meshes.push(mesh);
  }

  /** Disposes what was built so far (a replaced build). */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
    this.texture.dispose();
    this.material.dispose();
  }

  /** The lite mesh and the far data; the full meshes built so far. */
  finish(): TerrainMeshes {
    const liteB = new Builder();
    const lite = this.fields.lite;
    meshField(liteB, lite, 0, 0, lite.nx, lite.ny);
    const liteMesh = liteB.mesh(`terrain_lite_${this.island.id}_all`, this.scene, this.material, this.liteParent);
    liteMesh?.freezeWorldMatrix();
    const farF: Field = { ...downsampleField(this.fields.full, TERRAIN_VPT / FAR_VPT), quant: FAR_QUANT };
    const far = new Builder();
    meshField(far, farF, 0, 0, farF.nx, farF.ny);
    const full = this.meshes;
    return {
      lite: liteMesh ? [liteMesh] : [],
      full,
      field: this.fields.full,
      far,
      dispose: () => {
        liteMesh?.dispose();
        this.dispose();
      },
    };
  }
}

/** Foam pattern texels (one row, wraps): each foam column samples one, the pattern steps along. */
const FOAM_TEXELS = 64;
/** Seconds per step of the foam pattern. */
const FOAM_STEP_S = 0.45;
/** Heights over the sea surface of the shallows and the foam. */
const SHALLOWS_Y = SEA_LEVEL + 0.006;
const FOAM_Y = SEA_LEVEL + 0.012;
/** Shallow bands off the wet sand line (columns from the land, colour, alpha): lighter near the beach. */
const SHALLOW_BANDS: readonly { from: number; to: number; color: Color3; alpha: number }[] = [
  { from: 3, to: 4, color: Color3.Lerp(c3(WATER.shallows), c3(WATER.foam), 0.3), alpha: 0.55 },
  { from: 5, to: 6, color: Color3.Lerp(c3(WATER.shallows), c3(TERRAIN.sand), 0.12), alpha: 0.42 },
  { from: 7, to: 8, color: c3(WATER.shallows), alpha: 0.26 },
];

function foamTexture(scene: Scene, seed: number): RawTexture {
  const data = new Uint8Array(FOAM_TEXELS * 4);
  for (let x = 0; x < FOAM_TEXELS; x++) {
    // Runs of foam and gaps: a coarse noise along the row.
    const n = fbm(x / 5, 0.5, seed);
    const a = n > 0.42 ? 235 : n > 0.34 ? 120 : 0;
    data.set([255, 255, 255, a], x * 4);
  }
  const tex = new RawTexture(data, FOAM_TEXELS, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/**
 * The coast water of an island on the near field's column grid: the
 * shallows as stepped bands of translucent turquoise off the wet sand
 * line (near and mid LOD), and the foam — one pixel per column on the
 * first water column, broken pixels on the next — that crawls along the
 * coast in steps (near LOD). Both follow the stepped coast exactly.
 */
export class CoastWater {
  private readonly shallowMaterial: StandardMaterial;
  private readonly foamMaterial: StandardMaterial;
  private readonly texture: RawTexture;
  private shallows: Mesh | null = null;
  private foam: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly shallowParent: TransformNode | null,
    private readonly foamParent: TransformNode | null,
    seed: number,
  ) {
    this.shallowMaterial = new StandardMaterial("shallows", scene);
    this.shallowMaterial.disableLighting = true;
    this.shallowMaterial.emissiveColor = Color3.White();
    this.shallowMaterial.backFaceCulling = false;
    this.foamMaterial = new StandardMaterial("foam", scene);
    this.texture = foamTexture(scene, seed);
    this.foamMaterial.diffuseTexture = this.texture;
    this.foamMaterial.useAlphaFromDiffuseTexture = true;
    this.foamMaterial.disableLighting = true;
    this.foamMaterial.emissiveColor = c3(WATER.foam).scale(0.95);
    this.foamMaterial.backFaceCulling = false;
  }

  /** Rebuilds both meshes from a near field (its coast distances). */
  update(f: Field | null, seed: number): void {
    this.shallows?.dispose();
    this.foam?.dispose();
    this.shallows = null;
    this.foam = null;
    if (!f?.toLand) return;
    const { nx, ny, s, x0, y0, toLand, h } = f;
    // Shallows: per row, runs of columns of one band.
    const sp: number[] = [];
    const sc: number[] = [];
    const si: number[] = [];
    const bandOf = (k: number) => {
      if (h[k] !== EMPTY) return -1;
      const d = toLand[k] as number;
      return SHALLOW_BANDS.findIndex((b) => d >= b.from && d <= b.to);
    };
    const rect = (xa: number, xb: number, ya: number, yb: number, y: number, pos: number[], idx: number[]) => {
      const base = pos.length / 3;
      pos.push(xa, y, -ya, xb, y, -ya, xb, y, -yb, xa, y, -yb);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        const band = bandOf(j * nx + i);
        let e = i + 1;
        while (e < nx && bandOf(j * nx + e) === band) e++;
        if (band >= 0) {
          rect(x0 + i * s, x0 + e * s, y0 + j * s, y0 + (j + 1) * s, SHALLOWS_Y, sp, si);
          const b = SHALLOW_BANDS[band] as (typeof SHALLOW_BANDS)[number];
          for (let q = 0; q < 4; q++) sc.push(b.color.r, b.color.g, b.color.b, b.alpha);
        }
        i = e;
      }
    }
    // Foam: one quad per column, its pattern texel by a hash of the column.
    const fp: number[] = [];
    const fi: number[] = [];
    const fu: number[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (h[k] !== EMPTY) continue;
        const d = toLand[k] as number;
        if (d !== 3 && !(d === 4 && hash2(i, j, seed + 41) < 0.3)) continue;
        rect(x0 + i * s, x0 + (i + 1) * s, y0 + j * s, y0 + (j + 1) * s, FOAM_Y, fp, fi);
        // Neighbouring columns sample neighbouring texels: the pattern's runs and gaps travel along the coast.
        const u = ((i + j + Math.floor(hash2(i, j, seed + 40) * 2)) % FOAM_TEXELS + 0.5) / FOAM_TEXELS;
        fu.push(u, 0.5, u, 0.5, u, 0.5, u, 0.5);
      }
    }
    const make = (name: string, pos: number[], idx: number[], material: StandardMaterial, parent: TransformNode | null, extra: (d: VertexData) => void) => {
      if (idx.length === 0) return null;
      const mesh = new Mesh(name, this.scene);
      const data = new VertexData();
      data.positions = pos;
      data.indices = idx;
      data.normals = pos.map((_, q) => (q % 3 === 1 ? 1 : 0));
      extra(data);
      data.applyToMesh(mesh);
      mesh.material = material;
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      return mesh;
    };
    this.shallows = make("shallows", sp, si, this.shallowMaterial, this.shallowParent, (d) => (d.colors = sc));
    if (this.shallows) {
      this.shallows.hasVertexAlpha = true;
      this.shallows.alphaIndex = 1;
    }
    this.foam = make("foam", fp, fi, this.foamMaterial, this.foamParent, (d) => (d.uvs = fu));
    if (this.foam) this.foam.alphaIndex = 2;
  }

  /** Shallows at near and mid LOD (the foam's parent is the near node). */
  setFar(far: boolean): void {
    this.shallows?.setEnabled(!far);
  }

  /** Steps the foam pattern along (server time nowMs). */
  frame(nowMs: number): void {
    this.texture.uOffset = Math.floor(nowMs / 1000 / FOAM_STEP_S) / FOAM_TEXELS;
  }

  dispose(): void {
    this.shallows?.dispose();
    this.foam?.dispose();
    this.texture.dispose();
    this.shallowMaterial.dispose();
    this.foamMaterial.dispose();
  }
}
