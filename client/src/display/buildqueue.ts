// Incremental island build (polish round 3): an island's detail is built
// chunk by chunk in the render loop under a time budget per frame instead
// of all at once the first time it is in view, so an island entering the
// view never stalls a frame and the first frame never waits for a build.
// Until its last step the island is drawn from its 1:4 mask mesh. Pure
// scheduling helpers (order, budgeted drain); the steps themselves are
// render/island.ts. No game rule (D-027).
import type { Quality } from "./quality";

/**
 * Build time per frame (ms, measured with performance.now() step by step)
 * by device class — the life layer's classes (display/life.ts): "high" is
 * the desktop layout, "low" phones and tablets. A step that starts inside
 * the budget runs to its end, so a frame can overrun by one step.
 */
export const BUILD_BUDGET_MS: Record<Quality, number> = { high: 6, low: 4 };

/** One pending step of an island's build: its island-level head (chunk null) or one chunk. */
export interface BuildItem {
  island: string;
  /** Chunk key (display/chunks.ts), null: the island's head steps (they run before its chunks). */
  chunk: string | null;
  /** The island is the focused one. */
  focus: boolean;
  /** The chunk (head: the island) is in the camera's footprint. */
  visible: boolean;
  /** Distance (tiles) of the chunk's centre (head: the island's nearest pending chunk) to the camera's target. */
  dist: number;
}

/**
 * The build order: the focused island first, then the visible chunks
 * before the culled ones, each nearest to the camera's target first; an
 * island's head before its chunks (its distance is the nearest of them).
 */
export function buildOrder(items: readonly BuildItem[]): BuildItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.focus) - Number(a.focus) ||
      Number(b.visible) - Number(a.visible) ||
      a.dist - b.dist ||
      (a.island === b.island ? Number(a.chunk !== null) - Number(b.chunk !== null) : 0) ||
      (a.island < b.island ? -1 : a.island > b.island ? 1 : 0) ||
      (a.chunk ?? "").localeCompare(b.chunk ?? ""),
  );
}

/**
 * Runs steps while the budget lasts: `step` runs the next one and returns
 * false when nothing is left; the clock is read before each step. Returns
 * the number of steps run (0 when the budget is ≤ 0).
 */
export function drainBudget(step: () => boolean, now: () => number, budgetMs: number): number {
  const start = now();
  let n = 0;
  while (now() - start < budgetMs) {
    if (!step()) break;
    n++;
  }
  return n;
}

/**
 * The renderer's side of the build: nothing runs before the first frame
 * was rendered (sea, mask meshes, ships and HUD come first) or while the
 * builds are not ready to start (the decoration models are loading); then
 * drainBudget each frame.
 */
export class BuildScheduler {
  private frames = 0;

  /** A frame was rendered. */
  frameRendered(): void {
    this.frames++;
  }

  /** Runs this frame's build steps (drainBudget); 0 before the first rendered frame or when not ready. */
  drain(step: () => boolean, now: () => number, budgetMs: number, ready = true): number {
    if (this.frames === 0 || !ready) return 0;
    return drainBudget(step, now, budgetMs);
  }
}
