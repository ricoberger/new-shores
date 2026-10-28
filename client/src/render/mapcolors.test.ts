import { describe, expect, it } from "vitest";
import { MASK_COAST, MASK_FOREST, MASK_GRASS, MASK_MOUNTAIN } from "../display/mask";
import { TERRAIN, WATER } from "../theme/palette";
import { hexOf, MAP_SEA, mapLandColor, rgbOf, seaDeepRgb } from "./mapcolors";
import { seaDeep } from "./water";

describe("map colours", () => {
  it("colour each land cell with its voxel ground role", () => {
    expect(mapLandColor(MASK_COAST)).toBe(TERRAIN.sand);
    expect(mapLandColor(MASK_FOREST)).toBe(TERRAIN.forest_floor);
    expect(mapLandColor(MASK_MOUNTAIN)).toBe(TERRAIN.mountain);
    // Grass: between the two grass tones.
    const g = rgbOf(mapLandColor(MASK_GRASS));
    const a = rgbOf(TERRAIN.grass_a);
    const b = rgbOf(TERRAIN.grass_b);
    for (let i = 0; i < 3; i++) expect(g[i]).toBeCloseTo(((a[i] as number) + (b[i] as number)) / 2, 2);
    expect(new Set([MASK_COAST, MASK_FOREST, MASK_MOUNTAIN, MASK_GRASS].map(mapLandColor)).size).toBe(4);
  });

  it("use the renderer's warmed deep sea", () => {
    const s = seaDeep();
    expect(MAP_SEA).toBe(hexOf([s.r, s.g, s.b]));
    expect(MAP_SEA).not.toBe(WATER.deep.toLowerCase());
    expect(hexOf(rgbOf(WATER.deep))).toBe(WATER.deep.toLowerCase());
    expect(seaDeepRgb()[0]).toBeGreaterThan(rgbOf(WATER.deep)[0]);
  });
});
