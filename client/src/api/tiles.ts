// Lazy island tiles: the order and pacing of the full-tile requests
// (GET /world/islands/{id}/tiles). The payload carries every island's 1:4
// mask, so the renderer draws all islands at once and the full rows load
// in the background: the island under the camera first, then the islands
// in view, then the rest; at most TILES_IN_FLIGHT requests at a time; a
// failed request is retried once after TILES_RETRY_MS and then given up
// until the next payload. No game rule here (D-027).

/** Tile requests in flight at most. */
export const TILES_IN_FLIGHT = 2;
/** Delay of the one retry of a failed tile request (ms). */
export const TILES_RETRY_MS = 2_000;

/**
 * The load order: the focused island, then the islands in view (in the
 * given order), then the rest (in payload order). Every ID once.
 */
export function tileOrder(all: readonly string[], focus: string | null, inView: Iterable<string>): string[] {
  const known = new Set(all);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!known.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  if (focus !== null) push(focus);
  for (const id of inView) push(id);
  for (const id of all) push(id);
  return out;
}

/** Why a load ended without tiles. */
export type TileFailure = { id: string; error: unknown };

/**
 * Schedules the tile loads of one payload's islands. `load` fetches and
 * stores an island's tiles (rejecting on failure); `onGiveUp` hears of an
 * island whose retry failed too. `reset` starts a new payload: islands
 * given up become eligible again; islands loaded or in flight are kept.
 */
export class TileQueue {
  private ids: string[] = [];
  private focus: string | null = null;
  private inView: string[] = [];
  private readonly loaded = new Set<string>();
  private readonly inFlight = new Set<string>();
  /** Failed attempts this payload, by island. */
  private readonly attempts = new Map<string, number>();
  /** Islands waiting for their retry (not eligible until the timer fires). */
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly gaveUp = new Set<string>();
  /** Incremented by clear(): results of an earlier epoch are ignored. */
  private epoch = 0;

  constructor(
    private readonly load: (id: string) => Promise<void>,
    private readonly onGiveUp: (f: TileFailure) => void = () => undefined,
  ) {}

  /** A new payload with these islands (payload order): re-arms islands given up and starts loads. */
  reset(ids: readonly string[]): void {
    this.ids = [...ids];
    this.gaveUp.clear();
    for (const [id, t] of this.waiting) {
      if (ids.includes(id)) continue;
      clearTimeout(t);
      this.waiting.delete(id);
    }
    for (const id of this.attempts.keys()) if (!this.waiting.has(id)) this.attempts.delete(id);
    this.pump();
  }

  /** Drops everything (a reroll or a reset world: the islands' tiles changed under the same IDs). */
  clear(): void {
    this.epoch++;
    this.loaded.clear();
    this.inFlight.clear();
    this.attempts.clear();
    for (const t of this.waiting.values()) clearTimeout(t);
    this.waiting.clear();
    this.gaveUp.clear();
  }

  /** The renderer's priorities: the island under the camera and the islands in view. */
  setPriority(focus: string | null, inView: Iterable<string>): void {
    this.focus = focus;
    this.inView = [...inView];
    this.pump();
  }

  /** Marks an island as loaded without a request (e.g. kept from before). */
  markLoaded(id: string): void {
    this.loaded.add(id);
  }

  /** Islands with a request in flight (tests). */
  pending(): string[] {
    return [...this.inFlight];
  }

  /** Islands given up until the next payload (tests). */
  failed(): string[] {
    return [...this.gaveUp];
  }

  /** Whether an island's tiles are still to come this payload (loading, queued or waiting for its retry). */
  loading(id: string): boolean {
    return this.ids.includes(id) && !this.loaded.has(id) && !this.gaveUp.has(id);
  }

  private pump(): void {
    if (this.inFlight.size >= TILES_IN_FLIGHT) return;
    for (const id of tileOrder(this.ids, this.focus, this.inView)) {
      if (this.inFlight.size >= TILES_IN_FLIGHT) return;
      if (this.loaded.has(id) || this.inFlight.has(id) || this.waiting.has(id) || this.gaveUp.has(id)) continue;
      this.start(id);
    }
  }

  private start(id: string): void {
    const epoch = this.epoch;
    this.inFlight.add(id);
    this.load(id).then(
      () => {
        if (epoch !== this.epoch) return;
        this.inFlight.delete(id);
        this.loaded.add(id);
        this.attempts.delete(id);
        this.pump();
      },
      (error: unknown) => {
        if (epoch !== this.epoch) return;
        this.inFlight.delete(id);
        const n = (this.attempts.get(id) ?? 0) + 1;
        this.attempts.set(id, n);
        if (n >= 2) {
          this.gaveUp.add(id);
          this.onGiveUp({ id, error });
        } else {
          this.waiting.set(
            id,
            setTimeout(() => {
              if (epoch !== this.epoch) return;
              this.waiting.delete(id);
              this.pump();
            }, TILES_RETRY_MS),
          );
        }
        this.pump();
      },
    );
  }
}
