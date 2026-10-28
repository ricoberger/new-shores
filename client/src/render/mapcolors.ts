/**
 * Flat colours of the voxel world for 2D views (the minimap, D-048): the
 * ground role each mask terrain is drawn with (render/terrain.ts
 * groundColor without its noise) and the warmed deep sea
 * (render/water.ts). Free of Babylon so that the HUD can import it.
 */
import { MASK_COAST, MASK_FOREST, MASK_GRASS, MASK_MOUNTAIN } from "../display/mask";
import { TERRAIN, WATER } from "../theme/palette";

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

/** The deep sea: the palette's deep a little toward the shallows and warmed (D-057 V2). */
export function seaDeepRgb(): Rgb {
  const d = lerp(rgbOf(WATER.deep), rgbOf(WATER.shallows), SEA_TEAL);
  return [Math.min(1, d[0] * 1.08 + 0.015), Math.min(1, d[1] * 1.03), d[2] * 0.97];
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
