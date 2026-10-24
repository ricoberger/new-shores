import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, IslandDisplay } from "../api/client";
import type { LifeSink } from "./life";
import { CART_CAPACITY, CART_INSTANCES, cartsFor, CLS, deliveryRoutes, delivers, IslandLife, MAX_CARTS, WHEEL_AHEAD, WHEEL_HEIGHT } from "./lifeplan";

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
