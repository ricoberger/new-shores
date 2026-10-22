import { describe, expect, it } from "vitest";
import { roadPieces } from "./roads";

const area = (r: [number, number, number, number]) => (r[2] - r[0]) * (r[3] - r[1]);

describe("road pieces", () => {
  const set = (tiles: [number, number][]) => {
    const s = new Set(tiles.map(([x, y]) => `${x},${y}`));
    return (x: number, y: number) => s.has(`${x},${y}`);
  };

  it("joins neighbours exactly on the shared tile edge", () => {
    const has = set([
      [0, 0],
      [1, 0],
    ]);
    const a = roadPieces({ x: 0, y: 0 }, has, 0.3);
    const b = roadPieces({ x: 1, y: 0 }, has, 0.3);
    expect(a.some((r) => r[2] === 1)).toBe(true);
    expect(b.some((r) => r[0] === 1)).toBe(true);
    // Nothing crosses into the neighbour tile.
    expect(a.every((r) => r[2] <= 1 && r[0] >= 0)).toBe(true);
  });

  it("draws a crossing as a centre and four arms without overlaps", () => {
    const has = set([
      [1, 1],
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ]);
    const pieces = roadPieces({ x: 1, y: 1 }, has, 0.3);
    expect(pieces).toHaveLength(5);
    // Centre (0.6²) plus four arms (0.6 × 0.2): no overlap means the areas add up to the cross.
    expect(pieces.reduce((n, r) => n + area(r), 0)).toBeCloseTo(0.36 + 4 * 0.12, 10);
  });

  it("an isolated tile is its centre square only", () => {
    expect(roadPieces({ x: 3, y: 4 }, () => false, 0.25)).toEqual([[3.25, 4.25, 3.75, 4.75]]);
  });
});
