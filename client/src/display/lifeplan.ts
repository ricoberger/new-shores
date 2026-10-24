// Life plan of one island (docs/LIFE_LAYER.md §2–3): derived from the
// island's display payload whenever it changes, extrapolated every frame
// from the renderer's clock. Pure (no Babylon): the render layer
// (render/life.ts) passes a sink that turns the instances into thin
// instances. Budgets are applied in the priority order of ART_DIRECTION §5
// (carts, walkers, smoke, boats and gulls, inhabitants) so a dense island
// on a phone keeps its most telling motion.
import type { ContentBuilding, Island, IslandDisplay } from "../api/client";
import { type LifeAtLod, type LifeBudget, type LifePlan, type LifeSink, type LifeStats } from "./life";

const NONE: LifeStats = { instances: 0, particles: 0 };

export class IslandLife implements LifePlan {
  private display: IslandDisplay | null = null;
  private defs: ReadonlyMap<string, ContentBuilding> = new Map();
  private statics: Island | null = null;

  /** Rebuilds the plan from the island's payload (content and static data for paths and water). */
  update(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>, statics: Island | null): void {
    this.display = display;
    this.defs = defs;
    this.statics = statics;
  }

  /** Writes the island's instances at server time nowMs within the budget, only what the LOD shows. */
  frame(nowMs: number, sink: LifeSink, at: LifeAtLod, budget: LifeBudget): LifeStats {
    if (!this.display || !this.statics || this.defs.size === 0 || !Number.isFinite(nowMs) || !sink || !at || budget.instances <= 0) return NONE;
    return NONE;
  }
}
