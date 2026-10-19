// Client-side synchronisation with the server (refresh policy of the M1b
// spec, E.24): the server payload is replaced by every response, the display
// model is recomputed at 4 Hz, the world is re-fetched at next_change_at,
// on focus/visibility and never by polling otherwise.
//
// World requests (GET /world and commands) go through one queue: at most one
// is in flight and commands reach the server in invocation order. A refresh
// requested while a GET is the last queued request shares that GET; a GET
// queued behind a command is skipped when the command's response (a fresh
// world state too) arrived first. Because responses are therefore applied in request order, a
// response with a lower version than the current state means the world was
// reset (dev-server restart) and replaces the state.
import { clockOffsetMs, extrapolate, serverTimeMs } from "../display/extrapolate";
import {
  ApiError,
  type Command,
  type Content,
  type DisplayState,
  getContent,
  getIsland,
  getWorld,
  type Island,
  NetworkError,
  sendCommand,
  type WorldResponse,
} from "./client";

const MODEL_INTERVAL_MS = 250;
const NEXT_CHANGE_MARGIN_MS = 50;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10_000;

/**
 * World seconds per wall-clock second. Must match the dev server's
 * --time-scale (default 1); only the dev server can run faster than real
 * time, so production builds always use 1.
 */
const TIME_SCALE: number = (() => {
  const v = Number(import.meta.env.VITE_TIME_SCALE ?? "1");
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

export interface SyncSnapshot {
  /** Last server payload (with version). */
  server: WorldResponse | null;
  /** Extrapolated display model (4 Hz). */
  model: DisplayState | null;
  content: Content | null;
  islands: ReadonlyMap<string, Island>;
  /** The server could not be reached; retrying. */
  unreachable: boolean;
}

type Listener = () => void;

/** A failed background request (not a command; commands reject to the caller). */
export interface SyncError {
  /** What was being loaded, e.g. "world", "content", "island start". */
  what: string;
  error: ApiError;
}

type ErrorListener = (e: SyncError) => void;

export class GameSync {
  private snapshot: SyncSnapshot = { server: null, model: null, content: null, islands: new Map(), unreachable: false };
  private offsetMs = 0;
  private receivedAtMs = 0;
  private listeners = new Set<Listener>();
  private errorListeners = new Set<ErrorListener>();
  /** Resolves when the last queued world request has finished. */
  private tail: Promise<void> = Promise.resolve();
  /** The last queued world request if it is a GET (for coalescing). */
  private lastGet: Promise<void> | null = null;
  /** Number of world responses applied so far. */
  private accepted = 0;
  private nextChangeTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = new Map<string, { timer: ReturnType<typeof setTimeout>; delayMs: number }>();
  private modelTimer: ReturnType<typeof setInterval> | undefined;
  private islandRequests = new Set<string>();
  private contentRequest = false;
  private stopped = true;

  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible") void this.refresh();
  };
  private readonly onFocus = (): void => void this.refresh();

  /** Starts fetching; returns a stop function (React Strict Mode safe). */
  start(): () => void {
    this.stopped = false;
    this.modelTimer = setInterval(() => this.recompute(), MODEL_INTERVAL_MS);
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("focus", this.onFocus);
    void this.loadContent();
    void this.refresh();
    return () => this.stop();
  }

  private stop(): void {
    this.stopped = true;
    clearInterval(this.modelTimer);
    clearTimeout(this.nextChangeTimer);
    for (const r of this.retries.values()) clearTimeout(r.timer);
    this.retries.clear();
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("focus", this.onFocus);
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Errors of background requests (GET world, content, island), for toasts. */
  subscribeErrors(l: ErrorListener): () => void {
    this.errorListeners.add(l);
    return () => this.errorListeners.delete(l);
  }

  getSnapshot = (): SyncSnapshot => this.snapshot;

  /**
   * Server time now (ms since epoch): Date.now() + offset, where offset =
   * evaluated_at - receive time of the last response (scaled by
   * VITE_TIME_SCALE for a dev server running with --time-scale).
   */
  serverNowMs(): number {
    const now = Date.now();
    return now + this.offsetMs + (now - this.receivedAtMs) * (TIME_SCALE - 1);
  }

  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private recompute(): void {
    const server = this.snapshot.server;
    if (server) this.set({ model: extrapolate(server.display, this.serverNowMs()) });
  }

  /** Runs a world request after every earlier one (one in flight). */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Re-fetches the world. Coalesced: while a GET is the last queued world
   * request, callers share it; a GET queued behind a command is skipped if
   * a newer response was applied before it starts.
   */
  refresh(): Promise<void> {
    if (this.lastGet) return this.lastGet;
    const seen = this.accepted;
    const p = this.enqueue(async () => {
      if (this.accepted > seen || this.stopped) return;
      try {
        const res = await getWorld();
        this.accept(res, Date.now());
        this.succeeded("world");
      } catch (err) {
        this.failed("world", err, () => void this.refresh());
      }
    });
    this.lastGet = p;
    const clear = () => {
      if (this.lastGet === p) this.lastGet = null;
    };
    p.then(clear, clear);
    return p;
  }

  /**
   * Sends a command after every earlier world request; the response
   * replaces the state. Errors are rethrown to the caller (which shows
   * them); a network error also starts the reconnect retry.
   */
  send(command: Command): Promise<WorldResponse> {
    this.lastGet = null; // a refresh after this command needs its own GET
    return this.enqueue(async () => {
      try {
        const res = await sendCommand(command, this.snapshot.server?.version);
        this.accept(res, Date.now());
        this.succeeded("world");
        return res;
      } catch (err) {
        if (err instanceof NetworkError) this.failed("world", err, () => void this.refresh(), false);
        throw err;
      }
    });
  }

  private async loadContent(): Promise<void> {
    if (this.contentRequest || this.stopped) return;
    this.contentRequest = true;
    try {
      const content = await getContent();
      if (this.stopped) return;
      this.set({ content });
      this.succeeded("content");
    } catch (err) {
      this.failed("content", err, () => void this.loadContent());
    } finally {
      this.contentRequest = false;
    }
  }

  private async loadIsland(id: string): Promise<void> {
    if (this.snapshot.islands.has(id) || this.islandRequests.has(id) || this.stopped) return;
    this.islandRequests.add(id);
    try {
      const island = await getIsland(id);
      if (this.stopped) return;
      const islands = new Map(this.snapshot.islands);
      islands.set(id, island);
      this.set({ islands });
      this.succeeded(`island ${id}`);
    } catch (err) {
      this.failed(`island ${id}`, err, () => void this.loadIsland(id));
    } finally {
      this.islandRequests.delete(id);
    }
  }

  private succeeded(key: string): void {
    const r = this.retries.get(key);
    if (r) {
      clearTimeout(r.timer);
      this.retries.delete(key);
    }
    if (this.snapshot.unreachable) this.set({ unreachable: false });
  }

  /**
   * Handles a failed background request: network errors raise the
   * unreachable banner, API errors are reported to the error listeners
   * (toasts); both retry with exponential backoff until the request
   * succeeds.
   */
  private failed(key: string, err: unknown, retry: () => void, report = true): void {
    if (this.stopped) return;
    if (err instanceof NetworkError) {
      if (!this.snapshot.unreachable) this.set({ unreachable: true });
    } else if (err instanceof ApiError) {
      if (report) for (const l of this.errorListeners) l({ what: key, error: err });
    } else {
      throw err;
    }
    const prev = this.retries.get(key);
    if (prev) clearTimeout(prev.timer);
    const delayMs = prev ? Math.min(RETRY_MAX_MS, prev.delayMs * 2) : RETRY_MIN_MS;
    this.retries.set(key, { delayMs, timer: setTimeout(retry, delayMs) });
  }

  private accept(res: WorldResponse, receivedAtMs: number): void {
    if (this.stopped) return;
    const cur = this.snapshot.server;
    // Responses arrive in request order (one queue), so a lower version is
    // a reset world (dev-server restart): drop the island cache and reload
    // the content, which may have changed with the restart.
    const reset = cur !== null && res.version < cur.version;
    this.accepted++;
    this.offsetMs = clockOffsetMs(res.display, receivedAtMs);
    this.receivedAtMs = receivedAtMs;
    this.set({
      server: res,
      model: extrapolate(res.display, this.serverNowMs()),
      ...(reset ? { islands: new Map<string, Island>() } : {}),
    });
    if (reset || (!this.snapshot.content && !this.retries.has("content"))) void this.loadContent();
    this.armNextChange(res);
    for (const is of res.display.islands) {
      if (!this.retries.has(`island ${is.id}`)) void this.loadIsland(is.id);
    }
  }

  private armNextChange(res: WorldResponse): void {
    clearTimeout(this.nextChangeTimer);
    const next = res.display.next_change_at;
    if (next === null) return;
    const delay = Math.max(0, serverTimeMs(next) - this.serverNowMs()) / TIME_SCALE + NEXT_CHANGE_MARGIN_MS;
    this.nextChangeTimer = setTimeout(() => void this.refresh(), delay);
  }
}
