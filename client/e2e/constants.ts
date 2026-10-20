// Shared E2E settings and dev-island coordinates. The coordinates come from
// the committed dev island (server/internal/devworld/island.json); the Go
// test TestSmokeLayoutProducesPlanks checks the same layout.
export const API_PORT = 18080;
export const WEB_PORT = 4174;
/** World seconds per wall-clock second for the E2E run (server and client). */
export const E2E_TIME_SCALE = 10;

export const ISLAND = "start";
/** Warehouse at (2,1) rotation 0 (x 2..5, y 1..3); the road starts below it. */
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
/** A tile of the seeded warehouse (x 2..5, y 1..3). */
export const WAREHOUSE_TILE = { x: 3, y: 2 };
/** A water tile (invalid placement). */
export const WATER = { x: 0, y: 0 };
/** Gold of the dev world: start.json (no dev-only bonus since the tier 1–2 balancing pass). */
export const START_GOLD = 800;
export const CONTENT_VERSION = "old_coast-0.5.0";

// Shipping (voyage.spec.ts; the Go test TestShippingLayoutFoundsIsland2
// checks the same layout): a road from below the warehouse down the west
// side to the south coast connects a shipyard on the south coast.
/** Vertical road (x = 2) from below the warehouse to the south coast. */
export const SHIP_ROAD_FROM = { x: 2, y: 4 };
export const SHIP_ROAD_TO = { x: 2, y: 34 };
/** Two more tiles east to touch the shipyard's west edge. */
export const SHIP_ROAD_SPUR_FROM = { x: 3, y: 34 };
export const SHIP_ROAD_SPUR_TO = { x: 4, y: 34 };
/** Shipyard 5×4 at (5,34): x 5..9, y 34..37 (row 37 is coast). */
export const SHIPYARD = { x: 5, y: 34, rotation: 0 };
/** The unsettled island 2 and its coastal warehouse site (x 2..5, y 1..3). */
export const ISLAND2 = "island2";
export const ISLAND2_WAREHOUSE = { x: 2, y: 1 };
/** Planks shipped to island 2: the warehouse's 20 plus 40. */
export const SHIPMENT_PLANKS = 60;
/** Planks the warehouse founded on island 2 takes from the cargo. */
export const WAREHOUSE_PLANKS = 20;
/** Island 2 layout after founding: road y = 4, two houses and a fisher on it. */
export const ISLAND2_ROAD_FROM = { x: 2, y: 4 };
export const ISLAND2_ROAD_TO = { x: 20, y: 4 };
export const ISLAND2_HOUSES = [
  { x: 8, y: 5 },
  { x: 10, y: 5 },
];
export const ISLAND2_FISHER = { x: 12, y: 2 };
