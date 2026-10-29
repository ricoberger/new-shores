import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { decodeMask, encodeMask } from "../display/mask";
import { MaskLayer, maskMeshData, mergeParts } from "./farmesh";
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

describe("mask mesh", () => {
  // 16 × 12 tiles: a 4 × 3 mask, land in the middle two columns of every row.
  const rows = Array.from({ length: 12 }, () => "wwwwggggffffwwww");
  const mask = fixtureMask(...rows);

  it("builds ground at height 0 over the land cells and the sand shelves down below the sea", () => {
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(3);
    const b = maskMeshData(mask, 7);
    expect(b.indices.length).toBeGreaterThan(0);
    expect(b.indices.length % 3).toBe(0);
    for (const v of b.positions) expect(Number.isFinite(v)).toBe(true);
    const y = ys(b);
    // Ground and rim at 0, the outer shelf's foot under the sea surface.
    expect(Math.max(...y)).toBeLessThan(0.05);
    expect(Math.min(...y)).toBeLessThan(SEA_LEVEL);
    // The land spans tiles 4…12 in x (cells 1 and 2), the two shelves (one column per tile) two tiles beyond.
    const xs = b.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(14);
    const land = b.positions.filter((_, i) => i % 3 === 0 && b.positions[i + 1] === 0);
    expect(Math.min(...land)).toBe(4);
    expect(Math.max(...land)).toBe(12);
    // Island-local z is −y: every vertex lies at or above the island's top edge's mirror.
    const zs = b.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeLessThanOrEqual(0.5);
    expect(Math.min(...zs)).toBeGreaterThan(-12.5);
  });

  it("colours the cells by their terrain band in true colours (no unsettled tint)", () => {
    const data = maskMeshData(mask, 7);
    const spread = (cols: number[]) => {
      let s = 0;
      for (let i = 0; i < cols.length; i += 4) s += Math.max(cols[i]!, cols[i + 1]!, cols[i + 2]!) - Math.min(cols[i]!, cols[i + 1]!, cols[i + 2]!);
      return s / (cols.length / 4);
    };
    // True grass/sand colours (≈ 0.23 mean channel spread); the former unsettled grey tint kept 30 % (≈ 0.07).
    expect(spread(data.colors)).toBeGreaterThan(0.15);
  });

  it("is empty for an all-water mask and merges islands at their positions", () => {
    expect(maskMeshData(fixtureMask("wwww", "wwww"), 1).indices).toHaveLength(0);
    const a = maskMeshData(mask, 7);
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
  const maskTris = maskMeshData(mask, 7).indices.length / 3;

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
});
