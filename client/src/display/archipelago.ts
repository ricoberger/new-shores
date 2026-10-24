// Display aggregates of an island for the archipelago tooltip and island
// card (D-027): sums and ratios of server display numbers and lookups of
// static island data and content — no game rule.
import type { CargoDisplay, Content, DisplayState, Island, IslandDisplay, ShipDisplay } from "../api/client";
import { serverTimeMs } from "./extrapolate";
import { cargoTotals } from "./ships";

export interface IslandSummary {
  /** Residents of all tiers (milli-residents). */
  population: number;
  /** Σ stock / Σ capacity of the inventory in percent (0–100), null when the island has no capacity (unsettled). */
  fillPercent: number | null;
  /** Buildings whose status is not ok (the warnings tray's rule). */
  warnings: number;
}

export function islandSummary(is: IslandDisplay): IslandSummary {
  let population = 0;
  for (const v of Object.values(is.population)) population += v;
  let stock = 0;
  let capacity = 0;
  for (const g of Object.values(is.inventory)) {
    stock += g.stock;
    capacity += g.capacity;
  }
  return {
    population,
    fillPercent: is.settled && capacity > 0 ? Math.round((stock / capacity) * 100) : null,
    warnings: is.buildings.filter((b) => b.status !== "ok").length,
  };
}

/** Deposit kinds of an island's static data with their tile counts, sorted by kind. */
export function depositCounts(island: Pick<Island, "deposits"> | undefined): { kind: string; tiles: number }[] {
  const counts = new Map<string, number>();
  for (const d of island?.deposits ?? []) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, tiles]) => ({ kind, tiles }));
}

/** Ships at an island at server time nowMs: without a leg there, or on a leg from there before departure. */
export function shipsAt(ships: readonly ShipDisplay[], islandId: string, nowMs: number): ShipDisplay[] {
  return ships.filter((s) => (s.leg ? s.leg.from_island_id === islandId && nowMs < serverTimeMs(s.leg.depart_at) : s.island_id === islandId));
}

/**
 * Whether a cargo covers the material cost of the content's warehouse
 * building: a content lookup like the build menu's have/need display, not a
 * rule (the server validates found_island).
 */
export function cargoCoversWarehouse(cargo: readonly CargoDisplay[], content: Content): boolean {
  const wh = content.buildings.find((b) => b.trading_post);
  if (!wh) return false;
  const aboard = cargoTotals(cargo);
  return Object.entries(wh.cost.materials).every(([good, need]) => (aboard[good] ?? 0) >= need);
}

/** Idle ships at an unsettled island whose cargo covers the warehouse's materials. */
export function foundingShips(model: DisplayState, content: Content, islandId: string): ShipDisplay[] {
  const is = model.islands.find((i) => i.id === islandId);
  if (!is || is.settled) return [];
  return model.ships.filter((s) => s.state === "idle" && s.island_id === islandId && cargoCoversWarehouse(s.cargo, content));
}
