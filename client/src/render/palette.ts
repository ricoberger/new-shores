// Renderer colours: Babylon colours of the palette roles (single source
// assets/palette.json → theme/palette.ts, ART_DIRECTION §2). Terrain
// roles keep water and mountain clearly distinct from the buildable coast,
// grass and forest.
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Terrain } from "../api/client";
import { BUILDINGS, LIGHT, ROUTES, STATUS, TERRAIN, UI, WATER } from "../theme/palette";

/** A palette hex colour as a Babylon Color3. */
export function c3(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

/** A palette hex colour as a Babylon Color4. */
export function c4(hex: string, alpha = 1): Color4 {
  const c = Color3.FromHexString(hex);
  return new Color4(c.r, c.g, c.b, alpha);
}

/** A palette hex colour as an RGBA tuple (vertex and instance colours). */
export function colorTuple(hex: string, alpha = 1): [number, number, number, number] {
  const c = Color3.FromHexString(hex);
  return [c.r, c.g, c.b, alpha];
}

/** Linear blend of two palette colours (t = 0: a, 1: b). */
export function mix(a: string, b: string, t: number): Color3 {
  return Color3.Lerp(c3(a), c3(b), t);
}

export const TERRAIN_COLORS: Record<Terrain, Color3> = {
  water: c3(WATER.deep),
  coast: c3(TERRAIN.sand),
  grass: c3(TERRAIN.grass_a),
  forest: c3(TERRAIN.forest_floor),
  mountain: c3(TERRAIN.mountain),
};

/** Debug colour of a terrain value this client does not know (deliberately loud, not a palette role). */
export const UNKNOWN_TERRAIN = Color3.FromHexString("#FF00FF");

/** Wall and roof materials of the procedural placeholder buildings. */
const WALLS = [BUILDINGS.plaster, BUILDINGS.ochre, BUILDINGS.stone, BUILDINGS.thatch];
const ROOFS = [BUILDINGS.terracotta, BUILDINGS.slate, BUILDINGS.timber];

function hashId(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A stable wall colour per content ID. */
export function buildingColor(id: string): Color4 {
  return c4(WALLS[hashId(id) % WALLS.length] ?? BUILDINGS.plaster);
}

/** A stable roof colour per content ID (varies independently of the wall). */
export function roofColor(id: string): Color4 {
  return c4(ROOFS[Math.floor(hashId(id) / WALLS.length) % ROOFS.length] ?? BUILDINGS.terracotta);
}

export const DOOR = c3(BUILDINGS.timber);
export const CART = c3(UI.parchment);
export const GHOST = c3(STATUS.ghost_ok);
/** Ghost of a building without an adjacent road: "not connected", never red. */
export const GHOST_NO_ROAD = c3(STATUS.ghost_no_road);
/**
 * Ghost of a building the server would reject for a missing fertility or
 * deposit (a lookup of the island's static data; the click still goes to
 * the server, which validates).
 */
export const GHOST_INVALID = c3(STATUS.ghost_invalid);
export const SELECTION = c3(STATUS.selection);
/** Field tool preview: a tile the drag will send (D-049). */
export const FIELD_VALID = c3(STATUS.field_valid);
/** Field tool preview: a free matching tile outside every accepting farm's ring (shown, not sent). */
export const FIELD_OUT_OF_RANGE = c3(STATUS.field_out_of_range);
/** Work-radius ring of a farm with fields. */
export const FIELD_RING = c3(STATUS.field_ring);
/** Haze the sea fades into toward the edges of the world (also the scene's clear colour). */
export const HAZE = c3(WATER.haze);
/** Route ribbons in route order, the editor's draft and the direction arrows. */
export const ROUTE_COLORS = [ROUTES.route_1, ROUTES.route_2, ROUTES.route_3, ROUTES.route_4, ROUTES.route_5, ROUTES.route_6, ROUTES.route_7].map(c3);
export const DRAFT_COLOR = c3(ROUTES.draft);
export const ARROW_DIM = colorTuple(ROUTES.arrow_dim);
export const ARROW_BRIGHT = colorTuple(ROUTES.arrow_bright);
/** Shadow tint (blob shadows). */
export const SHADOW = c3(LIGHT.shadow);
