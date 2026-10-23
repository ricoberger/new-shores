// Terrain (ART_DIRECTION §4, restyle diorama), render-only: continuous
// flat ground with a hidden grid on top of a diorama slab. The land is
// filled by marching squares over the tile centres (display/coastline.ts)
// so its outline follows the chamfered coastline; vertex colours at the
// tile centres give two-tone grass noise with dry patches, the forest
// floor, rock and sand, blending smoothly between tiles. Along the
// smoothed coastline the land ends in a slab: a thin sand rim on top, then
// a layered cliff (an upper band, a ledge, a lower band) down to its
// AO-darkened foot under the sea surface (SEA_LEVEL, ≈ 0.6 tiles below the
// ground), flat-shaded with per-face normals so the bands catch the sun;
// band heights and offsets wander with noise along the coast. Every LOD
// draws this diorama ground: the full slab profile with the full models
// (near and mid LOD), the five-ring one with the lite models (far). One mesh per
// CHUNK × CHUNK tiles (the whole island for the current content): draw
// calls, not vertices, are the phone budget. The foam line (FoamLine) is a
// separate animated strip at the cliff foot at near LOD.
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
import { ISLAND, TERRAIN, WATER } from "../theme/palette";
import { c3, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";
import { skyFill } from "./lighting";

export const CHUNK = 64;
/**
 * The slab at far LOD (with the lite models): the same bands merged to
 * five rings (rim, contour, the upper cliff's top, the ledge, the foot) —
 * about half the triangles of PROFILE, which near and mid LOD draw.
 */
export const NEAR_PROFILE: readonly ProfileRing[] = [
  { out: -0.22, y: 0.004, color: c3(ISLAND.sand_rim), jitter: 0 },
  { out: 0, y: 0.004, color: c3(ISLAND.sand_rim).scale(0.97), jitter: 0 },
  { out: 0.08, y: -0.09, color: c3(ISLAND.cliff_upper), jitter: 0.015 },
  { out: 0.21, y: -0.31, color: c3(ISLAND.cliff_ledge), jitter: 0.04 },
  { out: 0.36, y: -0.7, color: c3(ISLAND.cliff_foot), jitter: 0 },
];

/** Share of the local radius of curvature a slab ring may reach on the curve's inner side. */
const CURVE_SHARE = 0.8;
/** Upward tilt added to the slab's steep face normals (stylised soft lighting of the cliffs). */
const UP_TILT = 0.55;
/** Height of the sea surface: the slab's cliffs drop from the ground (0) to below it. */
export const SEA_LEVEL = -0.6;
/** How far (tiles) the sand rim reaches inland from the coastline. */
const RIM_INLAND = 0.22;
/** How far (tiles) the cliff foot reaches out from the coastline (the foam starts there). */
export const SLAB_REACH = 0.36;

/**
 * The slab profile from the coastline outward: (outward offset, height,
 * colour, noise weight of the height) per ring. The rim and its rounded
 * lip, the upper cliff band, a ledge, the lower band and the foot below
 * the sea. Noise moves the inner rings' heights by up to ±weight.
 */
const PROFILE: readonly ProfileRing[] = [
  { out: -RIM_INLAND, y: 0.004, color: c3(ISLAND.sand_rim), jitter: 0 },
  { out: 0, y: 0.004, color: c3(ISLAND.sand_rim).scale(0.97), jitter: 0 },
  { out: 0.05, y: -0.045, color: c3(ISLAND.sand_rim).scale(0.88), jitter: 0 },
  { out: 0.08, y: -0.09, color: c3(ISLAND.cliff_upper), jitter: 0.015 },
  { out: 0.1, y: -0.25, color: c3(ISLAND.cliff_upper).scale(0.86), jitter: 0.04 },
  { out: 0.19, y: -0.29, color: c3(ISLAND.cliff_ledge), jitter: 0.04 },
  { out: 0.23, y: -0.33, color: c3(ISLAND.cliff_ledge).scale(0.9), jitter: 0.04 },
  { out: 0.25, y: -0.4, color: c3(ISLAND.cliff_lower), jitter: 0.03 },
  { out: 0.28, y: -0.56, color: c3(ISLAND.cliff_lower).scale(0.78), jitter: 0.02 },
  { out: SLAB_REACH, y: SEA_LEVEL - 0.1, color: c3(ISLAND.cliff_foot), jitter: 0 },
];

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

/**
 * Stylised: tilts steep normals toward the sky, so cliffs turned away from
 * the sun keep a readable mid-tone instead of the bare ambient fill.
 */
function tilt(n: [number, number, number]): [number, number, number] {
  if (n[1] >= 0.6) return n;
  const ny = n[1] + UP_TILT;
  const l = Math.hypot(n[0], ny, n[2]) || 1;
  return [n[0] / l, ny / l, n[2] / l];
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

  /** A triangle with its own vertices, colours and normals (normals are tilted toward the sky like flat()). */
  shaded(p: readonly [number, number, number][], cols: readonly Color3[], normals: readonly [number, number, number][]): void {
    for (let k = 0; k < 3; k++) {
      const q = p[k] as [number, number, number];
      const col = cols[k] as Color3;
      const n = tilt(normals[k] as [number, number, number]);
      this.indices.push(this.positions.length / 3);
      this.positions.push(q[0], q[1], q[2]);
      this.colors.push(col.r, col.g, col.b, 1);
      this.normals.push(n[0], n[1], n[2]);
    }
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

/** Ground colour of a tile (centre) and of a coastline crossing. */
export interface GroundColors {
  tile(terrain: Terrain | undefined, x: number, y: number): Color3;
  /** Colour transform of the slab colours. */
  slab(c: Color3): Color3;
}

/**
 * Ground fill of the cell between the centres of tiles (i, j) … (i+1,
 * j+1) at height y: the part of the marching-squares cell inside the
 * mask, centres coloured per tile, crossings (edge midpoints) by `edge`.
 */
export function fillCell(
  b: Builder,
  inside: (x: number, y: number) => boolean,
  tile: (x: number, y: number) => Color3,
  edgeColor: Color3,
  i: number,
  j: number,
  y = 0,
): void {
  const corner = (x: number, yy: number) => b.vertex(x + 0.5, y, -(yy + 0.5), tile(x, yy), `c${x},${yy}`);
  const edge = (x: number, yy: number) => b.vertex(x, y, -yy, edgeColor, `e${x},${yy}`);
  const tl = inside(i, j);
  const tr = inside(i + 1, j);
  const br = inside(i + 1, j + 1);
  const bl = inside(i, j + 1);
  const T = () => edge(i + 1, j + 0.5);
  const R = () => edge(i + 1.5, j + 1);
  const B = () => edge(i + 1, j + 1.5);
  const L = () => edge(i + 0.5, j + 1);
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

/** The island ground's cell: land is any terrain but water, tiles coloured by `colors`. */
function groundCell(b: Builder, island: Island, i: number, j: number, colors: GroundColors): void {
  const { width, height, terrain } = island;
  const t = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? (terrain[y * width + x] as Terrain | undefined) : "water");
  fillCell(b, (x, y) => t(x, y) !== "water", (x, y) => colors.tile(t(x, y), x, y), colors.slab(c3(ISLAND.sand_rim)), i, j);
}

/** One ring of a slab profile: outward offset from the contour, height, colour and noise weight of the height. */
export interface ProfileRing {
  out: number;
  y: number;
  color: Color3;
  jitter: number;
}

/**
 * The slab along one smoothed coastline loop: PROFILE rings offset along
 * the outward normal, heights wandering with noise along the loop
 * (deterministic per seed), flat-shaded quads between consecutive points.
 */
export function slabStrip(b: Builder, loop: CoastLoop, seed: number, tint: (c: Color3) => Color3, profile: readonly ProfileRing[] = PROFILE, topRings = 2): void {
  const n = loop.length;
  if (n < 3) return;
  const rings: { pts: [number, number, number][] }[] = [];
  // Outward normals averaged over neighbours, so that the rings of tight
  // concave corners fan instead of folding over each other; the shading
  // normals averaged wider (±4 points), so a short step of the coast (a
  // one-tile notch) shades like its neighbours instead of as an isolated
  // face turned away from the sun.
  const smooth = smoothNormals(loop, 2);
  const shadeN = smoothNormals(loop, 4);
  // Clamp the offsets where the coast curves tighter than they reach: at
  // an inward corner (curving toward the water) the outward rings would
  // fold over each other into dark interpenetrating faces, at an outward
  // corner the inland rim would. Each point's offsets on that side are
  // limited to a share of the local radius of curvature (smoothed along
  // the loop so the clamp blends in).
  const maxOut = Math.max(...profile.map((r) => r.out)) * 1.25;
  const maxIn = Math.max(0, ...profile.map((r) => -r.out));
  const pt = (k: number) => loop[((k % n) + n) % n] as CoastLoop[number];
  const rawOut: number[] = [];
  const rawIn: number[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = pt(k - 2);
    const a1 = pt(k);
    const a2 = pt(k + 2);
    const ax = a1.x - a0.x;
    const ay = a1.y - a0.y;
    const bx = a2.x - a1.x;
    const by = a2.y - a1.y;
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const theta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    const o = smooth[k] as { x: number; y: number };
    const toward = (bx / lb - ax / la) * o.x + (by / lb - ay / la) * o.y;
    const radius = (la + lb) / 2 / Math.max(1e-6, Math.abs(theta));
    const limit = CURVE_SHARE * radius;
    rawOut.push(toward > 0 && maxOut > limit ? limit / maxOut : 1);
    rawIn.push(toward < 0 && maxIn > limit ? limit / maxIn : 1);
  }
  const window = (arr: number[], k: number) => {
    let m = 1;
    for (let d = -3; d <= 3; d++) m = Math.min(m, arr[((k + d) % n + n) % n] as number);
    return m;
  };
  let along = 0;
  for (let k = 0; k < n; k++) {
    const p = loop[k] as CoastLoop[number];
    if (k > 0) {
      const q = loop[k - 1] as CoastLoop[number];
      along += Math.hypot(p.x - q.x, p.y - q.y);
    }
    const o = smooth[k] as { x: number; y: number };
    const wobble = fbm(along / 2.5, seed % 97, seed) * 2 - 1;
    const reach = (1 + 0.25 * (fbm(along / 4 + 17, seed % 53, seed + 3) * 2 - 1)) * window(rawOut, k);
    const inland = window(rawIn, k);
    const pts = profile.map((r): [number, number, number] => {
      const out = r.out > 0 ? r.out * reach : r.out * inland;
      return [p.x + o.x * out, r.y + r.jitter * wobble, -(p.y + o.y * out)];
    });
    rings.push({ pts });
  }
  const cols = profile.map((r) => tint(r.color));
  // Per band, the normal of its slope in the (outward, up) plane: a wall is
  // horizontal, a ledge points up; around the loop it turns with the
  // smoothed outward direction (bands keep their flat colours).
  const band = profile.slice(0, -1).map((r, s) => {
    const next = profile[s + 1] as ProfileRing;
    const dout = Math.max(0, next.out - r.out);
    const dy = r.y - next.y;
    const l = Math.hypot(dout, dy) || 1;
    return { h: dy / l, v: dout / l };
  });
  const normalAt = (k: number, s: number): [number, number, number] => {
    if (s < topRings) return [0, 1, 0];
    const o = shadeN[k % n] as { x: number; y: number };
    const bn = band[s] as { h: number; v: number };
    return [o.x * bn.h, bn.v, -o.y * bn.h];
  };
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const a = rings[k] as (typeof rings)[number];
    const c = rings[k2] as (typeof rings)[number];
    for (let s = 0; s + 1 < profile.length; s++) {
      const ca = cols[s] as Color3;
      const cb = cols[s + 1] as Color3;
      const na = normalAt(k, s);
      const nc = normalAt(k2, s);
      b.shaded([a.pts[s] as [number, number, number], c.pts[s] as [number, number, number], c.pts[s + 1] as [number, number, number]], [ca, ca, cb], [na, nc, nc]);
      b.shaded([a.pts[s] as [number, number, number], c.pts[s + 1] as [number, number, number], a.pts[s + 1] as [number, number, number]], [ca, cb, cb], [na, nc, na]);
    }
  }
}

/** Ground colours of the terrain (noise-tinted per terrain). */
export function terrainColors(seed: number): GroundColors {
  return { tile: (t, x, y) => groundColor(t, x, y, seed), slab: (c) => c };
}

/**
 * The island's ground and slab, one mesh per chunk under `parent`, with
 * the given colours and material (default: a lit terrain material).
 */
export function buildIslandMeshes(
  scene: Scene,
  island: Island,
  loops: readonly CoastLoop[],
  seed: number,
  colors: GroundColors,
  material: StandardMaterial,
  parent: TransformNode | null,
  name: string,
  profile: readonly ProfileRing[] = PROFILE,
): Mesh[] {
  const meshes: Mesh[] = [];
  const chunks = new Map<string, Builder>();
  const chunk = (x: number, y: number) => {
    const k = `${Math.max(0, Math.floor(x / CHUNK))},${Math.max(0, Math.floor(y / CHUNK))}`;
    let b = chunks.get(k);
    if (!b) chunks.set(k, (b = new Builder()));
    return b;
  };
  for (let j = -1; j < island.height; j++) {
    for (let i = -1; i < island.width; i++) groundCell(chunk(i + 1, j + 1), island, i, j, colors);
  }
  for (const loop of loops) {
    const p = loop[0];
    if (p) slabStrip(chunk(p.x, p.y), loop, seed, colors.slab, profile);
  }
  for (const [k, b] of chunks) {
    const mesh = b.mesh(`${name}_${island.id}_${k}`, scene, material, parent);
    if (!mesh) continue;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * The island's terrain in two details, both built once: `lite` with the
 * five-ring slab profile (far LOD, with the lite models) and `full` with
 * the full profile (near and mid LOD, with the full models). The ground
 * fill is in both; exactly one set is enabled at a time.
 */
export function buildTerrain(
  scene: Scene,
  island: Island,
  loops: readonly CoastLoop[],
  seed: number,
  parent: TransformNode | null = null,
): { lite: Mesh[]; full: Mesh[] } {
  const material = skyFill(new StandardMaterial("terrain", scene));
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  const colors = terrainColors(seed);
  return {
    lite: buildIslandMeshes(scene, island, loops, seed, colors, material, parent, "terrain_lite", NEAR_PROFILE),
    full: buildIslandMeshes(scene, island, loops, seed, colors, material, parent, "terrain", PROFILE),
  };
}

const FOAM_TEX_W = 128;
const FOAM_TEX_H = 32;
/** Foam band: from just inside the cliff foot to this far beyond the coastline (tiles), on the sea surface. */
const FOAM_IN = SLAB_REACH * 0.7;
const FOAM_OUT = SLAB_REACH + 0.55;
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
