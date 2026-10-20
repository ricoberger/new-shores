// WebSocket push of world changes (/api/v1/ws). Messages carry no game
// state: on world_changed the caller re-fetches the world. The socket
// reconnects with exponential backoff (1 s doubling to a 30 s cap, with
// jitter) and reports when it has been down for longer than DOWN_AFTER_MS.
import type { WorldChangedMessage } from "./client";

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** The socket counts as down (unreachable banner) after this long. */
export const DOWN_AFTER_MS = 3000;

/**
 * Reconnect delay before attempt n (0-based): min(30 s, 1 s * 2^n) scaled
 * by a random factor in [0.5, 1) so that clients do not reconnect in step.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
  return base / 2 + (random() * base) / 2;
}

/** Minimal WebSocket surface (the browser's WebSocket; fakes in tests). */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}

export interface WorldSocketHandlers {
  /** A world_changed message arrived. */
  changed(worldId: string): void;
  /** The socket (re)connected. */
  open(): void;
  /** The socket has been down for DOWN_AFTER_MS. */
  down(): void;
}

export class WorldSocket {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private downTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly handlers: WorldSocketHandlers,
    private readonly create: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.downTimer);
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let s: SocketLike;
    try {
      s = this.create(this.url);
    } catch {
      this.closed();
      return;
    }
    this.socket = s;
    this.armDown();
    s.onopen = () => {
      this.attempt = 0;
      clearTimeout(this.downTimer);
      this.downTimer = undefined;
      this.handlers.open();
    };
    s.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as WorldChangedMessage;
        if (msg.type === "world_changed") this.handlers.changed(msg.world_id);
      } catch {
        // Not a message of ours.
      }
    };
    s.onerror = () => undefined; // onclose follows
    s.onclose = () => {
      if (this.socket === s) this.socket = null;
      this.closed();
    };
  }

  /** Starts the down timer unless it is already running. */
  private armDown(): void {
    if (this.downTimer !== undefined) return;
    this.downTimer = setTimeout(() => {
      if (!this.stopped) this.handlers.down();
    }, DOWN_AFTER_MS);
  }

  private closed(): void {
    if (this.stopped) return;
    this.armDown();
    const delay = backoffMs(this.attempt++, this.random);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
