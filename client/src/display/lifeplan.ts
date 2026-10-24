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
import { allocateShares, hash01, lifeHash, type LifeAtLod, type LifeBudget, type LifePlan, type LifeSink, type LifeStats, loopPhase, spreadPhase } from "./life";
import { alongPath, footprintRoads, roadPath } from "./roadpath";
import { rotatedFootprint, tileKey } from "./geometry";
import { pierHeading, pierPoint } from "./ships";

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
  boat: "boat",
  crate: "crate",
  gullUp: "gull_up",
  gullDown: "gull_down",
  sheep: "sheep",
} as const;

/**
 * Inhabitants (LIFE_LAYER §5): floor(residents / RESIDENTS_PER_STROLLER)
 * strollers per house walk from the house's road tile to a road tile
 * within STROLL_RADIUS (picked by hash) or, for about half of them when a
 * market is within MARKET_RADIUS, to the market, pause there and walk
 * back, then rest at home.
 */
export const RESIDENTS_PER_STROLLER = 8;
const STROLL_RADIUS = 6;
const MARKET_RADIUS = 12;
const STROLL_SPEED = 0.45;
export const MARKET_PAUSE_MS = 8000;
const STOP_PAUSE_MS = 2000;
const HOME_PAUSE_MS = 4000;
const STROLLER_SIDE = 0.2;

/**
 * Sheep (LIFE_LAYER §5): SHEEP_PER_PASTURE wander inside each pasture: in
 * every SHEEP_STEP_MS a sheep walks for SHEEP_WALK of the step to a new
 * hashed spot, then grazes. An inactive pasture's sheep stand still and
 * greyed (the unpaid-ship multiplier).
 */
export const SHEEP_PER_PASTURE = 2;
export const SHEEP_STEP_MS = 9000;
const SHEEP_WALK = 0.35;
const SHEEP_MARGIN = 0.32;
const FIELD_H = 0;
export const INACTIVE_TINT: readonly [number, number, number, number] = [0.6, 0.68, 0.8, 1];

interface Stroller {
  path: TilePos[];
  tier: string;
  variant: number;
  side: number;
  /** Walk time of one leg, pause at the far end, round trip period (ms). */
  walkMs: number;
  pauseMs: number;
  periodMs: number;
  startMs: number;
}

interface Sheep {
  /** Field interior (island tiles). */
  x0: number;
  y0: number;
  w: number;
  h: number;
  key: string;
  active: boolean;
}

/** Whether a building is a market (strollers pause there). */
function isMarket(def: ContentBuilding | undefined): boolean {
  return !!def?.service && def.id.startsWith("market");
}

/** Whether a field's animals graze: the field is active (chain intact) and its farm is not paused. */
export function pastureActive(field: Pick<BuildingDisplay, "active">, farm: Pick<BuildingDisplay, "status"> | undefined): boolean {
  return field.active !== false && !!farm && farm.status !== "paused";
}

/** Strollers of the island's houses: home road tile → hashed stop or the market and back. */
export function strollers(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>, limit = Infinity): Stroller[] {
  const roads = new Set(display.roads.map(tileKey));
  const markets: { b: BuildingDisplay; tiles: TilePos[] }[] = [];
  for (const b of display.buildings) {
    const def = defs.get(b.type);
    if (isMarket(def)) markets.push({ b, tiles: footprintRoads(roads, b, def as ContentBuilding) });
  }
  const out: Stroller[] = [];
  for (const b of display.buildings) {
    const def = defs.get(b.type);
    if (!def?.house) continue;
    const n = Math.floor((b.residents ?? 0) / 1000 / RESIDENTS_PER_STROLLER);
    if (n <= 0) continue;
    const home = footprintRoads(roads, b, def);
    if (home.length === 0) continue;
    const h0 = home[0] as TilePos;
    const near = display.roads.filter((r) => Math.max(Math.abs(r.x - h0.x), Math.abs(r.y - h0.y)) <= STROLL_RADIUS);
    const market = markets.find((m) => m.tiles.some((t) => Math.max(Math.abs(t.x - h0.x), Math.abs(t.y - h0.y)) <= MARKET_RADIUS));
    for (let i = 0; i < n && out.length < limit; i++) {
      const toMarket = !!market && market.tiles.length > 0 && hash01(b.id, i, "market") < 0.5;
      const goal = toMarket ? (market as { tiles: TilePos[] }).tiles : [near[lifeHash(b.id, i, "stop") % Math.max(1, near.length)] as TilePos];
      if (!goal[0]) continue;
      const path = roadPath(roads, home, goal);
      if (!path || path.length < 2) continue;
      const walkMs = ((path.length - 1) / STROLL_SPEED) * 1000;
      const pauseMs = toMarket ? MARKET_PAUSE_MS : STOP_PAUSE_MS;
      const periodMs = 2 * walkMs + pauseMs + HOME_PAUSE_MS;
      out.push({
        path,
        tier: def.tier,
        variant: lifeHash(b.id, i, "variant") % VILLAGER_VARIANTS,
        side: (hash01(b.id, i, "side") < 0.5 ? -1 : 1) * STROLLER_SIDE,
        walkMs,
        pauseMs,
        periodMs,
        startMs: -hash01(b.id, i, "phase") * periodMs,
      });
    }
  }
  return out;
}

/** The sheep of the island's pastures (SHEEP_PER_PASTURE each). */
export function pastureSheep(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): Sheep[] {
  const byId = new Map(display.buildings.map((b) => [b.id, b]));
  const out: Sheep[] = [];
  for (const b of display.buildings) {
    const def = defs.get(b.type);
    if (!def?.field || def.id !== "pasture") continue;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    const active = pastureActive(b, byId.get(b.farm_id as number));
    for (let i = 0; i < SHEEP_PER_PASTURE; i++) {
      out.push({ x0: b.x + SHEEP_MARGIN, y0: b.y + SHEEP_MARGIN, w: w - 2 * SHEEP_MARGIN, h: h - 2 * SHEEP_MARGIN, key: `${b.id}:${i}`, active });
    }
  }
  return out;
}

/** Sea surface height (world y; render/terrain SEA_LEVEL, checked by a test). */
export const SEA_H = -0.6;

/**
 * Harbour life (LIFE_LAYER §4). The fisher's boat rows an ellipse that
 * starts at the jetty's mooring point and reaches BOAT_OUT tiles out to
 * sea, one loop per BOAT_LOOP_MS, while the fisher's status is ok.
 */
export const BOAT_LOOP_MS = 48_000;
/**
 * Budget shares of carts (instances), walkers, boats, crates, sheep,
 * gulls and strollers; what a class leaves unused goes to the others in
 * that priority order.
 */
const SHARES = [0.45, 0.1, 0.02, 0.04, 0.1, 0.04, 0.25];
/** Most strollers an island plans (above any instance budget). */
const MAX_STROLLERS = 400;
const BOAT_ALONG = 1.6;
const BOAT_OUT = 1.7;
const BOAT_SCALE = 1.3;
/** Gulls per island with a fisher or Trading Post: 3–5 (hash of the island). */
export const GULLS_MIN = 3;
export const GULLS_MAX = 5;
const GULL_FLAP_HZ = 1.6;
/** Crates stacked on the quay beside each ship handling at a Trading Post's pier. */
export const CRATES_PER_SHIP = 3;
const QUAY_H = 0.02;
/** How far back from the mooring point (toward land) the crates stand: on the pier deck beside the hull. */
const QUAY_BACK = 1.0;

interface Boat {
  /** Loop centre (island tiles), along-coast and outward unit axes. */
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  seed: number;
}

interface Gull {
  x: number;
  y: number;
  radius: number;
  h: number;
  /** rad/s, signed (direction of the circle). */
  speed: number;
  phase: number;
  flap: number;
}

/** Whether a building is a fisher: a water-edge producer (not a Trading Post). */
function isFisher(def: ContentBuilding | undefined): boolean {
  return !!def && !!def.water_tiles && !!def.recipe && !def.trading_post;
}

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
  private boats: Boat[] = [];
  private gulls: Gull[] = [];
  /** Crate positions (island tiles), yaw. */
  private crates: { x: number; y: number; h: number; yaw: number }[] = [];
  private strollers: Stroller[] = [];
  private sheep: Sheep[] = [];

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
    this.updateHarbour(display, defs);
    this.strollers = strollers(display, defs, MAX_STROLLERS);
    this.sheep = pastureSheep(display, defs);
  }

  private updateHarbour(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    this.boats = [];
    this.crates = [];
    const coast: { x: number; y: number }[] = [];
    for (const b of display.buildings) {
      const def = defs.get(b.type);
      if (!def || !(isFisher(def) || def.trading_post)) continue;
      const moor = pierPoint(def, b, 0, false);
      if (!moor) continue;
      const h = pierHeading(b.rotation);
      const ox = Math.cos(h);
      const oy = Math.sin(h);
      coast.push({ x: moor.x, y: moor.y });
      if (isFisher(def) && b.status === "ok") {
        this.boats.push({ cx: moor.x + ox * BOAT_OUT, cy: moor.y + oy * BOAT_OUT, ax: -oy, ay: ox, ox, oy, seed: hash01(b.id, "boat") });
      }
      // Crates on the quay beside every ship handling at the pier: back from the mooring point toward land.
      if (def.trading_post) {
        (b.berths?.ships ?? []).forEach((ship, i) => {
          const p = pierPoint(def, b, i, false);
          if (!p) return;
          for (let k = 0; k < CRATES_PER_SHIP; k++) {
            const side = k === 1 ? 0.3 : 0;
            const yaw = (hash01(ship, k, "crate") - 0.5) * 0.8;
            this.crates.push({ x: p.x - ox * QUAY_BACK - oy * (0.45 + side), y: p.y - oy * QUAY_BACK + ox * (0.45 + side), h: QUAY_H + (k === 2 ? 0.26 : 0), yaw });
          }
        });
      }
    }
    // Gulls circle over the island's fishers and Trading Posts, a little out to sea.
    this.gulls = [];
    if (coast.length > 0) {
      const n = GULLS_MIN + (lifeHash(display.id, "gulls") % (GULLS_MAX - GULLS_MIN + 1));
      for (let i = 0; i < n; i++) {
        const c = coast[i % coast.length] as { x: number; y: number };
        const r = (k: string) => hash01(display.id, i, k);
        this.gulls.push({
          x: c.x + (r("x") - 0.5) * 2,
          y: c.y + (r("y") - 0.5) * 2,
          radius: 1.4 + r("r") * 1.8,
          h: 1.6 + r("h") * 1.2,
          speed: (0.35 + r("s") * 0.25) * (r("d") < 0.5 ? -1 : 1),
          phase: r("p") * Math.PI * 2,
          flap: r("f"),
        });
      }
    }
  }

  /** Routes of the plan (tests). */
  deliveryRoutes(): readonly Route[] {
    return this.routes;
  }

  /** Writes the island's instances at server time nowMs within the budget, only what the LOD shows. */
  frame(nowMs: number, sink: LifeSink, lod: LifeAtLod, budget: LifeBudget): LifeStats {
    const particles = lod.smoke ? this.drawSmoke(nowMs, sink, budget.particles) : 0;
    const moving = lod.moving;
    const [cartInst = 0, walkers = 0, boats = 0, crates = 0, sheep = 0, gulls = 0, strollers = 0] = allocateShares(
      [
        moving ? this.carts.length * CART_INSTANCES : 0,
        moving ? this.routes.length : 0,
        moving ? this.boats.length : 0,
        lod.props ? this.crates.length : 0,
        lod.props ? this.sheep.length : 0,
        moving ? this.gulls.length : 0,
        moving ? this.strollers.length : 0,
      ],
      SHARES,
      budget.instances,
    );
    const nCarts = Math.floor(cartInst / CART_INSTANCES);
    for (let i = 0; i < nCarts; i++) this.drawCart(this.carts[i] as { route: Route; index: number }, nowMs, sink);
    for (let i = 0; i < walkers; i++) this.drawWalker(this.routes[i] as Route, nowMs, sink);
    for (let i = 0; i < boats; i++) this.drawBoat(this.boats[i] as Boat, nowMs, sink);
    for (let i = 0; i < crates; i++) {
      const c = this.crates[i] as { x: number; y: number; h: number; yaw: number };
      sink.add(CLS.crate, c.x, c.h, c.y, c.yaw, 1);
    }
    for (let i = 0; i < sheep; i++) this.drawSheep(this.sheep[i] as Sheep, moving ? nowMs : null, sink);
    for (let i = 0; i < gulls; i++) this.drawGull(this.gulls[i] as Gull, nowMs, sink);
    for (let i = 0; i < strollers; i++) this.drawStroller(this.strollers[i] as Stroller, nowMs, sink);
    return { instances: nCarts * CART_INSTANCES + walkers + boats + crates + sheep + gulls + strollers, particles };
  }

  private drawStroller(s: Stroller, nowMs: number, sink: LifeSink): void {
    const t = loopPhase(nowMs, s.startMs, s.periodMs) * s.periodMs;
    let f: number;
    let back = false;
    let walking = true;
    if (t < s.walkMs) f = t / s.walkMs;
    else if (t < s.walkMs + s.pauseMs) {
      f = 1;
      walking = false;
    } else if (t < 2 * s.walkMs + s.pauseMs) {
      f = 1 - (t - s.walkMs - s.pauseMs) / s.walkMs;
      back = true;
    } else {
      f = 0;
      walking = false;
      back = true;
    }
    alongPath(s.path, f, at);
    if (back) at.heading += Math.PI;
    const x = at.x - Math.sin(at.heading) * s.side;
    const y = at.y + Math.cos(at.heading) * s.side;
    const step = (f * (s.path.length - 1)) / STRIDE;
    const bob = walking ? Math.abs(Math.sin(step * Math.PI)) * BOB : 0;
    sink.add(CLS.villager(s.tier, s.variant), x, ROAD_H + bob, y, facing(at.heading), VILLAGER_SCALE);
  }

  /** A sheep at time nowMs (null: standing at its first spot, the mid LOD), walking then grazing in each step. */
  private drawSheep(s: Sheep, nowMs: number | null, sink: LifeSink): void {
    const spot = (k: number) => ({ x: s.x0 + hash01(s.key, k, "x") * s.w, y: s.y0 + hash01(s.key, k, "y") * s.h });
    if (!s.active || nowMs === null) {
      const p = spot(0);
      sink.add(CLS.sheep, p.x, FIELD_H, p.y, hash01(s.key, "yaw") * Math.PI * 2, 1, s.active ? undefined : INACTIVE_TINT);
      return;
    }
    const u = (nowMs + hash01(s.key, "phase") * SHEEP_STEP_MS) / SHEEP_STEP_MS;
    const k = Math.floor(u);
    const a = spot(k - 1);
    const b = spot(k);
    const f = Math.min(1, (u - k) / SHEEP_WALK);
    const e = f * f * (3 - 2 * f);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    // Head down while grazing: a slight forward pitch.
    sink.add(CLS.sheep, a.x + (b.x - a.x) * e, FIELD_H, a.y + (b.y - a.y) * e, facing(heading), 1, undefined, f >= 1 ? 0.12 : 0);
  }

  private drawBoat(b: Boat, nowMs: number, sink: LifeSink): void {
    // θ = −π/2 is the mooring point; the loop runs out along the coast and back.
    const th = 2 * Math.PI * (loopPhase(nowMs, -b.seed * BOAT_LOOP_MS, BOAT_LOOP_MS) - 0.25);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const x = b.cx + b.ax * BOAT_ALONG * c + b.ox * BOAT_OUT * s;
    const y = b.cy + b.ay * BOAT_ALONG * c + b.oy * BOAT_OUT * s;
    const dx = -b.ax * BOAT_ALONG * s + b.ox * BOAT_OUT * c;
    const dy = -b.ay * BOAT_ALONG * s + b.oy * BOAT_OUT * c;
    const bob = Math.sin(nowMs / 700 + b.seed * 6) * 0.015;
    sink.add(CLS.boat, x, SEA_H + bob, y, facing(Math.atan2(dy, dx)), BOAT_SCALE, undefined, Math.sin(nowMs / 900 + b.seed * 9) * 0.05); // pitching gently
  }

  private drawGull(g: Gull, nowMs: number, sink: LifeSink): void {
    const t = nowMs / 1000;
    const a = g.phase + g.speed * t;
    const x = g.x + Math.cos(a) * g.radius;
    const y = g.y + Math.sin(a) * g.radius;
    // Tangent of the circle: the direction of flight.
    const heading = Math.atan2(Math.cos(a) * g.speed, -Math.sin(a) * g.speed);
    // Flapping in bursts: wings up and down for half of every flap cycle, gliding (up) between bursts.
    const cycle = t * GULL_FLAP_HZ + g.flap * 7;
    const burst = Math.sin(cycle * 0.37 + g.flap * 5) > -0.2;
    const up = !burst || cycle % 1 < 0.5;
    const h = g.h + Math.sin(t * 0.8 + g.phase) * 0.12;
    sink.add(up ? CLS.gullUp : CLS.gullDown, x, h, y, facing(heading), 1);
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
