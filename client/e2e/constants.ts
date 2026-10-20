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
/** A water tile (invalid placement). */
export const WATER = { x: 0, y: 0 };
export const START_GOLD = 500;
