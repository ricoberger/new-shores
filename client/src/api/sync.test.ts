import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayState, WorldResponse } from "./client";
import { GameSync } from "./sync";

function world(version: number, evaluatedAt: string, nextChangeAt: string | null): WorldResponse {
  const display: DisplayState = {
    evaluated_at: evaluatedAt,
    next_change_at: nextChangeAt,
    gold: 1000,
    balance_rate_per_min: 0,
    tax_rate_per_min: 0,
    upkeep_rate_per_min: 0,
    tiers: [],
    islands: [],
  };
  return { version, display };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("GameSync", () => {
  let worlds: WorldResponse[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const target = new EventTarget();
    vi.stubGlobal("document", Object.assign(target, { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    worlds = [];
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/content")) return json({ region: {}, tiers: [], goods: [], buildings: [], needs: [] });
      const next = worlds.shift();
      if (!next) throw new Error("unexpected fetch " + url);
      return json(next);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const worldCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/v1/world")).length;

  it("coalesces overlapping refreshes and re-fetches at next_change_at", async () => {
    worlds.push(world(0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z"));
    worlds.push(world(0, "2026-01-01T00:00:10.050Z", null));
    const sync = new GameSync();
    const stop = sync.start();
    void sync.refresh();
    void sync.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(worldCalls()).toBe(1);
    expect(sync.getSnapshot().server?.display.next_change_at).toBe("2026-01-01T00:00:10.000Z");

    await vi.advanceTimersByTimeAsync(9_000);
    expect(worldCalls()).toBe(1); // no polling
    await vi.advanceTimersByTimeAsync(1_100);
    expect(worldCalls()).toBe(2);
    expect(sync.getSnapshot().server?.display.next_change_at).toBeNull();
    stop();
  });

  it("re-fetches on focus and ignores responses older than the current state", async () => {
    worlds.push(world(3, "2026-01-01T00:00:00.000Z", null));
    worlds.push(world(2, "2026-01-01T00:00:01.000Z", null));
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(worldCalls()).toBe(2);
    expect(sync.getSnapshot().server?.version).toBe(3);
    stop();
  });

  it("extrapolates the model at 4 Hz from the server clock offset", async () => {
    worlds.push({
      ...world(0, "2026-01-01T00:00:00.000Z", null),
      display: { ...world(0, "2026-01-01T00:00:00.000Z", null).display, gold: 60_000, balance_rate_per_min: -6_000 },
    });
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.getSnapshot().model?.gold).toBeCloseTo(59_900, 5);
    stop();
  });
});
