// Terrain (ART_DIRECTION §4), render-only: continuous flat ground with a
// hidden grid. The land is filled by marching squares over the tile
// centres (display/coastline.ts) so its outline follows the chamfered
// coastline; vertex colours at the tile centres give two-tone grass noise
// with dry patches, the forest floor, rock and sand, blending smoothly
// between tiles. Along the smoothed coastline a sand beach band slopes
// toward the water, replaced by a low cliff where a mountain tile meets
// the water. One mesh per CHUNK × CHUNK tiles (the whole island for the
// current content): draw calls, not vertices, are the phone budget. The
// foam line (FoamLine) is a separate animated strip at near LOD.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Island, Terrain } from "../api/client";
import { type CoastLoop, outwardNormal } from "../display/coastline";
import { fbm } from "../display/noise";
import { TERRAIN, WATER } from "../theme/palette";
import { c3, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";
import { skyFill } from "./lighting";

export const CHUNK = 64;
/** Width (tiles) of the beach band from the coastline toward the water. */
export const BEACH_WIDTH = 0.7;
/** The beach starts this far inland (it overlaps the ground fill's edge). */
const BEACH_INLAND = 0.25;
/** Height of the beach's outer edge (just above the sea surface). */
const BEACH_LOW = -0.11;
/** Low cliffs where mountain meets water: top above the ground, foot below the sea. */
const CLIFF_TOP = 0.22;
const CLIFF_FOOT = -0.3;

const SAND = c3(TERRAIN.sand);
const GRASS_A = c3(TERRAIN.grass_a);
const GRASS_B = c3(TERRAIN.grass_b);
const DRY = c3(TERRAIN.dry);
const CLIFF = c3(TERRAIN.cliff);
const WET_SAND = Color3.Lerp(SAND, c3(WATER.shallows), 0.5);

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

/** Mesh data under construction (positions, colours, indices) with shared vertices by key. */
class Builder {
  positions: number[] = [];
  colors: number[] = [];
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
    data.normals = this.positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }
}

/**
 * Ground fill of the cell between the centres of tiles (i, j) … (i+1,
 * j+1): the land part of the marching-squares cell, centres coloured by
 * their terrain, crossings (edge midpoints) by the beach or cliff.
 */
function fillCell(b: Builder, island: Island, i: number, j: number, seed: number): void {
  const { width, height, terrain } = island;
  const t = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? (terrain[y * width + x] as Terrain | undefined) : "water");
  const land = (x: number, y: number) => t(x, y) !== "water";
  const corner = (x: number, y: number) => b.vertex(x + 0.5, 0, -(y + 0.5), groundColor(t(x, y), x, y, seed), `c${x},${y}`);
  const edge = (x: number, y: number, lx: number, ly: number) =>
    b.vertex(x, 0, -y, t(lx, ly) === "mountain" ? CLIFF : SAND, `e${x},${y}`);
  const tl = land(i, j);
  const tr = land(i + 1, j);
  const br = land(i + 1, j + 1);
  const bl = land(i, j + 1);
  const T = () => edge(i + 1, j + 0.5, tl ? i : i + 1, j);
  const R = () => edge(i + 1.5, j + 1, i + 1, tr ? j : j + 1);
  const B = () => edge(i + 1, j + 1.5, bl ? i : i + 1, j + 1);
  const L = () => edge(i + 0.5, j + 1, i, tl ? j : j + 1);
  // Saddles keep diagonal land apart (as the coastline does).
  if (tr && bl && !tl && !br) {
    b.tri(T(), corner(i + 1, j), R());
    b.tri(B(), corner(i, j + 1), L());
    return;
  }
  if (tl && br && !tr && !bl) {
    b.tri(L(), corner(i, j), T());
    b.tri(R(), corner(i + 1, j + 1), B());
    return;
  }
  const poly: number[] = [];
  if (tl) poly.push(corner(i, j));
  if (tl !== tr) poly.push(T());
  if (tr) poly.push(corner(i + 1, j));
  if (tr !== br) poly.push(R());
  if (br) poly.push(corner(i + 1, j + 1));
  if (br !== bl) poly.push(B());
  if (bl) poly.push(corner(i, j + 1));
  if (bl !== tl) poly.push(L());
  for (let k = 1; k + 1 < poly.length; k++) b.tri(poly[0] as number, poly[k] as number, poly[k + 1] as number);
}

/** Beach band and cliffs along one smoothed coastline loop. */
function coastStrip(b: Builder, island: Island, loop: CoastLoop): void {
  const n = loop.length;
  if (n < 3) return;
  const mountain = (k: number) => {
    const p = loop[k % n] as CoastLoop[number];
    return island.terrain[p.landY * island.width + p.landX] === "mountain";
  };
  // Per point: inland, contour, outer (beach) or rim, top, foot (cliff).
  const beach: [number, number, number][] = [];
  const cliff: [number, number, number][] = [];
  for (let k = 0; k < n; k++) {
    const p = loop[k] as CoastLoop[number];
    const o = outwardNormal(loop, k);
    beach.push([
      b.vertex(p.x - o.x * BEACH_INLAND, 0.004, -(p.y - o.y * BEACH_INLAND), SAND),
      b.vertex(p.x, 0.002, -p.y, SAND.scale(0.98)),
      b.vertex(p.x + o.x * BEACH_WIDTH, BEACH_LOW, -(p.y + o.y * BEACH_WIDTH), WET_SAND),
    ]);
    if (mountain(k)) {
      cliff.push([
        b.vertex(p.x - o.x * 0.35, 0.006, -(p.y - o.y * 0.35), CLIFF.scale(0.95)),
        b.vertex(p.x, CLIFF_TOP, -p.y, CLIFF),
        b.vertex(p.x + o.x * 0.08, CLIFF_FOOT, -(p.y + o.y * 0.08), CLIFF.scale(0.62)),
      ]);
    } else {
      cliff.push([-1, -1, -1]);
    }
  }
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const strip = mountain(k) && mountain(k2) ? cliff : beach;
    const a = strip[k] as [number, number, number];
    const c = strip[k2] as [number, number, number];
    for (let s = 0; s < 2; s++) {
      b.tri(a[s] as number, c[s] as number, c[s + 1] as number);
      b.tri(a[s] as number, c[s + 1] as number, a[s + 1] as number);
    }
  }
}

export function buildTerrain(scene: Scene, island: Island, loops: readonly CoastLoop[], seed: number, parent: TransformNode | null = null): Mesh[] {
  const material = skyFill(new StandardMaterial("terrain", scene));
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  const meshes: Mesh[] = [];
  const chunks = new Map<string, Builder>();
  const chunk = (x: number, y: number) => {
    const k = `${Math.max(0, Math.floor(x / CHUNK))},${Math.max(0, Math.floor(y / CHUNK))}`;
    let b = chunks.get(k);
    if (!b) chunks.set(k, (b = new Builder()));
    return b;
  };
  for (let j = -1; j < island.height; j++) {
    for (let i = -1; i < island.width; i++) fillCell(chunk(i + 1, j + 1), island, i, j, seed);
  }
  for (const loop of loops) {
    const p = loop[0];
    if (p) coastStrip(chunk(p.x, p.y), island, loop);
  }
  for (const [k, b] of chunks) {
    const mesh = b.mesh(`terrain_${island.id}_${k}`, scene, material, parent);
    if (!mesh) continue;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  return meshes;
}

const FOAM_TEX_W = 128;
const FOAM_TEX_H = 32;
/** Foam band: from this far beyond the coastline to that far (tiles). */
const FOAM_IN = BEACH_WIDTH * 0.55;
const FOAM_OUT = BEACH_WIDTH + 0.45;
const FOAM_Y = -0.095;

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
      for (let k = 0; k <= n; k++) {
        const p = loop[k % n] as CoastLoop[number];
        if (k > 0) {
          const q = loop[k - 1] as CoastLoop[number];
          along += Math.hypot(p.x - q.x, p.y - q.y);
        }
        const o = outwardNormal(loop, k % n);
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
