// Dev/E2E-only synthetic archipelago (?fixture=archipelago-8x20): 8 islands
// and 20 ships (idle, on_route, manual_leg, anchored_unpaid) on 3 routes,
// with matching static islands, fed to the renderer without a server for
// the performance measurement of the archipelago view. Imported only
// behind the dev/E2E guard, so production builds tree-shake it away.
import type { Command, Content, DisplayState, Island, IslandDisplay, RouteDisplay, ShipDisplay, Terrain, WorldResponse } from "../api/client";
import { extrapolate } from "../display/extrapolate";
import type { SyncSnapshot } from "../api/sync";
import type { SyncLike } from "../ui/App";

export const ARCHIPELAGO_FIXTURE = "archipelago-8x20";

const GOODS = ["fish", "planks", "wood", "tools"];
const MODEL_INTERVAL_MS = 250;

/** The fixture named in a location.search string, or null. */
export function fixtureFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("fixture");
  return id === ARCHIPELAGO_FIXTURE ? id : null;
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

/** A read-only data source with the fixture; commands are rejected. */
export class FixtureSync implements SyncLike {
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    const built = buildArchipelagoFixture(Date.now());
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
}
