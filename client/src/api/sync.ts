// Client-side synchronisation with the server (refresh policy of the M1b
// spec, E.24): the server payload is replaced by every response, the display
// model is recomputed at 4 Hz, the world is re-fetched at next_change_at,
// on focus/visibility and never by polling otherwise.
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

export class GameSync {
  private snapshot: SyncSnapshot = { server: null, model: null, content: null, islands: new Map(), unreachable: false };
  private offsetMs = 0;
  private receivedAtMs = 0;
  private listeners = new Set<Listener>();
  private inFlight: Promise<void> | null = null;
  private nextChangeTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MIN_MS;
  private modelTimer: ReturnType<typeof setInterval> | undefined;
  private islandRequests = new Set<string>();
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
    clearTimeout(this.retryTimer);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("focus", this.onFocus);
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

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

  private async loadContent(): Promise<void> {
    try {
      const content = await getContent();
      if (!this.stopped) this.set({ content });
    } catch (err) {
      this.handleNetwork(err, () => void this.loadContent());
    }
  }

  /** Re-fetches the world; overlapping calls share one request. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const res = await getWorld();
        this.accept(res, Date.now());
      } catch (err) {
        this.handleNetwork(err, () => void this.refresh());
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Sends a command; the response replaces the state. Errors are rethrown. */
  async send(command: Command): Promise<WorldResponse> {
    try {
      const res = await sendCommand(command, this.snapshot.server?.version);
      this.accept(res, Date.now());
      return res;
    } catch (err) {
      if (err instanceof NetworkError) this.handleNetwork(err, () => void this.refresh());
      throw err;
    }
  }

  private handleNetwork(err: unknown, retry: () => void): void {
    if (!(err instanceof NetworkError) || this.stopped) {
      if (err instanceof ApiError || this.stopped) return;
      throw err;
    }
    this.set({ unreachable: true });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(retry, this.retryMs);
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
  }

  private accept(res: WorldResponse, receivedAtMs: number): void {
    if (this.stopped) return;
    const cur = this.snapshot.server;
    // Never let an older response overwrite a newer one.
    if (
      cur &&
      (res.version < cur.version ||
        (res.version === cur.version && serverTimeMs(res.display.evaluated_at) < serverTimeMs(cur.display.evaluated_at)))
    ) {
      return;
    }
    this.offsetMs = clockOffsetMs(res.display, receivedAtMs);
    this.receivedAtMs = receivedAtMs;
    this.retryMs = RETRY_MIN_MS;
    this.set({
      server: res,
      model: extrapolate(res.display, this.serverNowMs()),
      unreachable: false,
    });
    if (!this.snapshot.content) void this.loadContent();
    this.armNextChange(res);
    for (const is of res.display.islands) void this.loadIsland(is.id);
  }

  private armNextChange(res: WorldResponse): void {
    clearTimeout(this.nextChangeTimer);
    const next = res.display.next_change_at;
    if (next === null) return;
    const delay = Math.max(0, serverTimeMs(next) - this.serverNowMs()) / TIME_SCALE + NEXT_CHANGE_MARGIN_MS;
    this.nextChangeTimer = setTimeout(() => void this.refresh(), delay);
  }

  private async loadIsland(id: string): Promise<void> {
    if (this.snapshot.islands.has(id) || this.islandRequests.has(id)) return;
    this.islandRequests.add(id);
    try {
      const island = await getIsland(id);
      const islands = new Map(this.snapshot.islands);
      islands.set(id, island);
      if (!this.stopped) this.set({ islands });
    } catch (err) {
      this.handleNetwork(err, () => void this.refresh());
    } finally {
      this.islandRequests.delete(id);
    }
  }
}
