// Mountains as rocky plateaus (D-057 voxel style), visual only: the
// island's mountain tiles rise in one level (and the tiles deep inside a
// mountain range in a second one). Each level's outline is the tile
// contour rounded by Gaussian-like smoothing (corner radius ≥ 0.5 tile);
// inside it the terrain columns (render/voxelterrain.ts, 4 per tile) step
// up as terraces — two voxels at the rim, three, then four inside — warm
// rock on the first level, a moss cap on the second, rock sides in bands
// darkest at the foot. Voxel crags
// and boulders (decor_crag_*, decor_rock_c) cluster along the level
// edges and on the tops, so the silhouette is jagged. The rules do not
// change (D-036): roads never go on mountains, and a building that covers
// mountain tiles (a mine or quarry on its deposit) keeps them at ground
// level — they are cut out of the plateau, so the building stands in a
// notch; deposit tiles get their outcrop instead of crags. Rebuilt with
// the layout (building footprints) and once the decor models have
// loaded; shown at near and mid LOD under the island root.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding, Island } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { type CoastLoop, marchingSquares, traceLoops } from "../display/coastline";
import { fbm, hash2 } from "../display/noise";
import { ISLAND } from "../theme/palette";
import { addGround } from "./groundshader";
import { skyFill } from "./lighting";
import { decorModel, type ModelRegistry } from "./models";
import { c3 } from "./palette";
import { Builder } from "./terrain";
import { ModelMerger } from "./trees";
import { distanceTo, EMPTY, type Field, meshField, TERRAIN_VPT } from "./voxelterrain";

/**
 * Height (tiles) of one plateau level: four voxel steps of 1/8 (see
 * plateauField; literals, as voxelterrain.ts imports this module and its
 * constants are not initialised yet here).
 */
export const PLATEAU_STEP = 0.5;
/** Voxel steps of one plateau level. */
const PLATEAU_STEPS = 4;
/** Sample spacing (tiles) of the rounded outline. */
const OUTLINE_STEP = 0.2;
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
 * The plateau levels as terraces of terrain columns (4 per tile, steps of
 * one voxel, 1/8 tile) inside each level's rounded outline: the rim column
 * two steps up, the next one three, the inside four (level 1 → 2, 3, 4;
 * level 2 → 6, 7, 8), so the edge steps up like stacked rock; the sides
 * in rock bands, darkest at each level's foot. PLATEAU_STEP is the
 * four-step height of a level.
 */
export function plateauField(width: number, height: number, levelLoops: readonly (readonly CoastLoop[])[]): Field {
  const vpt = TERRAIN_VPT;
  const s = 1 / vpt;
  const nx = width * vpt;
  const ny = height * vpt;
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const packed = (c: Color3) => (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
  const steps = PLATEAU_STEPS;
  levelLoops.forEach((loops, k) => {
    const inside = insideGrid(loops, s / 2, s / 2, s, nx, ny);
    const out = new Uint8Array(nx * ny);
    for (let q = 0; q < nx * ny; q++) out[q] = inside[q] ? 0 : 1;
    const d = distanceTo(out, nx, ny, 3);
    const level = k + 1;
    for (let q = 0; q < nx * ny; q++) {
      if (!inside[q]) continue;
      const dq = d[q] as number;
      h[q] = steps * level - (dq === 1 ? 2 : dq === 2 ? 1 : 0);
      // Patches of lighter and darker rock or moss on the tops (three levels: neighbours still merge).
      const n = fbm((q % nx) / 7, Math.floor(q / nx) / 7, 31 + level);
      const patch = n < 0.36 ? 0.93 : n > 0.62 ? 1.06 : 1;
      top[q] = packed((dq === 1 ? ROCK_LIGHT : dq === 2 ? Color3.Lerp(ROCK_LIGHT, topColor(level), 0.5) : topColor(level)).scale(patch));
    }
  });
  // Bands per level, foot to top: deep rock, rock, rock, light rock (the moss cap's lip on the top level).
  const bands = [ROCK_DEEP, ROCK, ROCK, ROCK_LIGHT];
  const lip = Color3.Lerp(ROCK_LIGHT, MOSS, 0.55);
  return {
    nx,
    ny,
    x0: 0,
    y0: 0,
    s,
    h,
    top,
    bottom: 0,
    side: (z) => (z === 2 * steps - 1 ? lip : (bands[((z % steps) + steps) % steps] as Color3)),
  };
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
    // The per-voxel jitter of the terrain (no ground texture: the tops keep their vertex colours).
    this.material = addGround(skyFill(new StandardMaterial("plateaus", scene)), { texture: null, width: 1, height: 1, vpt: TERRAIN_VPT });
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
   * level's outline, its rim crags and every band of top crags; the
   * terraces are meshed at the end. Nothing is drawn differently
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
      yield;
      allLoops.push(loops);
      yield;
      if (models) yield* this.placeCrags(rocks, loops, level, h1, seed, (x, y) => mask(x, y) && !deposits.has(`${x},${y}`) && levels[y * width + x] === level);
    }
    if (allLoops.length > 0) {
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
