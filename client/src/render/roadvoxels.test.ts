import { describe, expect, it } from "vitest";
import { chunkAt } from "../display/chunks";
import { BOLLARD_H, fieldBase, fieldGround, paintFields, paintRoads, QUAY_H, ROAD_H, touchedChunks } from "./roadvoxels";
import { type Field, SIDE_ROCK, TERRAIN_VPT } from "./voxelterrain";

/** A flat grass field of w × h tiles at TERRAIN_VPT columns per tile. */
function flat(w: number, h: number): Field {
  const nx = w * TERRAIN_VPT;
  const ny = h * TERRAIN_VPT;
  return { nx, ny, x0: 0, y0: 0, s: 1 / TERRAIN_VPT, h: new Int8Array(nx * ny), top: new Uint32Array(nx * ny).fill(0x5a8a3a), bottom: -6, side: () => ({ r: 0, g: 0, b: 0 }) as never };
}

/** The road rows of a tile as strings ('#' road, '.' ground). */
function tileRows(f: Field, x: number, y: number): string[] {
  const out: string[] = [];
  for (let b = 0; b < TERRAIN_VPT; b++) {
    let row = "";
    for (let a = 0; a < TERRAIN_VPT; a++) row += f.h[(y * TERRAIN_VPT + b) * f.nx + x * TERRAIN_VPT + a] === ROAD_H ? "#" : ".";
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

  it("sinks a two-column path one voxel with arms to the road neighbours (joins and junctions are unions)", () => {
    const f = flat(4, 4);
    const base = fieldBase(f);
    const tiles = [
      { x: 1, y: 1, type: "road_dirt" },
      { x: 2, y: 1, type: "road_dirt" },
      { x: 1, y: 2, type: "road_dirt" },
    ];
    paintRoads(f, base, tiles, 7);
    // The corner tile: centre plus arms east and south.
    expect(tileRows(f, 1, 1)).toEqual(["....", ".###", ".###", ".##."]);
    // Its east neighbour: an arm west only.
    expect(tileRows(f, 2, 1)).toEqual(["....", "###.", "###.", "...."]);
    // A tile without roads stays flat.
    expect(tileRows(f, 3, 3)).toEqual(["....", "....", "....", "...."]);
  });

  it("wears the edges and repaints from the base when a road goes away", () => {
    const f = flat(3, 3);
    const base = fieldBase(f);
    const changed = paintRoads(f, base, [{ x: 1, y: 1, type: "road_paved" }], 3);
    expect(changed.length).toBe(4);
    // The kerb: most columns around the path changed colour but kept their height.
    let kerb = 0;
    for (let k = 0; k < f.nx * f.ny; k++) if (f.h[k] === 0 && f.top[k] !== base.top[k]) kerb++;
    expect(kerb).toBeGreaterThan(4);
    const back = paintRoads(f, base, [], 3);
    expect(back.length).toBe(4);
    expect(Array.from(f.h)).toEqual(Array.from(base.h));
    expect(Array.from(f.top)).toEqual(Array.from(base.top));
  });

  it("never sinks the beach or the shelves", () => {
    const f = flat(2, 1);
    f.h.fill(-1);
    const base = fieldBase(f);
    expect(paintRoads(f, base, [{ x: 0, y: 0 }], 1)).toEqual([]);
  });

  it("names the chunks whose meshes a height change touches (neighbours across a chunk's edge too)", () => {
    const f = flat(40, 4);
    const base = fieldBase(f);
    const chunk = (x: number, y: number) => chunkAt(x, y, 40, 4);
    // A lone road tile at x 32: its path is inside chunk 1,0.
    expect([...touchedChunks(paintRoads(f, base, [{ x: 32, y: 1 }], 1), f, chunk)]).toEqual(["1,0"]);
    // Joined with x 31: the arms reach the shared edge, both chunks rebuild.
    expect([...touchedChunks(paintRoads(f, base, [{ x: 31, y: 1 }, { x: 32, y: 1 }], 1), f, chunk)].sort()).toEqual(["0,0", "1,0"]);
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
    // The sunk road columns keep their colour.
    expect(f.h[at(1, 0)]).toBe(ROAD_H);
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
    // The road columns (rows 1–2): level 0 sunk one voxel, the middle tile rising 1, 2, 3, 4 steps (minus the voxel), the last flat at level 1 (its east edge no road).
    expect(row(1)).toEqual([0, -1, -1, -1, 0, 1, 2, 3, 3, 3, 3, 4]);
    // Off the road the terrace edge stays a wall.
    expect(row(0).slice(4, 8)).toEqual([4, 4, 4, 4]);
  });
});
