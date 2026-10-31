import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { IslandDisplay } from "../api/client";
import { decodeMask, encodeMask, MASK_GRASS } from "../display/mask";
import { FAR_RESERVE, FAR_SCENERY_TRIS, FAR_TRIS, farTerrainBudget, homeTerrain, MaskLayer, maskMeshData, mergeParts } from "./farmesh";
import { mapLandColor, rgbOf } from "./mapcolors";
import { Builder, SEA_LEVEL } from "./terrain";

const NAMES: Record<string, string> = { w: "water", c: "coast", g: "grass", f: "forest", m: "mountain" };

/** A fixture island from rows of terrain letters, its mask built from the rows (as the server does). */
function fixtureMask(...rows: string[]) {
  const island = { width: rows[0]!.length, height: rows.length, terrain: rows.flatMap((r) => [...r].map((c) => NAMES[c]!)) };
  return decodeMask(encodeMask(island), island.width, island.height);
}

function ys(b: { positions: number[] }): number[] {
  return b.positions.filter((_, i) => i % 3 === 1);
}

/** The up-facing quads (4 vertices each, Builder order) at height y: their tile rectangles (island tiles, y down). */
function topRects(b: Builder, y: number): { minX: number; maxX: number; minY: number; maxY: number }[] {
  const out: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (let v = 0; v < b.positions.length / 3; v += 4) {
    const ps = [0, 1, 2, 3].map((k) => [b.positions[(v + k) * 3]!, b.positions[(v + k) * 3 + 1]!, -b.positions[(v + k) * 3 + 2]!] as const);
    if (b.normals[v * 3 + 1] !== 1 || ps.some((p) => Math.abs(p[1] - y) > 1e-6)) continue;
    out.push({ minX: Math.min(...ps.map((p) => p[0])), maxX: Math.max(...ps.map((p) => p[0])), minY: Math.min(...ps.map((p) => p[2])), maxY: Math.max(...ps.map((p) => p[2])) });
  }
  return out;
}

describe("mask mesh (the flat outline)", () => {
  // 16 × 12 tiles: a 4 × 3 mask, land in the middle two columns of every row.
  const rows = Array.from({ length: 12 }, () => "wwwwggggffffwwww");
  const mask = fixtureMask(...rows);

  it("builds ground at height 0 over the land cells and one 1-tile sand shelf down below the sea", () => {
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(3);
    const b = maskMeshData(mask);
    expect(b.indices.length).toBeGreaterThan(0);
    expect(b.indices.length % 3).toBe(0);
    for (const v of b.positions) expect(Number.isFinite(v)).toBe(true);
    const y = ys(b);
    // Ground at 0, the shelf below it, the shelf's wall to just under the sea surface.
    expect(Math.max(...y)).toBe(0);
    expect(Math.min(...y)).toBeLessThan(SEA_LEVEL);
    expect(Math.min(...y)).toBeGreaterThan(SEA_LEVEL - 0.1);
    // The land spans tiles 4…12 in x (cells 1 and 2), the shelf one tile beyond.
    const xs = b.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(3);
    expect(Math.max(...xs)).toBe(13);
    const land = b.positions.filter((_, i) => i % 3 === 0 && b.positions[i + 1] === 0);
    expect(Math.min(...land)).toBe(4);
    expect(Math.max(...land)).toBe(12);
    // Island-local z is −y: the shelf reaches one tile past the mask's top and bottom rows.
    const zs = b.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBe(1);
    expect(Math.min(...zs)).toBe(-13);
  });

  it("merges each terrain run into flat quads (no per-tile columns): two land quads here", () => {
    const b = maskMeshData(mask);
    const tops = topRects(b, 0);
    expect(tops).toEqual([
      { minX: 4, maxX: 8, minY: 0, maxY: 12 },
      { minX: 8, maxX: 12, minY: 0, maxY: 12 },
    ]);
    // Land tops, shelf tops (a ring of four strips), the land's walls down to the shelf and the shelf's walls into the sea: a few dozen triangles.
    expect(b.indices.length / 3).toBeLessThanOrEqual(40);
  });

  it("draws exactly the minimap's cells: the coast is the cell contour, not smoothed", () => {
    // An L of land cells with a notch: every land tile is under a land top, no water tile is.
    const m = fixtureMask(
      ...[
        "gggggggggggg",
        "gggggggggggg",
        "gggggggggggg",
        "gggggggggggg",
        "ggggwwwwcccc",
        "ggggwwwwcccc",
        "ggggwwwwcccc",
        "ggggwwwwcccc",
      ],
    );
    const tops = topRects(maskMeshData(m), 0);
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 12; tx++) {
        const covered = tops.some((r) => tx + 0.5 > r.minX && tx + 0.5 < r.maxX && ty + 0.5 > r.minY && ty + 0.5 < r.maxY);
        expect(covered, `tile ${tx},${ty}`).toBe(!(ty >= 4 && tx >= 4 && tx < 8));
      }
    }
    // Every land corner lies on the cell grid (MASK_BLOCK tiles).
    for (const r of tops) for (const v of [r.minX, r.maxX, r.minY, r.maxY]) expect(v % 4).toBe(0);
  });

  it("colours the cells in the minimap's colours (true colours, no unsettled tint)", () => {
    const data = maskMeshData(mask);
    const spread = (cols: number[]) => {
      let s = 0;
      for (let i = 0; i < cols.length; i += 4) s += Math.max(cols[i]!, cols[i + 1]!, cols[i + 2]!) - Math.min(cols[i]!, cols[i + 1]!, cols[i + 2]!);
      return s / (cols.length / 4);
    };
    expect(spread(data.colors)).toBeGreaterThan(0.15);
    // The land tops carry mapLandColor of their cell (quantised to FAR_QUANT levels).
    const grass = rgbOf(mapLandColor(MASK_GRASS));
    const v = data.positions.findIndex((p, i) => i % 3 === 0 && p === 4 && data.positions[i + 1] === 0 && data.normals[i + 1] === 1) / 3;
    for (let ch = 0; ch < 3; ch++) expect(data.colors[v * 4 + ch]!).toBeCloseTo(grass[ch]!, 1);
  });

  it("is empty for an all-water mask and merges islands at their positions", () => {
    expect(maskMeshData(fixtureMask("wwww", "wwww")).indices).toHaveLength(0);
    const a = maskMeshData(mask);
    const merged = mergeParts([
      { data: a, x: 0, y: 0 },
      { data: a, x: 100, y: 50 },
    ]);
    const n = a.positions.length / 3;
    expect(merged.positions.length).toBe(a.positions.length * 2);
    expect(merged.indices.length).toBe(a.indices.length * 2);
    expect(merged.positions[n * 3]).toBeCloseTo(a.positions[0]! + 100, 5);
    expect(merged.positions[n * 3 + 2]).toBeCloseTo(a.positions[2]! - 50, 5);
    expect(Math.max(...merged.indices)).toBe(2 * n - 1);
  });

  it("costs ≤ 1.5 k triangles for a large island and ≤ 25 k for the whole archipelago (the far budget's outlines)", () => {
    const fx = JSON.parse(gunzipSync(readFileSync(join(__dirname, "testdata", "farbudget", "played.json.gz"))).toString("utf8")) as { islands: IslandDisplay[] };
    let total = 0;
    let large = 0;
    for (const is of fx.islands) {
      const tris = maskMeshData(decodeMask(is.terrain_mask, is.width, is.height)).indices.length / 3;
      total += tris;
      if (is.width >= 180) {
        large++;
        expect(tris, is.id).toBeLessThanOrEqual(1_500);
      }
    }
    expect(large).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(25_000);
  });
});

describe("mask layer budget (D-058)", () => {
  const engine = new NullEngine();
  afterAll(() => engine.dispose());
  const mask = fixtureMask(...Array.from({ length: 12 }, () => "wwwwggggffffwwww"));
  /** Far columns of a built island: `tris` triangles. */
  const columns = (tris: number) => {
    const b = new Builder();
    for (let i = 0; i < tris * 3; i++) b.indices.push(0);
    b.positions.push(0, 0, 0);
    b.colors.push(1, 1, 1, 1);
    b.normals.push(0, 1, 0);
    return b;
  };
  const island = (id: string, x: number, tris: number) => ({ id, position: { x, y: 0 }, mask, seed: 7, tiles: { key: id, data: columns(tris) } });
  const maskTris = maskMeshData(mask).indices.length / 3;

  it("keeps the far columns of the first islands while the mesh fits the budget, the rest their mask", () => {
    const layer = new MaskLayer(new Scene(engine));
    const islands = [island("a", 0, 1000), island("b", 40, 1000), island("c", 80, 1000)];
    expect(maskTris).toBeLessThan(1000);
    layer.show(islands, 1000 + 2 * maskTris);
    expect(layer.tiled()).toEqual(["a"]);
    expect(layer.triangles()).toBe(1000 + 2 * maskTris);
    layer.show(islands, Infinity);
    expect(layer.tiled()).toEqual(["a", "b", "c"]);
    expect(layer.triangles()).toBe(3000);
  });

  it("spends the far budget's headroom on the focused island's relief first, then the nearest islands', their outlines the last resort", () => {
    const layer = new MaskLayer(new Scene(engine));
    const big = 30_000;
    // Nearest first (the engine sorts by distance from the view's centre).
    const islands = [island("near", 0, big), island("mid", 40, big), island("far", 80, big)];
    const outlines = layer.outlineTriangles(islands);
    expect(outlines).toBe(3 * maskTris);
    // The fixed layers' cost leaves the terrain FAR_TRIS less the reserve and the scenery.
    const none = { models: 0, trees: 0, shadows: 0, ships: 0 };
    expect(farTerrainBudget(none)).toBe(FAR_TRIS * (1 - FAR_RESERVE) - FAR_SCENERY_TRIS);
    // A small town: the home island's fine lite terrain fits, every neighbour keeps its relief.
    let budget = farTerrainBudget({ ...none, models: 15_000, trees: 24_000, ships: 10_000 });
    expect(homeTerrain(budget, outlines, 50_000)).toBe("lite");
    layer.show(islands, budget - 50_000);
    expect(layer.tiled()).toEqual(["near", "mid", "far"]);
    // A large town: the fine terrain does not fit next to the outlines (coarse, 24 k here), the nearest neighbours get what is left.
    budget = farTerrainBudget({ ...none, models: 92_000, trees: 24_000, shadows: 4_000, ships: 16_000 });
    expect(homeTerrain(budget, outlines, 50_000)).toBe("lite");
    expect(homeTerrain(budget, 67_000, 50_000)).toBe("coarse");
    layer.show(islands, budget - 24_000 - 2 * maskTris);
    expect(layer.tiled()).toEqual(["near", "mid"]);
    expect(92_000 + 24_000 + 4_000 + 16_000 + FAR_SCENERY_TRIS + 24_000 + layer.triangles()).toBeLessThanOrEqual(FAR_TRIS * (1 - FAR_RESERVE));
    // Nothing left: every neighbour is drawn from its outline (the mesh's least).
    expect(farTerrainBudget({ ...none, models: FAR_TRIS })).toBe(0);
    layer.show(islands, 0);
    expect(layer.tiled()).toEqual([]);
    expect(layer.triangles()).toBe(3 * maskTris);
  });
});
