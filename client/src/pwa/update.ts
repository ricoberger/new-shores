// Service-worker update flow (framework-free, tested with fakes): a new
// worker that finished installing while an old one controls the page is
// an available update; applying it asks the waiting worker to skip
// waiting and reloads once the new one takes control.

export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface RegistrationLike {
  readonly active: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

export interface ContainerLike {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
}

export const SKIP_WAITING = { type: "SKIP_WAITING" } as const;

/** Holds the waiting worker of an available update and notifies subscribers. */
export class UpdateFlow {
  private waiting: WorkerLike | null = null;
  private readonly listeners = new Set<() => void>();
  private reloading = false;

  constructor(
    private readonly container: ContainerLike,
    private readonly reload: () => void,
  ) {}

  /**
   * Watches a registration for installed updates (also one already
   * waiting). The first worker of a registration (none active yet) is
   * never an update, even if a browser reports it installed only after it
   * took control (WebKit's event order).
   */
  watch(reg: RegistrationLike): void {
    let first: WorkerLike | null = null;
    let firstPending = false;
    const observe = (w: WorkerLike) =>
      w.addEventListener("statechange", () => {
        if (w.state === "installed") this.offer(w);
      });
    if (!reg.active) {
      first = reg.installing ?? reg.waiting;
      firstPending = first === null;
    } else {
      if (reg.waiting) this.offer(reg.waiting);
      // An update already installing when the page starts watching.
      if (reg.installing) observe(reg.installing);
    }
    const seen = reg.installing;
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w || w === first || w === seen) return;
      if (firstPending) {
        firstPending = false;
        first = w;
        return;
      }
      observe(w);
    });
  }

  /** Without a controlling worker there is nothing to update. */
  private offer(w: WorkerLike): void {
    if (!this.container.controller) return;
    this.waiting = w;
    this.emit();
  }

  available(): boolean {
    return this.waiting !== null;
  }

  /** Activates the waiting worker; the page reloads when it takes control. */
  apply(): void {
    const w = this.waiting;
    if (!w) return;
    this.container.addEventListener("controllerchange", () => {
      if (this.reloading) return;
      this.reloading = true;
      this.reload();
    });
    w.postMessage(SKIP_WAITING);
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
