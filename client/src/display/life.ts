// Life layer (docs/LIFE_LAYER.md, ART_DIRECTION §5): pure helpers. Every
// element of the life layer — carts, walkers, smoke, boats, gulls,
// strollers, animals, berth crates — is derived from the display payload
// and extrapolated with the renderer's (server) clock: positions and
// phases come from timers and seeded hashes of IDs, never from
// Math.random(), so two clients show the same scene and screenshots are
// reproducible (the e2e hook freezes the clock). Nothing here is a game
// rule (D-027): the layer only draws what the payload already says.
import type { Quality } from "./quality";
import type { Lod } from "./lod";

/** Per-island budgets of one device class (LIFE_LAYER §1). */
export interface LifeBudget {
  /** Animated instances (carts, walkers, strollers, animals, boats, gulls, crates) per visible island. */
  instances: number;
  /** Live smoke particles per visible island. */
  particles: number;
}

/**
 * Budgets per device class: the render quality is the device class
 * (display/quality.ts: "high" = the desktop layout, "low" = touch layouts,
 * phones and tablets of unknown GPU class). Phones: ≤ 150 animated
 * instances and ≤ 64 live particles per visible island; desktop ≤ 400
 * instances (LIFE_LAYER §1) and 160 particles.
 */
export const LIFE_BUDGETS: Readonly<Record<Quality, LifeBudget>> = {
  low: { instances: 150, particles: 64 },
  high: { instances: 400, particles: 160 },
};

export function lifeBudget(quality: Quality): LifeBudget {
  return LIFE_BUDGETS[quality];
}

/** Whether the life layer is on: off with ?life=0 (A/B comparisons), on otherwise. */
export function lifeEnabled(search: string): boolean {
  return new URLSearchParams(search).get("life") !== "0";
}

/** What the life layer draws at a level of detail (LIFE_LAYER §1). */
export interface LifeAtLod {
  /** Everything that moves per frame: carts, walkers, strollers, animals, boats, gulls. */
  moving: boolean;
  /** Chimney smoke. */
  smoke: boolean;
  /** Static props (crates on the quay of a handling berth). */
  props: boolean;
}

/** near: everything; mid: smoke and static props; far: nothing (ships move at every LOD in their own layer). */
export function lifeAtLod(lod: Lod): LifeAtLod {
  switch (lod) {
    case "near":
      return { moving: true, smoke: true, props: true };
    case "mid":
      return { moving: false, smoke: true, props: true };
    case "far":
      return { moving: false, smoke: false, props: false };
  }
}

/**
 * Grants a budget to demands in priority order (the first demands are
 * served first; a demand may be granted partly). Returns the granted
 * count per demand, in the demands' order.
 */
export function allocate(demands: readonly number[], budget: number): number[] {
  let left = Math.max(0, Math.floor(budget));
  return demands.map((d) => {
    const g = Math.min(left, Math.max(0, Math.floor(d)));
    left -= g;
    return g;
  });
}

/**
 * Grants a budget by shares, then by priority: first every demand gets up
 * to floor(share × budget), then what is left goes to the demands still
 * short in priority order. A dense town keeps a mix of elements instead
 * of spending everything on the first class.
 */
export function allocateShares(demands: readonly number[], shares: readonly number[], budget: number): number[] {
  const total = Math.max(0, Math.floor(budget));
  const first = demands.map((d, i) => Math.min(Math.max(0, Math.floor(d)), Math.floor((shares[i] ?? 0) * total)));
  const used = first.reduce((a, b) => a + b, 0);
  const more = allocate(
    demands.map((d, i) => Math.max(0, Math.floor(d)) - (first[i] as number)),
    total - used,
  );
  return first.map((g, i) => g + (more[i] as number));
}

/** x mod m in [0, m) (also for negative x). */
export function mod(x: number, m: number): number {
  const r = x % m;
  return r < 0 ? r + m : r;
}

/**
 * Phase (0..1) of a loop of periodMs at time nowMs: ((now − start) /
 * period) mod 1 (LIFE_LAYER §3); 0 for a period ≤ 0.
 */
export function loopPhase(nowMs: number, startMs: number, periodMs: number): number {
  if (!(periodMs > 0)) return 0;
  return mod((nowMs - startMs) / periodMs, 1);
}

/** Phase offset of the i-th of n elements spread evenly over a loop. */
export function spreadPhase(i: number, n: number): number {
  return n > 0 ? mod(i / n, 1) : 0;
}

/** A round trip: 0..1..0 over a phase of 0..1 (out on the first half, back on the second). */
export function pingPong(phase: number): number {
  const t = mod(phase, 1);
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/**
 * 32-bit FNV-1a hash of the parts (IDs, indices, salts) with a final
 * avalanche: stable across sessions and clients, never Math.random().
 */
export function lifeHash(...parts: readonly (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** lifeHash mapped to [0, 1). */
export function hash01(...parts: readonly (number | string)[]): number {
  return lifeHash(...parts) / 0x1_0000_0000;
}

/** Instance and particle counts drawn in the last frame (the ?stats=1 badge, tests). */
export interface LifeStats {
  instances: number;
  particles: number;
}

/** Writes the instances of a frame (render/life.ts). */
export interface LifeSink {
  /**
   * An instance of a class at island-local tile coordinates (x, height h,
   * y), turned by yaw (radians: the class's local +x axis points along the
   * tile direction (cos yaw, sin yaw)), uniformly scaled and first rolled
   * about its local x axis (radians; wheels); the colour multiplies the
   * vertex colours (default white).
   */
  add(cls: string, x: number, h: number, y: number, yaw: number, scale?: number, color?: readonly number[], roll?: number): void;
}

/** The life plan of one island: writes its instances for a frame within the budget. */
export interface LifePlan {
  /** `chunks`: the island chunks in view (display/chunks.ts; null: all) — walkers, carts, smoke, strollers, sheep and crates spawn only there. */
  frame(nowMs: number, sink: LifeSink, at: LifeAtLod, budget: LifeBudget, chunks?: ReadonlySet<string> | null): LifeStats;
}
