import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayState, WorldResponse } from "./client";
import { GameSync, type SyncError } from "./sync";

function world(version: number, evaluatedAt: string, nextChangeAt: string | null, islands: string[] = []): WorldResponse {
  const display: DisplayState = {
    evaluated_at: evaluatedAt,
    next_change_at: nextChangeAt,
    gold: 1000,
    balance_rate_per_min: 0,
    tax_rate_per_min: 0,
    upkeep_rate_per_min: 0,
    tiers: [],
    islands: islands.map((id) => ({ id, width: 1, height: 1, inventory: {}, roads: [], buildings: [], workforce: {}, population: {} })),
  };
  return { version, display };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CONTENT = { region: { version: "v" }, tiers: [], goods: [], buildings: [], needs: [] };
const ISLAND = { id: "start", width: 1, height: 1, revision: "v", terrain: ["grass"] };
const SERVER_ERROR = { error: { code: "internal", message: "internal error" } };

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

interface Call {
  method: string;
  path: string;
  body?: string;
}

describe("GameSync", () => {
  let worldHandler: Handler;
  let contentHandler: Handler;
  let islandHandler: Handler;
  let calls: Call[];
  let inFlight: number;
  let maxInFlight: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
    calls = [];
    inFlight = 0;
    maxInFlight = 0;
    contentHandler = () => json(CONTENT);
    islandHandler = () => json(ISLAND);
    worldHandler = () => json(world(0, "2026-01-01T00:00:00.000Z", null));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        const method = init?.method ?? "GET";
        calls.push({ method, path, body: init?.body as string | undefined });
        if (path === "/api/v1/content") return contentHandler(url, init);
        if (path.startsWith("/api/v1/world/islands/")) return islandHandler(url, init);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          return await worldHandler(url, init);
        } finally {
          inFlight--;
        }
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const worldCalls = () => calls.filter((c) => c.path === "/api/v1/world" || c.path === "/api/v1/world/commands");
  const gets = () => calls.filter((c) => c.path === "/api/v1/world").length;

  /** A world handler whose responses are released one by one. */
  function deferredWorld(): { release: (r: WorldResponse) => Promise<void> } {
    const waiting: ((r: Response) => void)[] = [];
    worldHandler = () => new Promise<Response>((resolve) => waiting.push(resolve));
    return {
      release: async (r) => {
        await vi.advanceTimersByTimeAsync(0);
        const next = waiting.shift();
        if (!next) throw new Error("no request waiting");
        next(json(r));
        await vi.advanceTimersByTimeAsync(0);
      },
    };
  }

  it("re-fetches at next_change_at and never polls otherwise", async () => {
    const responses = [world(0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z"), world(0, "2026-01-01T00:00:10.050Z", null)];
    worldHandler = () => json(responses.shift());
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(gets()).toBe(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(gets()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(gets()).toBe(2);
    expect(sync.getSnapshot().server?.display.next_change_at).toBeNull();
    stop();
  });

  it("coalesces refreshes while a GET is in flight", async () => {
    const w = deferredWorld();
    const sync = new GameSync();
    const stop = sync.start();
    void sync.refresh();
    window.dispatchEvent(new Event("focus"));
    void sync.refresh();
    await w.release(world(0, "2026-01-01T00:00:00.000Z", null));
    expect(gets()).toBe(1);
    expect(maxInFlight).toBe(1);
    stop();
  });

  it("serialises commands behind a GET and each other, in invocation order", async () => {
    const w = deferredWorld();
    const sync = new GameSync();
    const stop = sync.start();
    const cmd = (x: number) => ({ type: "place_road" as const, island_id: "start", road_type: "road_dirt", tiles: [{ x, y: 0 }] });
    const a = sync.send(cmd(1));
    const b = sync.send(cmd(2));
    // A refresh requested behind the commands is skipped when they succeed.
    const r = sync.refresh();
    await w.release(world(0, "2026-01-01T00:00:00.000Z", null));
    expect(worldCalls()).toHaveLength(2); // the GET, then only the first command
    await w.release(world(1, "2026-01-01T00:00:00.100Z", null));
    await w.release(world(2, "2026-01-01T00:00:00.200Z", null));
    await Promise.all([a, b, r]);
    expect(maxInFlight).toBe(1);
    const order = worldCalls().map((c) => (c.body ? (JSON.parse(c.body) as { command: { tiles: { x: number }[] } }).command.tiles[0]?.x : "GET"));
    expect(order).toEqual(["GET", 1, 2]);
    expect(JSON.parse(worldCalls()[2]?.body ?? "{}")).toMatchObject({ version: 1 });
    expect(sync.getSnapshot().server?.version).toBe(2);
    stop();
  });

  it("a failed command does not swallow a queued refresh", async () => {
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    worldHandler = (_url, init) =>
      init?.method === "POST"
        ? json({ error: { code: "terrain", message: "terrain not buildable" } }, 409)
        : json(world(0, "2026-01-01T00:00:01.000Z", null));
    const failing = sync.send({ type: "demolish", island_id: "start", building_id: 9, accept_surplus_loss: false });
    const r = sync.refresh();
    await expect(failing).rejects.toMatchObject({ code: "terrain", status: 409 });
    await r;
    expect(gets()).toBe(2);
    expect(sync.getSnapshot().server?.display.evaluated_at).toBe("2026-01-01T00:00:01.000Z");
    stop();
  });

  it("recovers after a dev-server restart (lower version, newer state)", async () => {
    worldHandler = () => json(world(5, "2026-01-01T00:00:00.000Z", "2026-01-01T00:01:00.000Z", ["start"]));
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getSnapshot().server?.version).toBe(5);

    // Server down: the refresh fails, the banner shows.
    worldHandler = () => Promise.reject(new TypeError("Failed to fetch"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getSnapshot().unreachable).toBe(true);

    // Server back with a reset world: the retry applies it and clears the banner.
    worldHandler = () => json(world(0, "2026-01-01T00:00:02.000Z", "2026-01-01T00:00:12.000Z", ["start"]));
    const islandsBefore = calls.filter((c) => c.path.startsWith("/api/v1/world/islands/")).length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.getSnapshot().server?.version).toBe(0);
    expect(sync.getSnapshot().unreachable).toBe(false);
    expect(calls.filter((c) => c.path.startsWith("/api/v1/world/islands/")).length).toBe(islandsBefore + 1);

    // The next_change_at timer is armed again.
    const before = gets();
    await vi.advanceTimersByTimeAsync(10_100);
    expect(gets()).toBe(before + 1);
    stop();
  });

  it("reports GET errors of world, content and island and recovers by retrying", async () => {
    worldHandler = () => json(SERVER_ERROR, 500);
    contentHandler = () => json(SERVER_ERROR, 500);
    islandHandler = () => json(SERVER_ERROR, 500);
    const sync = new GameSync();
    const errors: SyncError[] = [];
    sync.subscribeErrors((e) => errors.push(e));
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getSnapshot().model).toBeNull();
    expect(errors.map((e) => e.what).sort()).toEqual(["content", "world"]);
    expect(errors[0]?.error.status).toBe(500);

    worldHandler = () => json(world(0, "2026-01-01T00:00:01.000Z", null, ["start"]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.getSnapshot().model).not.toBeNull();
    expect(errors.map((e) => e.what)).toContain("island start");

    contentHandler = () => json(CONTENT);
    islandHandler = () => json(ISLAND);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sync.getSnapshot().content).not.toBeNull();
    expect(sync.getSnapshot().islands.get("start")?.terrain).toEqual(["grass"]);

    // No further retries once everything loaded.
    const n = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBe(n);
    stop();
  });

  it("extrapolates the model at 4 Hz from the server clock offset", async () => {
    worldHandler = () =>
      json({
        version: 0,
        display: { ...world(0, "2026-01-01T00:00:00.000Z", null).display, gold: 60_000, balance_rate_per_min: -6_000 },
      });
    const sync = new GameSync();
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.getSnapshot().model?.gold).toBeCloseTo(59_900, 5);
    stop();
  });
});

describe("GameSync session and push", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops and reports a 401 without retrying", async () => {
    let worldGets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/v1/content") return json(CONTENT);
        worldGets++;
        return json({ error: { code: "unauthorized", message: "no valid session" } }, 401);
      }),
    );
    const sync = new GameSync(() => null);
    let ended = 0;
    sync.subscribeUnauthorized(() => ended++);
    const errors: SyncError[] = [];
    sync.subscribeErrors((e) => errors.push(e));
    sync.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ended).toBe(1);
    expect(worldGets).toBe(1);
    expect(errors).toEqual([]);
  });

  it("re-fetches on world_changed and on (re)connect; the socket drives the banner", async () => {
    let worldGets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/v1/content") return json(CONTENT);
        worldGets++;
        return json(world(worldGets, "2026-01-01T00:00:00.000Z", null));
      }),
    );
    let handlers: import("./ws").WorldSocketHandlers | undefined;
    let stopped = false;
    const sync = new GameSync((h) => {
      handlers = h;
      return { start: () => undefined, stop: () => (stopped = true) };
    });
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(worldGets).toBe(1);
    handlers!.changed("w");
    await vi.advanceTimersByTimeAsync(0);
    expect(worldGets).toBe(2);
    handlers!.down();
    expect(sync.getSnapshot().unreachable).toBe(true);
    handlers!.open();
    expect(sync.getSnapshot().unreachable).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(worldGets).toBe(3);
    stop();
    expect(stopped).toBe(true);
  });
});
