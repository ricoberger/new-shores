import { describe, expect, it } from "vitest";
import { chunkAt } from "../display/chunks";
import { fieldBase, fieldGround, paintFields, paintRoads, ROAD_H, touchedChunks } from "./roadvoxels";
import { type Field, TERRAIN_VPT } from "./voxelterrain";

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
});
