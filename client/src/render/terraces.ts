// Terraces, rock and rivers (D-058; ART_DIRECTION §4), render data only:
// the generator's terrace level per tile (0 at the coast, up to 2 inland)
// and the rock height of mountain, cliff and islet tiles become heights of
// the voxel terrain columns (render/voxelterrain.ts, 4 per tile, steps of
// 1/8 tile). One terrace level is LEVEL_STEPS steps (half a tile).
//
// - **Terraces**: each level is the tiles at or above it, sampled at the
//   column centres by the bilinear blend of the tile centres (straight
//   edges stay on the tile border, corners round off by a column). A level
//   edge is a cliff of earth and rock bands, or — in low-frequency noise
//   zones away from the sea — a ramp: the edge columns step down one voxel
//   per column over a tile.
// - **Rock** (mountains, cliffs' rock caps, islets) stacks on the ground
//   in the same way, one level per rock step, eroded by a little noise
//   (ragged edges) and with stepped rims (two voxels at the rim, three,
//   then four): its own layer (RockLayer) at near and mid, so building
//   footprints (mines and quarries) are cut out of it and stand in a
//   notch; baked into the lite and far terrain. Crags stand on the rims
//   and the peaks.
// - **Rivers** are water columns RIVER_DROP steps below their level's
//   ground; where the river's level drops, the higher column's wall is a
//   waterfall; at level 0 it runs out into the sand shelf (the estuary).
//
// Nothing here changes a rule (D-058 §4): no tile loses buildability.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding, Island, Terrain } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { fbm, hash2 } from "../display/noise";
import { BUILDINGS, ISLAND } from "../theme/palette";
import { addGround } from "./groundshader";
import { skyFill } from "./lighting";
import { decorModel, type ModelRegistry } from "./models";
import { c3 } from "./palette";
import { Builder } from "./terrain";
import { ModelMerger } from "./trees";
import { distanceTo, EMPTY, type Field, meshField, TERRAIN_VPT } from "./voxelterrain";

/**
 * Voxel steps of one terrace level (literals: voxelterrain.ts imports this
 * module, its constants are not initialised yet here).
 */
export const LEVEL_STEPS = 4;
/** Height (tiles) of one terrace level: LEVEL_STEPS steps of 1/8. */
export const LEVEL_HEIGHT = 0.5;
/** A river's surface below its level's ground (steps). */
export const RIVER_DROP = 2;
/** Share of the level edges away from the sea that are ramps (noise threshold: higher, fewer). */
const RAMP_NOISE = 0.57;
/** Noise erosion of the rock outline (bilinear share). */
const ROCK_EROSION = 0.22;
/** Crag rows placed per step of the incremental build. */
const CRAG_ROWS_PER_STEP = 24;

const ROCK_LIGHT = c3(ISLAND.rock_light);
const ROCK = c3(ISLAND.rock);
const ROCK_DEEP = c3(ISLAND.rock_deep);
const MOSS = c3(ISLAND.moss);
const PLINTH = c3(BUILDINGS.stone);

const CRAGS = ["decor_crag_a", "decor_crag_b", "decor_crag_c"] as const;
const BOULDER = "decor_rock_c";

/** The relief of an island per tile. */
export interface Relief {
  width: number;
  height: number;
  terrain: readonly Terrain[];
  /** Terrace level (0–9) per tile, row-major. */
  level: Uint8Array;
  /** Rock height (terrace levels above the tile's level) per tile, row-major. */
  rock: Uint8Array;
}

/** Whether a terrain carries rock (its height digit). */
const rocky = (t: Terrain | undefined) => t === "mountain" || t === "cliff" || t === "islet";

/** The relief of an island (levels and heights absent: flat). */
export function reliefOf(island: Pick<Island, "width" | "height" | "terrain" | "levels" | "heights">): Relief {
  const n = island.width * island.height;
  const level = new Uint8Array(n);
  const rock = new Uint8Array(n);
  const digit = (s: string | undefined, i: number) => {
    const c = s ? s.charCodeAt(i) - 48 : 0;
    return c >= 0 && c <= 9 ? c : 0;
  };
  for (let i = 0; i < n; i++) {
    const t = island.terrain[i];
    if (t === undefined || t === "water") continue;
    level[i] = digit(island.levels, i);
    if (rocky(t)) rock[i] = digit(island.heights, i);
  }
  return { width: island.width, height: island.height, terrain: island.terrain, level, rock };
}

/** Ground height (tiles) of a tile: its terrace level (0 off the island). */
export function groundY(r: Relief, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return 0;
  return (r.level[y * r.width + x] as number) * LEVEL_HEIGHT;
}

/**
 * The bilinear blend of a tile predicate at a point (tile units; tile x
 * spans x … x + 1): the weights of the four tile centres around it where
 * `on` holds. Outside the grid counts as off.
 */
export function cover(on: (x: number, y: number) => boolean, fx: number, fy: number): number {
  const gx = fx - 0.5;
  const gy = fy - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const wx = gx - x0;
  const wy = gy - y0;
  return (on(x0, y0) ? (1 - wx) * (1 - wy) : 0) + (on(x0 + 1, y0) ? wx * (1 - wy) : 0) + (on(x0, y0 + 1) ? (1 - wx) * wy : 0) + (on(x0 + 1, y0 + 1) ? wx * wy : 0);
}

/** The relief as terrain columns. */
export interface ReliefColumns {
  nx: number;
  ny: number;
  /** Ground height (steps) of every column: the terraces with their ramps (sea columns: 0). */
  ground: Int8Array;
  /** The flat ground height (steps) of each column's tile: its level (roads and fields paint where ground equals it). */
  flat: Int8Array;
  /** Rock height (steps) above the ground (0: none). */
  rock: Int8Array;
  /** River columns (1) and their surface (steps). */
  river: Uint8Array;
  riverH: Int8Array;
  /** Waterfall columns: a river column whose wall drops to a lower river column (1). */
  fall: Uint8Array;
}

/**
 * The relief's columns at `vpt` per tile. `blocked` tiles ("x,y") carry
 * no rock (building footprints: the notch).
 */
export function reliefColumns(r: Relief, vpt: number, seed: number, blocked: ReadonlySet<string> = new Set()): ReliefColumns {
  const { width, height, terrain, level, rock } = r;
  const nx = width * vpt;
  const ny = height * vpt;
  const n = nx * ny;
  const ground = new Int8Array(n);
  const flat = new Int8Array(n);
  const rockH = new Int8Array(n);
  const river = new Uint8Array(n);
  const riverH = new Int8Array(n);
  const fall = new Uint8Array(n);
  const tile = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x);
  const land = (i: number) => i >= 0 && terrain[i] !== undefined && terrain[i] !== "water";
  let maxL = 0;
  let maxR = 0;
  for (let i = 0; i < width * height; i++) {
    maxL = Math.max(maxL, level[i] as number);
    maxR = Math.max(maxR, rock[i] as number);
  }
  // Tiles within one tile of the sea (no ramps there: cliffs drop to the water).
  const nearSea = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sea = false;
      for (let dy = -1; dy <= 1 && !sea; dy++) for (let dx = -1; dx <= 1; dx++) if (!land(tile(x + dx, y + dy))) sea = true;
      nearSea[y * width + x] = sea ? 1 : 0;
    }
  }
  const colTile = (k: number) => tile(Math.floor((k % nx) / vpt), Math.floor(Math.floor(k / nx) / vpt));
  for (let k = 0; k < n; k++) {
    const t = colTile(k);
    flat[k] = land(t) ? (level[t] as number) * LEVEL_STEPS : 0;
  }
  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  // Terraces.
  for (let lv = 1; lv <= maxL; lv++) {
    const on = (x: number, y: number) => {
      const t = tile(x, y);
      return land(t) && (level[t] as number) >= lv;
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const v = cover(on, (i + 0.5) / vpt, (j + 0.5) / vpt);
        inside[k] = v >= 0.5 ? 1 : 0;
        outside[k] = 1 - (inside[k] as number);
      }
    }
    const d = distanceTo(outside, nx, ny, LEVEL_STEPS);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!inside[k]) continue;
        const dk = d[k] as number;
        let add = LEVEL_STEPS;
        if (dk < LEVEL_STEPS) {
          const t = colTile(k);
          const ramp = t >= 0 && !nearSea[t] && fbm((i + 0.5) / vpt / 6, (j + 0.5) / vpt / 6, seed + 31 * lv) > RAMP_NOISE;
          if (ramp) add = dk;
        }
        ground[k] = (ground[k] as number) + add;
      }
    }
  }
  // Rock: stacked levels with stepped rims, eroded by noise.
  for (let q = 1; q <= maxR; q++) {
    const on = (x: number, y: number) => {
      const t = tile(x, y);
      return t >= 0 && (rock[t] as number) >= q && !blocked.has(`${x},${y}`);
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const fx = (i + 0.5) / vpt;
        const fy = (j + 0.5) / vpt;
        // Erosion only lowers the share: the noise is needed only near the outline.
        let v = cover(on, fx, fy);
        if (v >= 0.5 && v < 0.5 + ROCK_EROSION) v -= ROCK_EROSION * fbm(fx * 0.9, fy * 0.9, seed + 53 * q);
        inside[k] = v >= 0.5 ? 1 : 0;
        outside[k] = 1 - (inside[k] as number);
      }
    }
    const d = distanceTo(outside, nx, ny, 3);
    for (let k = 0; k < n; k++) {
      if (!inside[k]) continue;
      const dk = d[k] as number;
      rockH[k] = (rockH[k] as number) + LEVEL_STEPS - (dk === 1 ? 2 : dk === 2 ? 1 : 0);
    }
  }
  // Rivers: tile-exact, below their level's ground.
  for (let k = 0; k < n; k++) {
    const t = colTile(k);
    if (t < 0 || terrain[t] !== "river") continue;
    river[k] = 1;
    riverH[k] = (level[t] as number) * LEVEL_STEPS - RIVER_DROP;
    rockH[k] = 0;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!river[k]) continue;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a;
        if (river[q] && (riverH[q] as number) < (riverH[k] as number)) fall[k] = 1;
      }
    }
  }
  return { nx, ny, ground, flat, rock: rockH, river, riverH, fall };
}

/** A building's rotated footprint (tiles). */
export interface FootprintRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rotated footprints of the buildings (not roads; fields included): the plinths' rectangles. */
export function footprintRects(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): FootprintRect[] {
  const out: FootprintRect[] = [];
  for (const b of buildings) {
    const def = defs.get(b.type);
    if (!def || def.category === "roads") continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    out.push({ x: b.x, y: b.y, w, h });
  }
  return out;
}

/** Tiles ("x,y") covered by building footprints (not roads or fields): kept at their ground, no crags or outcrops. */
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

/** Rock top colour by its height above the ground (steps): light rock low down, warmer rock higher, moss patches on the high tops. */
export function rockTop(steps: number, i: number, j: number, seed: number): Color3 {
  const n = fbm(i / 7, j / 7, seed + 31);
  const patch = n < 0.36 ? 0.93 : n > 0.62 ? 1.06 : 1;
  const c = steps < 2 * LEVEL_STEPS ? ROCK_LIGHT : steps < 3 * LEVEL_STEPS ? Color3.Lerp(ROCK_LIGHT, ROCK, 0.35) : Color3.Lerp(ROCK_LIGHT, MOSS, n > 0.5 ? 0.45 : 0.15);
  return c.scale(patch);
}

/** Side band of a rock wall layer z (steps above the ground's base): deep rock at each level's foot, rock, light rock at the lip. */
function rockSide(z: number): Color3 {
  const p = ((z % LEVEL_STEPS) + LEVEL_STEPS) % LEVEL_STEPS;
  return p === 0 ? ROCK_DEEP : p === LEVEL_STEPS - 1 ? ROCK_LIGHT : ROCK;
}

/** Plinth walls: dressed stone, a darker course every other step. */
function plinthSide(z: number): Color3 {
  return z % 2 === 0 ? PLINTH.scale(0.86) : PLINTH;
}

/**
 * The plinths of building footprints (D-058): every column of a footprint
 * below its base (the highest level under it; ramps and rims included)
 * rises to it, as dressed stone. Returns the target height per column
 * (steps; 0: none).
 */
export function plinthColumns(cols: ReliefColumns, r: Relief, rects: readonly { x: number; y: number; w: number; h: number }[]): Int8Array {
  const out = new Int8Array(cols.nx * cols.ny);
  const vpt = cols.nx / r.width;
  for (const f of rects) {
    let base = 0;
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) if (x >= 0 && y >= 0 && x < r.width && y < r.height) base = Math.max(base, (r.level[y * r.width + x] as number) * LEVEL_STEPS);
    if (base === 0) continue;
    for (let j = Math.max(0, f.y * vpt); j < Math.min(cols.ny, (f.y + f.h) * vpt); j++) {
      for (let i = Math.max(0, f.x * vpt); i < Math.min(cols.nx, (f.x + f.w) * vpt); i++) {
        const k = j * cols.nx + i;
        if ((cols.ground[k] as number) < base && !cols.river[k]) out[k] = base;
      }
    }
  }
  return out;
}

/**
 * The rock of the relief as a field (near and mid): columns with rock
 * stand at ground + rock (EMPTY elsewhere; their walls go down to the
 * column's own ground, `floor`).
 */
export function rockField(cols: ReliefColumns, seed: number, plinth?: Int8Array): Field {
  const { nx, ny, ground, rock } = cols;
  const kind = new Uint8Array(nx * ny);
  const h = new Int8Array(nx * ny).fill(EMPTY);
  const top = new Uint32Array(nx * ny);
  const floor = new Int8Array(nx * ny);
  const packed = (c: Color3) => (Math.round(Math.min(1, c.r) * 255) << 16) | (Math.round(Math.min(1, c.g) * 255) << 8) | Math.round(Math.min(1, c.b) * 255);
  for (let k = 0; k < nx * ny; k++) {
    const r = rock[k] as number;
    floor[k] = ground[k] as number;
    const p = plinth ? (plinth[k] as number) : 0;
    if (p > 0) {
      h[k] = p;
      top[k] = packed(PLINTH.scale(0.95 + 0.08 * hash2(k % nx, Math.floor(k / nx), seed + 41)));
      kind[k] = 1;
      continue;
    }
    if (r <= 0) continue;
    h[k] = (ground[k] as number) + r;
    top[k] = packed(rockTop(r, k % nx, Math.floor(k / nx), seed));
  }
  return { nx, ny, x0: 0, y0: 0, s: 1 / TERRAIN_VPT, h, top, kind, floor, bottom: 0, side: (z, kd) => (kd === 1 ? plinthSide(z) : rockSide(z)) };
}

/**
 * Rock of an island (near and mid LOD): the rock field meshed, with crags
 * and boulders on its rims and peaks. Rebuilt with the layout (building
 * footprints cut notches) and once the decor models have loaded; the
 * crags are hidden at far LOD (the far triangle budget, ART_DIRECTION §2).
 */
export class RockLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private crags: Mesh | null = null;
  private bridgeMesh: Mesh | null = null;
  private bridgeKey = "";
  private key = "";
  private relief: Relief | null = null;
  private blocked: ReadonlySet<string> = new Set();
  private far = false;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    // The per-voxel jitter of the terrain (no ground texture: the tops keep their vertex colours).
    this.material = addGround(skyFill(new StandardMaterial("rock", scene)), { texture: null, width: 1, height: 1, vpt: TERRAIN_VPT });
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /** Rebuilds the rock of an island with the building footprints cut out and no crags on deposit tiles. */
  update(island: Island, seed: number, blocked: ReadonlySet<string>, plinths: readonly FootprintRect[] = []): void {
    const steps = this.steps(island, seed, blocked, plinths);
    while (!steps.next().done);
  }

  /** update() in steps (the incremental island build): the columns, then the crags in bands of rows; meshed at the end. */
  *steps(island: Island, seed: number, blocked: ReadonlySet<string>, plinths: readonly FootprintRect[] = []): Generator<void, void, void> {
    const relief = reliefOf(island);
    this.relief = relief;
    this.blocked = blocked;
    const models = CRAGS.every((id) => decorModel(this.registry, id) !== null);
    const key = `${island.id}|${island.revision}|${models}|${[...blocked].sort().join(";")}|${plinths.map((p) => `${p.x},${p.y},${p.w},${p.h}`).join(";")}`;
    if (key === this.key) return;
    const cols = reliefColumns(relief, TERRAIN_VPT, seed, blocked);
    yield;
    const b = new Builder();
    const f = rockField(cols, seed, plinthColumns(cols, relief, plinths));
    meshField(b, f, 0, 0, f.nx, f.ny);
    const rocks = new ModelMerger();
    if (models) {
      const deposits = new Set(island.deposits.map((d) => `${d.x},${d.y}`));
      yield* this.placeCrags(rocks, cols, relief, seed, (x, y) => !deposits.has(`${x},${y}`) && !blocked.has(`${x},${y}`));
    }
    this.key = key;
    this.mesh?.dispose();
    this.crags?.dispose();
    this.mesh = b.mesh(`rock_${island.id}`, this.scene, this.material, this.parent);
    this.crags = rocks.build(`crags_${island.id}`, this.scene, this.material, this.parent);
    this.mesh?.setEnabled(!this.far);
    this.crags?.setEnabled(!this.far);
  }

  /** Far LOD: hides the rock (the lite terrain carries it), the crags and the bridges. */
  setFar(far: boolean): void {
    this.far = far;
    this.mesh?.setEnabled(!far);
    this.crags?.setEnabled(!far);
    this.bridgeMesh?.setEnabled(!far);
  }

  /**
   * The bridges of the roads over the rivers (decor_bridge_1/2, a run of
   * three or more tiles as pieces of two and one): centred on their run,
   * along its axis, standing on the river's surface.
   */
  setBridges(runs: readonly BridgeRun[], name: string): void {
    const one = decorModel(this.registry, "decor_bridge_1");
    const two = decorModel(this.registry, "decor_bridge_2");
    const key = `${one !== null}${two !== null}|${runs.map((b) => `${b.x},${b.y},${b.len}${b.axis}${b.level}`).join(";")}`;
    if (key === this.bridgeKey) return;
    this.bridgeKey = key;
    this.bridgeMesh?.dispose();
    this.bridgeMesh = null;
    if (!one || !two || runs.length === 0) return;
    const m = new ModelMerger();
    for (const b of runs) {
      const y = b.level - RIVER_DROP / 8;
      for (let o = 0; o < b.len; ) {
        const len = b.len - o >= 2 ? 2 : 1;
        const along = o + len / 2;
        if (b.axis === "x") m.add(len === 2 ? two : one, b.x + along, y, -(b.y + 0.5), 1, 0);
        else m.add(len === 2 ? two : one, b.x + 0.5, y, -(b.y + along), 1, Math.PI / 2);
        o += len;
      }
    }
    this.bridgeMesh = m.build(`bridges_${name}`, this.scene, this.material, this.parent);
    this.bridgeMesh?.setEnabled(!this.far);
  }

  /**
   * Crags and boulders: on the rim columns of every rock level (one
   * candidate per ~1.2 tiles, seeded), larger ones on the peaks (tiles
   * whose rock is the highest of their 5 × 5 neighbourhood).
   */
  private *placeCrags(m: ModelMerger, cols: ReliefColumns, r: Relief, seed: number, free: (x: number, y: number) => boolean): Generator<void, void, void> {
    const crag = (k: number) => decorModel(this.registry, CRAGS[k % CRAGS.length] as string);
    const boulder = decorModel(this.registry, BOULDER);
    const vpt = TERRAIN_VPT;
    const { nx, ny, ground, rock } = cols;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : (rock[j * nx + i] as number));
    for (let ty = 0; ty < r.height; ty++) {
      if (ty > 0 && ty % CRAG_ROWS_PER_STEP === 0) yield;
      for (let tx = 0; tx < r.width; tx++) {
        const t = ty * r.width + tx;
        const rk = r.rock[t] as number;
        if (rk === 0 || !free(tx, ty)) continue;
        // Peaks: the tile's rock is the highest around (≥ 2 levels).
        let peak = rk >= 2;
        for (let dy = -2; dy <= 2 && peak; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = tx + dx;
            const y = ty + dy;
            if (x < 0 || y < 0 || x >= r.width || y >= r.height || (dx === 0 && dy === 0)) continue;
            const o = r.rock[y * r.width + x] as number;
            if (o > rk || (o === rk && (dy < 0 || (dy === 0 && dx < 0)))) peak = false;
          }
        }
        const s = seed + 977;
        if (peak) {
          const i = tx * vpt + 2;
          const j = ty * vpt + 2;
          const model = crag(Math.floor(hash2(tx, ty, s + 6) * 30));
          if (model) m.add(model, tx + 0.5, ((ground[j * nx + i] as number) + at(i, j)) / 8 - 0.03, -(ty + 0.5), 1.1 + 0.5 * hash2(tx, ty, s + 7), hash2(tx, ty, s + 8) * Math.PI * 2);
          continue;
        }
        if (hash2(tx, ty, s + 3) > 0.16) continue;
        // A rim column of the tile: rock lower than a neighbour's by the rim step.
        const i = tx * vpt + Math.floor(hash2(tx, ty, s + 4) * vpt);
        const j = ty * vpt + Math.floor(hash2(tx, ty, s + 5) * vpt);
        const h = at(i, j);
        if (h === 0) continue;
        const rim = at(i + 1, j) < h || at(i - 1, j) < h || at(i, j + 1) < h || at(i, j - 1) < h;
        const roll = hash2(tx, ty, s + 9);
        if (!rim && roll > 0.35) continue;
        const model = roll < 0.7 ? crag(Math.floor(roll * 30)) : boulder;
        if (!model) continue;
        const scale = roll < 0.7 ? 0.55 + 0.55 * hash2(ty, tx, s + 1) : 0.8 + 0.4 * roll;
        m.add(model, (i + 0.5) / vpt, ((ground[j * nx + i] as number) + h) / 8 - 0.03, -(j + 0.5) / vpt, scale, hash2(tx, ty, s + 2) * Math.PI * 2, 0.92 + 0.12 * roll);
      }
    }
  }

  /** Height (tiles) at a tile where decoration and outcrops stand: its level plus its rock, the level alone where a footprint cut the rock out. */
  heightAt(x: number, y: number): number {
    const r = this.relief;
    if (!r || x < 0 || y < 0 || x >= r.width || y >= r.height) return 0;
    const t = y * r.width + x;
    const rk = this.blocked.has(`${x},${y}`) ? 0 : (r.rock[t] as number);
    return ((r.level[t] as number) + rk) * LEVEL_HEIGHT;
  }

  /** The rock meshes (sun shadow casters), if any. */
  meshes(): Mesh[] {
    return [this.mesh, this.crags, this.bridgeMesh].filter((m): m is Mesh => m !== null);
  }
}

/** The deck of a bridge above its river's banks (tiles): one voxel (render/models: decor_bridge_<n>, nsvoxel/terrain.py DECK_TOP). */
export const BRIDGE_DECK = 0.125;

/** Directions of a road ramp: toward the lower road neighbour. */
const RAMP_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** A straight bridge over a run of river road tiles: its first tile, length and axis. */
export interface BridgeRun {
  x: number;
  y: number;
  len: number;
  axis: "x" | "y";
  /** The deck's ground (tiles): the river's level. */
  level: number;
}

/**
 * Heights of an island's ground for what stands and moves on it (D-058):
 * buildings on the highest level under their footprint (plinths fill the
 * lower tiles), carts and walkers on the road surface — up the road ramps
 * where a road climbs a level, over the bridges on river tiles.
 */
export class IslandGround {
  private relief: Relief | null = null;
  private roads = new Set<number>();
  /** Per tile: the ramp direction (index into RAMP_DIRS), -1 none. */
  private ramp: Int8Array = new Int8Array(0);
  private bridgeTiles = new Set<number>();
  private runs: BridgeRun[] = [];

  /** Sets the relief (an island's statics). */
  setRelief(r: Relief): void {
    this.relief = r;
    this.setRoads([...this.roads].map((t) => ({ x: t % r.width, y: Math.floor(t / r.width) })));
  }

  /** Sets the road tiles: ramps and bridges follow. */
  setRoads(tiles: readonly { x: number; y: number }[]): void {
    const r = this.relief;
    if (!r) {
      this.roads = new Set();
      return;
    }
    const { width, height } = r;
    this.roads = new Set(tiles.filter((t) => t.x >= 0 && t.y >= 0 && t.x < width && t.y < height).map((t) => t.y * width + t.x));
    this.ramp = roadRamps(r, this.roads);
    this.runs = bridgeRuns(r, this.roads);
    this.bridgeTiles = new Set();
    for (const b of this.runs) for (let i = 0; i < b.len; i++) this.bridgeTiles.add(b.axis === "x" ? b.y * width + b.x + i : (b.y + i) * width + b.x);
  }

  /** The bridges over the rivers. */
  bridges(): readonly BridgeRun[] {
    return this.runs;
  }

  /** The ramp direction of a road tile (RAMP_DIRS index, -1 none; tests and the road painter). */
  rampAt(x: number, y: number): number {
    const r = this.relief;
    if (!r || x < 0 || y < 0 || x >= r.width || y >= r.height) return -1;
    return this.ramp[y * r.width + x] ?? -1;
  }

  /** Ground of a tile (tiles): its terrace level. */
  tile(x: number, y: number): number {
    return this.relief ? groundY(this.relief, x, y) : 0;
  }

  /** The base of a footprint (tiles): the highest level under it. */
  base(x: number, y: number, w: number, h: number): number {
    let m = 0;
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) m = Math.max(m, this.tile(tx, ty));
    return m;
  }

  /** The walking surface at an island-local point (tiles, y down): road ramps and bridge decks included. */
  surface(fx: number, fy: number): number {
    const r = this.relief;
    if (!r) return 0;
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    if (tx < 0 || ty < 0 || tx >= r.width || ty >= r.height) return 0;
    const t = ty * r.width + tx;
    const lv = r.level[t] as number;
    if (this.bridgeTiles.has(t)) return lv * LEVEL_HEIGHT + BRIDGE_DECK;
    const d = this.ramp[t] ?? -1;
    if (d >= 0) {
      const [dx, dy] = RAMP_DIRS[d] as readonly [number, number];
      // Distance (0..1) from the edge toward the lower neighbour.
      const u = dx > 0 ? tx + 1 - fx : dx < 0 ? fx - tx : dy > 0 ? ty + 1 - fy : fy - ty;
      return (lv - 1 + Math.min(1, Math.max(0, u))) * LEVEL_HEIGHT;
    }
    return lv * LEVEL_HEIGHT;
  }
}

/** Per tile: the direction (RAMP_DIRS index) of a road tile toward a road neighbour one level lower (-1: none). */
export function roadRamps(r: Relief, roads: ReadonlySet<number>): Int8Array {
  const out = new Int8Array(r.width * r.height).fill(-1);
  for (const t of roads) {
    const x = t % r.width;
    const y = Math.floor(t / r.width);
    const lv = r.level[t] as number;
    if (lv === 0 || r.terrain[t] === "river") continue;
    for (let d = 0; d < RAMP_DIRS.length; d++) {
      const [dx, dy] = RAMP_DIRS[d] as readonly [number, number];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height) continue;
      const n = ny * r.width + nx;
      if (roads.has(n) && (r.level[n] as number) === lv - 1 && r.terrain[n] !== "river") {
        out[t] = d;
        break;
      }
    }
  }
  return out;
}

/**
 * The bridges: maximal straight runs of road tiles on river tiles, along
 * the axis their road neighbours lie on (x when a road continues east or
 * west of the run, else y).
 */
export function bridgeRuns(r: Relief, roads: ReadonlySet<number>): BridgeRun[] {
  const { width, height, terrain } = r;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && roads.has(y * width + x) && terrain[y * width + x] === "river";
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && roads.has(y * width + x);
  const seen = new Set<number>();
  const out: BridgeRun[] = [];
  for (const t of [...roads].sort((a, b) => a - b)) {
    if (seen.has(t) || terrain[t] !== "river") continue;
    const x = t % width;
    const y = Math.floor(t / width);
    // The axis: the road continues across the river along it.
    let ex = x;
    while (on(ex + 1, y)) ex++;
    let ey = y;
    while (on(x, ey + 1)) ey++;
    const alongX = road(x - 1, y) || road(ex + 1, y) || (ex > x && !(road(x, y - 1) || road(x, ey + 1)));
    const len = alongX ? ex - x + 1 : ey - y + 1;
    for (let i = 0; i < len; i++) seen.add(alongX ? t + i : t + i * width);
    out.push({ x, y, len, axis: alongX ? "x" : "y", level: (r.level[t] as number) * LEVEL_HEIGHT });
  }
  return out;
}
