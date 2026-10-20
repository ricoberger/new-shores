// Colours. Terrain uses a colour-blind-safe set that also differs in
// lightness: water and mountain are clearly distinct from the buildable
// coast, grass and forest.
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Terrain } from "../api/client";

export const TERRAIN_COLORS: Record<Terrain, Color3> = {
  water: Color3.FromHexString("#2B5C8A"),
  coast: Color3.FromHexString("#E8D9A8"),
  grass: Color3.FromHexString("#9CC27A"),
  forest: Color3.FromHexString("#3E7A3E"),
  mountain: Color3.FromHexString("#8A8580"),
};

export const UNKNOWN_TERRAIN = Color3.FromHexString("#FF00FF");

const BUILDING_HUES = ["#C8553D", "#8E6C8A", "#D9A441", "#5B8E7D", "#4A6FA5", "#B5838D", "#6D9DC5", "#A0522D", "#7A9E7E", "#C9A66B"];

/** A stable colour per content ID. */
export function buildingColor(id: string): Color4 {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = Color3.FromHexString(BUILDING_HUES[h % BUILDING_HUES.length] ?? "#999999");
  return new Color4(c.r, c.g, c.b, 1);
}

export const ROOF = new Color4(0.45, 0.25, 0.2, 1);
export const ROAD = Color3.FromHexString("#8B6B4A");
export const DOOR = Color3.FromHexString("#3A2A1A");
export const CART = Color3.FromHexString("#F2E8CF");
export const GHOST = Color3.FromHexString("#DDDDDD");
/** Ghost of a building without an adjacent road: "not connected", never red. */
export const GHOST_NO_ROAD = Color3.FromHexString("#F0C808");
export const SELECTION = Color3.FromHexString("#FFD23F");
