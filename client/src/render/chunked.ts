// Per-chunk instances of a static island layer (display/chunks.ts): each
// chunk's layer is built from that chunk's input and rebuilt only when its
// input signature changed; chunks without input are dropped.
import { changedChunks } from "../display/chunks";

export class Chunked<L, I> {
  private readonly layers = new Map<string, L>();
  private sigs: Map<string, string> | null = null;
  /** Chunk keys rebuilt (or dropped) by the last update (tests and profiling). */
  lastRebuilt: string[] = [];

  constructor(
    /** A new layer for a chunk. */
    private readonly make: (key: string) => L,
    /** Builds a chunk's layer from its input (replacing what it drew). */
    private readonly build: (layer: L, input: I, key: string) => void,
    /** Disposes a chunk's layer (its chunk lost all input). */
    private readonly drop: (layer: L) => void,
    /** The input signature of a chunk: equal signatures skip the rebuild. */
    private readonly sig: (input: I) => string,
  ) {}

  /** Brings the chunks up to date with the inputs by chunk; `force` rebuilds every chunk. Returns the chunks rebuilt or dropped. */
  update(inputs: ReadonlyMap<string, I>, force = false): string[] {
    const next = new Map<string, string>();
    for (const [k, v] of inputs) next.set(k, this.sig(v));
    const changed = changedChunks(force ? null : this.sigs, next);
    if (force) for (const k of this.layers.keys()) if (!inputs.has(k) && !changed.includes(k)) changed.push(k);
    for (const k of changed) {
      const input = inputs.get(k);
      const layer = this.layers.get(k);
      if (input === undefined || next.get(k) === "") {
        if (layer !== undefined) {
          this.drop(layer);
          this.layers.delete(k);
        }
        continue;
      }
      let l = layer;
      if (l === undefined) this.layers.set(k, (l = this.make(k)));
      this.build(l, input, k);
    }
    this.sigs = next;
    this.lastRebuilt = changed;
    return changed;
  }

  /**
   * Builds one chunk from its input (the incremental island build): as
   * update() would for this chunk, keeping the other chunks' signatures,
   * so a later update() rebuilds only what changed since.
   */
  updateOne(key: string, input: I | undefined): void {
    const sig = input === undefined ? "" : this.sig(input);
    const sigs = (this.sigs ??= new Map());
    const layer = this.layers.get(key);
    if (input === undefined || sig === "") {
      if (layer !== undefined) {
        this.drop(layer);
        this.layers.delete(key);
      }
      sigs.delete(key);
      return;
    }
    if (layer !== undefined && sigs.get(key) === sig) return;
    let l = layer;
    if (l === undefined) this.layers.set(key, (l = this.make(key)));
    this.build(l, input, key);
    sigs.set(key, sig);
  }

  /** The layer of a chunk (undefined: none built). */
  get(key: string): L | undefined {
    return this.layers.get(key);
  }

  /** The chunks' layers. */
  values(): IterableIterator<L> {
    return this.layers.values();
  }

  /** The layers by chunk key. */
  entries(): IterableIterator<[string, L]> {
    return this.layers.entries();
  }
}
