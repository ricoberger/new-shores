// Display aggregates of an island for the archipelago tooltip and island
// card (D-027): sums and ratios of server display numbers and lookups of
// static island data and content — no game rule.
import type { CargoDisplay, Content, DisplayState, Island, IslandDisplay, ShipDisplay } from "../api/client";
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

/**
 * The ship for "Found settlement here" on an unsettled island (D-051): an
 * idle ship whose cargo covers the Trading Post's materials — one already
 * at the island first, else the start ship at sea, else any other (lowest
 * ID). Null when the island is settled or no ship qualifies. A content
 * lookup; the server validates sail_ship and found_island.
 */
export function founderFor(model: DisplayState, content: Content, islandId: string): ShipDisplay | null {
  const is = model.islands.find((i) => i.id === islandId);
  if (!is || is.settled) return null;
  const able = model.ships.filter((s) => s.state === "idle" && cargoCoversWarehouse(s.cargo, content));
  return able.find((s) => s.island_id === islandId) ?? able.find((s) => s.position) ?? able[0] ?? null;
}

/**
 * A founding chained by the client (D-051, UI.md §1): the player chose the
 * Trading Post's site on an island the ship is not at; the client sent
 * sail_ship and sends found_island when the ship is idle there.
 */
export interface PendingFounding {
  shipId: number;
  islandId: string;
  x: number;
  y: number;
  rotation: number;
}

/**
 * What to do with a pending founding at a new payload: "found" when the
 * ship is idle at the island (send found_island), "wait" while it sails
 * there (or unloads), "drop" when the island got settled, the ship is gone
 * or it is heading elsewhere.
 */
export function pendingFoundingStep(p: PendingFounding, model: DisplayState): "found" | "wait" | "drop" {
  const is = model.islands.find((i) => i.id === p.islandId);
  const s = model.ships.find((x) => x.id === p.shipId);
  if (!is || is.settled || !s) return "drop";
  if (s.state === "idle" && s.island_id === p.islandId) return "found";
  if (s.leg && s.leg.to_island_id === p.islandId) return "wait";
  return "drop";
}
