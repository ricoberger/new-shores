import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, DisplayState, WorldResponse } from "./client";
import { GameSync, type SyncError, SyncStoppedError } from "./sync";

function world(version: number, evaluatedAt: string, nextChangeAt: string | null, islands: string[] = [], roll = 0): WorldResponse {
  const display: DisplayState = {
    evaluated_at: evaluatedAt,
    next_change_at: nextChangeAt,
    gold: 1000,
    balance_rate_per_min: 0,
    tax_rate_per_min: 0,
    upkeep_rate_per_min: 0,
    tiers: [],
    archipelago: { seed: 7, roll, rerollable: roll < 2, bounds: { x: 0, y: 0, width: 1, height: 1 } },
    islands: islands.map((id) => ({
      id,
      name: "",
      size_class: "large",
      rock: false,
      settled: true,
      position: { x: 0, y: 0 },
      width: 1,
      height: 1,
      inventory: {},
      roads: [],
      buildings: [],
      workforce: {},
      population: {},
      capacity_source: null,
      fertilities: [],
      deposits: [],
      terrain_mask: "g",
    })),
    ships: [],
    routes: [],
    insolvency: { unpaid_buildings: 0, unpaid_ships: 0, unpaid_upkeep_per_min: 0, balance_if_resumed_per_min: 0 },
    quests: { active: [], claimable: [], completed: [] },
    away_summary: null,
    last_seen_at: evaluatedAt,
  };
  return { version, display };
}

/**
 * A JSON response whose body resolves at once. A real Response streams
 * its body through the runtime's event loop (real timers), which
 * advanceTimersByTimeAsync does not drive: under load the body could
 * still be pending after a fake-timer step, so the tests flaked.
 */
function json(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/**
 * Every test runs on the fake clock end to end: fake timers and Date, a
 * stub document and window, and no WebSocket. GameSync's default socket
 * factory opens a real WebSocket to API_BASE (Node has one): its events
 * arrive on the real event loop, outside the fake clock — with a dev
 * server on :8080 its open() re-fetched the world in the middle of a test
 * (the intermittent failures). Tests pass `noSocket` or a fake factory; a
 * real WebSocket throws.
 */
function fakeEnvironment(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        throw new Error("a real WebSocket in a fake-clock test: pass a socket factory to GameSync");
      }
    },
  );
}

/** The socket factory of the tests without push: no WebSocket. */
const noSocket = () => null;

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
    fakeEnvironment();
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
    const sync = new GameSync(noSocket);
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
    const sync = new GameSync(noSocket);
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
    const sync = new GameSync(noSocket);
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
    const sync = new GameSync(noSocket);
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
    const sync = new GameSync(noSocket);
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

  it("drops and reloads the island cache after a reroll (same IDs, new archipelago)", async () => {
    worldHandler = () => json(world(1, "2026-01-01T00:00:00.000Z", null, ["isle-01"]));
    const sync = new GameSync(noSocket);
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const islandCalls = () => calls.filter((c) => c.path === "/api/v1/world/islands/isle-01/tiles").length;
    expect(islandCalls()).toBe(1);
    expect(sync.getSnapshot().islands.get("isle-01")?.revision).toBe("v");

    // An unchanged archipelago keeps the cache.
    worldHandler = () => json(world(2, "2026-01-01T00:00:01.000Z", null, ["isle-01"]));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(islandCalls()).toBe(1);

    // The reroll: same ID, the next roll; the island is fetched again.
    islandHandler = () => json({ ...ISLAND, id: "isle-01", revision: "v-7-1" });
    worldHandler = () => json(world(3, "2026-01-01T00:00:02.000Z", null, ["isle-01"], 1));
    await sync.send({ type: "reroll_archipelago" });
    await vi.advanceTimersByTimeAsync(0);
    expect(islandCalls()).toBe(2);
    expect(sync.getSnapshot().islands.get("isle-01")?.revision).toBe("v-7-1");
    stop();
  });

  it("loads the tiles lazily in the renderer's priority, two at a time", async () => {
    worldHandler = () => json(world(1, "2026-01-01T00:00:00.000Z", null, ["a", "b", "c"]));
    const release: (() => void)[] = [];
    islandHandler = () => new Promise<Response>((resolve) => release.push(() => resolve(json(ISLAND))));
    const sync = new GameSync(noSocket);
    // The renderer answers the first snapshot with its priorities (as the engine does).
    sync.subscribe(() => sync.setTilePriority("c", ["b", "c"]));
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const tileCalls = () => calls.filter((c) => c.path.endsWith("/tiles")).map((c) => c.path.split("/")[5]);
    expect(tileCalls()).toEqual(["c", "b"]);
    release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(tileCalls()).toEqual(["c", "b", "a"]);
    stop();
  });

  it("ignores an island response of the archipelago before a reroll", async () => {
    worldHandler = () => json(world(1, "2026-01-01T00:00:00.000Z", null, ["isle-01"]));
    let releaseOld: (r: Response) => void = () => undefined;
    islandHandler = () => new Promise<Response>((resolve) => (releaseOld = resolve));
    const sync = new GameSync(noSocket);
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);

    // The reroll lands while the old island is still loading.
    islandHandler = () => json({ ...ISLAND, id: "isle-01", revision: "v-7-1" });
    worldHandler = () => json(world(2, "2026-01-01T00:00:01.000Z", null, ["isle-01"], 1));
    await sync.send({ type: "reroll_archipelago" });
    await vi.advanceTimersByTimeAsync(0);
    releaseOld(json({ ...ISLAND, id: "isle-01", revision: "v" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getSnapshot().islands.get("isle-01")?.revision).toBe("v-7-1");
    stop();
  });

  it("reports GET errors of world, content and island and recovers by retrying (island tiles: once, then at the next payload)", async () => {
    worldHandler = () => json(SERVER_ERROR, 500);
    contentHandler = () => json(SERVER_ERROR, 500);
    islandHandler = () => json(SERVER_ERROR, 500);
    const sync = new GameSync(noSocket);
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
    const tileCalls = () => calls.filter((c) => c.path === "/api/v1/world/islands/start/tiles").length;
    expect(tileCalls()).toBe(1);
    // The one retry after 2 s fails too: reported once, then given up.
    expect(errors.map((e) => e.what)).not.toContain("island start");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tileCalls()).toBe(2);
    expect(errors.filter((e) => e.what === "island start")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tileCalls()).toBe(2);

    contentHandler = () => json(CONTENT);
    islandHandler = () => json(ISLAND);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sync.getSnapshot().content).not.toBeNull();
    // The next payload loads the island again.
    worldHandler = () => json(world(1, "2026-01-01T00:00:40.000Z", null, ["start"]));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(tileCalls()).toBe(3);
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
    const sync = new GameSync(noSocket);
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync.getSnapshot().model?.gold).toBeCloseTo(59_900, 5);
    stop();
  });
});

describe("GameSync session and push", () => {
  beforeEach(() => {
    fakeEnvironment();
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
    const sync = new GameSync(noSocket);
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

describe("GameSync queued commands after the session ends", () => {
  const ROAD: Command = { type: "place_road", island_id: "start", road_type: "road_dirt", tiles: [{ x: 1, y: 1 }] };

  beforeEach(() => {
    fakeEnvironment();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** fetch stub: commands wait for release(); records the account of each command. */
  function setup(commandStatus: () => number) {
    let account = "A";
    const commands: string[] = [];
    const waiting: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/v1/content") return json(CONTENT);
        if (path === "/api/v1/world/commands") {
          commands.push(account);
          await new Promise<void>((resolve) => waiting.push(resolve));
          const status = commandStatus();
          return status === 200 ? json(world(1, "2026-01-01T00:00:00.000Z", null)) : json({ error: { code: "unauthorized", message: "no valid session" } }, status);
        }
        return json(world(0, "2026-01-01T00:00:00.000Z", null));
      }),
    );
    return {
      commands,
      switchAccount: (a: string) => (account = a),
      release: async () => {
        await vi.advanceTimersByTimeAsync(0);
        waiting.shift()?.();
        await vi.advanceTimersByTimeAsync(0);
      },
    };
  }

  it("drops queued commands on logout (stop) so they never run under another session", async () => {
    const f = setup(() => 200);
    const sync = new GameSync(noSocket);
    const stop = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = sync.send(ROAD);
    const second = sync.send(ROAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.commands).toEqual(["A"]); // the first is in flight
    stop(); // logout / unmount
    f.switchAccount("B"); // another account logs in in the same browser
    const restartStop = sync.start(); // e.g. React Strict Mode re-running the effect
    await f.release();
    await expect(first).rejects.toBeInstanceOf(SyncStoppedError);
    await expect(second).rejects.toBeInstanceOf(SyncStoppedError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.commands).toEqual(["A"]);
    restartStop();
  });

  it("drops queued commands after a 401", async () => {
    const f = setup(() => 401);
    const sync = new GameSync(noSocket);
    let ended = 0;
    sync.subscribeUnauthorized(() => ended++);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = sync.send(ROAD);
    const second = sync.send(ROAD);
    first.catch(() => undefined);
    await f.release();
    await expect(first).rejects.toMatchObject({ status: 401 });
    await expect(second).rejects.toBeInstanceOf(SyncStoppedError);
    f.switchAccount("B");
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.commands).toEqual(["A"]);
    expect(ended).toBe(1);
  });
});

describe("GameSync restart (React Strict Mode: start -> stop -> start)", () => {
  beforeEach(() => {
    fakeEnvironment();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubServer(worldDelayMs = 0) {
    const counts = { world: 0, content: 0, island: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/v1/content") {
          counts.content++;
          return json(CONTENT);
        }
        if (path.startsWith("/api/v1/world/islands/")) {
          counts.island++;
          return json(ISLAND);
        }
        counts.world++;
        if (worldDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, worldDelayMs));
        return json(world(counts.world, "2026-01-01T00:00:00.000Z", null, ["start"]));
      }),
    );
    return counts;
  }

  it("loads the world, content and islands over HTTP after an immediate restart without push", async () => {
    const counts = stubServer();
    const sync = new GameSync(noSocket); // no WebSocket: no open() refresh
    const stop1 = sync.start();
    stop1();
    const stop2 = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const snap = sync.getSnapshot();
    expect(counts.world).toBeGreaterThanOrEqual(1);
    expect(snap.server).not.toBeNull();
    expect(snap.content).not.toBeNull();
    expect(snap.islands.has("start")).toBe(true);
    stop2();
  });

  it("loads the world when restarted while the first generation's GET is in flight", async () => {
    const counts = stubServer(100);
    const sync = new GameSync(noSocket);
    const stop1 = sync.start();
    await vi.advanceTimersByTimeAsync(10); // first GET in flight
    stop1();
    const stop2 = sync.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(counts.world).toBe(2); // the restarted generation fetched its own world
    expect(sync.getSnapshot().server?.version).toBe(2); // the stale response was ignored
    expect(sync.getSnapshot().islands.has("start")).toBe(true);
    stop2();
  });
});
