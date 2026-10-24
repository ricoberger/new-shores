import { describe, expect, it } from "vitest";
import { allocate, hash01, LIFE_BUDGETS, lifeAtLod, lifeBudget, lifeEnabled, lifeHash, loopPhase, mod, pingPong, spreadPhase } from "./life";

describe("life budgets", () => {
  it("follows the device class: phones 150 instances / 64 particles, desktop 400", () => {
    expect(lifeBudget("low")).toEqual({ instances: 150, particles: 64 });
    expect(lifeBudget("high").instances).toBe(400);
    expect(LIFE_BUDGETS.high.particles).toBeGreaterThanOrEqual(LIFE_BUDGETS.low.particles);
  });

  it("allocates in priority order, partly granting the demand that crosses the budget", () => {
    expect(allocate([60, 60, 40], 150)).toEqual([60, 60, 30]);
    expect(allocate([200, 10], 150)).toEqual([150, 0]);
    expect(allocate([1, 2, 3], 100)).toEqual([1, 2, 3]);
    expect(allocate([5, 5], 0)).toEqual([0, 0]);
    expect(allocate([2.7, -1, 4], 5)).toEqual([2, 0, 3]);
  });

  it("draws by LOD: everything at near, smoke and props at mid, nothing at far", () => {
    expect(lifeAtLod("near")).toEqual({ moving: true, smoke: true, props: true });
    expect(lifeAtLod("mid")).toEqual({ moving: false, smoke: true, props: true });
    expect(lifeAtLod("far")).toEqual({ moving: false, smoke: false, props: false });
  });

  it("is switched off by ?life=0 only", () => {
    expect(lifeEnabled("")).toBe(true);
    expect(lifeEnabled("?life=1&stats=1")).toBe(true);
    expect(lifeEnabled("?fixture=town&life=0")).toBe(false);
  });
});

describe("phase math", () => {
  it("is ((now − start) / period) mod 1, also before the start", () => {
    expect(loopPhase(1500, 1000, 1000)).toBeCloseTo(0.5);
    expect(loopPhase(3250, 1000, 1000)).toBeCloseTo(0.25);
    expect(loopPhase(750, 1000, 1000)).toBeCloseTo(0.75);
    expect(loopPhase(5, 0, 0)).toBe(0);
    expect(mod(-0.25, 1)).toBeCloseTo(0.75);
  });

  it("spreads n elements evenly and runs round trips out and back", () => {
    expect([0, 1, 2].map((i) => spreadPhase(i, 3))).toEqual([0, 1 / 3, 2 / 3]);
    expect(spreadPhase(0, 0)).toBe(0);
    expect(pingPong(0)).toBe(0);
    expect(pingPong(0.25)).toBeCloseTo(0.5);
    expect(pingPong(0.5)).toBe(1);
    expect(pingPong(0.75)).toBeCloseTo(0.5);
    expect(pingPong(1.25)).toBeCloseTo(0.5);
  });
});

describe("hash placement", () => {
  it("is deterministic and spreads consecutive IDs", () => {
    expect(lifeHash(42, "stroller", 0)).toBe(lifeHash(42, "stroller", 0));
    expect(lifeHash(42, "stroller", 0)).not.toBe(lifeHash(42, "stroller", 1));
    const xs = Array.from({ length: 1000 }, (_, i) => hash01(i, "x"));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    // Roughly uniform: every tenth gets 60–140 of 1000.
    const bins = new Array(10).fill(0) as number[];
    for (const x of xs) bins[Math.floor(x * 10)]!++;
    for (const n of bins) expect(n).toBeGreaterThan(60);
  });
});
