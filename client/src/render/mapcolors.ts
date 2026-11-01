/**
 * Flat colours of the voxel world for 2D views (the minimap, D-048): the
 * ground role each mask terrain is drawn with (render/terrain.ts
 * groundColor without its noise), the relief of loaded tiles and the deep sea
 * (render/water.ts). Free of Babylon so that the HUD can import it.
 */
import { MASK_COAST, MASK_FOREST, MASK_GRASS, MASK_MOUNTAIN } from "../display/mask";
import { ISLAND, TERRAIN, WATER } from "../theme/palette";

export type Rgb = readonly [number, number, number];

/** '#RRGGBB' → 0..1 channels. */
export function rgbOf(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

/** 0..1 channels → '#rrggbb'. */
export function hexOf(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Share of the shallows in the deep sea's colour. */
const SEA_TEAL = 0.12;

/** The deep sea: the palette's deep a little toward the shallows (no warming step since D-064). */
export function seaDeepRgb(): Rgb {
  return lerp(rgbOf(WATER.deep), rgbOf(WATER.shallows), SEA_TEAL);
}

/** The minimap's sea. */
export const MAP_SEA = hexOf(seaDeepRgb());

const LAND: Record<number, string> = {
  [MASK_COAST]: TERRAIN.sand,
  [MASK_GRASS]: hexOf(lerp(rgbOf(TERRAIN.grass_a), rgbOf(TERRAIN.grass_b), 0.5)),
  [MASK_FOREST]: TERRAIN.forest_floor,
  [MASK_MOUNTAIN]: TERRAIN.mountain,
};

/** The minimap colour of a land mask cell (display/mask.ts code): its voxel ground role. */
export function mapLandColor(code: number): string {
  return LAND[code] ?? TERRAIN.grass_a;
}

const TILE: Record<string, Rgb> = {
  coast: rgbOf(TERRAIN.sand),
  islet: rgbOf(TERRAIN.sand),
  grass: lerp(rgbOf(TERRAIN.grass_a), rgbOf(TERRAIN.grass_b), 0.5),
  forest: rgbOf(TERRAIN.forest_floor),
  mountain: rgbOf(ISLAND.rock_light),
  cliff: lerp(rgbOf(TERRAIN.grass_b), rgbOf(ISLAND.rock_light), 0.45),
  river: lerp(rgbOf(WATER.shallows), rgbOf(WATER.deep), 0.4),
};

/**
 * The minimap colour (0..1 channels) of a loaded tile (D-058): its ground
 * role as the voxel terrain draws it (rivers in river water, rock in the
 * rock's tone), a little lighter per terrace level and per level of rock
 * (null for the sea).
 */
export function mapTileRgb(terrain: string, level: number, rock: number): Rgb | null {
  const base = rock > 0 && terrain === "islet" ? TILE.mountain! : TILE[terrain];
  if (!base) return null;
  const f = 1 + 0.06 * level + 0.05 * rock;
  return [Math.min(1, base[0] * f), Math.min(1, base[1] * f), Math.min(1, base[2] * f)];
}
