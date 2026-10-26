import { describe, expect, it } from "vitest";
import { byChunk, CHUNK, chunkAt, changedChunks, islandChunks, visibleChunks } from "./chunks";

describe("island chunks", () => {
  it("cover every tile of an island exactly once, clipped at its edges", () => {
    for (const [w, h] of [
      [1, 1],
      [32, 32],
      [33, 31],
      [160, 100],
      [161, 97],
    ] as const) {
      const chunks = islandChunks(w, h);
      const hits = new Uint8Array(w * h);
      for (const c of chunks) {
        expect(c.width).toBeGreaterThan(0);
        expect(c.height).toBeGreaterThan(0);
        expect(c.width).toBeLessThanOrEqual(CHUNK);
        expect(c.height).toBeLessThanOrEqual(CHUNK);
        for (let y = c.y; y < c.y + c.height; y++) for (let x = c.x; x < c.x + c.width; x++) hits[y * w + x]! += 1;
        // The key names the chunk of every tile in it.
        expect(chunkAt(c.x + c.width - 1, c.y + c.height - 1)).toBe(c.key);
      }
      expect(hits.every((n) => n === 1)).toBe(true);
      expect(chunks).toHaveLength(Math.ceil(w / CHUNK) * Math.ceil(h / CHUNK));
    }
  });

  it("puts points beyond the island's edge (the slab) into the edge chunks", () => {
    expect(chunkAt(-0.4, -2)).toBe("0,0");
    expect(chunkAt(64.3, 10, 64, 50)).toBe("1,0");
    expect(chunkAt(70, 51, 64, 50)).toBe("1,1");
    expect(chunkAt(64.3, 10)).toBe("2,0");
  });

  it("groups items by chunk", () => {
    const g = byChunk(
      [
        { x: 0, y: 0 },
        { x: 31, y: 31 },
        { x: 32, y: 0 },
        { x: 5, y: 40 },
      ],
      (p) => p,
    );
    expect([...g.keys()].sort()).toEqual(["0,0", "0,1", "1,0"]);
    expect(g.get("0,0")).toHaveLength(2);
  });

  it("finds the chunks in a ground footprint (with a margin)", () => {
    const island = { position: { x: 100, y: 200 }, width: 96, height: 64 };
    // A small view over chunk 1,0 (archipelago x 132–163, y 200–231).
    const quad = [
      { x: 140, y: 210 },
      { x: 150, y: 210 },
      { x: 150, y: 220 },
      { x: 140, y: 220 },
    ];
    expect([...visibleChunks(island, quad, 0)]).toEqual(["1,0"]);
    // The margin reaches into the neighbour 8 tiles away (x 132), not the one 12 tiles away (y 232).
    expect([...visibleChunks(island, quad, 10)].sort()).toEqual(["0,0", "1,0"]);
    // Off the island: nothing.
    expect(visibleChunks(island, quad.map((p) => ({ x: p.x + 500, y: p.y })), 8).size).toBe(0);
  });

  it("picks exactly the chunks whose input changed (gained, lost or different)", () => {
    const prev = new Map([
      ["0,0", "a"],
      ["1,0", "b"],
      ["0,1", "c"],
    ]);
    const next = new Map([
      ["0,0", "a"],
      ["1,0", "B"],
      ["1,1", "d"],
    ]);
    expect(changedChunks(prev, next).sort()).toEqual(["0,1", "1,0", "1,1"]);
    expect(changedChunks(prev, prev)).toEqual([]);
    expect(changedChunks(null, next).sort()).toEqual(["0,0", "1,0", "1,1"]);
    // An empty signature is no input.
    expect(changedChunks(new Map([["0,0", ""]]), new Map())).toEqual([]);
  });
});
