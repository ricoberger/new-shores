// Mountains as rocky plateaus (restyle diorama), visual only: the
// island's mountain tiles rise in one step (and the tiles deep inside a
// mountain range in a second one). Each step's outline is the tile
// contour rounded by Gaussian-like smoothing (corner radius ≥ 0.5 tile),
// its top a flat surface sampled on a quarter-tile grid inside that
// rounded outline (warm rock on the first step, a thin moss cap on the
// top step), its side the slab's layered cliff profile in warm rock
// bands. KayKit crags and boulders (decor_crag_*, decor_rock_c) cluster
// along the step edges and on the tops, so the silhouette is jagged. The
// rules do not change (D-036): roads never go on mountains, and a
// building that covers mountain tiles (a mine or quarry on its deposit)
// keeps them at ground level — they are cut out of the plateau, so the
// building stands in a notch; deposit tiles get their outcrop instead of
// crags. Rebuilt with the layout (building footprints) and once the
// decor models have loaded; shown at near and mid LOD under the island
// root.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding, Island } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { type CoastLoop, marchingSquares, traceLoops } from "../display/coastline";
import { hash2 } from "../display/noise";
import { ISLAND } from "../theme/palette";
import { skyFill } from "./lighting";
import { decorModel, type ModelRegistry } from "./models";
import { c3 } from "./palette";
import { Builder, type ProfileRing, slabStrip } from "./terrain";
import { ModelMerger } from "./trees";
import { VOXEL } from "../display/voxel";
import { distanceTo, EMPTY, type Field, meshField, TERRAIN_VPT, VOXEL_STEP } from "./voxelterrain";

/** Height (tiles) of one plateau step (voxel prototype: two voxel steps, see plateauField). */
export const PLATEAU_STEP = VOXEL ? 2 * VOXEL_STEP : 0.42;
/** Sample spacing (tiles) of the rounded outline and of the top surface grid. */
const OUTLINE_STEP = 0.2;
const TOP_GRID = 0.25;
/** Plateau-top crag rows placed per step of the incremental build. */
const CRAG_ROWS_PER_STEP = 24;
/** Smoothing passes of the resampled outline (more: rounder corners). */
const SMOOTH_PASSES = 10;

const ROCK_LIGHT = c3(ISLAND.rock_light);
const ROCK = c3(ISLAND.rock);
const ROCK_DEEP = c3(ISLAND.rock_deep);
const MOSS = c3(ISLAND.moss);

const CRAGS = ["decor_crag_a", "decor_crag_b", "decor_crag_c"] as const;
const BOULDER = "decor_rock_c";

/** Top colour of a plateau level: warm rock on the first step, the moss cap on the top step. */
function topColor(level: number): Color3 {
  return level >= 2 ? MOSS : Color3.Lerp(ROCK_LIGHT, MOSS, 0.18);
}

/** Cliff profile of one step from its top (h1) down to the level below (h0): rounded lip, upper band, ledge, lower band, foot. */
function stepProfile(h0: number, h1: number, top: Color3): ProfileRing[] {
  const d = h1 - h0;
  return [
    { out: -0.18, y: h1, color: top, jitter: 0 },
    { out: 0, y: h1, color: Color3.Lerp(top, ROCK_LIGHT, 0.6), jitter: 0 },
    { out: 0.06, y: h1 - 0.14 * d, color: ROCK_LIGHT, jitter: 0 },
    { out: 0.1, y: h1 - 0.45 * d, color: ROCK, jitter: 0.06 * d },
    { out: 0.17, y: h1 - 0.52 * d, color: ROCK.scale(1.06), jitter: 0.06 * d },
    { out: 0.2, y: h1 - 0.62 * d, color: ROCK_DEEP, jitter: 0.04 * d },
    { out: 0.24, y: h0 + 0.1 * d, color: ROCK_DEEP.scale(0.86), jitter: 0 },
    { out: 0.3, y: h0 - 0.02, color: ROCK_DEEP.scale(0.7), jitter: 0 },
  ];
}

/**
 * Plateau level of every tile (0: ground, 1, 2), row-major: mountain
 * tiles outside `blocked` ("x,y" keys) are level 1, and level 2 where all
 * eight neighbours are level 1 too.
 */
export function plateauLevels(island: Pick<Island, "width" | "height" | "terrain">, blocked: ReadonlySet<string>): Uint8Array {
  const { width, height, terrain } = island;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (terrain[y * width + x] === "mountain" && !blocked.has(`${x},${y}`)) out[y * width + x] = 1;
  }
  const one = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && out[y * width + x]! >= 1;
  const two: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!one(x, y)) continue;
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!one(x + dx, y + dy)) all = false;
      if (all) two.push(y * width + x);
    }
  }
  for (const i of two) out[i] = 2;
  return out;
}

/** Tiles ("x,y") covered by building footprints (not roads or fields): kept at ground level, no crags or outcrops. */
export function footprintTiles(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): Set<string> {
  const out = new Set<string>();
  for (const b of buildings) {
    const def = defs.get(b.type);
    if (!def || def.category === "roads" || def.field) continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) out.add(`${x},${y}`);
  }
  return out;
}

/** Ground height (tiles) of a tile under the plateaus. */
export function plateauHeight(levels: Uint8Array, width: number, x: number, y: number): number {
  return (levels[y * width + x] ?? 0) * PLATEAU_STEP;
}

/**
 * A closed contour resampled at `step` and smoothed `passes` times
 * ((¼, ½, ¼) kernel): sharp tile corners become round with a radius that
 * grows with the passes (≈ 0.5 tile at the defaults). The land stays on
 * the right, like the coastline loops.
 */
export function roundLoop(loop: readonly { x: number; y: number }[], step = OUTLINE_STEP, passes = SMOOTH_PASSES): CoastLoop {
  const pts: { x: number; y: number }[] = [];
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const a = loop[k] as { x: number; y: number };
    const b = loop[(k + 1) % n] as { x: number; y: number };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const m = Math.max(1, Math.round(len / step));
    for (let i = 0; i < m; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / m, y: a.y + ((b.y - a.y) * i) / m });
  }
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const c = cur.length;
    cur = cur.map((q, k) => {
      const a = cur[(k - 1 + c) % c] as { x: number; y: number };
      const b = cur[(k + 1) % c] as { x: number; y: number };
      return { x: 0.25 * a.x + 0.5 * q.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * q.y + 0.25 * b.y };
    });
  }
  return cur.map((q) => ({ x: q.x, y: q.y, landX: 0, landY: 0 }));
}

/** Even-odd point-in-polygon test against a set of closed loops (holes included). */
export function insideLoops(loops: readonly (readonly { x: number; y: number }[])[], x: number, y: number): boolean {
  let inside = false;
  for (const l of loops) {
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const a = l[i] as { x: number; y: number };
      const b = l[j] as { x: number; y: number };
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * insideLoops of fixed loops as a function, with the edges bucketed by
 * the unit rows they span: a test looks only at the edges of its row
 * (the same even-odd result).
 */
export function loopIndex(loops: readonly (readonly { x: number; y: number }[])[]): (x: number, y: number) => boolean {
  const rows = new Map<number, [number, number, number, number][]>();
  for (const l of loops) {
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const a = l[i] as { x: number; y: number };
      const b = l[j] as { x: number; y: number };
      if (a.y === b.y) continue; // never crossed (a.y > y !== b.y > y is false)
      for (let r = Math.floor(Math.min(a.y, b.y)); r <= Math.floor(Math.max(a.y, b.y)); r++) {
        let list = rows.get(r);
        if (!list) rows.set(r, (list = []));
        list.push([a.x, a.y, b.x, b.y]);
      }
    }
  }
  return (x, y) => {
    let inside = false;
    for (const [ax, ay, bx, by] of rows.get(Math.floor(y)) ?? []) {
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
}

/**
 * insideLoops for every point of a grid (x0 + i·g, y0 + j·g), i < nx,
 * j < ny, row-major: the same even-odd test, with each row's edge
 * crossings computed once (O(rows × edges + points) instead of
 * O(points × edges)).
 */
export function insideGrid(loops: readonly (readonly { x: number; y: number }[])[], x0: number, y0: number, g: number, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(nx * ny);
  const xs: number[] = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * g;
    xs.length = 0;
    for (const l of loops) {
      for (let i = 0, k = l.length - 1; i < l.length; k = i++) {
        const a = l[i] as { x: number; y: number };
        const b = l[k] as { x: number; y: number };
        if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
      }
    }
    if (xs.length === 0) continue;
    xs.sort((p, q) => p - q);
    // Crossings strictly right of x, counted down as x moves right.
    let c = 0;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * g;
      while (c < xs.length && (xs[c] as number) <= x) c++;
      out[j * nx + i] = (xs.length - c) % 2;
    }
  }
  return out;
}

/**
 * The flat top inside rounded loops: marching squares over a TOP_GRID
 * sample grid at height y; with merge, a row's run of whole cells is one
 * quad (same surface, a fraction of the triangles; false: tests).
 */
export function fillTop(b: Builder, loops: readonly CoastLoop[], y: number, color: Color3, merge = true): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of loops) {
    for (const p of l) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return;
  const g = TOP_GRID;
  const nx = Math.ceil((maxX - minX) / g) + 2;
  const ny = Math.ceil((maxY - minY) / g) + 2;
  const x0 = minX - g;
  const y0 = minY - g;
  const inside = insideGrid(loops, x0, y0, g, nx, ny);
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && inside[j * nx + i] === 1;
  // Shared vertices by half-step grid position (one top per call and height: no string keys needed).
  const shared = new Map<number, number>();
  const v = (px: number, py: number) => {
    const k = Math.round(py * 2) * (2 * nx + 2) + Math.round(px * 2);
    let i = shared.get(k);
    if (i === undefined) shared.set(k, (i = b.vertex(x0 + px * g, y, -(y0 + py * g), color)));
    return i;
  };
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      if (!tl && !tr && !br && !bl) continue;
      if (merge && tl && tr && br && bl) {
        // A run of whole cells is one quad (the top is flat and one colour).
        let e = i + 1;
        while (e + 1 < nx && at(e + 1, j) && at(e + 1, j + 1)) e++;
        const a = v(i, j);
        const c = v(e, j + 1);
        b.tri(a, v(e, j), c);
        b.tri(a, c, v(i, j + 1));
        i = e - 1;
        continue;
      }
      const poly: number[] = [];
      if (tl) poly.push(v(i, j));
      if (tl !== tr) poly.push(v(i + 0.5, j));
      if (tr) poly.push(v(i + 1, j));
      if (tr !== br) poly.push(v(i + 1, j + 0.5));
      if (br) poly.push(v(i + 1, j + 1));
      if (br !== bl) poly.push(v(i + 0.5, j + 1));
      if (bl) poly.push(v(i, j + 1));
      if (bl !== tl) poly.push(v(i, j + 0.5));
      for (let k = 1; k + 1 < poly.length; k++) b.tri(poly[0] as number, poly[k] as number, poly[k + 1] as number);
    }
  }
}

/**
 * Voxel prototype: the plateau levels as terraces of terrain columns (4 per
 * tile) inside each level's rounded outline: one voxel step at the rim and
 * two inside (level 1 → 1, 2 steps; level 2 → 3, 4), so every visible step
 * is one voxel; PLATEAU_STEP is the two-step height of a level.
 */
export function plateauField(width: number, height: number, levelLoops: readonly (readonly CoastLoop[])[]): Field {
  const vpt = TERRAIN_VPT;
  const s = 1 / vpt;
  const nx = width * vpt;
  const ny = height * vpt;
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const packed = (c: Color3) => (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
  levelLoops.forEach((loops, k) => {
    const inside = insideGrid(loops, -0.5 + s / 2, -0.5 + s / 2, s, nx, ny);
    const out = new Uint8Array(nx * ny);
    for (let q = 0; q < nx * ny; q++) out[q] = inside[q] ? 0 : 1;
    const d = distanceTo(out, nx, ny, 2);
    const level = k + 1;
    for (let q = 0; q < nx * ny; q++) {
      if (!inside[q]) continue;
      const rim = d[q] === 1;
      h[q] = 2 * level - (rim ? 1 : 0);
      top[q] = packed(rim ? ROCK_LIGHT : topColor(level));
    }
  });
  const bands = [ROCK_LIGHT, ROCK, ROCK_DEEP, ROCK.scale(1.06)];
  return { nx, ny, x0: -0.5, y0: -0.5, s, h, top, bottom: 0, side: (z) => bands[((z % 4) + 4) % 4] as Color3 };
}

export class PlateauLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private crags: Mesh | null = null;
  private key = "";
  private levelsData: Uint8Array = new Uint8Array(0);
  private width = 0;
  /** Far LOD: the crags are left out (a few pixels each there; the far triangle budget, ART_DIRECTION §2). */
  private far = false;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.material = skyFill(new StandardMaterial("plateaus", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /** Rebuilds the plateaus of an island with the tiles kept at ground level (building footprints) and without crags on deposit tiles. */
  update(island: Island, seed: number, blocked: ReadonlySet<string>): void {
    const steps = this.steps(island, seed, blocked);
    while (!steps.next().done);
  }

  /**
   * update() in steps (the incremental island build): yields after each
   * level's outline, top and step, its rim crags and every band of
   * top crags. Nothing is drawn differently
   * until the generator is done.
   */
  *steps(island: Island, seed: number, blocked: ReadonlySet<string>): Generator<void, void, void> {
    const levels = plateauLevels(island, blocked);
    const models = CRAGS.every((id) => decorModel(this.registry, id) !== null);
    const key = `${island.id}|${island.revision}|${models}|${Array.from(levels).join("")}`;
    this.levelsData = levels;
    this.width = island.width;
    if (key === this.key) return;
    const { width, height } = island;
    const deposits = new Set(island.deposits.map((d) => `${d.x},${d.y}`));
    const b = new Builder();
    const rocks = new ModelMerger();
    const allLoops: CoastLoop[][] = [];
    for (const level of [1, 2]) {
      const mask = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && levels[y * width + x]! >= level;
      const loops = traceLoops(marchingSquares(width, height, mask)).map((l) => roundLoop(l));
      if (loops.length === 0) continue;
      const h1 = level * PLATEAU_STEP;
      const h0 = (level - 1) * PLATEAU_STEP;
      const top = topColor(level);
      yield;
      if (VOXEL) {
        allLoops.push(loops);
      } else {
        fillTop(b, loops, h1, top);
        yield;
        const profile = stepProfile(h0, h1, top);
        for (const loop of loops) slabStrip(b, loop, seed + 31 * level, (c) => c, profile, 2);
      }
      yield;
      if (models) yield* this.placeCrags(rocks, loops, level, h1, seed, (x, y) => mask(x, y) && !deposits.has(`${x},${y}`) && levels[y * width + x] === level);
    }
    if (VOXEL && allLoops.length > 0) {
      const f = plateauField(width, height, allLoops);
      meshField(b, f, 0, 0, f.nx, f.ny);
    }
    this.key = key;
    this.mesh?.dispose();
    this.crags?.dispose();
    this.mesh = b.mesh(`plateaus_${island.id}`, this.scene, this.material, this.parent);
    this.crags = rocks.build(`crags_${island.id}`, this.scene, this.material, this.parent);
    this.crags?.setEnabled(!this.far);
  }

  /** Far LOD: hides the crags. */
  setFar(far: boolean): void {
    this.far = far;
    this.crags?.setEnabled(!far);
  }

  /**
   * Crags and boulders of one level: along the step edge (every ~0.9 tile
   * of the rounded outline, just inside it, sizes and kinds jittered from
   * the seed) and a few on the top, on tiles of this level that are not
   * deposits. They stand on the step's top.
   */
  private *placeCrags(m: ModelMerger, loops: readonly CoastLoop[], level: number, h: number, seed: number, free: (x: number, y: number) => boolean): Generator<void, void, void> {
    const crag = (k: number) => decorModel(this.registry, CRAGS[k % CRAGS.length] as string);
    const boulder = decorModel(this.registry, BOULDER);
    const s = seed + level * 977;
    for (const loop of loops) {
      let acc = 0;
      for (let k = 1; k < loop.length; k++) {
        const p = loop[k] as CoastLoop[number];
        const q = loop[k - 1] as CoastLoop[number];
        acc += Math.hypot(p.x - q.x, p.y - q.y);
        if (acc < 1.1) continue;
        acc = 0;
        // Inward of the rim by a quarter tile (the land is on the right of the walking direction).
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const l = Math.hypot(dx, dy) || 1;
        const x = p.x - (dy / l) * 0.25;
        const y = p.y + (dx / l) * 0.25;
        if (!free(Math.floor(x), Math.floor(y))) continue;
        const r = hash2(Math.floor(x * 7), Math.floor(y * 7), s);
        if (hash2(Math.floor(y * 11), Math.floor(x * 11), s + 9) > 0.55) continue;
        const model = r < 0.7 ? crag(Math.floor(r * 30)) : boulder;
        if (!model) continue;
        const scale = r < 0.7 ? 0.6 + 0.6 * hash2(Math.floor(y * 5), Math.floor(x * 5), s + 1) : 0.8 + 0.4 * r;
        m.add(model, x, h - 0.03, -y, scale, hash2(Math.floor(x * 3), Math.floor(y * 3), s + 2) * Math.PI * 2, 0.92 + 0.12 * r);
      }
    }
    yield;
    // A few on the tops: one candidate per tile.
    const xs = loops.flatMap((l) => l.map((p) => p.x));
    const ys = loops.flatMap((l) => l.map((p) => p.y));
    const inside = loopIndex(loops);
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    const x0 = Math.floor(Math.min(...xs));
    const x1 = Math.ceil(Math.max(...xs));
    for (let ty = y0; ty <= y1; ty++) {
      // A step per band of rows (the incremental build).
      if (ty > y0 && (ty - y0) % CRAG_ROWS_PER_STEP === 0) yield;
      for (let tx = x0; tx <= x1; tx++) {
        if (!free(tx, ty) || hash2(tx, ty, s + 3) > 0.14) continue;
        const x = tx + 0.25 + 0.5 * hash2(tx, ty, s + 4);
        const y = ty + 0.25 + 0.5 * hash2(tx, ty, s + 5);
        if (!inside(x, y)) continue;
        const model = crag(Math.floor(hash2(tx, ty, s + 6) * 30));
        if (!model) continue;
        m.add(model, x, h - 0.03, -y, 0.45 + 0.35 * hash2(tx, ty, s + 7), hash2(tx, ty, s + 8) * Math.PI * 2);
      }
    }
  }

  /** Ground height (tiles) at a tile (0 off the plateaus). */
  heightAt(x: number, y: number): number {
    if (this.width === 0) return 0;
    return plateauHeight(this.levelsData, this.width, x, y);
  }

  /** The plateau meshes (sun shadow casters), if any. */
  meshes(): Mesh[] {
    return [this.mesh, this.crags].filter((m): m is Mesh => m !== null);
  }
}
