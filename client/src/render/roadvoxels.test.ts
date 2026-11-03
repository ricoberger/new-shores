import { describe, expect, it } from "vitest";
import { chunkAt } from "../display/chunks";
import { cobbleTop, DIRT, KERB, STONE, STONE_DARK } from "./groundpaint";
import { BOLLARD_H, fieldBase, fieldGround, paintFields, paintRoads, QUAY_H, touchedChunks } from "./roadvoxels";
import { type Field, SIDE_ROCK, TERRAIN_VPT } from "./voxelterrain";

/** A flat grass field of w × h tiles at TERRAIN_VPT columns per tile. */
function flat(w: number, h: number): Field {
  const nx = w * TERRAIN_VPT;
  const ny = h * TERRAIN_VPT;
  return { nx, ny, x0: 0, y0: 0, s: 1 / TERRAIN_VPT, h: new Int8Array(nx * ny), top: new Uint32Array(nx * ny).fill(0x5a8a3a), bottom: -6, side: () => ({ r: 0, g: 0, b: 0 }) as never };
}

/** The cobble colours of the paved road (render/groundpaint.ts cobbleTop: three shades and a joint). */
const COBBLES = new Set([0.1, 0.5, 0.8, 0.99].map(cobbleTop));

/** The paved road rows of a tile as strings ('#' cobbles, '.' ground or kerb). */
function tileRows(f: Field, x: number, y: number): string[] {
  const out: string[] = [];
  for (let b = 0; b < TERRAIN_VPT; b++) {
    let row = "";
    for (let a = 0; a < TERRAIN_VPT; a++) row += COBBLES.has(f.top[(y * TERRAIN_VPT + b) * f.nx + x * TERRAIN_VPT + a] as number) ? "#" : ".";
    out.push(row);
  }
  return out;
}

describe("voxel roads", () => {
  it("builds quays as stone decks on the water with fenders and a bollard every third tile (D-060)", () => {
    // Land in row 0 (level 0), sea (seabed -6) below.
    const f = flat(6, 3);
    for (let j = TERRAIN_VPT; j < f.ny; j++) for (let i = 0; i < f.nx; i++) f.h[j * f.nx + i] = -6;
    const base = fieldBase(f);
    const quay = [0, 1, 2, 3].map((x) => ({ x, y: 1, type: "quay" }));
    paintRoads(f, base, quay, 5);
    const col = (x: number, y: number, a: number, b: number) => (y * TERRAIN_VPT + b) * f.nx + x * TERRAIN_VPT + a;
    // The deck covers the whole tile at the shore's level, with stone walls.
    expect(f.h[col(1, 1, 1, 1)]).toBe(QUAY_H);
    expect(f.kind?.[col(1, 1, 1, 1)]).toBe(SIDE_ROCK);
    // A bollard on the open (south) edge of every third tile ((x + y) % 3 === 0: tile 2 of 0..3).
    const bollards = (x: number) => [0, 1, 2, 3].filter((a) => f.h[col(x, 1, a, TERRAIN_VPT - 1)] === BOLLARD_H).length;
    expect([0, 1, 2, 3].map(bollards)).toEqual([0, 0, 1, 0]);
    // The fender (south edge) is timber, not the deck's stone; no fender toward the land (north).
    expect(f.top[col(1, 1, 1, TERRAIN_VPT - 1)]).not.toBe(f.top[col(1, 1, 1, 1)]);
    // The sea next to the quay stays.
    expect(f.h[col(4, 1, 1, 1)]).toBe(-6);
    // Repainting without the quay restores heights and side kinds.
    paintRoads(f, base, [], 5);
    expect(Array.from(f.h)).toEqual(Array.from(base.h));
    expect(Array.from(f.kind ?? [])).toEqual(new Array(f.nx * f.ny).fill(0));
  });

  it("paints a two-column path flush with the ground, with arms to the road neighbours (joins and junctions are unions; D-068)", () => {
    const f = flat(4, 4);
    const base = fieldBase(f);
    const tiles = [
      { x: 1, y: 1, type: "road_paved" },
      { x: 2, y: 1, type: "road_paved" },
      { x: 1, y: 2, type: "road_paved" },
    ];
    expect(paintRoads(f, base, tiles, 7)).toEqual([]);
    expect(Array.from(f.h)).toEqual(Array.from(base.h));
    // The corner tile: centre plus arms east and south.
    expect(tileRows(f, 1, 1)).toEqual(["....", ".###", ".###", ".##."]);
    // Its east neighbour: an arm west only.
    expect(tileRows(f, 2, 1)).toEqual(["....", "###.", "###.", "...."]);
    // A tile without roads keeps the ground.
    expect(tileRows(f, 3, 3)).toEqual(["....", "....", "....", "...."]);
    expect(f.top[(3 * TERRAIN_VPT + 1) * f.nx + 3 * TERRAIN_VPT + 1]).toBe(base.top[(3 * TERRAIN_VPT + 1) * f.nx + 3 * TERRAIN_VPT + 1]);
  });

  it("paints the rims and repaints from the base when a road goes away", () => {
    const f = flat(3, 3);
    const base = fieldBase(f);
    expect(paintRoads(f, base, [{ x: 1, y: 1, type: "road_paved" }], 3)).toEqual([]);
    // The path and its kerb: the columns around it changed colour, no height.
    let painted = 0;
    for (let k = 0; k < f.nx * f.ny; k++) if (f.top[k] !== base.top[k]) painted++;
    expect(painted).toBeGreaterThan(4 + 4);
    expect(paintRoads(f, base, [], 3)).toEqual([]);
    expect(Array.from(f.h)).toEqual(Array.from(base.h));
    expect(Array.from(f.top)).toEqual(Array.from(base.top));
  });

  it("paints plain rims: packed earth beside a dirt road, the kerb beside a paved one — no ground left in, no mixes", () => {
    // Whether a packed colour is a shade of `c` (the channel ratios kept, within 8-bit rounding).
    const shadeOf = (p: number, c: { r: number; g: number; b: number }) => {
      const r = (p >> 16) & 255;
      const g = (p >> 8) & 255;
      const b = p & 255;
      const k = g / (c.g * 255);
      return Math.abs(r - c.r * 255 * k) <= 3 && Math.abs(b - c.b * 255 * k) <= 3;
    };
    for (const type of ["road_dirt", "road_paved"] as const) {
      const f = flat(3, 3);
      const base = fieldBase(f);
      paintRoads(f, base, [{ x: 1, y: 1, type }], 11);
      const col = (a: number, b: number) => (TERRAIN_VPT + b) * f.nx + TERRAIN_VPT + a;
      // The rim of a lone tile: the columns beside the two-by-two path.
      const rim = [
        [0, 1], [0, 2], [3, 1], [3, 2], [1, 0], [2, 0], [1, 3], [2, 3],
      ].map(([a, b]) => f.top[col(a!, b!)] as number);
      for (const p of rim) {
        expect(p).not.toBe(base.top[0]);
        if (type === "road_paved") expect(shadeOf(p, KERB)).toBe(true);
        else expect(shadeOf(p, DIRT) || shadeOf(p, STONE) || shadeOf(p, STONE_DARK)).toBe(true);
      }
      // The tile's corners stay ground (a rounded end, not a square slab).
      expect(f.top[col(0, 0)]).toBe(base.top[0]);
    }
  });

  it("never paints the beach or the shelves", () => {
    const f = flat(2, 1);
    f.h.fill(-1);
    const base = fieldBase(f);
    expect(paintRoads(f, base, [{ x: 0, y: 0 }], 1)).toEqual([]);
    expect(Array.from(f.top)).toEqual(Array.from(base.top));
  });

  it("names the chunks whose meshes a height change touches (neighbours across a chunk's edge too)", () => {
    const f = flat(40, 4);
    const chunk = (x: number, y: number) => chunkAt(x, y, 40, 4);
    const col = (tx: number, a: number) => (1 * TERRAIN_VPT + 1) * f.nx + tx * TERRAIN_VPT + a;
    // A column inside tile 32: chunk 1,0 only.
    expect([...touchedChunks([col(32, 1)], f, chunk)]).toEqual(["1,0"]);
    // Tile 32's first column: its neighbour is in tile 31, both chunks rebuild.
    expect([...touchedChunks([col(32, 0)], f, chunk)].sort()).toEqual(["0,0", "1,0"]);
    // A plain road changes no height, so no chunk.
    expect(paintRoads(f, fieldBase(f), [{ x: 31, y: 1 }, { x: 32, y: 1 }], 1)).toEqual([]);
  });
});

describe("field ground", () => {
  it("ploughs crop fields in furrows, keeps roads and repaints from the base", () => {
    expect(["wheat_field", "pasture", "cattle_pasture", "orchard_plot", "woad_field"].map(fieldGround)).toEqual(["furrows", "pasture", "pasture", "orchard", "furrows"]);
    const f = flat(3, 3);
    const base = fieldBase(f);
    paintRoads(f, base, [{ x: 1, y: 0 }, { x: 1, y: 1 }], 1);
    const road = f.top.slice();
    paintFields(f, base, [{ x: 1, y: 1, type: "wheat_field" }], 1);
    const at = (a: number, b: number) => (TERRAIN_VPT + b) * f.nx + TERRAIN_VPT + a;
    // Furrows: alternate rows along x differ, columns of one row are close.
    expect(f.top[at(0, 0)]).not.toBe(base.top[at(0, 0)]);
    expect((f.top[at(0, 0)]! >> 16) & 255).toBeLessThan((f.top[at(0, 1)]! >> 16) & 255);
    // The road columns keep their colour (and the ground's height).
    expect(f.h[at(1, 0)]).toBe(0);
    expect(f.top[at(1, 0)]).toBe(road[at(1, 0)]);
    // Colour only: no height changes; a repaint without the field restores the ground.
    paintRoads(f, base, [], 1);
    paintFields(f, base, [], 1);
    expect(Array.from(f.top)).toEqual(Array.from(base.top));
  });

  it("climbs a level across the upper tile where a road meets a road one level lower (D-058 road ramps)", () => {
    // Three tiles in a row: level 0, then 1, 1; the field's flat ground per tile is its level.
    const f = flat(3, 1);
    const flatH = new Int8Array(f.nx * f.ny);
    for (let k = 0; k < flatH.length; k++) flatH[k] = Math.floor((k % f.nx) / TERRAIN_VPT) >= 1 ? 4 : 0;
    f.flat = flatH;
    f.h.set(flatH);
    const base = fieldBase(f);
    paintRoads(f, base, [0, 1, 2].map((x) => ({ x, y: 0, type: "road_dirt" })), 7);
    const row = (j: number) => Array.from(f.h.slice(j * f.nx, (j + 1) * f.nx));
    // The road columns (rows 1–2): level 0 flush, the middle tile rising 1, 2, 3, 4 steps (the terrace's ramp), the last flat at level 1.
    expect(row(1)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4, 4]);
    // Off the road the terrace edge stays a wall.
    expect(row(0).slice(4, 8)).toEqual([4, 4, 4, 4]);
  });
});
