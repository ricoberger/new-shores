// Dev/E2E-only synthetic worlds, fed to the renderer without a server for
// performance measurements. Imported only behind the dev/E2E guard, so
// production builds tree-shake them away.
//
// ?fixture=archipelago-8x20: 8 islands and 20 ships (idle, on_route,
// manual_leg, anchored_unpaid) on 3 routes (the archipelago view).
// ?fixture=dense-2x400: two islands, ≈ 400 buildings on the shown one (plus
// 40 on the other), a road grid, ≥ 60 producers that draw moving carts,
// 16 fields of two types (D-049) and 2 ships on legs (the island view's
// mobile budget, FIRST_PLAYABLE §3).
import type {
  BuildingDisplay,
  Command,
  Content,
  DisplayState,
  Island,
  IslandDisplay,
  RouteDisplay,
  ShipDisplay,
  Terrain,
  WorldResponse,
} from "../api/client";
import type { View } from "../display/view";
import { extrapolate } from "../display/extrapolate";
import type { SyncSnapshot } from "../api/sync";
import type { SyncLike } from "../ui/App";

export const ARCHIPELAGO_FIXTURE = "archipelago-8x20";
export const DENSE_FIXTURE = "dense-2x400";
export type FixtureId = typeof ARCHIPELAGO_FIXTURE | typeof DENSE_FIXTURE;

const GOODS = ["fish", "planks", "wood", "tools"];
const MODEL_INTERVAL_MS = 250;

/** The fixture named in a location.search string, or null. */
export function fixtureFromSearch(search: string): FixtureId | null {
  const id = new URLSearchParams(search).get("fixture");
  return id === ARCHIPELAGO_FIXTURE || id === DENSE_FIXTURE ? id : null;
}

/** The view a fixture opens in. */
export function fixtureView(id: FixtureId): View {
  return id === DENSE_FIXTURE ? { kind: "island", id: DENSE_ISLAND } : { kind: "archipelago" };
}

/** Deterministic pseudo-random numbers (LCG). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A blob-shaped island: water border, coast ring, grass/forest/mountain inside. */
function terrain(width: number, height: number, seed: number): Terrain[] {
  const r = rng(seed);
  const bumps = Array.from({ length: 8 }, () => 0.85 + r() * 0.2);
  const out: Terrain[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - width / 2) / (width / 2 - 1);
      const dy = (y + 0.5 - height / 2) / (height / 2 - 1);
      const a = Math.atan2(dy, dx);
      const k = bumps[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8] as number;
      const d = Math.hypot(dx, dy) / k;
      out.push(d > 1 ? "water" : d > 0.85 ? "coast" : d < 0.25 ? "mountain" : (x * 7 + y * 3) % 5 === 0 ? "forest" : "grass");
    }
  }
  return out;
}

interface Built {
  server: WorldResponse;
  islands: Map<string, Island>;
  content: Content;
}

const ts = (ms: number) => new Date(ms).toISOString();

export function buildArchipelagoFixture(nowMs: number): Built {
  const specs = [
    { x: 0, y: 0, w: 56, h: 40 },
    { x: 80, y: 10, w: 40, h: 30 },
    { x: 150, y: 0, w: 36, h: 36 },
    { x: 20, y: 70, w: 44, h: 28 },
    { x: 95, y: 70, w: 30, h: 34 },
    { x: 160, y: 70, w: 40, h: 26 },
    { x: 40, y: 130, w: 34, h: 30 },
    { x: 130, y: 130, w: 48, h: 32 },
  ];
  const islands: IslandDisplay[] = [];
  const statics = new Map<string, Island>();
  specs.forEach((sp, i) => {
    const id = `isle${i + 1}`;
    const settled = i % 4 !== 3;
    const inventory: IslandDisplay["inventory"] = {};
    for (const [j, g] of GOODS.entries()) {
      inventory[g] = { stock: settled ? ((i + 1) * (j + 2) * 7000) % 300_000 : 0, capacity: settled ? 300_000 : 0, in_transit: 0, rate_per_min: 0 };
    }
    islands.push({
      id,
      name: `Isle ${i + 1}`,
      settled,
      position: { x: sp.x, y: sp.y },
      width: sp.w,
      height: sp.h,
      inventory,
      roads: [],
      buildings: [],
      workforce: {},
      population: settled ? { settlers: (i + 1) * 12_000 } : {},
    });
    statics.set(id, {
      id,
      width: sp.w,
      height: sp.h,
      revision: "fixture",
      terrain: terrain(sp.w, sp.h, 17 + i),
      fertilities: i % 2 === 0 ? ["wheat"] : ["apples", "hops"],
      deposits: i % 3 === 0 ? [{ x: Math.floor(sp.w / 2), y: Math.floor(sp.h / 2), kind: "stone" }] : [],
    });
  });
  const settledIds = islands.filter((is) => is.settled).map((is) => is.id);
  const routeStops = [
    [settledIds[0], settledIds[1], settledIds[2]],
    [settledIds[0], settledIds[3], settledIds[4]],
    [settledIds[2], settledIds[5]],
  ];
  const routes: RouteDisplay[] = routeStops.map((stops, i) => ({
    id: i + 1,
    name: `Route ${i + 1}`,
    stops: stops.map((s, j) => ({
      island_id: s as string,
      load: j === 0 ? [{ good: GOODS[i % GOODS.length] as string, max_amount: 50_000 }] : [],
      unload: j === 0 ? [] : [GOODS[i % GOODS.length] as string],
    })),
    ship_ids: [],
    loop_ms: 600_000,
    effects: [],
  }));
  const ships: ShipDisplay[] = [];
  const r = rng(99);
  for (let n = 0; n < 20; n++) {
    const id = n + 1;
    const kind = n % 5; // 0, 1: on_route; 2: manual_leg; 3: idle; 4: anchored_unpaid
    const base: ShipDisplay = {
      id,
      type: "sloop",
      state: "idle",
      island_id: "",
      route_id: 0,
      stop_index: 0,
      leg: null,
      cargo: n % 2 === 0 ? [{ good: "planks", amount: 30_000 }] : [],
      slots: 2,
      slot_size: 50_000,
      upkeep_per_min: 1000,
      paused: false,
      paused_reason: "",
    };
    if (kind <= 2) {
      const route = routes[n % routes.length] as RouteDisplay;
      const k = n % route.stops.length;
      const from = kind === 2 ? (islands[n % 8] as IslandDisplay).id : (route.stops[k]?.island_id as string);
      const to = kind === 2 ? (islands[(n + 3) % 8] as IslandDisplay).id : (route.stops[(k + 1) % route.stops.length]?.island_id as string);
      // Long legs with staggered starts keep ships moving during a measurement.
      const depart = nowMs - r() * 60_000 + (n % 3 === 0 ? 5_000 : 0);
      const arrive = depart + 600_000 + r() * 300_000;
      ships.push({
        ...base,
        state: kind === 2 ? "manual_leg" : "on_route",
        island_id: depart > nowMs ? from : "",
        route_id: kind === 2 ? 0 : route.id,
        leg: { from_island_id: from, to_island_id: to, depart_at: ts(depart), arrive_at: ts(arrive) },
      });
      if (kind !== 2) route.ship_ids.push(id);
    } else {
      const at = (islands[(n * 3) % 8] as IslandDisplay).id;
      ships.push(
        kind === 4
          ? { ...base, state: "anchored_unpaid", island_id: at, upkeep_per_min: 0, paused: true, paused_reason: "unpaid" }
          : { ...base, island_id: at },
      );
    }
  }
  const display: DisplayState = {
    evaluated_at: ts(nowMs),
    next_change_at: null,
    gold: 1_000_000,
    balance_rate_per_min: 0,
    tax_rate_per_min: 0,
    upkeep_rate_per_min: 0,
    tiers: [],
    islands,
    ships,
    routes,
    insolvency: { unpaid_buildings: 0, unpaid_ships: 4, unpaid_upkeep_per_min: 4000, balance_if_resumed_per_min: -4000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    last_seen_at: ts(nowMs),
  } as DisplayState;
  const content = {
    region: { id: "fixture", name: "Fixture", version: "fixture" },
    quests: [],
    tiers: [],
    goods: GOODS.map((g) => ({ id: g, name: g[0]?.toUpperCase() + g.slice(1) })),
    buildings: [],
    needs: [],
    ships: [{ id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000 }],
  } as unknown as Content;
  return { server: { version: 1, display }, islands: statics, content };
}

/** The dense island shown by dense-2x400. */
export const DENSE_ISLAND = "dense1";
const DENSE_GOODS = ["wood", "planks", "fish", "tools"];

/** A rectangular island: water border, a coast ring, grass inside. */
function blockTerrain(width: number, height: number): Terrain[] {
  const out: Terrain[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      out.push(edge === 0 ? "water" : edge === 1 ? "coast" : (x * 5 + y * 3) % 23 === 0 ? "forest" : "grass");
    }
  }
  return out;
}

/** Synthetic building definitions (all 2 × 2) for the renderer and the HUD. */
function denseContent(): Content {
  const def = (id: string, name: string, category: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    tier: "settlers",
    category,
    width: 2,
    height: 2,
    coastal: false,
    requires_road: category !== "houses",
    cost: { gold: 50_000, materials: { planks: 2_000 } },
    upkeep_per_min: category === "houses" ? 0 : 1_000,
    pause_category: category === "houses" ? "never" : "production",
    ...extra,
  });
  return {
    region: { id: "fixture", name: "Fixture", version: "fixture" },
    quests: [],
    tiers: [{ id: "settlers", name: "Settlers" }],
    goods: DENSE_GOODS.map((g) => ({ id: g, name: g[0]?.toUpperCase() + g.slice(1) })),
    buildings: [
      def("house", "House", "houses", { house: { tier: "settlers" } }),
      def("woodcutter", "Woodcutter", "production", { recipe: { inputs: [], outputs: [{ good: "wood", amount: 1_000 }], cycle_ms: 20_000 } }),
      def("sawmill", "Sawmill", "production", {
        recipe: { inputs: [{ good: "wood", amount: 1_000 }], outputs: [{ good: "planks", amount: 1_000 }], cycle_ms: 20_000 },
      }),
      def("fisher", "Fisher", "production", { recipe: { inputs: [], outputs: [{ good: "fish", amount: 1_000 }], cycle_ms: 30_000 } }),
      def("chapel", "Chapel", "public", { service: { radius: 10 } }),
      def("depot", "Depot", "harbour", { warehouse: { levels: [{ capacity: 100_000, throughput_per_min: 60_000 }] } }),
      def("yard", "Yard", "harbour", { shipyard: {} }),
      def("road", "Road", "roads", { width: 1, height: 1, requires_road: false, road: { ms_per_tile: 500 } }),
      def("pasture", "Pasture", "production", { width: 1, height: 1, requires_road: false, field: { type: "pasture", terrain: ["grass"] } }),
      def("wheat_field", "Wheat field", "production", { width: 1, height: 1, requires_road: false, field: { type: "wheat_field", terrain: ["grass"] } }),
    ],
    needs: [],
    ships: [{ id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000 }],
  } as unknown as Content;
}

const PRODUCERS = ["woodcutter", "sawmill", "fisher"];
const BAD_STATUS: BuildingDisplay["status"][] = ["input_starved", "short_of_workers", "warehouse_full", "low_efficiency"];

/**
 * A grid town: horizontal roads every 5 rows joined by a road column at
 * each side; 2 × 2 buildings in two rows between the roads (each touches
 * one). Warehouses spread over the grid; producers deliver to the nearest
 * one by slot order and draw a cart each.
 */
function denseIsland(id: string, name: string, width: number, height: number, count: number, firstId: number) {
  const roads: { x: number; y: number; type: string }[] = [];
  const roadRows: number[] = [];
  for (let y = 4; y <= height - 5; y += 5) roadRows.push(y);
  const minX = 3;
  const maxX = width - 4;
  for (const y of roadRows) for (let x = minX; x <= maxX; x++) roads.push({ x, y, type: "road" });
  for (let y = roadRows[0] ?? 4; y <= (roadRows[roadRows.length - 1] ?? 4); y++) {
    if (roadRows.includes(y)) continue;
    roads.push({ x: minX, y, type: "road" }, { x: maxX, y, type: "road" });
  }
  const slots: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < roadRows.length; i++) {
    const r = roadRows[i] as number;
    for (const y of [r + 1, r + 3]) for (let x = minX + 1; x + 1 < maxX; x += 2) slots.push({ x, y });
  }
  const n = Math.min(count, slots.length);
  const step = slots.length / n;
  const chosen = Array.from({ length: n }, (_, i) => slots[Math.floor(i * step)] as { x: number; y: number });
  const warehouses = new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]);
  const buildings: BuildingDisplay[] = [];
  let lastWarehouse = firstId;
  chosen.forEach((p, i) => {
    const bid = firstId + i;
    const base = {
      id: bid,
      x: p.x,
      y: p.y,
      rotation: (p.y % 5 === 0 ? 0 : 180) as BuildingDisplay["rotation"],
      paused: false,
      paused_reason: "",
      status: "ok",
      efficiency_permille: 1000,
      throughput_factor_permille: 1000,
    } as BuildingDisplay;
    if (warehouses.has(i)) {
      lastWarehouse = bid;
      buildings.push({ ...base, type: "depot", level: 1, capacity: 100_000 } as BuildingDisplay);
    } else if (i % 5 === 1) {
      // Producers: most deliver (a cart each); some are starved (status icon).
      const type = PRODUCERS[i % PRODUCERS.length] as string;
      const good = type === "woodcutter" ? "wood" : type === "sawmill" ? "planks" : "fish";
      const bad = i % 25 === 6;
      buildings.push({
        ...base,
        type,
        status: bad ? (BAD_STATUS[i % BAD_STATUS.length] as BuildingDisplay["status"]) : "ok",
        rates: { inputs: type === "sawmill" ? { wood: 3_000 } : {}, outputs: { [good]: bad ? 0 : 3_000 } },
        cycle_seconds: 20,
        cycle_progress_permille: (i * 37) % 1000,
        cycle_rate_permille_per_min: 3000,
        assigned_warehouse_id: lastWarehouse,
        transfer_delay_ms: 8_000 + (i % 7) * 1_500,
        road_distance: 10,
      } as BuildingDisplay);
    } else if (i % 13 === 4) {
      buildings.push({ ...base, type: i % 26 === 4 ? "yard" : "chapel" } as BuildingDisplay);
    } else {
      const unhappy = i % 17 === 0;
      buildings.push({ ...base, type: "house", status: unhappy ? "short_of_workers" : "ok", residents: 8_000 } as unknown as BuildingDisplay);
    }
  });
  // Eight fields of each type on the free grass columns west and east of
  // the road grid (the field layer's draw calls; the shown island stays
  // at ≈ 400 buildings).
  let fieldId = firstId + n;
  const terrain = blockTerrain(width, height);
  for (const [x, type] of [
    [2, "pasture"],
    [width - 3, "wheat_field"],
  ] as const) {
    let placed = 0;
    for (let y = 2; y < height - 2 && placed < 8; y++) {
      if (terrain[y * width + x] !== "grass") continue;
      placed++;
      buildings.push({
        id: fieldId++,
        type,
        x,
        y,
        rotation: 0,
        paused: false,
        paused_reason: "",
        status: "ok",
        efficiency_permille: 1000,
        throughput_factor_permille: 1000,
      } as BuildingDisplay);
    }
  }
  const inventory: IslandDisplay["inventory"] = {};
  for (const g of DENSE_GOODS) inventory[g] = { stock: 40_000, capacity: 100_000, in_transit: 0, rate_per_min: 1_000 };
  const display = {
    id,
    name,
    settled: true,
    position: { x: 0, y: 0 },
    width,
    height,
    inventory,
    roads,
    buildings,
    workforce: {},
    population: { settlers: buildings.filter((b) => b.type === "house").length * 8_000 },
  } as IslandDisplay;
  const statics: Island = { id, width, height, revision: "fixture", terrain: blockTerrain(width, height), fertilities: ["wheat"], deposits: [] };
  return { display, statics };
}

export function buildDenseFixture(nowMs: number): Built {
  const a = denseIsland(DENSE_ISLAND, "Dense", 64, 50, 400, 1);
  const b = denseIsland("dense2", "Neighbour", 44, 30, 40, 1001);
  a.display.position = { x: 0, y: 0 };
  b.display.position = { x: 90, y: 12 };
  const leg = (from: string, to: string, offset: number) => ({
    from_island_id: from,
    to_island_id: to,
    depart_at: ts(nowMs - offset),
    arrive_at: ts(nowMs - offset + 20 * 60_000),
  });
  const ship = (id: number, from: string, to: string, offset: number): ShipDisplay => ({
    id,
    type: "sloop",
    state: "manual_leg",
    island_id: "",
    route_id: 0,
    stop_index: 0,
    leg: leg(from, to, offset),
    cargo: [{ good: "planks", amount: 20_000 }],
    slots: 2,
    slot_size: 50_000,
    upkeep_per_min: 1_000,
    paused: false,
    paused_reason: "",
  });
  const display = {
    evaluated_at: ts(nowMs),
    next_change_at: null,
    gold: 5_000_000,
    balance_rate_per_min: 12_000,
    tax_rate_per_min: 60_000,
    upkeep_rate_per_min: 48_000,
    tiers: [{ id: "settlers", unlocked: true, population: {}, buildings: {}, goods_delivered: {} }],
    islands: [a.display, b.display],
    ships: [ship(1, DENSE_ISLAND, "dense2", 60_000), ship(2, "dense2", DENSE_ISLAND, 300_000)],
    routes: [],
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 12_000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return {
    server: { version: 1, display },
    islands: new Map([
      [a.statics.id, a.statics],
      [b.statics.id, b.statics],
    ]),
    content: denseContent(),
  };
}

/** A read-only data source with a fixture; commands are rejected. */
export class FixtureSync implements SyncLike {
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(id: FixtureId = ARCHIPELAGO_FIXTURE) {
    const built = id === DENSE_FIXTURE ? buildDenseFixture(Date.now()) : buildArchipelagoFixture(Date.now());
    const nowMs = Date.now();
    this.snapshot = {
      server: built.server,
      model: extrapolate(built.server.display, nowMs),
      nowMs,
      content: built.content,
      islands: built.islands,
      unreachable: false,
    };
  }

  start(): () => void {
    this.timer = setInterval(() => {
      const nowMs = this.serverNowMs();
      const server = this.snapshot.server;
      if (server) this.set({ model: extrapolate(server.display, nowMs), nowMs });
    }, MODEL_INTERVAL_MS);
    return () => clearInterval(this.timer);
  }

  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  serverNowMs(): number {
    return Date.now();
  }

  subscribeUnauthorized(): () => void {
    return () => undefined;
  }

  subscribeErrors(): () => void {
    return () => undefined;
  }

  send(command: Command): Promise<WorldResponse> {
    return Promise.reject(new Error(`fixture is read-only (${command.type})`));
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }
}
