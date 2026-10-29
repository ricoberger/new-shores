import { describe, expect, it } from "vitest";
import { MASK_COAST, MASK_FOREST, MASK_GRASS, MASK_MOUNTAIN } from "../display/mask";
import { TERRAIN, WATER } from "../theme/palette";
import { hexOf, MAP_SEA, mapLandColor, mapTileRgb, rgbOf, seaDeepRgb } from "./mapcolors";
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

  it("colour loaded tiles by terrain, lighter per terrace level and rock (D-058)", () => {
    expect(mapTileRgb("water", 0, 0)).toBeNull();
    expect(hexOf(mapTileRgb("coast", 0, 0)!)).toBe(TERRAIN.sand.toLowerCase());
    const river = mapTileRgb("river", 0, 0)!;
    expect(river[2]).toBeGreaterThan(river[0]);
    const g0 = mapTileRgb("grass", 0, 0)!;
    const g2 = mapTileRgb("grass", 2, 0)!;
    expect(g2[1]).toBeGreaterThan(g0[1]);
    expect(mapTileRgb("islet", 0, 1)).toEqual(mapTileRgb("mountain", 0, 1));
  });

  it("use the renderer's warmed deep sea", () => {
    const s = seaDeep();
    expect(MAP_SEA).toBe(hexOf([s.r, s.g, s.b]));
    expect(MAP_SEA).not.toBe(WATER.deep.toLowerCase());
    expect(hexOf(rgbOf(WATER.deep))).toBe(WATER.deep.toLowerCase());
    expect(seaDeepRgb()[0]).toBeGreaterThan(rgbOf(WATER.deep)[0]);
  });
});
