import { describe, expect, it } from "vitest";
import { dashPieces } from "./dash";

const len = (p: [{ x: number; y: number }, { x: number; y: number }]) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);

describe("draft ribbon dashes", () => {
  it("splits a closed loop into dashes and gaps of the given lengths", () => {
    // A 10 × 0 there-and-back loop: 20 tiles, on 3, off 2 → 4 periods.
    const pieces = dashPieces([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3, 2);
    const drawn = pieces.reduce((n, p) => n + len(p), 0);
    expect(drawn).toBeCloseTo(12);
    expect(pieces[0]).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    expect(pieces[1]).toEqual([{ x: 5, y: 0 }, { x: 8, y: 0 }]);
    // The way back: the dashes at 10–13 and 15–18 of the loop's length.
    expect(pieces.slice(2)).toEqual([
      [{ x: 10, y: 0 }, { x: 7, y: 0 }],
      [{ x: 5, y: 0 }, { x: 2, y: 0 }],
    ]);
  });

  it("carries the phase around corners and skips repeated points", () => {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    const pieces = dashPieces(sq, 1.5, 1);
    // 8 tiles around: dashes at 0–1.5, 2.5–4, 5–6.5, 7.5–8 (the corners at 2, 4 and 6 do not restart a dash; the one at 6 splits one).
    expect(pieces.reduce((n, p) => n + len(p), 0)).toBeCloseTo(1.5 + 1.5 + 1.5 + 0.5);
    expect(pieces[0]).toEqual([{ x: 0, y: 0 }, { x: 1.5, y: 0 }]);
    expect(pieces[1]).toEqual([{ x: 2, y: 0.5 }, { x: 2, y: 2 }]);
  });

  it("draws nothing for a degenerate input", () => {
    expect(dashPieces([{ x: 1, y: 1 }], 1, 1)).toEqual([]);
    expect(dashPieces([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0, 1)).toEqual([]);
  });
});
