// Shared E2E settings and dev-island coordinates. The coordinates come from
// the committed dev island (server/internal/devworld/island.json); the Go
// test TestSmokeLayoutProducesPlanks checks the same layout.
export const API_PORT = 18080;
export const WEB_PORT = 4174;
/** World seconds per wall-clock second for the E2E run (server and client). */
export const E2E_TIME_SCALE = 10;
/** Command of the e2e dev server (run in ../server): in-memory world, the committed content. */
export const API_SERVER_COMMAND = `go run ./cmd/server --dev --content ../content/old_coast --addr :${API_PORT} --cors-origin http://localhost:${WEB_PORT} --time-scale ${E2E_TIME_SCALE}`;
/** Command of the e2e client (run in the client directory): a production build with the test hook, served by `vite preview`. */
export const WEB_SERVER_COMMAND = `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`;

export const ISLAND = "start";
/**
 * The default fixture founded the start island from the start sloop
 * (D-051): its Trading Post at (2,0) rotation 0 (x 2..5, y 0..3; rows 0–1
 * over the bay); the road starts below it.
 */
export const ROAD_FROM = { x: 3, y: 4 };
/** Forest edge (the forest starts at x = 34 from row 5). */
export const ROAD_TO = { x: 36, y: 4 };
/** Settler house below the road (x 8..9, y 5..6), touching it with its top edge. */
export const HOUSE = { x: 8, y: 5, rotation: 180 };
/** Lumberjack in the forest (x 35..36, y 5..6), placed before the road reaches it. */
export const LUMBERJACK = { x: 35, y: 5, rotation: 180 };
/** Sawmill below the road (x 20..21, y 5..6). */
export const SAWMILL = { x: 20, y: 5, rotation: 180 };
/** Move targets below the road (D-042): footprints still touch the road. */
export const HOUSE_MOVED = { x: 11, y: 5 };
export const SAWMILL_MOVED = { x: 24, y: 5 };
/** Three more settler houses below the road for the houses quest (four houses in all). */
export const QUEST_HOUSES = [
  { x: 14, y: 5 },
  { x: 16, y: 5 },
  { x: 18, y: 5 },
];
/** A land tile of the founded Trading Post (x 2..5, y 0..3). */
export const TRADING_POST_TILE = { x: 3, y: 2 };
/** A water tile (invalid placement). */
export const WATER = { x: 0, y: 0 };
/**
 * Gold of the default fixture right after founding: start.json's 1 000
 * minus the Trading Post's 200 (no dev-only bonus); the start sloop's
 * upkeep (1/min of world time) lowers it from there.
 */
export const START_GOLD = 800;
export const CONTENT_VERSION = "old_coast-0.8.0";

// Shipping (voyage.spec.ts; the Go test TestShippingLayoutFoundsIsland2
// checks the same layout): a road from below the Trading Post down the west
// side to the south coast connects a shipyard on the south coast.
/** Vertical road (x = 2) from below the Trading Post to the south coast. */
export const SHIP_ROAD_FROM = { x: 2, y: 4 };
export const SHIP_ROAD_TO = { x: 2, y: 34 };
/** Two more tiles east to touch the shipyard's west edge. */
export const SHIP_ROAD_SPUR_FROM = { x: 3, y: 34 };
export const SHIP_ROAD_SPUR_TO = { x: 4, y: 34 };
/** Shipyard 5×4 at (5,34) facing south (rotation 180): x 5..9, y 34..37, rows 36–37 over the south bay. */
export const SHIPYARD = { x: 5, y: 34, rotation: 180 };
/** The unsettled island 2 and its Trading Post site (x 2..5, y 0..3; rows 0–1 over the water). */
export const ISLAND2 = "island2";
export const ISLAND2_TRADING_POST = { x: 2, y: 0 };
/** Planks shipped to island 2: the Trading Post's 15 plus 45. */
export const SHIPMENT_PLANKS = 60;
/** Planks the Trading Post founded on island 2 takes from the cargo. */
export const TRADING_POST_PLANKS = 15;
/** Island 2 layout after founding: road y = 4, two houses and a fisher on it. */
export const ISLAND2_ROAD_FROM = { x: 2, y: 4 };
export const ISLAND2_ROAD_TO = { x: 20, y: 4 };
export const ISLAND2_HOUSES = [
  { x: 8, y: 5 },
  { x: 10, y: 5 },
];
/** The fisher on island 2's notch (x 12..13, y 2..3; row 2 over the water). */
export const ISLAND2_FISHER = { x: 12, y: 2 };

// Start at sea (seafaring.spec.ts, D-051): the seafaring fixture's start
// sloop (ship 1) at sea at (30, 48) with the starting stock aboard.
export const START_SHIP = 1;
export const START_SEA = { x: 30, y: 48 };
/** The start island's Trading Post site of the start flow: (2,0) like the default fixture. */
export const START_TRADING_POST = { x: 2, y: 0 };
/** A land site for the water-edge ghost (its front rows on grass): red with the reason. */
export const LAND_SITE = { x: 10, y: 8 };

/**
 * Wheel ticks (deltaY 300 each) that zoom out from the near default (half
 * extent 18) so that the whole start island is on a desktop screen while
 * the camera stays at near LOD (buildings pickable): one tick is a factor
 * exp(300 × 0.0015) ≈ 1.57, half extent 28.2 < NEAR_EXIT_HALF (30,
 * client/src/display/lod.ts). Two more ticks reach mid and far LOD.
 */
export const ISLAND_ZOOM_OUT_TICKS = 1;

// Island taps (archipelago.spec.ts, voyage.spec.ts): tiles to click on the
// islands, away from their centre (name label) and berths.
/** A grass tile of the start island. */
export const ISLAND_INLAND = { x: 10, y: 10 };
/** A grass tile of island 2. */
export const ISLAND2_INLAND = { x: 8, y: 8 };
/** Open sea between the islands, in start-island tile (= archipelago) coordinates. */
export const SEA_BETWEEN = { x: 62, y: 66 };

// Touch projects (touch.spec.ts) start from the settled fixture: free
// grass north-west of the forest of the start island, one area per
// browser project, away from the fixture's layout. The phone
// view is centred on TOUCH_FOCUS first, which brings these tiles and the
// sawmill on screen.
export const TOUCH_FOCUS = { x: 20, y: 12 };
/** Pixel 5 (Chromium): settler house placed by tap + Confirm (x 18..19, y 12..13). */
export const TOUCH_HOUSE = { x: 18, y: 12 };
/** Its move target (x 18..19, y 15..16). */
export const TOUCH_HOUSE_MOVED = { x: 18, y: 15 };
/** A road drawn with one finger (y = 19, x 12..20). */
export const TOUCH_ROAD_FROM = { x: 12, y: 19 };
export const TOUCH_ROAD_TO = { x: 20, y: 19 };
/** iPhone 12 (WebKit): settler house placed by tap + Confirm (x 22..23, y 12..13). */
export const TOUCH_HOUSE_WEBKIT = { x: 22, y: 12 };
/** Grass with nothing on it (a tap there with a tool positions only). */
export const TOUCH_EMPTY = { x: 16, y: 16 };

// Fields (D-051 part 4, smoke.spec.ts and touch.spec.ts): a sheep farm below
// the road east of the moved sawmill (x 28..30, y 5..7), its top edge on the
// road. Its 2 × 2 pastures chain from it: P1 at (31,5) touches the farm, P2
// at (32,7) touches only P1, P3 at (26,5) and P4 at (28,8) touch the farm
// (the forest starts at x = 34). (20,9) touches nothing. Demolishing P1
// leaves P2 inactive.
export const SHEEP_FARM = { x: 28, y: 5, rotation: 0 };
export const PASTURE_CHAIN = [
  { x: 31, y: 5 },
  { x: 32, y: 7 },
  { x: 26, y: 5 },
  { x: 28, y: 8 },
];
export const PASTURE_NOT_ADJACENT = { x: 20, y: 9 };
/** Touch project (Pixel 5, settled fixture: the farm has four pastures at (26,6), (31,6), (28,8), (30,8)): a fifth touching (30,8). */
export const TOUCH_PASTURE = { x: 32, y: 8 };
/** A grass tile touching neither the farm nor a pasture. */
export const TOUCH_FAR = { x: 31, y: 12 };

// Camera rotation (archipelago.spec.ts): one settler house (2 × 2, 10
// planks) placed by a click at each of four camera headings (0°, 45°,
// 135°, 225° from the default),
// with building rotation step × 90°, on free grass of the start island
// (x 12..19, y 23..24) reserved for this test; no other spec builds there.
export const ROTATION_HOUSES = [
  { x: 12, y: 23 },
  { x: 14, y: 23 },
  { x: 16, y: 23 },
  { x: 18, y: 23 },
];
