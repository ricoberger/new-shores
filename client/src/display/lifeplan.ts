// Life plan of one island (docs/LIFE_LAYER.md §2–3): derived from the
// island's display payload whenever it changes, extrapolated every frame
// from the renderer's (server) clock. Pure (no Babylon): the render layer
// (render/life.ts) passes a sink that turns the instances into thin
// instances. Budgets are applied in the priority order of ART_DIRECTION §5
// (carts, walkers, then the rest) so a dense island on a phone keeps its
// most telling motion; within a class every producer gets its first
// element before any gets a second.
import type { BuildingDisplay, ContentBuilding, Island, IslandDisplay } from "../api/client";
import type { TilePos } from "./geometry";
import { allocate, hash01, lifeHash, type LifeAtLod, type LifeBudget, type LifePlan, type LifeSink, type LifeStats, loopPhase, spreadPhase } from "./life";
import { alongPath, footprintRoads, roadPath } from "./roadpath";
import { tileKey } from "./geometry";

/**
 * Visual cart capacity (output milli-units per minute one cart carries):
 * a producer with output rate r runs ceil(r / CART_CAPACITY) carts, at most
 * MAX_CARTS (LIFE_LAYER §3). No server field: the payload has no cart
 * capacity, so this is a display constant (logged as an open question).
 */
export const CART_CAPACITY = 1000;
export const MAX_CARTS = 3;

/** Road surface height (render/roads.ts ROAD_Y). */
const ROAD_H = 0.02;
/** Wheel pivots of the cart models (assets/recipes/life_cart*.json anchors, tiles: ahead of the centre, height). */
export const WHEEL_AHEAD = 0.1474;
export const WHEEL_HEIGHT = 0.0969;
/** Wheel radius (tiles): the spin per tile travelled. */
const WHEEL_RADIUS = 0.09;
/** Walkers keep to the right of the road centre (tiles), carts drive in the middle. */
const WALKER_SIDE = 0.24;
/** Stride (tiles per step) and bob height (tiles) of a walker. */
const STRIDE = 0.22;
const BOB = 0.018;
/**
 * Villager scale: the recipe's 0.47-tile figure drawn at about 0.8 tiles
 * (ART_DIRECTION §5: carts and people ≈ 1 tile, readable at default zoom).
 */
export const VILLAGER_SCALE = 1.7;
/** Villager variants per tier (assets/recipes/life_villager_*.json). */
export const VILLAGER_VARIANTS = 3;

/** Statuses with no deliveries: no cart and no walker (LIFE_LAYER §1, "no walkers = not connected or starved"). */
const NO_DELIVERY = new Set(["paused", "not_connected", "input_starved", "warehouse_full"]);

/** The element classes of the life layer (render/life.ts LIFE_CLASSES). */
export const CLS = {
  cart: "cart",
  cartLoaded: "cart_loaded",
  axle: "cart_axle",
  villager: (tier: string, variant: number) => `villager_${tier === "settlers" ? "settlers" : "citizens"}_${variant}`,
  smoke: "smoke",
} as const;

/**
 * Chimney smoke (LIFE_LAYER §3): puffs per second at full throughput and
 * efficiency; a puff lives SMOKE_LIFE_MS, rising and drifting with the
 * world-fixed wind (tiles per second, archipelago x/y), growing then
 * shrinking away (opaque low-poly puffs: no transparency sorting).
 */
export const SMOKE_PER_S = 1.5;
export const SMOKE_LIFE_MS = 4000;
const SMOKE_RISE = 0.38;
export const WIND: Readonly<{ x: number; y: number }> = { x: 0.16, y: -0.09 };
const PUFF_MIN = 0.16;
const PUFF_MAX = 0.5;
const PUFF_JITTER = 0.07;

/** Where a producer's smoke leaves its chimney (island tiles x/y, height), null without a model anchor. */
export type SmokeAnchor = (b: BuildingDisplay, def: ContentBuilding) => { x: number; y: number; h: number } | null;

/** Smoke puffs per second of a building: base × throughput × efficiency while ok, else 0. */
export function smokeRate(b: Pick<BuildingDisplay, "status" | "throughput_factor_permille" | "efficiency_permille" | "rates">): number {
  if (b.status !== "ok" || !b.rates) return 0;
  return (SMOKE_PER_S * Math.max(0, b.throughput_factor_permille) * Math.max(0, b.efficiency_permille)) / 1e6;
}

interface Smoker {
  b: BuildingDisplay;
  def: ContentBuilding;
  /** Puffs per ms. */
  rate: number;
  seed: number;
  anchor: { x: number; y: number; h: number } | null;
}

/** Instances one cart draws (body and two axles). */
export const CART_INSTANCES = 3;

/** One delivery route of a producer: the road path to its collector and the round trip. */
export interface Route {
  producerId: number;
  path: TilePos[];
  /** One leg (ms): the server's transfer delay to the collector; the round trip is two legs. */
  legMs: number;
  /** Carts on the route (ceil(rate / CART_CAPACITY), ≤ MAX_CARTS). */
  carts: number;
  /** The tier of the producer (villager colours). */
  tier: string;
}

/** Output rate of a producer (milli-units per minute, all outputs). */
function outputRate(b: BuildingDisplay): number {
  let r = 0;
  for (const v of Object.values(b.rates?.outputs ?? {})) r += v;
  return r;
}

/** Carts of a producer with output rate r (milli-units per minute). */
export function cartsFor(rate: number): number {
  if (!(rate > 0)) return 0;
  return Math.min(MAX_CARTS, Math.ceil(rate / CART_CAPACITY));
}

/** Whether a producer delivers (and so has carts and a walker): running with output, a collector and a transfer delay. */
export function delivers(b: BuildingDisplay): boolean {
  return !NO_DELIVERY.has(b.status) && !b.paused && outputRate(b) > 0 && b.assigned_warehouse_id != null && (b.transfer_delay_ms ?? 0) > 0;
}

/** The delivery routes of an island: producers that deliver and have a road path of two tiles or more to their collector. */
export function deliveryRoutes(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): Route[] {
  const roads = new Set(display.roads.map(tileKey));
  const byId = new Map(display.buildings.map((b) => [b.id, b]));
  const out: Route[] = [];
  for (const b of display.buildings) {
    if (!delivers(b)) continue;
    const wh = byId.get(b.assigned_warehouse_id as number);
    const def = defs.get(b.type);
    const whDef = wh && defs.get(wh.type);
    if (!wh || !def || !whDef) continue;
    const path = roadPath(roads, footprintRoads(roads, b, def), footprintRoads(roads, wh, whDef));
    if (!path || path.length < 2) continue;
    out.push({ producerId: b.id, path, legMs: b.transfer_delay_ms as number, carts: cartsFor(outputRate(b)), tier: def.tier });
  }
  return out;
}

/** Yaw of a model facing +y (recipe front) heading along tile direction `heading` (render/life.ts convention). */
export function facing(heading: number): number {
  return heading - Math.PI / 2;
}

const at = { x: 0, y: 0, heading: 0 };

/**
 * Position on a route's round trip at phase p ∈ [0, 1): outbound (loaded)
 * for p < ½, back (empty) after; writes `at` and returns whether loaded
 * and the distance travelled on the leg (tiles).
 */
function onRoute(r: Route, p: number): { loaded: boolean; dist: number } {
  const loaded = p < 0.5;
  const f = loaded ? p * 2 : 2 - p * 2;
  alongPath(r.path, f, at);
  if (!loaded) at.heading += Math.PI;
  return { loaded, dist: (loaded ? f : 1 - f) * (r.path.length - 1) };
}

export class IslandLife implements LifePlan {
  private routes: Route[] = [];
  /** Carts in draw order: every route's first cart, then every second cart, … (fair budget cuts). */
  private carts: { route: Route; index: number }[] = [];
  private smokers: Smoker[] = [];
  private smokeAnchor: SmokeAnchor | null = null;

  /** Rebuilds the plan from the island's payload (content for footprints and tiers; static data for paths and water). */
  update(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>, _statics: Island | null, smokeAnchor: SmokeAnchor | null = null): void {
    void _statics;
    this.routes = deliveryRoutes(display, defs);
    this.carts = [];
    for (let i = 0; i < MAX_CARTS; i++) for (const route of this.routes) if (i < route.carts) this.carts.push({ route, index: i });
    this.smokeAnchor = smokeAnchor;
    this.smokers = [];
    for (const b of display.buildings) {
      const def = defs.get(b.type);
      const rate = smokeRate(b) / 1000;
      if (def && rate > 0) this.smokers.push({ b, def, rate, seed: hash01(b.id, "smoke"), anchor: null });
    }
  }

  /** Routes of the plan (tests). */
  deliveryRoutes(): readonly Route[] {
    return this.routes;
  }

  /** Writes the island's instances at server time nowMs within the budget, only what the LOD shows. */
  frame(nowMs: number, sink: LifeSink, lod: LifeAtLod, budget: LifeBudget): LifeStats {
    const particles = lod.smoke ? this.drawSmoke(nowMs, sink, budget.particles) : 0;
    if (!lod.moving) return { instances: 0, particles };
    const [cartInst = 0, walkers = 0] = allocate([this.carts.length * CART_INSTANCES, this.routes.length], budget.instances);
    const nCarts = Math.floor(cartInst / CART_INSTANCES);
    for (let i = 0; i < nCarts; i++) this.drawCart(this.carts[i] as { route: Route; index: number }, nowMs, sink);
    for (let i = 0; i < walkers; i++) this.drawWalker(this.routes[i] as Route, nowMs, sink);
    return { instances: nCarts * CART_INSTANCES + walkers, particles };
  }

  /**
   * Smoke puffs: puff k of a producer leaves at t_k = (k + seed) / rate
   * and lives SMOKE_LIFE_MS, so the live puffs follow from the clock
   * alone. Over the particle budget every producer's rate thins by the
   * same factor (density stays proportional).
   */
  private drawSmoke(nowMs: number, sink: LifeSink, budget: number): number {
    if (this.smokers.length === 0 || budget <= 0) return 0;
    let demand = 0;
    for (const s of this.smokers) {
      s.anchor ??= this.smokeAnchor?.(s.b, s.def) ?? null;
      if (s.anchor) demand += s.rate * SMOKE_LIFE_MS + 1;
    }
    const thin = demand > budget ? budget / demand : 1;
    let drawn = 0;
    for (const s of this.smokers) {
      const a = s.anchor;
      if (!a) continue;
      const rate = s.rate * thin;
      const kMax = Math.floor(nowMs * rate - s.seed);
      const kMin = Math.floor((nowMs - SMOKE_LIFE_MS) * rate - s.seed) + 1;
      for (let k = Math.max(kMin, kMax - 63); k <= kMax && drawn < budget; k++) {
        const age = (nowMs - (k + s.seed) / rate) / SMOKE_LIFE_MS; // 0..1
        const t = (age * SMOKE_LIFE_MS) / 1000;
        const jx = (hash01(s.b.id, k, "x") - 0.5) * 2 * PUFF_JITTER;
        const jy = (hash01(s.b.id, k, "y") - 0.5) * 2 * PUFF_JITTER;
        const size = age < 0.6 ? PUFF_MIN + (PUFF_MAX - PUFF_MIN) * (age / 0.6) : PUFF_MAX * (1 - (age - 0.6) / 0.4) + PUFF_MIN * 0.3;
        sink.add(CLS.smoke, a.x + jx + WIND.x * t, a.h + SMOKE_RISE * t, a.y + jy + WIND.y * t, hash01(s.b.id, k, "r") * Math.PI * 2, size);
        drawn++;
      }
    }
    return drawn;
  }

  private drawCart(c: { route: Route; index: number }, nowMs: number, sink: LifeSink): void {
    const r = c.route;
    const period = r.legMs * 2;
    const start = -hash01(r.producerId, "cart") * period;
    const p = (loopPhase(nowMs, start, period) + spreadPhase(c.index, r.carts)) % 1;
    const { loaded, dist } = onRoute(r, p);
    const yaw = facing(at.heading);
    sink.add(loaded ? CLS.cartLoaded : CLS.cart, at.x, ROAD_H, at.y, yaw, 1);
    // Axles at the wheel pivots, spinning with the distance travelled.
    const spin = dist / WHEEL_RADIUS;
    const fx = Math.cos(at.heading) * WHEEL_AHEAD;
    const fy = Math.sin(at.heading) * WHEEL_AHEAD;
    sink.add(CLS.axle, at.x + fx, ROAD_H + WHEEL_HEIGHT, at.y + fy, yaw, 1, undefined, spin);
    sink.add(CLS.axle, at.x - fx, ROAD_H + WHEEL_HEIGHT, at.y - fy, yaw, 1, undefined, spin);
  }

  private drawWalker(r: Route, nowMs: number, sink: LifeSink): void {
    const period = r.legMs * 2;
    // Half a round trip apart from the first cart, so the walker and the cart meet on the road.
    const start = -(hash01(r.producerId, "walker") * 0.5 + 0.25) * period;
    const { dist } = onRoute(r, loopPhase(nowMs, start, period));
    const side = WALKER_SIDE;
    const x = at.x - Math.sin(at.heading) * side;
    const y = at.y + Math.cos(at.heading) * side;
    const step = dist / STRIDE;
    const bob = Math.abs(Math.sin(step * Math.PI)) * BOB;
    const variant = lifeHash(r.producerId, "walker") % VILLAGER_VARIANTS;
    sink.add(CLS.villager(r.tier, variant), x, ROAD_H + bob, y, facing(at.heading), VILLAGER_SCALE);
  }
}
