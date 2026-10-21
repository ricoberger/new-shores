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

  /** Watches a registration for installed updates (also one already waiting). */
  watch(reg: RegistrationLike): void {
    if (reg.waiting) this.offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed") this.offer(w);
      });
    });
  }

  /** A first install (no controller yet) is not an update. */
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
