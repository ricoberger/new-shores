import { describe, expect, it } from "vitest";
import { BUILD_BUDGET_MS, type BuildItem, buildOrder, BuildScheduler, drainBudget } from "./buildqueue";

const item = (island: string, chunk: string | null, focus: boolean, visible: boolean, dist: number): BuildItem => ({ island, chunk, focus, visible, dist });

describe("island build order", () => {
  it("puts the focused island first, then visible chunks before culled ones, nearest first", () => {
    const order = buildOrder([
      item("b", "0,0", false, false, 1),
      item("b", "1,0", false, true, 50),
      item("c", "0,0", false, true, 20),
      item("a", "1,1", true, false, 90),
      item("a", "0,0", true, true, 40),
      item("c", "1,0", false, true, 5),
    ]);
    expect(order.map((it) => `${it.island}/${it.chunk}`)).toEqual(["a/0,0", "a/1,1", "c/1,0", "c/0,0", "b/1,0", "b/0,0"]);
  });

  it("puts an island's head before its chunks at the same distance, and is deterministic on ties", () => {
    const order = buildOrder([item("b", "0,0", false, true, 3), item("a", "0,0", false, true, 3), item("a", null, false, true, 3)]);
    expect(order.map((it) => `${it.island}/${it.chunk ?? "head"}`)).toEqual(["a/head", "a/0,0", "b/0,0"]);
  });

  it("budgets 6 ms on desktop and 4 ms on phones and tablets", () => {
    expect(BUILD_BUDGET_MS).toEqual({ high: 6, low: 4 });
  });
});

describe("budgeted drain (fake clock)", () => {
  it("runs steps while the time read before each step is inside the budget", () => {
    let t = 1000;
    const costs = [1.5, 1.5, 1.5, 1.5, 1.5];
    const ran: number[] = [];
    const n = drainBudget(
      () => {
        const c = costs[ran.length];
        if (c === undefined) return false;
        ran.push(c);
        t += c;
        return true;
      },
      () => t,
      4,
    );
    // Started at 0, 1.5 and 3.0 ms; at 4.5 ms the budget is spent.
    expect(n).toBe(3);
    expect(t - 1000).toBe(4.5);
  });

  it("finishes early when the queue runs empty and overruns by at most the step that started inside", () => {
    let t = 0;
    let left = 2;
    expect(drainBudget(() => (left-- > 0 ? ((t += 1), true) : false), () => t, 6)).toBe(2);
    t = 0;
    expect(drainBudget(() => ((t += 10), true), () => t, 6)).toBe(1);
    expect(drainBudget(() => true, () => 0, 0)).toBe(0);
  });
});

describe("build scheduler", () => {
  it("builds nothing before the first frame was rendered, nor while not ready", () => {
    const s = new BuildScheduler();
    let steps = 0;
    const step = () => steps++ < 3;
    expect(s.drain(step, () => 0, 6)).toBe(0);
    expect(steps).toBe(0);
    s.frameRendered();
    expect(s.drain(step, () => 0, 6, false)).toBe(0);
    expect(steps).toBe(0);
    expect(s.drain(step, () => 0, 6)).toBe(3);
  });
});
