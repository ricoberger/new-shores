import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import type { LifeSink } from "./life";
import {
  CART_CAPACITY,
  CART_INSTANCES,
  cartsFor,
  CLS,
  deliveryRoutes,
  delivers,
  BOAT_LOOP_MS,
  CRATES_PER_SHIP,
  GULLS_MAX,
  GULLS_MIN,
  INACTIVE_TINT,
  IslandLife,
  MARKET_PAUSE_MS,
  MAX_CARTS,
  pastureActive,
  RESIDENTS_PER_STROLLER,
  SHEEP_PER_PASTURE,
  SHEEP_STEP_MS,
  strollers,
  SMOKE_LIFE_MS,
  SMOKE_PER_S,
  type SmokeAnchor,
  smokeRate,
  WHEEL_AHEAD,
  WHEEL_HEIGHT,
} from "./lifeplan";

const defs = new Map<string, ContentBuilding>(
  [
    ["lumberjack", 1, 1, "settlers"],
    ["warehouse", 2, 2, "settlers"],
    ["toolmaker", 1, 1, "citizens"],
  ].map(([id, w, h, tier]) => [id as string, { id, width: w, height: h, tier, category: "production" } as unknown as ContentBuilding]),
);

function producer(id: number, x: number, extra: Partial<BuildingDisplay> = {}): BuildingDisplay {
  return {
    id,
    type: "lumberjack",
    x,
    y: 0,
    rotation: 0,
    paused: false,
    paused_reason: "",
    status: "ok",
    efficiency_permille: 1000,
    throughput_factor_permille: 1000,
    rates: { inputs: {}, outputs: { wood: 2000 } },
    transfer_delay_ms: 4000,
    assigned_warehouse_id: 100,
    ...extra,
  } as BuildingDisplay;
}

/** A road along y = 1 from x = 0 to 11; the warehouse at x 10–11 above it, producers at y = 0. */
function island(buildings: BuildingDisplay[]): IslandDisplay {
  const warehouse = { id: 100, type: "warehouse", x: 10, y: -1, rotation: 0, paused: false, paused_reason: "", status: "ok" } as BuildingDisplay;
  return { buildings: [...buildings, warehouse], roads: Array.from({ length: 12 }, (_, x) => ({ x, y: 1 })) } as unknown as IslandDisplay;
}

/** Records the instances of a frame by class. */
function record(): LifeSink & { by: Map<string, { x: number; y: number; yaw: number; roll: number }[]> } {
  const by = new Map<string, { x: number; y: number; yaw: number; roll: number }[]>();
  return {
    by,
    add(cls, x, _h, y, yaw, _k, _c, roll = 0) {
      if (!by.has(cls)) by.set(cls, []);
      by.get(cls)?.push({ x, y, yaw, roll });
    },
  };
}

const NEAR = { moving: true, smoke: true, props: true };
const BIG = { instances: 400, particles: 160 };

describe("carts per rate", () => {
  it("runs ceil(rate / cart capacity) carts, at most 3, none without output", () => {
    expect(cartsFor(0)).toBe(0);
    expect(cartsFor(-5)).toBe(0);
    expect(cartsFor(1)).toBe(1);
    expect(cartsFor(CART_CAPACITY)).toBe(1);
    expect(cartsFor(CART_CAPACITY + 1)).toBe(2);
    expect(cartsFor(2500)).toBe(3);
    expect(cartsFor(99_000)).toBe(MAX_CARTS);
  });
});

describe("no state → no motion (carts and walkers)", () => {
  it.each([
    ["ok", {}, true],
    ["throttled", { status: "throttled" }, true],
    ["short of workers", { status: "short_of_workers" }, true],
    ["paused", { status: "paused", paused: true }, false],
    ["not connected", { status: "not_connected", assigned_warehouse_id: undefined }, false],
    ["input starved", { status: "input_starved" }, false],
    ["warehouse full", { status: "warehouse_full" }, false],
    ["no output", { rates: { inputs: {}, outputs: { wood: 0 } } }, false],
    ["no collector", { assigned_warehouse_id: undefined }, false],
  ] as const)("%s → %s", (_name, extra, want) => {
    expect(delivers(producer(1, 2, extra as Partial<BuildingDisplay>))).toBe(want);
    const life = new IslandLife();
    life.update(island([producer(1, 2, extra as Partial<BuildingDisplay>)]), defs, null);
    const s = record();
    life.frame(1000, s, NEAR, BIG);
    expect(s.by.has(CLS.cart) || s.by.has(CLS.cartLoaded)).toBe(want);
    expect(s.by.has(CLS.villager("settlers", 0)) || s.by.has(CLS.villager("settlers", 1)) || s.by.has(CLS.villager("settlers", 2))).toBe(want);
  });

  it("draws nothing without a road path (an unconnected producer away from the road)", () => {
    const routes = deliveryRoutes(island([producer(1, 2, { y: 5 } as Partial<BuildingDisplay>)]), defs);
    expect(routes).toEqual([]);
  });
});

describe("IslandLife", () => {
  it("spawns carts, walkers and smoke only in the chunks in view", () => {
    const life = new IslandLife();
    const anchor: SmokeAnchor = (b) => ({ x: b.x + 0.5, y: b.y + 0.5, h: 1 });
    life.update(island([producer(1, 2)]), defs, null, anchor);
    const count = (chunks: ReadonlySet<string> | null) => {
      const s = record();
      const stats = life.frame(123_456, s, NEAR, BIG, chunks);
      return { stats, smoke: s.by.get(CLS.smoke)?.length ?? 0 };
    };
    const all = count(null);
    expect(all.stats.instances).toBeGreaterThan(0);
    expect(all.smoke).toBeGreaterThan(0);
    // The producer, its road and the warehouse lie in chunk 0,0.
    expect(count(new Set(["0,0"]))).toEqual(all);
    const none = count(new Set(["1,0", "0,1"]));
    expect(none.stats).toEqual({ instances: 0, particles: 0 });
    expect(none.smoke).toBe(0);
  });

  it("runs the carts of a producer evenly spread in phase on its road path, loaded out and empty back", () => {
    const life = new IslandLife();
    life.update(island([producer(1, 2)]), defs, null);
    const [route] = life.deliveryRoutes();
    expect(route?.path[0]).toEqual({ x: 2, y: 1 });
    expect(route?.path.at(-1)).toEqual({ x: 10, y: 1 });
    expect(route?.carts).toBe(2);
    const s = record();
    const stats = life.frame(123_456, s, NEAR, BIG);
    const carts = [...(s.by.get(CLS.cart) ?? []), ...(s.by.get(CLS.cartLoaded) ?? [])];
    // Two carts half a round trip apart: one on each leg, mirrored on the path.
    expect(carts).toHaveLength(2);
    expect(s.by.get(CLS.cart)).toHaveLength(1);
    expect(s.by.get(CLS.cartLoaded)).toHaveLength(1);
    const [a, b] = carts as { x: number }[];
    expect((a?.x ?? 0) + (b?.x ?? 0)).toBeCloseTo(2.5 + 10.5);
    expect(s.by.get(CLS.axle)).toHaveLength(4);
    expect(stats).toEqual({ instances: 2 * CART_INSTANCES + 1, particles: 0 });
  });

  it("moves with the clock, deterministically", () => {
    const pos = (now: number) => {
      const life = new IslandLife();
      life.update(island([producer(7, 2)]), defs, null);
      const s = record();
      life.frame(now, s, NEAR, BIG);
      return [...(s.by.get(CLS.cart) ?? []), ...(s.by.get(CLS.cartLoaded) ?? [])].map((c) => c.x);
    };
    expect(pos(5000)).toEqual(pos(5000));
    expect(pos(5000)).not.toEqual(pos(5500));
    // The round trip is two legs of the transfer delay.
    expect(pos(5000)).toEqual(pos(5000 + 8000));
  });

  it("faces the travel direction and spins the wheels with the distance", () => {
    const life = new IslandLife();
    life.update(island([producer(1, 2, { rates: { inputs: {}, outputs: { wood: 500 } } } as Partial<BuildingDisplay>)]), defs, null);
    const s1 = record();
    const s2 = record();
    // Phase from the hash: sample two close times on the same leg.
    life.frame(1000, s1, NEAR, BIG);
    life.frame(1100, s2, NEAR, BIG);
    const c = [...(s1.by.get(CLS.cart) ?? []), ...(s1.by.get(CLS.cartLoaded) ?? [])][0];
    // Along +x (outbound) the yaw is −π/2, along −x (back) +π/2.
    expect(Math.abs(Math.abs(c?.yaw ?? 0) - Math.PI / 2)).toBeLessThan(1e-9);
    const r1 = s1.by.get(CLS.axle)?.[0]?.roll ?? 0;
    const r2 = s2.by.get(CLS.axle)?.[0]?.roll ?? 0;
    expect(r1).not.toBe(r2);
  });

  it("keeps each producer's first cart and its walker when the budget is short", () => {
    const life = new IslandLife();
    life.update(island([producer(1, 0), producer(2, 2), producer(3, 4)]), defs, null);
    const s = record();
    const stats = life.frame(1000, s, NEAR, { instances: 3 * CART_INSTANCES + 2, particles: 64 });
    expect(stats.instances).toBeLessThanOrEqual(3 * CART_INSTANCES + 2);
    const carts = [...(s.by.get(CLS.cart) ?? []), ...(s.by.get(CLS.cartLoaded) ?? [])];
    expect(carts).toHaveLength(3);
    // The first carts of the three producers (different routes: different x ranges are not guaranteed, so count axles).
    expect(s.by.get(CLS.axle)).toHaveLength(6);
  });

  it("draws nothing that moves at mid or far", () => {
    const life = new IslandLife();
    life.update(island([producer(1, 2)]), defs, null);
    const s = record();
    expect(life.frame(1000, s, { moving: false, smoke: true, props: true }, BIG)).toEqual({ instances: 0, particles: 0 });
    expect(s.by.size).toBe(0);
  });

  it("dresses walkers in their producer's tier", () => {
    const life = new IslandLife();
    life.update(island([producer(1, 2, { type: "toolmaker" } as Partial<BuildingDisplay>)]), defs, null);
    const s = record();
    life.frame(1000, s, NEAR, BIG);
    expect([...s.by.keys()].filter((k) => k.startsWith("villager_"))).toEqual([expect.stringMatching(/^villager_citizens_[0-2]$/)]);
  });
});

describe("chimney smoke", () => {
  const chimney: SmokeAnchor = (b) => ({ x: b.x + 0.5, y: b.y + 0.5, h: 1.5 });
  const puffs = (b: BuildingDisplay[], now = 50_000, at = NEAR, budget = BIG, anchor: SmokeAnchor | null = chimney) => {
    const life = new IslandLife();
    life.update(island(b), defs, null, anchor);
    const s = record();
    const stats = life.frame(now, s, at, budget);
    return { n: s.by.get(CLS.smoke)?.length ?? 0, stats, at: s.by.get(CLS.smoke) ?? [] };
  };

  it("is base × throughput × efficiency while ok, none otherwise", () => {
    const b = producer(1, 2);
    expect(smokeRate(b)).toBeCloseTo(SMOKE_PER_S);
    expect(smokeRate({ ...b, throughput_factor_permille: 500, efficiency_permille: 800 })).toBeCloseTo(SMOKE_PER_S * 0.4);
    for (const status of ["paused", "not_connected", "input_starved", "warehouse_full", "throttled", "short_of_workers", "low_efficiency"] as const) {
      expect(smokeRate({ ...b, status })).toBe(0);
    }
    expect(smokeRate({ ...b, rates: undefined })).toBe(0);
  });

  it("keeps about rate × lifetime puffs alive, rising from the chimney and drifting", () => {
    const { n, stats, at } = puffs([producer(1, 2)]);
    const expected = (SMOKE_PER_S * SMOKE_LIFE_MS) / 1000;
    expect(Math.abs(n - expected)).toBeLessThanOrEqual(1);
    expect(stats.particles).toBe(n);
    expect(stats.instances).toBeGreaterThan(0);
    for (const p of at) expect(p.y).toBeLessThan(3);
    // Half the throughput, about half the puffs; paused: none.
    const half = puffs([producer(1, 2, { throughput_factor_permille: 500 })]).n;
    expect(Math.abs(half - expected / 2)).toBeLessThanOrEqual(1);
    expect(puffs([producer(1, 2, { status: "paused", paused: true })]).n).toBe(0);
  });

  it("is deterministic, shows at mid but not far, and needs the model's anchor", () => {
    expect(puffs([producer(1, 2)], 77_777).at).toEqual(puffs([producer(1, 2)], 77_777).at);
    expect(puffs([producer(1, 2)], 50_000, { moving: false, smoke: true, props: true }).stats).toEqual({ instances: 0, particles: expect.any(Number) });
    expect(puffs([producer(1, 2)], 50_000, { moving: false, smoke: true, props: true }).n).toBeGreaterThan(0);
    expect(puffs([producer(1, 2)], 50_000, { moving: false, smoke: false, props: false }).n).toBe(0);
    expect(puffs([producer(1, 2)], 50_000, NEAR, BIG, null).n).toBe(0);
  });

  it("thins every producer alike within the particle budget", () => {
    const many = Array.from({ length: 30 }, (_, i) => producer(i + 1, i % 10, { y: -5 - Math.floor(i / 10) } as Partial<BuildingDisplay>));
    const { n } = puffs(many, 50_000, NEAR, { instances: 150, particles: 64 });
    expect(n).toBeLessThanOrEqual(64);
    expect(n).toBeGreaterThan(40);
  });
});

describe("harbour life", () => {
  const harbourDefs = new Map<string, ContentBuilding>([
    ...defs,
    ["fisher", { id: "fisher", width: 2, height: 2, tier: "settlers", category: "production", water_rows: { min: 1, max: 1 }, recipe: {}, boat: true } as unknown as ContentBuilding],
    ["salt_pans", { id: "salt_pans", width: 2, height: 3, tier: "merchants", category: "production", water_rows: { min: 1, max: 1 }, recipe: {} } as unknown as ContentBuilding],
    ["trading_post", { id: "trading_post", width: 4, height: 4, tier: "settlers", category: "harbour", water_rows: { min: 2, max: 2 }, trading_post: {} } as unknown as ContentBuilding],
  ]);
  const fisher = (status = "ok") => ({ id: 7, type: "fisher", x: 20, y: 0, rotation: 0, paused: false, paused_reason: "", status }) as unknown as BuildingDisplay;
  const post = (ships: number[] = []) =>
    ({ id: 8, type: "trading_post", x: 30, y: 0, rotation: 0, paused: false, paused_reason: "", status: "ok", berths: { ships, queue: [] } }) as unknown as BuildingDisplay;
  const run = (b: BuildingDisplay[], now = 10_000, at = NEAR, id = "isle") => {
    const life = new IslandLife();
    life.update({ ...island(b), id } as IslandDisplay, harbourDefs, null);
    const s = record();
    const stats = life.frame(now, s, at, BIG);
    return { s, stats, n: (c: string) => s.by.get(c)?.length ?? 0 };
  };
  const gulls = (r: { n: (c: string) => number }) => r.n(CLS.gullUp) + r.n(CLS.gullDown);

  it("rows the fisher's boat on a loop out to sea only while the fisher is ok", () => {
    expect(run([fisher()]).n(CLS.boat)).toBe(1);
    for (const st of ["paused", "warehouse_full", "short_of_workers"]) expect(run([fisher(st)]).n(CLS.boat)).toBe(0);
    // Rotation 0: the sea is −y; the boat stays seaward of the jetty and comes back to the same place each loop.
    const pts = Array.from({ length: 12 }, (_, i) => run([fisher()], (i * BOAT_LOOP_MS) / 12).s.by.get(CLS.boat)?.[0] as { x: number; y: number });
    for (const p of pts) expect(p.y).toBeLessThan(0);
    const at = (t: number) => run([fisher()], t).s.by.get(CLS.boat)?.[0] as { x: number; y: number };
    expect(at(5000).x).toBeCloseTo(at(5000 + BOAT_LOOP_MS).x);
    expect(at(5000).y).toBeCloseTo(at(5000 + BOAT_LOOP_MS).y);
    expect(run([fisher()], 5000, { moving: false, smoke: true, props: true }).n(CLS.boat)).toBe(0);
  });

  it("rows a boat only for buildings whose content says boat: salt pans keep their barge moored", () => {
    const pans = { id: 9, type: "salt_pans", x: 10, y: 0, rotation: 0, paused: false, paused_reason: "", status: "ok" } as unknown as BuildingDisplay;
    expect(run([pans]).n(CLS.boat)).toBe(0);
    expect(run([pans, fisher()]).n(CLS.boat)).toBe(1);
  });

  it("starts the boat's loop at the model's boat anchor and stacks crates behind the berth anchors (D-054)", () => {
    const anchor: SmokeAnchor = (_b, _def, name) => (name === "boat" ? { x: 25, y: -3, h: 0 } : name === "berth_1" ? { x: 40, y: -2, h: 0.06 } : null);
    const withAnchors = (b: BuildingDisplay[], now: number) => {
      const life = new IslandLife();
      life.update({ ...island(b), id: "isle" } as IslandDisplay, harbourDefs, null, anchor);
      const s = record();
      life.frame(now, s, NEAR, BIG);
      return s;
    };
    const pts = Array.from({ length: 24 }, (_, i) => withAnchors([fisher()], (i * BOAT_LOOP_MS) / 24).by.get(CLS.boat)?.[0] as { x: number; y: number });
    // The loop reaches back to the anchor (its landward end) and runs out to sea from it.
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(-3, 1);
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(-5);
    expect(pts.reduce((s, p) => s + p.x, 0) / pts.length).toBeCloseTo(25, 0);
    // The crates of the ship at berth 1 stand on the pier behind its anchor (toward land).
    const crates = withAnchors([post([5])], 10_000).by.get(CLS.crate) as { x: number; y: number }[];
    expect(crates).toHaveLength(CRATES_PER_SHIP);
    for (const c of crates) {
      expect(Math.abs(c.x - 40)).toBeLessThan(1);
      expect(c.y).toBeCloseTo(-1, 5);
    }
  });

  it("circles 3–5 gulls over an island with a fisher or Trading Post, none elsewhere", () => {
    expect(gulls(run([producer(1, 2)]))).toBe(0);
    const seen = new Set<number>();
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const n = gulls(run([post()], 10_000, NEAR, id));
      expect(n).toBeGreaterThanOrEqual(GULLS_MIN);
      expect(n).toBeLessThanOrEqual(GULLS_MAX);
      seen.add(n);
      // A paused fisher still has gulls (the harbour is there).
      expect(gulls(run([fisher("paused")], 10_000, NEAR, id))).toBe(n);
    }
    expect(seen.size).toBeGreaterThan(1);
    // Flying: they move between frames, and flap (up and down strokes both occur).
    const a = run([post()], 10_000).s;
    const b = run([post()], 11_000).s;
    expect([...(a.by.get(CLS.gullUp) ?? []), ...(a.by.get(CLS.gullDown) ?? [])]).not.toEqual([...(b.by.get(CLS.gullUp) ?? []), ...(b.by.get(CLS.gullDown) ?? [])]);
    let up = 0;
    let down = 0;
    for (let t = 0; t < 20_000; t += 137) {
      const r = run([post()], t);
      up += r.n(CLS.gullUp);
      down += r.n(CLS.gullDown);
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it("stacks crates on the quay while a ship handles at the pier, at near and mid", () => {
    expect(run([post()]).n(CLS.crate)).toBe(0);
    expect(run([post([5])]).n(CLS.crate)).toBe(CRATES_PER_SHIP);
    expect(run([post([5, 6])]).n(CLS.crate)).toBe(2 * CRATES_PER_SHIP);
    expect(run([post([5])], 10_000, { moving: false, smoke: true, props: true }).n(CLS.crate)).toBe(CRATES_PER_SHIP);
    expect(run([post([5])], 10_000, { moving: false, smoke: false, props: false }).n(CLS.crate)).toBe(0);
  });
});

describe("inhabitants and animals", () => {
  const townDefs = new Map<string, ContentBuilding>([
    ...defs,
    ["house_settlers", { id: "house_settlers", width: 2, height: 2, tier: "settlers", category: "housing", house: {} } as unknown as ContentBuilding],
    ["market", { id: "market", width: 3, height: 3, tier: "settlers", category: "public", service: { radius: 12 } } as unknown as ContentBuilding],
    ["sheep_farm", { id: "sheep_farm", width: 3, height: 3, tier: "settlers", category: "production", fields: {} } as unknown as ContentBuilding],
    ["pasture", { id: "pasture", width: 2, height: 2, tier: "settlers", category: "production", field: { type: "pasture", farm: "sheep_farm" } } as unknown as ContentBuilding],
  ]);
  const house = (id: number, x: number, residents: number) => ({ id, type: "house_settlers", x, y: -1, rotation: 0, status: "ok", residents: residents * 1000 }) as unknown as BuildingDisplay;
  const market = { id: 50, type: "market", x: 4, y: 2, rotation: 0, status: "ok" } as unknown as BuildingDisplay;
  const farm = (status = "ok") => ({ id: 60, type: "sheep_farm", x: 20, y: 2, rotation: 0, status }) as unknown as BuildingDisplay;
  const pasture = (id: number, active = true) => ({ id, type: "pasture", x: 23, y: 2 + (id - 61) * 2, rotation: 0, status: active ? "ok" : "not_adjacent", active, farm_id: 60 }) as unknown as BuildingDisplay;
  const frame = (b: BuildingDisplay[], now = 10_000, at = NEAR) => {
    const life = new IslandLife();
    life.update(island(b), townDefs, null);
    const s = record();
    life.frame(now, s, at, BIG);
    return s;
  };
  const villagers = (s: ReturnType<typeof record>) => [0, 1, 2].reduce((n, v) => n + (s.by.get(CLS.villager("settlers", v))?.length ?? 0), 0);

  it("sends floor(residents / 8) strollers per house onto the nearby roads", () => {
    expect(villagers(frame([house(1, 2, RESIDENTS_PER_STROLLER - 1)]))).toBe(0);
    expect(villagers(frame([house(1, 2, RESIDENTS_PER_STROLLER)]))).toBe(1);
    expect(villagers(frame([house(1, 2, 2 * RESIDENTS_PER_STROLLER + 3), house(2, 6, RESIDENTS_PER_STROLLER)]))).toBe(3);
    // Without an adjacent road (y far from the road at y = 1): none.
    expect(villagers(frame([{ ...house(1, 2, 16), y: 8 } as BuildingDisplay]))).toBe(0);
    // On the road (y = 1 ± side offset), never beyond the radius.
    for (let t = 0; t < 60_000; t += 1700) {
      for (const p of frame([house(1, 2, 16)], t).by.values()) for (const q of p) expect(Math.abs(q.y - 1.5)).toBeLessThan(0.3);
    }
  });

  it("pauses strollers at the market", () => {
    const st = strollers(island([house(1, 2, 80), market]), townDefs);
    const toMarket = st.filter((s) => s.pauseMs === MARKET_PAUSE_MS);
    expect(toMarket.length).toBeGreaterThan(0);
    for (const s of toMarket) expect(s.path.at(-1)?.y).toBe(1);
    expect(strollers(island([house(1, 2, 80)]), townDefs).every((s) => s.pauseMs !== MARKET_PAUSE_MS)).toBe(true);
  });

  it("wanders two sheep per active pasture inside the field; inactive ones stand still, greyed", () => {
    expect(pastureActive({ active: true }, { status: "ok" })).toBe(true);
    expect(pastureActive({ active: false }, { status: "ok" })).toBe(false);
    expect(pastureActive({ active: true }, { status: "paused" })).toBe(false);
    expect(pastureActive({ active: true }, undefined)).toBe(false);
    const sheepAt = (b: BuildingDisplay[], t: number, at = NEAR) => {
      const life = new IslandLife();
      life.update(island(b), townDefs, null);
      const out: { x: number; y: number; color?: readonly number[] }[] = [];
      life.frame(t, { add: (cls, x, _h, y, _yaw, _k, color) => cls === CLS.sheep && out.push({ x, y, ...(color ? { color } : {}) }) }, at, BIG);
      return out;
    };
    const herd = [farm(), pasture(61), pasture(62)];
    const a = sheepAt(herd, 10_000);
    expect(a).toHaveLength(2 * SHEEP_PER_PASTURE);
    for (let t = 0; t < 5 * SHEEP_STEP_MS; t += 1300) {
      for (const p of sheepAt(herd, t)) {
        expect(p.x).toBeGreaterThan(23);
        expect(p.x).toBeLessThan(25);
        expect(p.y).toBeGreaterThan(2);
        expect(p.y).toBeLessThan(6);
        expect(p.color).toBeUndefined();
      }
    }
    expect(sheepAt(herd, 10_000 + SHEEP_STEP_MS)).not.toEqual(a);
    // Inactive (chain broken, or the farm paused): still and grey.
    for (const still of [[farm(), pasture(61, false)], [farm("paused"), pasture(61)]]) {
      const s0 = sheepAt(still, 10_000);
      expect(s0).toHaveLength(SHEEP_PER_PASTURE);
      expect(sheepAt(still, 10_000 + 3 * SHEEP_STEP_MS)).toEqual(s0);
      for (const p of s0) expect(p.color).toEqual(INACTIVE_TINT);
    }
    // Mid LOD: standing (props), far: none.
    expect(sheepAt(herd, 10_000, { moving: false, smoke: true, props: true })).toEqual(sheepAt(herd, 99_000, { moving: false, smoke: true, props: true }));
    expect(sheepAt(herd, 10_000, { moving: false, smoke: false, props: false })).toHaveLength(0);
  });
});

describe("cart models", () => {
  it("place the axles at the recipe's wheel anchors", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "models", "manifest.json"), "utf8")) as {
      life: Record<string, { anchors: Record<string, number[]> }>;
    };
    for (const id of ["life_cart", "life_cart_merchant"]) {
      // glTF (x, y up, −z front).
      expect(manifest.life[id]?.anchors.wheel_front).toEqual([0, WHEEL_HEIGHT, -WHEEL_AHEAD]);
      expect(manifest.life[id]?.anchors.wheel_rear).toEqual([0, WHEEL_HEIGHT, WHEEL_AHEAD]);
    }
  });
});
