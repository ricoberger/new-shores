// Dev/E2E-only synthetic worlds, fed to the renderer without a server for
// performance measurements. Imported only behind the dev/E2E guard, so
// production builds tree-shake them away.
//
// ?fixture=archipelago-8x20: 8 islands and 20 ships (idle, on_route,
// manual_leg, anchored_unpaid) on 3 routes; the camera starts with the
// whole archipelago in view (far LOD).
// ?fixture=dense-2x400: two islands, ≈ 400 buildings on the first one (plus
// 40 on the other), a road grid, ≥ 60 producers that draw moving carts,
// 16 fields of two types (D-049) and 2 ships on legs; the camera starts on
// the dense island (near LOD, the mobile budget of FIRST_PLAYABLE §3).
// Below the town lie a forest belt (woodcutters with a forest work area
// thin it) and a rocky headland with two deposits meeting the water, and
// the coast is ragged — the terrain and decoration layers of the art
// direction are part of the budget.
// ?fixture=dense-archipelago-8: 8 islands at archipelago positions like
// archipelago-8x20, two of them dense (the dense-2x400 town each), four
// silhouette-only and two with 30 buildings, ships on legs and 2 routes;
// the camera starts on the first dense island (the far and mid LOD
// budgets of the continuous world, D-048).
// ?fixture=showcase: one island with every building, field and ship model
// of the asset manifest (tier 1–2 content IDs): houses of both tiers in
// all variants, every Trading Post and Warehouse level, a paused building, fields of
// all four types, an anchored_unpaid sloop and sloops with and without
// cargo (the art gate's model showcase).
//
// The dense and showcase fixtures use the real content IDs and footprints
// of content/old_coast (FIXTURE_DEFS), so they draw the real models.
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
import type { InitialCamera } from "../render/engine";
import { extrapolate } from "../display/extrapolate";
import type { SyncSnapshot } from "../api/sync";
import type { SyncLike } from "../ui/App";

export const ARCHIPELAGO_FIXTURE = "archipelago-8x20";
export const DENSE_FIXTURE = "dense-2x400";
export const DENSE_ARCHIPELAGO_FIXTURE = "dense-archipelago-8";
export const SHOWCASE_FIXTURE = "showcase";
export type FixtureId = typeof ARCHIPELAGO_FIXTURE | typeof DENSE_FIXTURE | typeof DENSE_ARCHIPELAGO_FIXTURE | typeof SHOWCASE_FIXTURE;

const GOODS = ["fish", "planks", "wood", "tools"];
const MODEL_INTERVAL_MS = 250;

/** The fixture named in a location.search string, or null. */
export function fixtureFromSearch(search: string): FixtureId | null {
  const id = new URLSearchParams(search).get("fixture");
  return id === ARCHIPELAGO_FIXTURE || id === DENSE_FIXTURE || id === DENSE_ARCHIPELAGO_FIXTURE || id === SHOWCASE_FIXTURE ? id : null;
}

/** Where a fixture's camera starts: the whole archipelago (far), the showcase island or the first dense island (near). */
export function fixtureCamera(id: FixtureId): InitialCamera {
  if (id === ARCHIPELAGO_FIXTURE) return { kind: "fit" };
  return { kind: "island", id: id === SHOWCASE_FIXTURE ? SHOWCASE_ISLAND : DENSE_ISLAND };
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
      capacity_source: null,
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
      // Idle ships carry planks too: the one at an unsettled island can found it.
      cargo: n % 2 === 0 || kind === 3 ? [{ good: "planks", amount: 30_000 }] : [],
      slots: 2,
      slot_size: 50_000,
      upkeep_per_min: 1000,
      paused: false,
      paused_reason: "",
      position: null,
      queued_at: null,
      berth_until: null,
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
        leg: { from_island_id: from, from_position: null, to_island_id: to, depart_at: ts(depart), arrive_at: ts(arrive) },
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
    // The Trading Post's cost: the idle ships with planks can found an unsettled island.
    buildings: fixtureDefs().filter((b) => b.id === "trading_post"),
    needs: [],
    ships: [{ id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000 }],
  } as unknown as Content;
  return { server: { version: 1, display }, islands: statics, content };
}

/** The (first) dense island of dense-2x400 and dense-archipelago-8. */
export const DENSE_ISLAND = "dense1";
const DENSE_GOODS = ["wood", "planks", "fish", "tools"];

/** The first row below the town's last road row (dense islands). */
function belowTown(height: number): number {
  let last = 4;
  for (let y = 4; y <= height - 5; y += 5) last = y;
  return last + 1;
}

/** Forest belt (x range) and rocky headland (x range) below the town of a dense island. */
function denseZones(width: number) {
  return { forest: [4, Math.floor(width * 0.62)] as const, rock: [Math.ceil(width * 0.69), width - 6] as const };
}

/**
 * A dense island: water border, a ragged coast ring and grass inside; below
 * the town a forest belt and a rocky headland down to the water.
 */
function blockTerrain(width: number, height: number): Terrain[] {
  const below = belowTown(height);
  const z = denseZones(width);
  const r = rng(width * 131 + height);
  const out: Terrain[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      const ragged = r() < 0.3;
      let t: Terrain = edge === 0 ? "water" : edge === 1 ? (ragged && x !== 2 && x !== width - 3 ? "water" : "coast") : (x * 5 + y * 3) % 23 === 0 ? "forest" : "grass";
      if (y >= below && y <= height - 3 && x >= z.forest[0] && x <= z.forest[1]) t = "forest";
      if (y >= below && y <= height - 2 && x >= z.rock[0] && x <= z.rock[1]) t = "mountain";
      out.push(t);
    }
  }
  return out;
}

/** Two deposits on the rocky headland of a dense island. */
function denseDeposits(width: number, height: number): Island["deposits"] {
  const z = denseZones(width);
  const y = Math.min(height - 3, belowTown(height) + 1);
  return [
    { x: z.rock[0] + 1, y, kind: "stone" },
    { x: Math.min(z.rock[1], z.rock[0] + 5), y, kind: "iron" },
  ];
}

type FixtureDef = [id: string, name: string, tier: string, category: string, width: number, height: number, extra?: Record<string, unknown>];

/**
 * Building definitions of content/old_coast (IDs, tiers, categories and
 * footprints as the server derives them; a Vitest cross-checks them
 * against the content JSON) for the renderer and the HUD of the dense and
 * showcase fixtures. Costs and recipes are simplified.
 */
const FIXTURE_DEFS: FixtureDef[] = [
  ["house_settlers", "Settler house", "settlers", "houses", 2, 2, { house: { tier: "settlers" } }],
  ["road_dirt", "Dirt road", "settlers", "roads", 1, 1, { road: { ms_per_tile: 500 } }],
  [
    "trading_post",
    "Trading Post",
    "settlers",
    "harbour",
    4,
    4,
    {
      requires_road: false,
      water_tiles: 2,
      trading_post: {
        levels: [
          { capacity: 300_000, throughput_per_min: 30_000, berths: 1 },
          { capacity: 500_000, throughput_per_min: 55_000, berths: 2 },
          { capacity: 800_000, throughput_per_min: 80_000, berths: 3 },
          { capacity: 1_200_000, throughput_per_min: 110_000, berths: 4 },
        ],
      },
    },
  ],
  ["warehouse", "Warehouse", "settlers", "production", 2, 2, { requires_road: false, warehouse: { levels: [{ throughput_per_min: 30_000 }, { throughput_per_min: 55_000 }, { throughput_per_min: 80_000 }] } }],
  ["market_small", "Small market", "settlers", "public", 3, 3, { service: { radius: 10 } }],
  ["chapel", "Chapel", "settlers", "public", 2, 2, { service: { radius: 10 } }],
  ["lumberjack", "Lumberjack", "settlers", "production", 2, 2, { work_area: { radius: 4, terrain: ["forest"] } }],
  ["sawmill", "Sawmill", "settlers", "production", 2, 2],
  ["fisher", "Fisher", "settlers", "production", 2, 2, { water_tiles: 1 }],
  ["sheep_farm", "Sheep farm", "settlers", "production", 3, 3, { work_area: { radius: 4 }, fields: { type: "pasture", required: 4 } }],
  ["pasture", "Pasture", "settlers", "production", 1, 1, { requires_road: false, field: { type: "pasture", terrain: ["grass"] } }],
  ["weaver_wool", "Wool weaver", "settlers", "production", 2, 2],
  ["shipyard", "Shipyard", "settlers", "harbour", 5, 4, { water_tiles: 2, shipyard: {} }],
  ["house_citizens", "Citizen house", "citizens", "houses", 2, 2, { house: { tier: "citizens" } }],
  ["road_paved", "Paved road", "citizens", "roads", 1, 1, { road: { ms_per_tile: 350 } }],
  ["tavern", "Tavern", "citizens", "public", 3, 3, { service: { radius: 10 } }],
  ["wheat_farm", "Wheat farm", "citizens", "production", 3, 3, { work_area: { radius: 4 }, fields: { type: "wheat_field", required: 4 } }],
  ["wheat_field", "Wheat field", "citizens", "production", 1, 1, { requires_road: false, field: { type: "wheat_field", terrain: ["grass"] } }],
  ["mill", "Mill", "citizens", "production", 2, 2],
  ["bakery", "Bakery", "citizens", "production", 2, 2],
  ["orchard", "Orchard", "citizens", "production", 3, 3, { work_area: { radius: 4 }, fields: { type: "orchard_plot", required: 4 } }],
  ["orchard_plot", "Orchard plot", "citizens", "production", 1, 1, { requires_road: false, field: { type: "orchard_plot", terrain: ["grass"] } }],
  ["cidery", "Cidery", "citizens", "production", 2, 2],
  ["hemp_farm", "Hemp farm", "citizens", "production", 3, 3, { work_area: { radius: 4 }, fields: { type: "hemp_field", required: 4 } }],
  ["hemp_field", "Hemp field", "citizens", "production", 1, 1, { requires_road: false, field: { type: "hemp_field", terrain: ["grass"] } }],
  ["weaver_linen", "Linen weaver", "citizens", "production", 2, 2],
  ["sailmaker", "Sailmaker", "citizens", "production", 2, 2],
  ["quarry", "Quarry", "citizens", "production", 3, 3, { requires_deposit: "stone" }],
  ["iron_mine", "Iron mine", "citizens", "production", 3, 3, { requires_deposit: "iron" }],
  ["charcoal_burner", "Charcoal burner", "citizens", "production", 2, 2],
  ["smelter", "Smelter", "citizens", "production", 3, 3],
  ["toolmaker", "Toolmaker", "citizens", "production", 2, 2],
];

/** The fixture building definitions (exported for the content cross-check). */
export function fixtureDefs(): { id: string; tier: string; category: string; width: number; height: number; field?: { type: string }; requires_deposit?: string }[] {
  return FIXTURE_DEFS.map(([id, name, tier, category, width, height, extra = {}]) => ({
    id,
    name,
    tier,
    category,
    width,
    height,
    coastal: false,
    water_tiles: 0,
    requires_road: category !== "houses" && category !== "roads",
    cost: { gold: 50_000, materials: { planks: 2_000 } },
    upkeep_per_min: category === "houses" || category === "roads" ? 0 : 1_000,
    pause_category: category === "houses" ? "never" : "production",
    ...(category === "production" && !("field" in extra) && !("warehouse" in extra) ? { recipe: { inputs: [], outputs: [{ good: "planks", amount: 1_000 }], cycle_ms: 20_000 } } : {}),
    ...extra,
  }));
}

/** Content of the dense and showcase fixtures. */
function denseContent(): Content {
  return {
    region: { id: "fixture", name: "Fixture", version: "fixture" },
    quests: [],
    tiers: [
      { id: "settlers", name: "Settlers" },
      { id: "citizens", name: "Citizens" },
    ],
    goods: DENSE_GOODS.map((g) => ({ id: g, name: g[0]?.toUpperCase() + g.slice(1) })),
    buildings: fixtureDefs(),
    needs: [],
    ships: [{ id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000 }],
  } as unknown as Content;
}

const PRODUCERS = ["lumberjack", "sawmill", "fisher"];
/**
 * 440 of the 448 slots of a 64 × 50 dense island: ≈ 410 buildings once
 * the Trading Post and shipyards take theirs, plus 16 fields (the 2 × 2
 * Warehouses take one slot each, so a few slots stay empty to keep the
 * building count of the perf budget).
 */
const DENSE_SLOTS = 440;
const BAD_STATUS: BuildingDisplay["status"][] = ["input_starved", "short_of_workers", "warehouse_full", "low_efficiency"];

/**
 * A grid town: horizontal roads every 5 rows joined by a road column at
 * each side; buildings in two rows of 2 × 2 slots between the roads,
 * fronts toward their road (the upper row faces up, rotation 180; the
 * lower row down, rotation 0). The Trading Post (4 × 4), Warehouses
 * (2 × 2) and shipyards (5 × 4) take slots of the upper row (and the one
 * below). Collectors
 * spread over the grid; producers deliver to the nearest one by slot
 * order and draw a cart each.
 */
function denseIsland(id: string, name: string, width: number, height: number, count: number, firstId: number) {
  const roads: { x: number; y: number; type: string }[] = [];
  const roadRows: number[] = [];
  for (let y = 4; y <= height - 5; y += 5) roadRows.push(y);
  const minX = 3;
  const maxX = width - 4;
  for (const y of roadRows) for (let x = minX; x <= maxX; x++) roads.push({ x, y, type: "road_dirt" });
  for (let y = roadRows[0] ?? 4; y <= (roadRows[roadRows.length - 1] ?? 4); y++) {
    if (roadRows.includes(y)) continue;
    roads.push({ x: minX, y, type: "road_dirt" }, { x: maxX, y, type: "road_dirt" });
  }
  const slots: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < roadRows.length; i++) {
    const r = roadRows[i] as number;
    for (const y of [r + 1, r + 3]) for (let x = minX + 1; x + 1 < maxX; x += 2) slots.push({ x, y });
  }
  const n = Math.min(count, slots.length);
  const step = slots.length / n;
  const chosen = Array.from({ length: n }, (_, i) => slots[Math.floor(i * step)] as { x: number; y: number });
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  /** Takes the slots a w × h footprint at (x, y) covers (all must be chosen and free). */
  const claim = (x: number, y: number, w: number, h: number): boolean => {
    const need: string[] = [];
    for (const s of chosen) {
      if (s.x + 2 > x && s.x < x + w && s.y + 2 > y && s.y < y + h) need.push(key(s.x, s.y));
    }
    const fits = x + w <= maxX && need.every((k) => !taken.has(k)) && need.length === Math.ceil(w / 2) * Math.ceil(h / 2);
    if (fits) for (const k of need) taken.add(k);
    return fits;
  };
  const upper = (p: { y: number }) => roadRows.includes(p.y - 1);
  // Warehouses and shipyards: the first upper-row slot from a target index on whose covered slots are free.
  const big = new Map<number, "trading_post" | "warehouse" | "shipyard">();
  const targets: [number, "trading_post" | "warehouse" | "shipyard"][] = [
    [0, "trading_post"],
    [Math.floor(n / 3), "warehouse"],
    [Math.floor((2 * n) / 3), "warehouse"],
    [Math.max(0, n - 40), "warehouse"],
  ];
  // The first shipyard sits in the top row by the north coast: the island's harbour (berths, ship legs).
  for (let i = 4; i < n - 40; i += 52) targets.push([i, "shipyard"]);
  for (const [target, type] of targets) {
    for (let j = target; j < n; j++) {
      const p = chosen[j] as { x: number; y: number };
      if (!upper(p) || big.has(j) || taken.has(key(p.x, p.y))) continue;
      if (claim(p.x, p.y, type === "warehouse" ? 2 : type === "trading_post" ? 4 : 6, type === "warehouse" ? 2 : 4)) {
        big.set(j, type);
        break;
      }
    }
  }
  const buildings: BuildingDisplay[] = [];
  let lastWarehouse = firstId;
  let bid = firstId;
  chosen.forEach((p, i) => {
    const kind = big.get(i);
    if (!kind && taken.has(key(p.x, p.y))) return;
    const base = {
      id: bid,
      x: p.x,
      y: p.y,
      rotation: (upper(p) ? 180 : 0) as BuildingDisplay["rotation"],
      paused: false,
      paused_reason: "",
      status: "ok",
      efficiency_permille: 1000,
      throughput_factor_permille: 1000,
    } as BuildingDisplay;
    if (kind) {
      if (kind === "trading_post") {
        lastWarehouse = bid;
        buildings.push({ ...base, type: "trading_post", level: 1, capacity: 100_000 } as BuildingDisplay);
      } else if (kind === "warehouse") {
        lastWarehouse = bid;
        buildings.push({ ...base, type: "warehouse", level: 1 } as BuildingDisplay);
      } else buildings.push({ ...base, type: "shipyard" } as BuildingDisplay);
      bid++;
      return;
    }
    taken.add(key(p.x, p.y));
    if (i % 5 === 1) {
      // Producers: most deliver (a cart each); some are starved (status icon).
      const type = PRODUCERS[i % PRODUCERS.length] as string;
      const good = type === "lumberjack" ? "wood" : type === "sawmill" ? "planks" : "fish";
      const bad = i % 50 === 6;
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
      buildings.push({ ...base, type: "chapel" } as BuildingDisplay);
    } else {
      const unhappy = i % 17 === 0;
      buildings.push({ ...base, type: "house_settlers", status: unhappy ? "short_of_workers" : "ok", residents: 8_000 } as unknown as BuildingDisplay);
    }
    bid++;
  });
  // Eight fields of each type on the free grass columns west and east of
  // the road grid (the field layer's draw calls; the shown island stays
  // at ≈ 400 buildings).
  let fieldId = bid;
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
    population: { settlers: buildings.filter((b) => b.type === "house_settlers").length * 8_000 },
    capacity_source: null,
  } as IslandDisplay;
  const statics: Island = { id, width, height, revision: "fixture", terrain, fertilities: ["wheat"], deposits: denseDeposits(width, height) };
  return { display, statics };
}

export function buildDenseFixture(nowMs: number): Built {
  const a = denseIsland(DENSE_ISLAND, "Dense", 64, 50, DENSE_SLOTS, 1);
  const b = denseIsland("dense2", "Neighbour", 44, 30, 40, 1001);
  a.display.position = { x: 0, y: 0 };
  b.display.position = { x: 90, y: 12 };
  const leg = (from: string, to: string, offset: number) => ({
    from_island_id: from,
    from_position: null,
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
    position: null,
    queued_at: null,
    berth_until: null,
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

/** The second dense island of dense-archipelago-8. */
export const DENSE_ISLAND_2 = "dense2";

/**
 * dense-archipelago-8: the dense islands lie along the step-0 camera's
 * screen-up diagonal (+x −y), so that a phone viewport centred between
 * them at the upper end of the mid band has both in its footprint.
 */
export function buildDenseArchipelagoFixture(nowMs: number): Built {
  const dense1 = denseIsland(DENSE_ISLAND, "Dense", 64, 50, DENSE_SLOTS, 1);
  const dense2 = denseIsland(DENSE_ISLAND_2, "Dense 2", 64, 50, DENSE_SLOTS, 1001);
  dense1.display.position = { x: 10, y: 90 };
  dense2.display.position = { x: 100, y: 10 };
  const town5 = denseIsland("isle5", "Isle 5", 30, 34, 30, 2001);
  const town7 = denseIsland("isle7", "Isle 7", 48, 32, 30, 3001);
  town5.display.position = { x: 100, y: 90 };
  town7.display.position = { x: 110, y: 150 };
  const displays: IslandDisplay[] = [dense1.display, dense2.display, town5.display, town7.display];
  const statics = new Map<string, Island>([dense1, dense2, town5, town7].map((x) => [x.statics.id, x.statics]));
  // Four silhouette-only islands (no buildings), two of them unsettled.
  const light = [
    { id: "isle3", x: 0, y: 0, w: 40, h: 30, settled: false },
    { id: "isle4", x: 185, y: 15, w: 36, h: 36, settled: true },
    { id: "isle6", x: 170, y: 85, w: 40, h: 26, settled: true },
    { id: "isle8", x: 185, y: 140, w: 34, h: 30, settled: false },
  ];
  light.forEach((sp, i) => {
    const inventory: IslandDisplay["inventory"] = {};
    for (const g of DENSE_GOODS) inventory[g] = { stock: sp.settled ? 20_000 : 0, capacity: sp.settled ? 100_000 : 0, in_transit: 0, rate_per_min: 0 };
    displays.push({
      id: sp.id,
      name: `Isle ${sp.id.slice(4)}`,
      settled: sp.settled,
      position: { x: sp.x, y: sp.y },
      width: sp.w,
      height: sp.h,
      inventory,
      roads: [],
      buildings: [],
      workforce: {},
      population: {},
      capacity_source: null,
    } as IslandDisplay);
    statics.set(sp.id, { id: sp.id, width: sp.w, height: sp.h, revision: "fixture", terrain: terrain(sp.w, sp.h, 31 + i), fertilities: ["wheat"], deposits: [] });
  });
  const ids = [DENSE_ISLAND, DENSE_ISLAND_2, "isle5", "isle7", "isle4", "isle6"];
  const routes: RouteDisplay[] = [
    [DENSE_ISLAND, DENSE_ISLAND_2],
    [DENSE_ISLAND_2, "isle5", "isle7"],
  ].map((stops, i) => ({
    id: i + 1,
    name: `Route ${i + 1}`,
    stops: stops.map((s, j) => ({
      island_id: s,
      load: j === 0 ? [{ good: "planks", max_amount: 50_000 }] : [],
      unload: j === 0 ? [] : ["planks"],
    })),
    ship_ids: [],
    loop_ms: 900_000,
    effects: [],
  }));
  const ships: ShipDisplay[] = [];
  const r = rng(7);
  for (let n = 0; n < 12; n++) {
    const id = n + 1;
    const base: ShipDisplay = {
      id,
      type: "sloop",
      state: "idle",
      island_id: "",
      route_id: 0,
      stop_index: 0,
      leg: null,
      cargo: [{ good: "planks", amount: 20_000 }],
      slots: 2,
      slot_size: 50_000,
      upkeep_per_min: 1_000,
      paused: false,
      paused_reason: "",
      position: null,
      queued_at: null,
      berth_until: null,
    };
    if (n % 4 === 3) {
      ships.push({ ...base, island_id: ids[n % ids.length] as string });
      continue;
    }
    const route = routes[n % routes.length] as RouteDisplay;
    const k = n % route.stops.length;
    const from = route.stops[k]?.island_id as string;
    const to = route.stops[(k + 1) % route.stops.length]?.island_id as string;
    // Long legs with staggered starts keep ships moving during a measurement.
    const depart = nowMs - r() * 60_000;
    ships.push({
      ...base,
      state: "on_route",
      route_id: route.id,
      leg: { from_island_id: from, from_position: null, to_island_id: to, depart_at: ts(depart), arrive_at: ts(depart + 900_000 + r() * 300_000) },
    });
    route.ship_ids.push(id);
  }
  const display = {
    evaluated_at: ts(nowMs),
    next_change_at: null,
    gold: 5_000_000,
    balance_rate_per_min: 12_000,
    tax_rate_per_min: 60_000,
    upkeep_rate_per_min: 48_000,
    tiers: [{ id: "settlers", unlocked: true, population: {}, buildings: {}, goods_delivered: {} }],
    islands: displays,
    ships,
    routes,
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 12_000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return { server: { version: 1, display }, islands: statics, content: denseContent() };
}

/** The showcase island. */
export const SHOWCASE_ISLAND = "showcase";

/** Showcase terrain: water border, coast ring, grass; a forest belt and a rocky patch in the south. */
function showcaseTerrain(width: number, height: number): Terrain[] {
  const out: Terrain[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      let t: Terrain = edge === 0 ? "water" : edge === 1 ? "coast" : "grass";
      if (edge > 1 && y >= 20 && y <= 25 && x >= 3 && x <= 18) t = "forest";
      if (edge > 1 && y >= 21 && y <= 26 && x >= 30 && x <= 38) t = "mountain";
      // The harbour bay along the south coast: the water rows of the Trading Posts, the fisher and the shipyard.
      if (y >= height - 2 && x >= 2 && x <= 41) t = "water";
      out.push(t);
    }
  }
  return out;
}

/**
 * ?fixture=showcase: every model of the manifest on one island along
 * three roads, fronts toward the roads: houses of both tiers (6 each, so
 * every variant appears), all production, public and harbour buildings,
 * the Trading Post at levels 1–4 and Warehouses at 1–3 (the harbour ones on the south bay), a paused sawmill, a shipyard building a
 * sloop, 4 fields of each type, and three sloops at the berths (one with
 * cargo handling at the level-1 Trading Post's pier, one empty waiting for
 * that berth, one anchored_unpaid).
 */
export function buildShowcaseFixture(nowMs: number): Built {
  const width = 44;
  const height = 32;
  const roadRows = [8, 17];
  const roads: { x: number; y: number; type: string }[] = [];
  for (const y of roadRows) for (let x = 3; x <= 40; x++) roads.push({ x, y, type: y === 8 ? "road_dirt" : "road_paved" });
  for (let y = 9; y < 17; y++) roads.push({ x: 40, y, type: "road_dirt" });
  const placed: [type: string, x: number, y: number, rotation: number, extra?: Partial<BuildingDisplay>][] = [];
  // North of the first road (fronts down, rotation 0): houses and public buildings.
  for (let i = 0; i < 6; i++) placed.push(["house_settlers", 3 + 2 * i, 6, 0]);
  for (let i = 0; i < 6; i++) placed.push(["house_citizens", 15 + 2 * i, 6, 0]);
  placed.push(["chapel", 27, 6, 0], ["market_small", 29, 5, 0], ["tavern", 32, 5, 0]);
  // South of the first road (fronts up, rotation 180): production.
  ["lumberjack", "sawmill", "weaver_wool", "mill", "bakery", "cidery", "weaver_linen", "sailmaker", "charcoal_burner", "toolmaker"].forEach((t, i) =>
    placed.push([t, 3 + 2 * i, 9, 180, t === "sawmill" ? { paused: true, paused_reason: "player", status: "paused" } : {}]),
  );
  ["sheep_farm", "wheat_farm", "orchard", "hemp_farm"].forEach((t, i) => placed.push([t, 25 + 3 * i, 9, 180]));
  // North of the second road (fronts down): mining and smelting, the harbour buildings and the fields.
  placed.push(["quarry", 3, 14, 0], ["iron_mine", 6, 14, 0], ["smelter", 9, 14, 0]);
  placed.push(["warehouse", 13, 15, 0, { level: 1 }], ["warehouse", 16, 15, 0, { level: 2 }], ["warehouse", 19, 15, 0, { level: 3 }]);
  // South of the second road (fronts up, rotation 180), their water rows on the bay: the Trading Post at every level, the fisher and the shipyard.
  // The level-1 one is the island's: sloop 1 handles at its pier, sloop 2 waits for the berth.
  for (let level = 1; level <= 4; level++) {
    placed.push([
      "trading_post",
      2 + 5 * (level - 1),
      28,
      180,
      {
        level,
        capacity: [300_000, 500_000, 800_000, 1_200_000][level - 1],
        berths: level === 1 ? { total: 1, busy: 1, ships: [1], queue: [2] } : { total: level, busy: 0, ships: [], queue: [] },
      },
    ]);
  }
  placed.push(["fisher", 22, 30, 180]);
  placed.push(["shipyard", 25, 28, 180, { ship_order: { type: "sloop", ordered_at: ts(nowMs - 60_000), due_at: ts(nowMs + 60_000) } }]);
  ["pasture", "wheat_field", "orchard_plot", "hemp_field"].forEach((t, i) => {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      placed.push([t, 29 + 2 * i + dx, 14 + dy, 0]);
    }
  });
  const buildings: BuildingDisplay[] = placed.map(([type, x, y, rotation, extra = {}], i) => ({
    id: 5001 + i,
    type,
    x,
    y,
    rotation: rotation as BuildingDisplay["rotation"],
    paused: false,
    paused_reason: "",
    status: "ok",
    efficiency_permille: 1000,
    throughput_factor_permille: 1000,
    ...extra,
  }) as BuildingDisplay);
  const inventory: IslandDisplay["inventory"] = {};
  for (const g of DENSE_GOODS) inventory[g] = { stock: 40_000, capacity: 100_000, in_transit: 0, rate_per_min: 1_000 };
  const island = {
    id: SHOWCASE_ISLAND,
    name: "Showcase",
    settled: true,
    position: { x: 0, y: 0 },
    width,
    height,
    inventory,
    roads,
    buildings,
    workforce: {},
    population: { settlers: 48_000, citizens: 30_000 },
    capacity_source: null,
  } as IslandDisplay;
  const statics: Island = {
    id: SHOWCASE_ISLAND,
    width,
    height,
    revision: "fixture",
    terrain: showcaseTerrain(width, height),
    fertilities: ["wheat", "apple", "hemp"],
    // Under the quarry and the iron mine: their outcrops stay hidden (the models sit on rock).
    deposits: [
      { x: 4, y: 15, kind: "stone" },
      { x: 7, y: 15, kind: "iron" },
    ],
  };
  const ship = (id: number, extra: Partial<ShipDisplay>): ShipDisplay => ({
    id,
    type: "sloop",
    state: "idle",
    island_id: SHOWCASE_ISLAND,
    route_id: 0,
    stop_index: 0,
    leg: null,
    cargo: [],
    slots: 2,
    slot_size: 50_000,
    upkeep_per_min: 1_000,
    paused: false,
    paused_reason: "",
    position: null,
    queued_at: null,
    berth_until: null,
    ...extra,
  });
  const display = {
    evaluated_at: ts(nowMs),
    next_change_at: null,
    gold: 5_000_000,
    balance_rate_per_min: 12_000,
    tax_rate_per_min: 60_000,
    upkeep_rate_per_min: 48_000,
    tiers: [
      { id: "settlers", unlocked: true, population: {}, buildings: {}, goods_delivered: {} },
      { id: "citizens", unlocked: true, population: {}, buildings: {}, goods_delivered: {} },
    ],
    islands: [island],
    ships: [
      ship(1, { state: "manual_leg", cargo: [{ good: "planks", amount: 20_000 }], berth_until: ts(nowMs + 600_000) }),
      ship(2, { state: "waiting_for_berth", queued_at: ts(nowMs - 30_000) }),
      ship(3, { state: "anchored_unpaid", upkeep_per_min: 0, paused: true, paused_reason: "unpaid", cargo: [{ good: "fish", amount: 10_000 }] }),
    ],
    routes: [],
    // The anchored_unpaid sloop is the ship style under test; no insolvency banner over the showcase.
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 12_000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return { server: { version: 1, display }, islands: new Map([[SHOWCASE_ISLAND, statics]]), content: denseContent() };
}

/** A read-only data source with a fixture; commands are rejected. */
export class FixtureSync implements SyncLike {
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(id: FixtureId = ARCHIPELAGO_FIXTURE) {
    const built =
      id === DENSE_FIXTURE
        ? buildDenseFixture(Date.now())
        : id === DENSE_ARCHIPELAGO_FIXTURE
          ? buildDenseArchipelagoFixture(Date.now())
          : id === SHOWCASE_FIXTURE
            ? buildShowcaseFixture(Date.now())
            : buildArchipelagoFixture(Date.now());
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
