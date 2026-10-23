import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  type GestureEvent,
  GestureRecognizer,
  LONG_PRESS_MS,
  PINCH_START_PX,
  ROTATE_STEP_RAD,
  TWIST_START_RAD,
  TOUCH_SLOP_PX,
} from "./gestures";

function setup() {
  const events: GestureEvent[] = [];
  const g = new GestureRecognizer((e) => events.push(e));
  const types = () => events.filter((e) => e.type !== "hover").map((e) => e.type);
  return { g, events, types };
}

const pt = (x: number, y: number) => ({ x, y });

describe("one pointer", () => {
  it("a mouse press without movement past the threshold is a tap", () => {
    const { g, events, types } = setup();
    g.down(1, "mouse", 0, pt(10, 10), 0);
    g.move(1, "mouse", pt(10 + DRAG_THRESHOLD_PX, 10));
    g.up(1, pt(12, 10));
    expect(types()).toEqual(["tap"]);
    expect(events.at(-1)).toEqual({ type: "tap", p: pt(12, 10), button: 0, kind: "mouse" });
    // The mouse hovers on every move.
    expect(events.filter((e) => e.type === "hover")).toHaveLength(1);
  });

  it("a mouse drag past the threshold emits start, moves and end", () => {
    const { g, events, types } = setup();
    g.down(1, "mouse", 2, pt(0, 0), 0);
    g.move(1, "mouse", pt(3, 0));
    g.move(1, "mouse", pt(DRAG_THRESHOLD_PX + 1, 0));
    g.move(1, "mouse", pt(20, 0));
    g.up(1, pt(20, 0));
    expect(types()).toEqual(["dragStart", "dragMove", "dragMove", "dragEnd"]);
    expect(events.find((e) => e.type === "dragStart")).toEqual({ type: "dragStart", start: pt(0, 0), button: 2, kind: "mouse" });
    const moves = events.filter((e) => e.type === "dragMove");
    // The first move starts at the press point (no movement is lost to the threshold).
    expect(moves[0]).toMatchObject({ prev: pt(0, 0), cur: pt(DRAG_THRESHOLD_PX + 1, 0) });
    expect(moves[1]).toMatchObject({ prev: pt(DRAG_THRESHOLD_PX + 1, 0), cur: pt(20, 0) });
  });

  it("touch uses the larger slop for tap vs drag and never hovers", () => {
    const { g, events, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.move(1, "touch", pt(TOUCH_SLOP_PX, 0));
    g.up(1, pt(TOUCH_SLOP_PX, 0));
    expect(types()).toEqual(["tap"]);
    g.down(2, "touch", 0, pt(0, 0), 100);
    g.move(2, "touch", pt(TOUCH_SLOP_PX + 1, 0));
    g.up(2, pt(TOUCH_SLOP_PX + 1, 0));
    expect(types()).toEqual(["tap", "dragStart", "dragMove", "dragEnd"]);
    expect(events.some((e) => e.type === "hover")).toBe(false);
  });

  it("pen behaves like the mouse (drag threshold, hover, no long-press)", () => {
    const { g, types } = setup();
    g.down(1, "pen", 0, pt(0, 0), 0);
    expect(g.deadline()).toBeNull();
    g.tick(LONG_PRESS_MS * 2);
    g.move(1, "pen", pt(DRAG_THRESHOLD_PX + 1, 0));
    g.up(1, pt(DRAG_THRESHOLD_PX + 1, 0));
    expect(types()).toEqual(["dragStart", "dragMove", "dragEnd"]);
  });

  it("ignores a second press while one is held", () => {
    const { g, types } = setup();
    expect(g.down(1, "mouse", 0, pt(0, 0), 0)).toBe(true);
    expect(g.down(2, "mouse", 1, pt(5, 5), 0)).toBe(false);
    g.up(2, pt(5, 5));
    g.up(1, pt(0, 0));
    expect(types()).toEqual(["tap"]);
  });
});

describe("long-press", () => {
  it("fires after LONG_PRESS_MS of a still touch and suppresses the tap", () => {
    const { g, events, types } = setup();
    g.down(1, "touch", 0, pt(50, 50), 1000);
    expect(g.deadline()).toBe(1000 + LONG_PRESS_MS);
    g.tick(1000 + LONG_PRESS_MS - 1);
    expect(types()).toEqual([]);
    g.move(1, "touch", pt(54, 52)); // within the slop
    g.tick(1000 + LONG_PRESS_MS);
    expect(types()).toEqual(["longPress"]);
    expect(events.at(-1)).toEqual({ type: "longPress", p: pt(54, 52), kind: "touch" });
    // Moving and lifting after the long-press does nothing more.
    g.move(1, "touch", pt(120, 50));
    g.up(1, pt(120, 50));
    expect(types()).toEqual(["longPress"]);
    expect(g.deadline()).toBeNull();
  });

  it("is cancelled by movement past the slop (it becomes a drag)", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.move(1, "touch", pt(0, TOUCH_SLOP_PX + 1));
    expect(g.deadline()).toBeNull();
    g.tick(LONG_PRESS_MS * 2);
    g.up(1, pt(0, 20));
    expect(types()).toEqual(["dragStart", "dragMove", "dragEnd"]);
  });

  it("is cancelled by a release before the deadline (a tap)", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.up(1, pt(0, 0));
    g.tick(LONG_PRESS_MS);
    expect(types()).toEqual(["tap"]);
  });

  it("is cancelled by a second finger", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.down(2, "touch", 0, pt(100, 0), 100);
    g.tick(LONG_PRESS_MS * 2);
    g.up(1, pt(0, 0));
    g.up(2, pt(100, 0));
    expect(types()).toEqual([]);
  });

  it("is decided by event times: a release after the deadline is a long-press even if tick never ran", () => {
    // A busy main thread: the deadline timer has not run when the release is processed.
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 1000);
    g.up(1, pt(0, 0), 1000 + LONG_PRESS_MS + 50);
    expect(types()).toEqual(["longPress"]);
    // A release before the deadline, processed late, is still a tap.
    g.down(2, "touch", 0, pt(0, 0), 5000);
    g.up(2, pt(0, 0), 5000 + 30);
    expect(types()).toEqual(["longPress", "tap"]);
  });

  it("is decided by event times: a move sampled before the deadline starts a drag; after it, the long-press wins", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.move(1, "touch", pt(40, 0), 100);
    g.tick(LONG_PRESS_MS * 2);
    g.up(1, pt(40, 0), LONG_PRESS_MS * 2);
    expect(types()).toEqual(["dragStart", "dragMove", "dragEnd"]);
    g.down(2, "touch", 0, pt(0, 0), 10_000);
    g.move(2, "touch", pt(2, 0), 10_000 + LONG_PRESS_MS + 1); // still within the slop
    g.move(2, "touch", pt(60, 0), 10_000 + LONG_PRESS_MS + 20);
    g.up(2, pt(60, 0), 10_000 + LONG_PRESS_MS + 40);
    expect(types().slice(3)).toEqual(["longPress"]);
  });

  it("never fires for the mouse", () => {
    const { g, types } = setup();
    g.down(1, "mouse", 0, pt(0, 0), 0);
    g.tick(LONG_PRESS_MS * 3);
    g.up(1, pt(0, 0));
    expect(types()).toEqual(["tap"]);
  });
});

describe("two fingers", () => {
  it("pinch reports centre, per-update scale and translation after the start threshold", () => {
    const { g, events, types } = setup();
    g.down(1, "touch", 0, pt(100, 100), 0);
    g.down(2, "touch", 0, pt(200, 100), 10);
    // Below the threshold nothing happens.
    g.move(2, "touch", pt(200 + PINCH_START_PX - 1, 100));
    expect(types()).toEqual([]);
    // Spread to 200 px: scale relative to the start (100 px).
    g.move(2, "touch", pt(300, 100));
    const first = events.at(-1);
    expect(first).toMatchObject({ type: "pinch", centre: pt(200, 100), scale: 2 });
    expect(first?.type === "pinch" && first.translation).toEqual(pt(50, 0));
    // Next updates relative to the previous one: both fingers move down by 20
    // (one after the other); the distance is back at 200 afterwards.
    g.move(1, "touch", pt(100, 120));
    g.move(2, "touch", pt(300, 120));
    const pinches = events.filter((e) => e.type === "pinch");
    const last = pinches.at(-1);
    expect(last?.type === "pinch" && last.centre).toEqual(pt(200, 120));
    expect(last?.type === "pinch" && last.translation).toEqual(pt(0, 10));
    // Product of the scales equals the total distance ratio.
    const total = pinches.reduce((k, e) => k * (e.type === "pinch" ? e.scale : 1), 1);
    expect(total).toBeCloseTo(2, 6);
    g.up(1, pt(100, 120));
    g.up(2, pt(300, 120));
    expect(types().filter((t) => t !== "pinch")).toEqual([]);
  });

  it("a pinch never produces a tap, long-press or drag", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(100, 100), 0);
    g.down(2, "touch", 0, pt(120, 100), 50);
    g.move(1, "touch", pt(80, 100));
    g.move(2, "touch", pt(160, 100));
    g.tick(LONG_PRESS_MS * 2);
    g.up(2, pt(160, 100));
    // The remaining finger moves and lifts: nothing.
    g.move(1, "touch", pt(10, 10));
    g.up(1, pt(10, 10));
    expect(types().every((t) => t === "pinch")).toBe(true);
    // A new press afterwards works normally.
    g.down(3, "touch", 0, pt(0, 0), 2000);
    g.up(3, pt(0, 0));
    expect(types().at(-1)).toBe("tap");
  });

  it("a second finger cancels a running one-finger drag", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.move(1, "touch", pt(40, 0));
    g.down(2, "touch", 0, pt(100, 100), 10);
    g.up(1, pt(40, 0));
    g.up(2, pt(100, 100));
    expect(types()).toEqual(["dragStart", "dragMove", "cancel"]);
  });

  it("rotate accumulates the angle and emits one step per threshold crossing", () => {
    const { g, events } = setup();
    const r = 100;
    const at = (a: number) => pt(200 + r * Math.cos(a), 200 + r * Math.sin(a));
    // Fingers opposite each other around (200, 200); finger 2 orbits.
    g.down(1, "touch", 0, pt(200 - r, 200), 0);
    g.down(2, "touch", 0, at(0), 0);
    const steps = () => events.filter((e) => e.type === "rotate" && e.steps !== 0);
    // Turning finger 2 about finger 1 by small increments.
    const orbit = (a: number) => pt(200 - r + 2 * r * Math.cos(a), 200 + 2 * r * Math.sin(a));
    for (let a = 0.05; a < ROTATE_STEP_RAD * 0.95; a += 0.05) g.move(2, "touch", orbit(a));
    expect(steps()).toHaveLength(0);
    g.move(2, "touch", orbit(ROTATE_STEP_RAD + 0.01));
    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toMatchObject({ steps: 1 });
    for (let a = ROTATE_STEP_RAD; a < 2 * ROTATE_STEP_RAD + 0.05; a += 0.05) g.move(2, "touch", orbit(a));
    expect(steps()).toHaveLength(2);
    const last = steps().at(-1);
    expect(last?.type === "rotate" && last.angle).toBeGreaterThan(2 * ROTATE_STEP_RAD);
    // Turning back crosses the thresholds in the other direction.
    for (let a = 2 * ROTATE_STEP_RAD; a > -0.05; a -= 0.05) g.move(2, "touch", orbit(a));
    expect(steps().slice(2).map((e) => (e.type === "rotate" ? e.steps : 0))).toEqual([-1, -1]);
  });

  it("emits the continuous twist past a dead zone, without a jump, summing to the twist beyond it", () => {
    const { g, events } = setup();
    const r = 100;
    g.down(1, "touch", 0, pt(200 - r, 200), 0);
    g.down(2, "touch", 0, pt(200 + r, 200), 0);
    const orbit = (a: number) => pt(200 - r + 2 * r * Math.cos(a), 200 + 2 * r * Math.sin(a));
    const deltas = () => events.flatMap((e) => (e.type === "rotate" && e.delta !== 0 ? [e.delta] : []));
    // Inside the dead zone: nothing turns.
    for (let a = 0.02; a < TWIST_START_RAD * 0.9; a += 0.02) g.move(2, "touch", orbit(a));
    expect(deltas()).toEqual([]);
    for (let a = TWIST_START_RAD; a <= 0.6 + 1e-9; a += 0.02) g.move(2, "touch", orbit(a));
    const sum = deltas().reduce((n, d) => n + d, 0);
    const angle = events.filter((e) => e.type === "rotate").at(-1)!;
    expect(angle.type === "rotate" && sum).toBeCloseTo((angle.type === "rotate" ? angle.angle : 0) - TWIST_START_RAD, 9);
    // Each delta is a small step (no jump by the dead zone).
    expect(Math.max(...deltas())).toBeLessThan(0.05);
    expect(events.find((e) => e.type === "rotate")).toMatchObject({ centre: expect.any(Object) });
  });

  it("does not combine a mouse with a touch", () => {
    const { g, types } = setup();
    g.down(1, "mouse", 0, pt(0, 0), 0);
    expect(g.down(2, "touch", 0, pt(10, 10), 0)).toBe(false);
    g.up(1, pt(0, 0));
    expect(types()).toEqual(["tap"]);
  });
});

describe("cancellation", () => {
  it("pointercancel ends a drag without dragEnd and a press without tap", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.move(1, "touch", pt(30, 0));
    g.cancelPointer(1);
    g.up(1, pt(30, 0));
    expect(types()).toEqual(["dragStart", "dragMove", "cancel"]);
    g.down(2, "mouse", 0, pt(0, 0), 10);
    g.cancelPointer(2);
    g.up(2, pt(0, 0));
    expect(types().slice(3)).toEqual(["cancel"]);
  });

  it("pointercancel of one finger ends the two-finger gesture", () => {
    const { g, types } = setup();
    g.down(1, "touch", 0, pt(0, 0), 0);
    g.down(2, "touch", 0, pt(100, 0), 0);
    g.cancelPointer(2);
    g.move(1, "touch", pt(50, 50));
    g.up(1, pt(50, 50));
    expect(types()).toEqual(["cancel"]);
  });

  it("cancel() from outside stops the held pointer; its later moves are hovers", () => {
    const { g, events, types } = setup();
    g.down(1, "mouse", 0, pt(0, 0), 0);
    g.move(1, "mouse", pt(20, 0));
    expect(g.cancel()).toEqual([1]);
    g.move(1, "mouse", pt(40, 0));
    g.up(1, pt(40, 0));
    expect(types()).toEqual(["dragStart", "dragMove", "cancel"]);
    expect(events.at(-1)).toEqual({ type: "hover", p: pt(40, 0) });
    expect(g.cancel()).toEqual([]);
  });

  it("leave hovers null only when nothing is pressed; wheel passes through", () => {
    const { g, events } = setup();
    g.down(1, "mouse", 0, pt(0, 0), 0);
    g.leave();
    expect(events).toEqual([]);
    g.up(1, pt(0, 0));
    g.leave();
    g.wheel(pt(1, 2), 300);
    expect(events.slice(1)).toEqual([
      { type: "hover", p: null },
      { type: "wheel", p: pt(1, 2), deltaY: 300 },
    ]);
  });
});
