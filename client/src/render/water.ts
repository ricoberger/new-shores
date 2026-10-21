// The sea (ART_DIRECTION §4): one plane under the whole archipelago with a
// shallows→deep gradient by distance from land (a texture computed once
// per payload change from the islands' statics, display/sea.ts), slow
// rippling scrolled with server time (a period of tens of seconds) and a
// subtle sun specular. "high": a tiling ripple normal map with the sun's
// real specular; "low": the same noise as sun-coloured glints in the
// emissive term (one texture sample instead of per-pixel bump lighting —
// the phone budget). Outside the gradient texture the sea is deep; the
// haze frame of the archipelago layer fades it out. Scene coordinates are archipelago coordinates (tile (x, y) is
// world (x, 0, −y)).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Rect } from "../display/camera";
import { valueNoise } from "../display/noise";
import type { Quality } from "../display/quality";
import { depthFactor, type DistanceField, type IslandLand, landDistance } from "../display/sea";
import { LIGHT, TERRAIN, WATER } from "../theme/palette";
import { c3 } from "./palette";
import { skyFill } from "./lighting";

/** Ripple normal map size (texels) and how many tiles one repeat covers. */
const RIPPLE_TEX = 64;
const RIPPLE_TILES = 9;
/** Ripple drift (normal-map repeats per second): a repeat takes ≈ 40 s. */
const RIPPLE_SPEED = 0.025;

/** Tileable two-octave value noise (n × n, period n) of the ripples. */
function rippleHeights(): Float32Array {
  const n = RIPPLE_TEX;
  const cells = 8;
  const h = new Float32Array(n * n);
  // Wrapping lattice: noise with a period of `cells`.
  const wrapNoise = (x: number, y: number, seed: number) => {
    const fx = (x / n) * cells;
    const fy = (y / n) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const lattice = (i: number, j: number) => valueNoise(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = lattice(x0, y0);
    const b = lattice(x0 + 1, y0);
    const c = lattice(x0, y0 + 1);
    const d = lattice(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = (wrapNoise(x, y, 11) + 0.5 * wrapNoise(x * 2, y * 2, 23)) / 1.5;
  return h;
}

/** Ripple normal map (tangent space) of the heights. */
function rippleTexture(scene: Scene, h: Float32Array): RawTexture {
  const n = RIPPLE_TEX;
  const data = new Uint8Array(n * n * 4);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)] as number;
  const k = 3.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      data[i] = Math.round((-dx / len) * 127.5 + 127.5);
      data[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      data[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      data[i + 3] = 255;
    }
  }
  const tex = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Gradient texture of a distance field: shallows near land, deep beyond. */
function gradientTexture(scene: Scene, f: DistanceField): RawTexture {
  const shallows = c3(WATER.shallows);
  const deep = c3(WATER.deep);
  const sand = c3(TERRAIN.sand);
  const data = new Uint8Array(f.width * f.height * 4);
  for (let i = 0; i < f.width * f.height; i++) {
    const d = f.dist[i] as number;
    const t = depthFactor(d);
    // Right at the shore the sand shows through the shallows.
    const s = Math.max(0, 1 - d / 1.5) * 0.35;
    const r = (shallows.r * (1 - t) + deep.r * t) * (1 - s) + sand.r * s;
    const g = (shallows.g * (1 - t) + deep.g * t) * (1 - s) + sand.g * s;
    const b = (shallows.b * (1 - t) + deep.b * t) * (1 - s) + sand.b * s;
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = RawTexture.CreateRGBATexture(data, f.width, f.height, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** Sun glints of the heights (low quality): sun-coloured where the ripples crest. */
function glintTexture(scene: Scene, h: Float32Array): RawTexture {
  const n = RIPPLE_TEX;
  const sun = c3(LIGHT.sun);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = h[i] as number;
    const t = Math.min(1, Math.max(0, (v - 0.6) / 0.2));
    const k = 0.025 + t * t * (3 - 2 * t) * 0.13;
    data[i * 4] = Math.round(sun.r * k * 255);
    data[i * 4 + 1] = Math.round(sun.g * k * 255);
    data[i * 4 + 2] = Math.round(sun.b * k * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = RawTexture.CreateRGBATexture(data, n, n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

export class Sea {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly ripples: RawTexture;
  private readonly glints: RawTexture;
  private gradient: RawTexture | null = null;
  private field: DistanceField | null = null;
  private rect: Rect | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly level: number,
  ) {
    this.mesh = new Mesh("sea", scene);
    this.material = skyFill(new StandardMaterial("sea", scene));
    this.material.diffuseColor = c3(WATER.deep);
    this.material.specularPower = 40;
    const heights = rippleHeights();
    this.ripples = rippleTexture(scene, heights);
    this.ripples.level = 0.3;
    this.glints = glintTexture(scene, heights);
    this.setQuality("low");
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
  }

  /** High: bump-mapped ripples with the sun's specular; low: emissive glints. */
  setQuality(q: Quality): void {
    const high = q === "high";
    this.material.bumpTexture = high ? this.ripples : null;
    this.material.emissiveTexture = high ? null : this.glints;
    this.material.specularColor = high ? c3(LIGHT.sun).scale(0.35) : Color3.Black();
  }

  /** Recomputes the shallows→deep gradient from the islands' land (call on payload changes). */
  setIslands(islands: readonly IslandLand[]): void {
    this.field = landDistance(islands);
    this.gradient?.dispose();
    this.gradient = this.field ? gradientTexture(this.scene, this.field) : null;
    this.material.diffuseTexture = this.gradient;
    this.material.diffuseColor = this.gradient ? Color3.White() : c3(WATER.deep);
    this.rebuild();
  }

  /** The sea plane's extent (archipelago tiles). */
  layout(rect: Rect): void {
    this.rect = rect;
    this.rebuild();
  }

  /** A quad over the rectangle; UVs in gradient-texture space (the ripples tile by their own scale). */
  private rebuild(): void {
    const r = this.rect;
    if (!r) return;
    const f = this.field;
    const u = (x: number) => (f ? (x - f.originX) / (f.width * f.step) : 0);
    const v = (y: number) => (f ? (y - f.originY) / (f.height * f.step) : 0);
    const data = new VertexData();
    data.positions = [r.minX, this.level, -r.minY, r.maxX, this.level, -r.minY, r.maxX, this.level, -r.maxY, r.minX, this.level, -r.maxY];
    data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    data.uvs = [u(r.minX), v(r.minY), u(r.maxX), v(r.minY), u(r.maxX), v(r.maxY), u(r.minX), v(r.maxY)];
    data.indices = [0, 2, 1, 0, 3, 2];
    data.applyToMesh(this.mesh, true);
    const fw = f ? f.width * f.step : 1;
    const fh = f ? f.height * f.step : 1;
    for (const t of [this.ripples, this.glints]) {
      t.uScale = fw / RIPPLE_TILES;
      t.vScale = fh / RIPPLE_TILES;
    }
  }

  /** Drifts the ripples at server time nowMs. */
  frame(nowMs: number): void {
    const t = (nowMs / 1000) * RIPPLE_SPEED;
    for (const tex of [this.ripples, this.glints]) {
      tex.uOffset = t % 1;
      tex.vOffset = (t * 0.63) % 1;
    }
  }
}
