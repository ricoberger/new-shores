// Dev/E2E-only synthetic worlds, fed to the renderer without a server for
// performance measurements. Imported only behind the dev/E2E guard, so
// production builds tree-shake them away.
//
// ?fixture=archipelago-8x20: 8 islands, 2 skerries and 20 ships (idle, on_route,
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
// silhouette-only and two with 30 buildings, two skerries, ships on legs
// and 2 routes;
// the camera starts on the first dense island (the far and mid LOD
// budgets of the continuous world, D-048).
// ?fixture=showcase: one island with every building, field and ship model
// of the asset manifest (tier 1–2 content IDs): houses of both tiers in
// all variants, every Trading Post and Warehouse level, a paused building, fields of
// all four types, an anchored_unpaid sloop and sloops with and without
// cargo (the art gate's model showcase).
//
// Any other ?fixture= name is a server fixture (settled, citizens, played,
// …): the page asks the dev server to reset its world to it (POST
// /api/v1/dev/reset) and then opens the game as usual (Root.tsx).
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
import { rectsTouch } from "../display/fields";
import { encodeMask } from "../display/mask";
import { rotatedFootprint } from "../display/geometry";
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

/** Ship types of the fixtures (two, to see a list; real content has one so far). */
const FIXTURE_SHIPS = [
  { id: "sloop", name: "Sloop", slots: 2, slot_size: 50_000, speed_permille: 1000, build_ms: 120_000, upkeep_per_min: 1_000, cost: { gold: 100_000, materials: { planks: 20_000, sails: 10_000 } } },
  { id: "cutter", name: "Cutter", slots: 1, slot_size: 50_000, speed_permille: 1400, build_ms: 90_000, upkeep_per_min: 1_500, cost: { gold: 150_000, materials: { planks: 15_000, sails: 15_000 } } },
] as unknown as Content["ships"];

/** The fixture named in a location.search string, or null. */
export function fixtureFromSearch(search: string): FixtureId | null {
  const id = new URLSearchParams(search).get("fixture");
  return id === ARCHIPELAGO_FIXTURE || id === DENSE_FIXTURE || id === DENSE_ARCHIPELAGO_FIXTURE || id === SHOWCASE_FIXTURE ? id : null;
}

/**
 * A server fixture named in a location.search string: any `fixture=` value
 * the synthetic fixtures do not take (the dev server's reset endpoint
 * validates it against its one list, devworld.Fixtures), or null.
 */
export function serverFixtureFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("fixture");
  return id && fixtureFromSearch(search) === null ? id : null;
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

/**
 * Terrace levels and rock heights of a fixture island (D-058; Island.levels
 * and Island.heights): `level` per land tile, rock tiles (mountain) `rock`
 * levels above it; water and coast stay at level 0.
 */
function relief(width: number, height: number, terrain: readonly Terrain[], level: (x: number, y: number) => number, rock: (x: number, y: number) => number): Pick<Island, "levels" | "heights"> {
  let levels = "";
  let heights = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = terrain[y * width + x];
      const land = t !== "water" && t !== "coast";
      levels += land ? String(level(x, y)) : "0";
      heights += t === "mountain" ? String(rock(x, y)) : "0";
    }
  }
  return { levels, heights };
}

/** The relief of a round fixture island (terrain()): a level-1 plateau inland, the central mountain 2 levels of rock on it. */
function roundRelief(width: number, height: number, terrain: readonly Terrain[]): Pick<Island, "levels" | "heights"> {
  const inland = (x: number, y: number) => Math.hypot((x + 0.5 - width / 2) / (width / 2 - 1), (y + 0.5 - height / 2) / (height / 2 - 1)) < 0.6;
  return relief(width, height, terrain, (x, y) => (inland(x, y) ? 1 : 0), () => 2);
}

/**
 * A skerry of the fixtures (D-058 scenic size class): a few rock tiles with a
 * grass top in a water border, no name, never focused or a destination.
 */
function skerry(id: string, x: number, y: number): { display: IslandDisplay; statics: Island } {
  const width = 8;
  const height = 7;
  const shape = ["........", "........", "...gg...", "..gggg..", "...gg...", "........", "........"];
  const terrain: Terrain[] = shape.flatMap((row) => [...row].map((c): Terrain => (c === "g" ? "grass" : "water")));
  const display = {
    id,
    name: "",
    settled: false,
    position: { x, y },
    width,
    height,
    inventory: {},
    roads: [],
    buildings: [],
    workforce: {},
    population: {},
    capacity_source: null,
    size_class: "scenic",
    rock: false,
    scenic: true,
    ...NO_STATICS,
  } as IslandDisplay;
  const statics: Island = { id, width, height, revision: "fixture", terrain, ...relief(width, height, terrain, (tx, ty) => (tx >= 3 && tx <= 4 && ty === 3 ? 2 : 1), () => 0), fertilities: [], deposits: [] };
  return { display, statics };
}

interface Built {
  server: WorldResponse;
  islands: Map<string, Island>;
  content: Content;
}

const ts = (ms: number) => new Date(ms).toISOString();

/** Placeholders of the static display fields; fillStatics sets them from the rows. */
const NO_STATICS = { fertilities: [], deposits: [], terrain_mask: "" } satisfies Pick<IslandDisplay, "fertilities" | "deposits" | "terrain_mask">;

/**
 * Sets the static display fields of a fixture's islands as the server
 * does: fertilities and deposits from the island's static data, the 1:4
 * terrain mask from its rows.
 */
function fillStatics(built: Built): Built {
  for (const is of built.server.display.islands) {
    const st = built.islands.get(is.id);
    if (!st) continue;
    is.fertilities = [...st.fertilities];
    is.deposits = st.deposits.map((d) => ({ ...d }));
    is.terrain_mask = encodeMask(st);
  }
  return built;
}

/** The display archipelago of a hand-made fixture: no seed, the islands' bounds (as the server computes them). */
function handMadeArchipelago(islands: readonly Pick<IslandDisplay, "position" | "width" | "height">[]): DisplayState["archipelago"] {
  const x0 = Math.min(...islands.map((is) => is.position.x));
  const y0 = Math.min(...islands.map((is) => is.position.y));
  const x1 = Math.max(...islands.map((is) => is.position.x + is.width));
  const y1 = Math.max(...islands.map((is) => is.position.y + is.height));
  return { seed: 0, roll: 0, rerollable: false, bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

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
      inventory[g] = { stock: settled ? ((i + 1) * (j + 2) * 7000) % 300_000 : 0, capacity: settled ? 300_000 : 0, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: 0 };
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
      size_class: "",
      rock: false,
      scenic: false,
      ...NO_STATICS,
    });
    statics.set(id, {
      id,
      width: sp.w,
      height: sp.h,
      revision: "fixture",
      terrain: terrain(sp.w, sp.h, 17 + i),
      ...roundRelief(sp.w, sp.h, terrain(sp.w, sp.h, 17 + i)),
      fertilities: i % 2 === 0 ? ["wheat"] : ["apples", "hops"],
      deposits: i % 3 === 0 ? [{ x: Math.floor(sp.w / 2), y: Math.floor(sp.h / 2), kind: "stone" }] : [],
    });
  });
  // Two skerries (D-058): land on the minimap and the far view, never a stop.
  for (const sk of [skerry("skerry1", 125, 45), skerry("skerry2", 88, 135)]) {
    islands.push(sk.display);
    statics.set(sk.display.id, sk.statics);
  }
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
    paths: stops.map(() => []),
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
      name: `Sloop ${id}`,
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
    archipelago: handMadeArchipelago(islands),
    last_seen_at: ts(nowMs),
  } as DisplayState;
  const content = {
    region: { id: "fixture", name: "Fixture", version: "fixture", camera: { max_half_extent: 120 } },
    quests: [],
    tiers: [],
    goods: GOODS.map((g) => ({ id: g, name: g[0]?.toUpperCase() + g.slice(1) })),
    // The Trading Post's cost: the idle ships with planks can found an unsettled island.
    buildings: fixtureDefs().filter((b) => b.id === "trading_post"),
    needs: [],
    ships: FIXTURE_SHIPS,
  } as unknown as Content;
  return fillStatics({ server: { version: 1, display }, islands: statics, content });
}

/** The (first) dense island of dense-2x400 and dense-archipelago-8. */
export const DENSE_ISLAND = "dense1";
const DENSE_GOODS = ["wood", "planks", "fish", "tools"];

/** The field building a farm type owns in the fixture content: its type and footprint. */
const FIELD_OF: Record<string, { type: string; size: number }> = {
  sheep_farm: { type: "pasture", size: 2 },
  wheat_farm: { type: "wheat_field", size: 1 },
  orchard: { type: "orchard_plot", size: 1 },
  hemp_farm: { type: "hemp_field", size: 1 },
};

interface Placed {
  x: number;
  y: number;
}

/**
 * Lays `count` fields of a farm as an adjacency chain (D-051 part 4): each
 * one touches the farm or an earlier field of it (nearest to the farm's
 * centre first, row-major on ties) on free grass inside `bounds`. `taken`
 * holds the tiles already used and gets the new fields' tiles. Synthetic
 * display data for the dev fixtures only, not a game rule.
 */
function chainFields(farm: { x: number; y: number }, farmType: string, count: number, taken: Set<string>, grass: (x: number, y: number) => boolean, bounds: { x0: number; y0: number; x1: number; y1: number }): Placed[] {
  const size = FIELD_OF[farmType]?.size ?? 1;
  const rects = [{ x: farm.x, y: farm.y, w: 3, h: 3 }];
  const out: Placed[] = [];
  for (let n = 0; n < count; n++) {
    let best: (Placed & { d: number }) | null = null;
    for (let y = bounds.y0; y + size - 1 <= bounds.y1; y++) {
      for (let x = bounds.x0; x + size - 1 <= bounds.x1; x++) {
        let free = true;
        for (let dy = 0; dy < size && free; dy++) for (let dx = 0; dx < size && free; dx++) free = grass(x + dx, y + dy) && !taken.has(`${x + dx},${y + dy}`);
        if (!free || !rects.some((r) => rectsTouch(r, { x, y, w: size, h: size }))) continue;
        const d = (x + size / 2 - (farm.x + 1.5)) ** 2 + (y + size / 2 - (farm.y + 1.5)) ** 2;
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (!best) break;
    out.push({ x: best.x, y: best.y });
    rects.push({ x: best.x, y: best.y, w: size, h: size });
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) taken.add(`${best.x + dx},${best.y + dy}`);
  }
  return out;
}

/** The display of a farm's fields: its `fields` block and one field display per chained field (all active). */
function farmWithFields(base: BuildingDisplay, ids: number[], required: number, max: number): BuildingDisplay {
  return { ...base, status: ids.length >= required ? "ok" : "low_efficiency", efficiency_permille: Math.min(1000, Math.floor((ids.length * 1000) / required)), fields: { active: ids.length, required, max, ids } } as BuildingDisplay;
}

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
        // The shipped content's levels and upgrade costs (fixture.test.ts compares them).
        levels: [
          { capacity: 300_000, throughput_per_min: 30_000, berths: 1 },
          { capacity: 500_000, throughput_per_min: 55_000, berths: 2, cost: { gold: 300_000, materials: { planks: 20_000, stone: 10_000 } } },
          { capacity: 800_000, throughput_per_min: 80_000, berths: 3, cost: { gold: 600_000, materials: { planks: 30_000, stone: 20_000 } } },
          {
            capacity: 1_200_000,
            throughput_per_min: 110_000,
            berths: 4,
            cost: { gold: 1_200_000, materials: { planks: 40_000, stone: 30_000, tools: 10_000 } },
          },
        ],
      },
    },
  ],
  [
    "warehouse",
    "Warehouse",
    "settlers",
    "production",
    2,
    2,
    {
      requires_road: false,
      warehouse: {
        levels: [
          { throughput_per_min: 30_000 },
          { throughput_per_min: 55_000, cost: { gold: 150_000, materials: { planks: 10_000, stone: 5_000 } } },
          { throughput_per_min: 80_000, cost: { gold: 300_000, materials: { planks: 15_000, stone: 10_000 } } },
        ],
      },
    },
  ],
  ["market", "Market", "settlers", "public", 3, 3, { service: { radius: 10 } }],
  ["chapel", "Chapel", "settlers", "public", 2, 2, { service: { radius: 10 } }],
  ["lumberjack", "Lumberjack", "settlers", "production", 2, 2, { work_area: { radius: 4, terrain: ["forest"] }, fields: { type: "tree_plot", required: 1, max: 2 } }],
  ["tree_plot", "Tree plot", "settlers", "production", 1, 1, { requires_road: false, cost: { gold: 1000, materials: {} }, field: { type: "tree_plot", farm: "lumberjack", terrain: ["grass", "forest"] } }],
  ["sawmill", "Sawmill", "settlers", "production", 2, 2],
  ["fisher", "Fisher", "settlers", "production", 2, 2, { water_tiles: 1, boat: true }],
  ["sheep_farm", "Sheep farm", "settlers", "production", 3, 3, { fields: { type: "pasture", required: 4, max: 4 } }],
  ["pasture", "Pasture", "settlers", "production", 2, 2, { requires_road: false, cost: { gold: 15_000, materials: {} }, field: { type: "pasture", farm: "sheep_farm", terrain: ["grass"] } }],
  ["weaver_wool", "Wool weaver", "settlers", "production", 2, 2],
  ["shipyard", "Shipyard", "settlers", "harbour", 5, 4, { water_tiles: 2, shipyard: { ships: ["sloop", "cutter"] } }],
  ["house_citizens", "Citizen house", "citizens", "houses", 2, 2, { house: { tier: "citizens" } }],
  ["road_paved", "Paved road", "citizens", "roads", 1, 1, { road: { ms_per_tile: 350 } }],
  ["tavern", "Tavern", "citizens", "public", 3, 3, { service: { radius: 10 } }],
  ["wheat_farm", "Wheat farm", "citizens", "production", 3, 3, { fields: { type: "wheat_field", required: 16, max: 16 } }],
  ["wheat_field", "Wheat field", "citizens", "production", 1, 1, { requires_road: false, cost: { gold: 5_000, materials: {} }, field: { type: "wheat_field", farm: "wheat_farm", terrain: ["grass"] } }],
  ["mill", "Mill", "citizens", "production", 2, 2],
  ["bakery", "Bakery", "citizens", "production", 2, 2],
  ["orchard", "Orchard", "citizens", "production", 3, 3, { fields: { type: "orchard_plot", required: 16, max: 16 } }],
  ["orchard_plot", "Orchard plot", "citizens", "production", 1, 1, { requires_road: false, cost: { gold: 5_000, materials: {} }, field: { type: "orchard_plot", farm: "orchard", terrain: ["grass"] } }],
  ["cidery", "Cidery", "citizens", "production", 2, 2],
  ["hemp_farm", "Hemp farm", "citizens", "production", 3, 3, { fields: { type: "hemp_field", required: 16, max: 16 } }],
  ["hemp_field", "Hemp field", "citizens", "production", 1, 1, { requires_road: false, cost: { gold: 5_000, materials: {} }, field: { type: "hemp_field", farm: "hemp_farm", terrain: ["grass"] } }],
  ["weaver_linen", "Linen weaver", "citizens", "production", 2, 2],
  ["sailmaker", "Sailmaker", "citizens", "production", 2, 2],
  ["quarry", "Quarry", "citizens", "production", 3, 3, { requires_deposit: "stone" }],
  ["iron_mine", "Iron mine", "citizens", "production", 3, 3, { requires_deposit: "iron" }],
  ["charcoal_burner", "Charcoal burner", "citizens", "production", 2, 2],
  ["smelter", "Smelter", "citizens", "production", 3, 3],
  ["toolmaker", "Toolmaker", "citizens", "production", 2, 2],
];

/** The fixture building definitions (exported for the content cross-check). */
export function fixtureDefs(): { id: string; tier: string; category: string; width: number; height: number; field?: { type: string; farm: string }; requires_deposit?: string }[] {
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
    pause_category: category === "houses" || "field" in extra || "shipyard" in extra || "warehouse" in extra || "trading_post" in extra ? "never" : "production",
    ...(category === "production" && !("field" in extra) && !("warehouse" in extra) ? { recipe: { inputs: [], outputs: [{ good: "planks", amount: 1_000 }], cycle_ms: 20_000 } } : {}),
    ...extra,
  }));
}

/** Content of the dense and showcase fixtures. */
function denseContent(): Content {
  return {
    region: { id: "fixture", name: "Fixture", version: "fixture", camera: { max_half_extent: 120 } },
    quests: [],
    tiers: [
      { id: "settlers", name: "Settlers" },
      { id: "citizens", name: "Citizens" },
    ],
    goods: DENSE_GOODS.map((g) => ({ id: g, name: g[0]?.toUpperCase() + g.slice(1) })),
    buildings: fixtureDefs(),
    needs: [],
    ships: FIXTURE_SHIPS,
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
  // A farm cluster (D-051 part 4) replaces the slots of a block in the first
  // building band of the large dense islands.
  const cluster = width >= 60 && height >= 50 ? { x: 40, y: 5, w: 20, h: 4 } : null;
  const slots: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < roadRows.length; i++) {
    const r = roadRows[i] as number;
    for (const y of [r + 1, r + 3]) {
      for (let x = minX + 1; x + 1 < maxX; x += 2) {
        if (cluster && x + 2 > cluster.x && x < cluster.x + cluster.w && y + 2 > cluster.y && y < cluster.y + cluster.h) continue;
        slots.push({ x, y });
      }
    }
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
      buildings.push({ ...base, type: "house_settlers", status: unhappy ? "short_of_workers" : "ok", residents: 8_000, upgrade: { available: true } } as unknown as BuildingDisplay);
    }
    bid++;
  });
  const terrain = blockTerrain(width, height);
  if (cluster) {
    // A sheep farm with four 2 × 2 pastures and a wheat farm with sixteen
    // wheat fields, each field chained to its farm (the field layer's draw
    // calls and the chain highlight; the shown island stays at ≈ 400 buildings).
    const taken = new Set<string>();
    for (const b of buildings) {
      const w = b.type === "trading_post" ? 4 : b.type === "shipyard" ? 6 : 2;
      const h = b.type === "trading_post" || b.type === "shipyard" ? 4 : 2;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) taken.add(`${b.x + dx},${b.y + dy}`);
    }
    for (const r of roads) taken.add(`${r.x},${r.y}`);
    const grass = (x: number, y: number) => terrain[y * width + x] === "grass";
    const bounds = { x0: cluster.x, y0: cluster.y, x1: cluster.x + cluster.w - 1, y1: cluster.y + cluster.h - 1 };
    let nextId = bid;
    for (const [farmType, farmX, count, required, max] of [
      ["sheep_farm", 41, 4, 4, 4],
      ["wheat_farm", 50, 16, 16, 16],
    ] as const) {
      const farmId = nextId++;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) taken.add(`${farmX + dx},${cluster.y + dy}`);
      const fieldType = (FIELD_OF[farmType] as { type: string; size: number }).type;
      const laid = chainFields({ x: farmX, y: cluster.y }, farmType, count, taken, grass, bounds);
      const ids = laid.map(() => nextId++);
      buildings.push(
        farmWithFields(
          {
            id: farmId,
            type: farmType,
            x: farmX,
            y: cluster.y,
            rotation: 180,
            paused: false,
            paused_reason: "",
            status: "ok",
            efficiency_permille: 1000,
            throughput_factor_permille: 1000,
          } as BuildingDisplay,
          ids,
          required,
          max,
        ),
      );
      laid.forEach((p, i) =>
        buildings.push({
          id: ids[i] as number,
          type: fieldType,
          x: p.x,
          y: p.y,
          rotation: 0,
          paused: false,
          paused_reason: "",
          status: "ok",
          efficiency_permille: 1000,
          throughput_factor_permille: 1000,
          farm_id: farmId,
          active: true,
        } as BuildingDisplay),
      );
    }
  }
  const inventory: IslandDisplay["inventory"] = {};
  for (const g of DENSE_GOODS) inventory[g] = { stock: 40_000, capacity: 100_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: 1_000 };
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
    size_class: "",
    rock: false,
    scenic: false,
    ...NO_STATICS,
  } as IslandDisplay;
  // The town stays on level 0; the forest belt and the headland below it are a level-1 terrace, the headland's rock 2 levels on it (D-058).
  const below = belowTown(height);
  const z = denseZones(width);
  const terrace = (x: number, y: number) => (y > below && x > z.forest[0] && x < z.rock[1] && y < height - 3 ? 1 : 0);
  const statics: Island = { id, width, height, revision: "fixture", terrain, ...relief(width, height, terrain, terrace, () => 2), fertilities: ["wheat"], deposits: denseDeposits(width, height) };
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
    name: `Sloop ${id}`,
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
    tiers: [{ id: "settlers", unlocked: true, population: {}, buildings: {} }],
    islands: [a.display, b.display],
    ships: [ship(1, DENSE_ISLAND, "dense2", 60_000), ship(2, "dense2", DENSE_ISLAND, 300_000)],
    routes: [],
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 12_000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    archipelago: handMadeArchipelago([a.display, b.display]),
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return fillStatics({
    server: { version: 1, display },
    islands: new Map([
      [a.statics.id, a.statics],
      [b.statics.id, b.statics],
    ]),
    content: denseContent(),
  });
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
    for (const g of DENSE_GOODS) inventory[g] = { stock: sp.settled ? 20_000 : 0, capacity: sp.settled ? 100_000 : 0, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: 0 };
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
      size_class: "",
      rock: false,
      scenic: false,
      ...NO_STATICS,
    } as IslandDisplay);
    const t = terrain(sp.w, sp.h, 31 + i);
    statics.set(sp.id, { id: sp.id, width: sp.w, height: sp.h, revision: "fixture", terrain: t, ...roundRelief(sp.w, sp.h, t), fertilities: ["wheat"], deposits: [] });
  });
  // Two skerries (D-058) between the towns.
  for (const sk of [skerry("skerry1", 140, 128), skerry("skerry2", 60, 50)]) {
    displays.push(sk.display);
    statics.set(sk.display.id, sk.statics);
  }
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
    paths: stops.map(() => []),
    effects: [],
  }));
  const ships: ShipDisplay[] = [];
  const r = rng(7);
  for (let n = 0; n < 12; n++) {
    const id = n + 1;
    const base: ShipDisplay = {
      id,
      type: "sloop",
      name: `Sloop ${id}`,
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
    tiers: [{ id: "settlers", unlocked: true, population: {}, buildings: {} }],
    islands: displays,
    ships,
    routes,
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 12_000 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    archipelago: handMadeArchipelago(displays),
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return fillStatics({ server: { version: 1, display }, islands: statics, content: denseContent() });
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
  // The service buildings follow the 12 houses: chapel 5013, market 5014, tavern 5015 (the server's `served_by`).
  const house = (served_by: number[]): Partial<BuildingDisplay> => ({
    residents: 8_000,
    residents_floor: 2_000,
    residents_max: 8_000,
    upgrade: { available: true },
    growth_rate_per_min: 0,
    satisfaction_permille: 800,
    served_by,
    needs: [],
  });
  for (let i = 0; i < 6; i++) placed.push(["house_settlers", 3 + 2 * i, 6, 0, house(i < 2 ? [5013] : [5013, 5014])]);
  for (let i = 0; i < 6; i++) placed.push(["house_citizens", 15 + 2 * i, 6, 0, house(i < 4 ? [5013, 5014, 5015] : [5014, 5015])]);
  placed.push(["chapel", 27, 6, 0], ["market", 29, 5, 0], ["tavern", 32, 5, 0]);
  // South of the first road (fronts up, rotation 180): production.
  ["lumberjack", "sawmill", "weaver_wool", "mill", "bakery", "cidery", "weaver_linen", "sailmaker", "charcoal_burner", "toolmaker"].forEach((t, i) =>
    placed.push([t, 3 + 2 * i, 9, 180, t === "sawmill" ? { paused: true, paused_reason: "player", status: "paused" } : {}]),
  );
  ["sheep_farm", "wheat_farm", "orchard", "hemp_farm"].forEach((t, i) => placed.push([t, 25 + 3 * i, 9, 180]));
  // North of the second road (fronts down): mining and smelting, the harbour buildings and the fields.
  placed.push(["quarry", 3, 14, 0], ["iron_mine", 6, 14, 0], ["smelter", 9, 14, 0]);
  placed.push(
    ["warehouse", 13, 15, 0, { level: 1, throughput_per_min: 30_000, load_permille: 400 }],
    ["warehouse", 16, 15, 0, { level: 2, throughput_per_min: 55_000, load_permille: 400 }],
    ["warehouse", 19, 15, 0, { level: 3, throughput_per_min: 80_000, load_permille: 400 }],
  );
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
        throughput_per_min: [30_000, 55_000, 80_000, 110_000][level - 1],
        load_permille: 400,
        berths: level === 1 ? { total: 1, busy: 1, ships: [1], queue: [2] } : { total: level, busy: 0, ships: [], queue: [] },
      },
    ]);
  }
  placed.push(["fisher", 22, 30, 180]);
  placed.push(["shipyard", 25, 28, 180, { ship_order: { type: "sloop", ordered_at: ts(nowMs - 60_000), due_at: ts(nowMs + 60_000) } }]);
  // The fields south of the farms: four chained fields each (D-051 part 4),
  // laid nearest to their farm first on the free grass between the roads.
  const terrain = showcaseTerrain(width, height);
  const sizes = new Map(fixtureDefs().map((d) => [d.id, d]));
  const taken = new Set<string>(roads.map((r) => `${r.x},${r.y}`));
  for (const [type, x, y, rotation] of placed) {
    const d = sizes.get(type);
    if (!d) continue;
    const [w, h] = rotatedFootprint(d.width, d.height, rotation);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) taken.add(`${x + dx},${y + dy}`);
  }
  const grass = (x: number, y: number) => terrain[y * width + x] === "grass";
  // The lumberjack's single tree plot lies south of it (fields chain to the farm's edge).
  const lumberjack = placed.findIndex((p) => p[0] === "lumberjack");
  const lj = placed[lumberjack] as (typeof placed)[number];
  placed.push(["tree_plot", lj[1], lj[2] + 2, 0, { farm_id: 5001 + lumberjack, active: true }]);
  lj[4] = { fields: { active: 1, required: 1, max: 2, ids: [5001 + placed.length - 1] }, status: "ok", efficiency_permille: 1000 };
  for (const farmType of ["wheat_farm", "orchard", "hemp_farm", "sheep_farm"]) {
    const farmIndex = placed.findIndex((p) => p[0] === farmType);
    const farm = placed[farmIndex] as (typeof placed)[number];
    const field = FIELD_OF[farmType] as { type: string; size: number };
    const laid = chainFields({ x: farm[1], y: farm[2] }, farmType, 4, taken, grass, { x0: 21, y0: 12, x1: 39, y1: 16 });
    const ids = laid.map((p) => {
      placed.push([field.type, p.x, p.y, 0, { farm_id: 5001 + farmIndex, active: true }]);
      return 5001 + placed.length - 1;
    });
    const def = fixtureDefs().find((d) => d.id === farmType) as unknown as { fields: { required: number; max: number } };
    farm[4] = { fields: { active: ids.length, required: def.fields.required, max: def.fields.max, ids }, status: ids.length >= def.fields.required ? "ok" : "low_efficiency", efficiency_permille: Math.min(1000, Math.floor((ids.length * 1000) / def.fields.required)) };
  }
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
  // Net rates of all three signs (green, plain, red) in the Trading Post card.
  DENSE_GOODS.forEach((g, i) => (inventory[g] = { stock: 40_000, capacity: 100_000, in_transit: 0, in_transit_rate_per_min: 0, rate_per_min: [1_500, 0, -2_000][i % 3] as number }));
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
    size_class: "",
    rock: false,
    scenic: false,
    ...NO_STATICS,
  } as IslandDisplay;
  const statics: Island = {
    id: SHOWCASE_ISLAND,
    width,
    height,
    revision: "fixture",
    terrain,
    // The forest and the mountain on a level-1 terrace, the mountain's rock 2 levels on it (D-058).
    ...relief(width, height, terrain, (x, y) => (y >= 20 && y <= 26 && ((x >= 3 && x <= 18) || (x >= 30 && x <= 38)) ? 1 : 0), (x, y) => (x >= 32 && x <= 36 && y >= 22 && y <= 25 ? 3 : 2)),
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
    name: `Sloop ${id}`,
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
      { id: "settlers", unlocked: true, population: {}, buildings: {} },
      { id: "citizens", unlocked: true, population: {}, buildings: {} },
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
    archipelago: handMadeArchipelago([island]),
    last_seen_at: ts(nowMs),
  } as unknown as DisplayState;
  return fillStatics({ server: { version: 1, display }, islands: new Map([[SHOWCASE_ISLAND, statics]]), content: denseContent() });
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
