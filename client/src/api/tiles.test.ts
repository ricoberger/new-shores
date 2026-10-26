import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TILES_IN_FLIGHT, TILES_RETRY_MS, TileQueue, tileOrder } from "./tiles";

describe("tile load order", () => {
  it("puts the focused island first, then those in view, then the rest in payload order", () => {
    expect(tileOrder(["a", "b", "c", "d", "e"], "d", ["e", "b", "d"])).toEqual(["d", "e", "b", "a", "c"]);
    expect(tileOrder(["a", "b"], null, [])).toEqual(["a", "b"]);
    // Unknown IDs (an island gone from the payload) are skipped.
    expect(tileOrder(["a", "b"], "x", ["y", "b"])).toEqual(["b", "a"]);
  });
});

describe("TileQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A loader whose requests are settled by the test. */
  function loader() {
    const calls: string[] = [];
    const open = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
    const load = (id: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push(id);
        open.set(id, { resolve, reject });
      });
    const settle = async (id: string, ok: boolean) => {
      const r = open.get(id)!;
      open.delete(id);
      if (ok) r.resolve();
      else r.reject(new Error("boom"));
      await vi.advanceTimersByTimeAsync(0);
    };
    return { calls, open, load, settle };
  }

  it("keeps at most two requests in flight, in priority order", async () => {
    const l = loader();
    const q = new TileQueue(l.load);
    q.setPriority("c", ["d"]);
    q.reset(["a", "b", "c", "d", "e"]);
    expect(TILES_IN_FLIGHT).toBe(2);
    expect(l.calls).toEqual(["c", "d"]);
    expect(q.pending().sort()).toEqual(["c", "d"]);
    // The camera moves on: the next free slot follows the new priority.
    q.setPriority("e", []);
    expect(l.calls).toEqual(["c", "d"]);
    await l.settle("d", true);
    expect(l.calls).toEqual(["c", "d", "e"]);
    await l.settle("c", true);
    await l.settle("e", true);
    expect(l.calls).toEqual(["c", "d", "e", "a", "b"]);
    await l.settle("a", true);
    await l.settle("b", true);
    expect(q.pending()).toEqual([]);
    // A new payload does not reload loaded islands.
    q.reset(["a", "b", "c", "d", "e"]);
    expect(l.calls).toHaveLength(5);
  });

  it("retries a failed island once after 2 s, then gives up until the next payload", async () => {
    const l = loader();
    const gaveUp: string[] = [];
    const q = new TileQueue(l.load, (f) => gaveUp.push(f.id));
    q.reset(["a"]);
    await l.settle("a", false);
    expect(l.calls).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(TILES_RETRY_MS - 1);
    expect(l.calls).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(l.calls).toEqual(["a", "a"]);
    await l.settle("a", false);
    expect(gaveUp).toEqual(["a"]);
    expect(q.failed()).toEqual(["a"]);
    expect(q.loading("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(l.calls).toHaveLength(2);
    // The next payload tries again.
    q.reset(["a"]);
    expect(l.calls).toHaveLength(3);
    await l.settle("a", true);
    expect(q.loading("a")).toBe(false);
    expect(q.failed()).toEqual([]);
  });

  it("a waiting retry leaves its slot to the next island", async () => {
    const l = loader();
    const q = new TileQueue(l.load);
    q.reset(["a", "b", "c"]);
    expect(l.calls).toEqual(["a", "b"]);
    await l.settle("a", false);
    expect(l.calls).toEqual(["a", "b", "c"]);
    await vi.advanceTimersByTimeAsync(TILES_RETRY_MS);
    // Both slots busy (b, c): the retry waits for one.
    expect(l.calls).toEqual(["a", "b", "c"]);
    await l.settle("b", true);
    expect(l.calls).toEqual(["a", "b", "c", "a"]);
  });

  it("clear drops the results of the earlier archipelago and loads again", async () => {
    const l = loader();
    const q = new TileQueue(l.load);
    q.reset(["a"]);
    const old = l.open.get("a")!;
    q.clear();
    q.reset(["a"]);
    expect(l.calls).toEqual(["a", "a"]);
    old.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.pending()).toEqual(["a"]);
    expect(q.loading("a")).toBe(true);
  });
});
