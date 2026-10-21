import { describe, expect, it } from "vitest";
import { GestureRecognizer, type GestureEvent } from "./gestures";
import { JumpLatch } from "./latch";

/** Feeds a recogniser and a latch like PointerInput and the renderer do; records what the renderer would act on. */
function harness() {
  const latch = new JumpLatch();
  let animating = false;
  const acted: string[] = [];
  const pointers = new Set<number>();
  const g = new GestureRecognizer((e: GestureEvent) => {
    // The renderer acts on pan/zoom/drag/tap only when not blocked; cancel never acts.
    if (e.type === "cancel" || e.type === "hover" || e.type === "wheel") return;
    if (!latch.blocks(animating)) acted.push(e.type);
  });
  return {
    acted,
    setAnimating: (a: boolean) => (animating = a),
    down(id: number, x: number, y: number, t: number) {
      latch.down(pointers.size === 0, animating);
      pointers.add(id);
      g.down(id, "touch", 0, { x, y }, t);
    },
    move: (id: number, x: number, y: number, t: number) => g.move(id, "touch", { x, y }, t),
    up(id: number, x: number, y: number, t: number) {
      g.up(id, { x, y }, t);
      pointers.delete(id);
      if (pointers.size === 0) latch.released();
    },
    latch,
  };
}

describe("JumpLatch", () => {
  it("a one-finger drag promoted to a pinch during a jump stays ignored after the jump until all fingers are up", () => {
    const h = harness();
    h.setAnimating(true);
    h.down(1, 100, 100, 0);
    h.move(1, 140, 100, 20); // a drag starts (ignored)
    h.down(2, 200, 100, 40); // promotion: the recogniser emits cancel
    h.setAnimating(false); // the jump ends with both fingers down
    h.move(1, 60, 100, 500);
    h.move(2, 260, 100, 510); // fingers widen: a pinch, still ignored
    expect(h.acted).toEqual([]);
    h.up(1, 60, 100, 600);
    h.up(2, 260, 100, 600);
    // A fresh pinch after release acts.
    h.down(3, 100, 100, 1000);
    h.down(4, 200, 100, 1010);
    h.move(3, 60, 100, 1050);
    h.move(4, 260, 100, 1060);
    expect(h.acted).toContain("pinch");
  });

  it("a finger added after the jump to a press that began during it keeps that press ignored; a press after the jump acts", () => {
    const h = harness();
    h.setAnimating(true);
    h.down(1, 100, 100, 0);
    h.setAnimating(false);
    h.down(2, 200, 100, 400); // not first: the ignored press goes on
    h.move(1, 60, 100, 450);
    h.move(2, 260, 100, 460);
    expect(h.acted).toEqual([]);
    h.up(1, 60, 100, 500);
    h.up(2, 260, 100, 500);
    h.down(3, 100, 100, 600);
    h.up(3, 100, 100, 650);
    expect(h.acted).toEqual(["tap"]);
  });

  it("blocks everything while a jump animates and nothing otherwise", () => {
    const l = new JumpLatch();
    expect(l.blocks(true)).toBe(true);
    expect(l.blocks(false)).toBe(false);
    l.down(true, false);
    expect(l.blocks(false)).toBe(false);
    l.down(false, true); // a finger added during a jump ignores the rest of the press
    expect(l.blocks(false)).toBe(true);
    l.released();
    expect(l.blocks(false)).toBe(false);
  });
});
