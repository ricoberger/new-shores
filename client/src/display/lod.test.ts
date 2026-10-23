import { describe, expect, it } from "vitest";
import { fitHalfHeight, MIN_HALF_HEIGHT, NEAR_DEFAULT_HALF_HEIGHT } from "./camera";
import {
  detailFor,
  FAR_ENTER_HALF,
  FAR_EXIT_HALF,
  FULL_DETAIL_ENTER_HALF,
  FULL_DETAIL_EXIT_HALF,
  initialLod,
  type Lod,
  liteTier,
  lodFor,
  modelsAtMid,
  MID_TO_NEAR_HALF,
  NEAR_EXIT_HALF,
} from "./lod";

// Dev world geometry (server/internal/devworld): start 56 × 40 at (0,0),
// island 2 40 × 18 at (72,96): bounding box 112 × 114.
const DEV_BOUNDS = { w: 112, h: 114 };
const VIEWPORTS = [
  { name: "1280 × 800", aspect: 1280 / 800 },
  { name: "412 × 915", aspect: 412 / 915 },
];

/** The levels of a sequence of half extents, starting at `start`. */
function run(halves: number[], start: Lod = "near"): Lod[] {
  const out: Lod[] = [];
  let lod = start;
  for (const h of halves) {
    lod = lodFor(h, lod);
    out.push(lod);
  }
  return out;
}

describe("LOD thresholds", () => {
  it("enter and leave thresholds of each boundary differ by at least 10 %", () => {
    expect(NEAR_EXIT_HALF / MID_TO_NEAR_HALF).toBeGreaterThanOrEqual(1.1);
    expect(FAR_ENTER_HALF / FAR_EXIT_HALF).toBeGreaterThanOrEqual(1.1);
    // The bands are ordered and the mid band is non-empty.
    expect(NEAR_EXIT_HALF).toBeLessThan(FAR_EXIT_HALF);
  });

  for (const vp of VIEWPORTS) {
    it(`dev world on ${vp.name}: near default is near, the whole-archipelago fit is far, mid is reachable`, () => {
      expect(initialLod(NEAR_DEFAULT_HALF_HEIGHT)).toBe("near");
      for (const prev of ["near", "mid", "far"] as const) expect(lodFor(NEAR_DEFAULT_HALF_HEIGHT, prev)).toBe("near");
      const fit = fitHalfHeight(DEV_BOUNDS.w, DEV_BOUNDS.h, vp.aspect);
      for (const prev of ["near", "mid", "far"] as const) expect(lodFor(fit, prev)).toBe("far");
      // A zoom inside the mid band (between near default and the fit) is mid.
      const between = (NEAR_EXIT_HALF + FAR_ENTER_HALF) / 2;
      expect(between).toBeGreaterThan(NEAR_DEFAULT_HALF_HEIGHT);
      expect(between).toBeLessThan(fit);
      expect(lodFor(between, "near")).toBe("mid");
      expect(lodFor(between, "far")).toBe("mid");
    });
  }
});

describe("LOD hysteresis", () => {
  it("zooming out passes near → mid → far monotonically, zooming in far → mid → near", () => {
    const out = Array.from({ length: 60 }, (_, i) => 10 * 1.05 ** i);
    expect(run(out)).toEqual([...run(out)].sort((a, b) => ["near", "mid", "far"].indexOf(a) - ["near", "mid", "far"].indexOf(b)));
    expect(run(out).at(-1)).toBe("far");
    const back = [...out].reverse();
    const seq = run(back, "far");
    expect(seq.at(-1)).toBe("near");
    expect(seq).toEqual([...seq].sort((a, b) => ["far", "mid", "near"].indexOf(a) - ["far", "mid", "near"].indexOf(b)));
  });

  it("switches near → mid only above the enter threshold and back only below the leave threshold", () => {
    expect(lodFor(NEAR_EXIT_HALF, "near")).toBe("near");
    expect(lodFor(NEAR_EXIT_HALF + 0.01, "near")).toBe("mid");
    expect(lodFor(MID_TO_NEAR_HALF, "mid")).toBe("mid");
    expect(lodFor(MID_TO_NEAR_HALF - 0.01, "mid")).toBe("near");
    expect(lodFor(FAR_ENTER_HALF, "mid")).toBe("mid");
    expect(lodFor(FAR_ENTER_HALF + 0.01, "mid")).toBe("far");
    expect(lodFor(FAR_EXIT_HALF, "far")).toBe("far");
    expect(lodFor(FAR_EXIT_HALF - 0.01, "far")).toBe("mid");
  });

  it("oscillating around a boundary flips at most once", () => {
    for (const [boundary, start] of [
      [NEAR_EXIT_HALF, "near"],
      [MID_TO_NEAR_HALF, "mid"],
      [FAR_ENTER_HALF, "mid"],
      [FAR_EXIT_HALF, "far"],
    ] as const) {
      const wobble = Array.from({ length: 40 }, (_, i) => boundary * (1 + (i % 2 === 0 ? 0.04 : -0.04)));
      const seq = run(wobble, start);
      let flips = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++;
      expect(flips, `around ${boundary} from ${start}`).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic: the same half extent and previous level give the same level", () => {
    for (const prev of ["near", "mid", "far"] as const) {
      for (let h = 5; h < 300; h += 0.5) expect(lodFor(h, prev)).toBe(lodFor(h, prev));
    }
    // Jumps across a whole band land on the right level.
    expect(lodFor(200, "near")).toBe("far");
    expect(lodFor(10, "far")).toBe("near");
  });
});

describe("model detail inside the near level", () => {
  it("draws the lite models at the near default zoom and the full ones zoomed in, with hysteresis", () => {
    expect(detailFor(NEAR_DEFAULT_HALF_HEIGHT, "lite")).toBe("lite");
    expect(detailFor(NEAR_DEFAULT_HALF_HEIGHT, "full")).toBe("lite");
    expect(detailFor(MIN_HALF_HEIGHT, "lite")).toBe("full");
    expect(detailFor(FULL_DETAIL_ENTER_HALF, "lite")).toBe("full");
    // Between the thresholds the previous detail stays.
    const mid = (FULL_DETAIL_ENTER_HALF + FULL_DETAIL_EXIT_HALF) / 2;
    expect(detailFor(mid, "lite")).toBe("lite");
    expect(detailFor(mid, "full")).toBe("full");
    expect(detailFor(FULL_DETAIL_EXIT_HALF + 0.01, "full")).toBe("lite");
    expect(FULL_DETAIL_EXIT_HALF / FULL_DETAIL_ENTER_HALF).toBeGreaterThanOrEqual(1.1);
  });

  it("keeps the lite tier unless ?detail=full", () => {
    expect(liteTier("")).toBe(true);
    expect(liteTier("?stats=1")).toBe(true);
    expect(liteTier("?detail=full&stats=1")).toBe(false);
  });

  it("draws the blocks at mid LOD unless ?mid=models", () => {
    expect(modelsAtMid("")).toBe(false);
    expect(modelsAtMid("?mid=blocks")).toBe(false);
    expect(modelsAtMid("?detail=full&mid=models")).toBe(true);
  });
});
