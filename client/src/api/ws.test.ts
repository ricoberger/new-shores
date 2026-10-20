import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsUrl } from "./client";
import { BACKOFF_MAX_MS, backoffMs, DOWN_AFTER_MS, type SocketLike, WorldSocket } from "./ws";

describe("wsUrl", () => {
  it("derives the WebSocket URL from API_BASE", () => {
    expect(wsUrl("http://localhost:8080", "http://localhost:5173")).toBe("ws://localhost:8080/api/v1/ws");
    expect(wsUrl("https://api.example.org/", "https://play.example.org")).toBe("wss://api.example.org/api/v1/ws");
    expect(wsUrl("", "https://play.example.org")).toBe("wss://play.example.org/api/v1/ws");
    expect(wsUrl("", "http://localhost:8000")).toBe("ws://localhost:8000/api/v1/ws");
  });
});

describe("backoffMs", () => {
  it("doubles from 1 s to a 30 s cap with jitter in [0.5, 1)", () => {
    expect(backoffMs(0, () => 0)).toBe(500);
    expect(backoffMs(0, () => 0.999)).toBeCloseTo(999.5);
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(4, () => 0.5)).toBe(12_000);
    expect(backoffMs(5, () => 0.999)).toBeLessThan(BACKOFF_MAX_MS);
    expect(backoffMs(50, () => 0)).toBe(BACKOFF_MAX_MS / 2);
  });
});

class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

describe("WorldSocket", () => {
  let sockets: FakeSocket[];
  let events: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    events = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = () =>
    new WorldSocket(
      "ws://x/api/v1/ws",
      { changed: (id) => events.push(`changed ${id}`), open: () => events.push("open"), down: () => events.push("down") },
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      () => 0, // shortest jitter
    );

  it("reports world_changed and ignores other messages", () => {
    const ws = make();
    ws.start();
    sockets[0]!.onopen?.({});
    sockets[0]!.onmessage?.({ data: '{"type":"world_changed","world_id":"w1"}' });
    sockets[0]!.onmessage?.({ data: '{"type":"other"}' });
    sockets[0]!.onmessage?.({ data: "not json" });
    expect(events).toEqual(["open", "changed w1"]);
    ws.stop();
    expect(sockets[0]!.closed).toBe(true);
  });

  it("reconnects with backoff and reports down after 3 s", async () => {
    const ws = make();
    ws.start();
    sockets[0]!.onopen?.({});
    sockets[0]!.onclose?.({});
    await vi.advanceTimersByTimeAsync(499);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // attempt 0: 500 ms
    expect(sockets).toHaveLength(2);
    sockets[1]!.onclose?.({});
    await vi.advanceTimersByTimeAsync(1000); // attempt 1: 1 s
    expect(sockets).toHaveLength(3);
    expect(events).toEqual(["open"]);
    await vi.advanceTimersByTimeAsync(DOWN_AFTER_MS);
    expect(events).toEqual(["open", "down"]);
    sockets[2]!.onopen?.({});
    expect(events).toEqual(["open", "down", "open"]);
    // After a successful open the backoff starts over.
    sockets[2]!.onclose?.({});
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(4);
    ws.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(4);
  });
});
