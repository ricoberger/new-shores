import { describe, expect, it } from "vitest";
import type { ContentBuilding } from "../api/client";
import { cobbleTop, groundTiles, paintYards, type YardTile } from "./groundpaint";
import { yardTiles } from "./island";
import { buildingAnchor, type GroundKind, type ModelEntry, type ModelRegistry } from "./models";
import { fieldBase, paintRoads } from "./roadvoxels";
import { type Field, TERRAIN_VPT } from "./voxelterrain";

/** A flat grass field of w × h tiles at TERRAIN_VPT columns per tile. */
function flat(w: number, h: number): Field {
  const nx = w * TERRAIN_VPT;
  const ny = h * TERRAIN_VPT;
  return { nx, ny, x0: 0, y0: 0, s: 1 / TERRAIN_VPT, h: new Int8Array(nx * ny), top: new Uint32Array(nx * ny).fill(0x5a8a3a), bottom: -6, side: () => ({ r: 0, g: 0, b: 0 }) as never };
}

const entry = (w: number, h: number, ground?: GroundKind[][]): ModelEntry => ({
  kind: "building",
  footprint: { w, h },
  bounds: { min: [-w / 2, 0, -h / 2], max: [w / 2, 1, h / 2] },
  anchors: { status: [0, 1, 0] },
  file: { path: "x.glb", triangles: 1, bytes: 1, sha256: "00000000", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, ground },
});
const def = (w: number, h: number) => ({ width: w, height: h }) as ContentBuilding;

/** The columns of a tile (k indices). */
function columns(f: Field, x: number, y: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < TERRAIN_VPT; b++) for (let a = 0; a < TERRAIN_VPT; a++) out.push((y * TERRAIN_VPT + b) * f.nx + x * TERRAIN_VPT + a);
  return out;
}

describe("yards as ground paint (D-068)", () => {
  it("maps the ground map onto the island like the model, at every rotation", () => {
    const [w, h] = [3, 2];
    for (const rotation of [0, 90, 180, 270] as const) {
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          const ground: GroundKind[][] = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === gx && y === gy ? "paved" : "none")));
          const b = { x: 10, y: 20, rotation };
          const tiles = groundTiles(entry(w, h), def(w, h), b, ground);
          // The tile under a model anchor at that ground tile's centre (the model's own transform).
          const probe = { ...entry(w, h), anchors: { status: [0, 1, 0] as [number, number, number], probe: [gx + 0.5 - w / 2, 0, -(gy + 0.5 - h / 2)] as [number, number, number] } };
          const a = buildingAnchor(probe, def(w, h), b, "probe")!;
          expect(tiles, `rotation ${rotation} (${gx}, ${gy})`).toEqual([{ x: Math.floor(a.x), y: Math.floor(a.y), kind: "paved" }]);
        }
      }
      // All tiles land inside the rotated footprint.
      const all: GroundKind[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => "dirt" as GroundKind));
      const tiles = groundTiles(entry(w, h), def(w, h), { x: 10, y: 20, rotation }, all);
      const [rw, rh] = rotation % 180 === 0 ? [w, h] : [h, w];
      expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(w * h);
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(10);
        expect(t.x).toBeLessThan(10 + rw);
        expect(t.y).toBeGreaterThanOrEqual(20);
        expect(t.y).toBeLessThan(20 + rh);
      }
    }
    // At rotation 0 the ground map's last row is the footprint's front row (the door side).
    const front = groundTiles(entry(3, 2), def(3, 2), { x: 0, y: 0, rotation: 0 }, [["none", "none", "none"], ["dirt", "dirt", "dirt"]]);
    expect(new Set(front.map((t) => t.y))).toEqual(new Set([1]));
  });

  it("paints a placed building's yard into its columns and returns them to the terrain colour when it goes", () => {
    const f = flat(6, 6);
    const base = fieldBase(f);
    const yards: YardTile[] = [
      { x: 1, y: 1, kind: "paved" },
      { x: 2, y: 1, kind: "dirt" },
      { x: 3, y: 1, kind: "sand" },
      { x: 4, y: 1, kind: "planks" },
    ];
    // As TerrainBuild.setRoads: roads (from the base), fields, yards.
    paintRoads(f, base, [], 3);
    paintYards(f, base, yards, 3);
    const grass = 0x5a8a3a;
    for (const k of columns(f, 1, 1)) expect(f.top[k]).not.toBe(grass);
    for (const k of columns(f, 3, 1)) expect(f.top[k]).not.toBe(grass);
    for (const k of columns(f, 4, 1)) expect(f.top[k]).not.toBe(grass);
    // The paved yard is cobbles; a dirt yard's rim frays, its inside is earth.
    const grey = (p: number) => Math.max(p >> 16, (p >> 8) & 255, p & 255) - Math.min(p >> 16, (p >> 8) & 255, p & 255) < 24;
    expect(columns(f, 1, 1).every((k) => grey(f.top[k] as number))).toBe(true);
    expect(cobbleTop(0.5)).not.toBe(cobbleTop(0.1));
    expect(columns(f, 2, 1).filter((k) => f.top[k] !== grass).length).toBeGreaterThan(TERRAIN_VPT * TERRAIN_VPT / 2);
    // Nothing outside the yard tiles changed.
    for (const k of columns(f, 1, 2)) expect(f.top[k]).toBe(grass);
    // Demolished: the next paint has no yards; every column is the terrain's again.
    paintRoads(f, base, [], 3);
    paintYards(f, base, [], 3);
    expect(Array.from(f.top)).toEqual(Array.from(base.top));
  });

  it("leaves road columns and columns off the tile's flat ground alone", () => {
    const f = flat(4, 4);
    const base = fieldBase(f);
    paintRoads(f, base, [{ x: 1, y: 1, type: "road_dirt" }], 3);
    const roadTops = columns(f, 1, 1).map((k) => f.top[k]);
    paintYards(f, base, [{ x: 1, y: 1, kind: "paved" }], 3);
    // The road's columns keep their colour, the ground beside them takes the yard.
    const after = columns(f, 1, 1).map((k) => f.top[k]);
    const centre = (TERRAIN_VPT / 2) * TERRAIN_VPT + TERRAIN_VPT / 2;
    expect(after[centre]).toBe(roadTops[centre]);
  });

  it("takes each building's drawn file (variant) from the registry; fields and models without a ground map paint nothing", () => {
    const e = entry(2, 2, [
      ["dirt", "none"],
      ["none", "none"],
    ]);
    const registry = { entry: (id: string) => (id === "barn" ? e : id === "plain" ? entry(2, 2) : undefined) } as unknown as ModelRegistry;
    const defs = new Map<string, ContentBuilding>([
      ["barn", def(2, 2)],
      ["plain", def(2, 2)],
      ["wheat_field", { ...def(1, 1), field: { type: "wheat_field", farm: "farm", terrain: [] } } as unknown as ContentBuilding],
    ]);
    const display = {
      buildings: [
        { id: 1, type: "barn", x: 4, y: 4, rotation: 0 },
        { id: 2, type: "plain", x: 8, y: 4, rotation: 0 },
        { id: 3, type: "wheat_field", x: 0, y: 0, rotation: 0 },
      ],
    } as never;
    const tiles = yardTiles(display, defs, registry);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.kind).toBe("dirt");
    expect(yardTiles(display, defs, null)).toEqual([]);
  });
});
