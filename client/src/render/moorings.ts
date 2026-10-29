// Idle ships at a Trading Post's pier (visual only). The server's berths
// list the ships handling there and the queue; a ship that is idle at the
// island (after founding, after a route ended, anchored for unpaid upkeep)
// holds no berth, so the dock layout skipped it and it lay at a harbour
// berth with heading 0 — across the pier, behind the building. It now lies
// at a free pier berth like a moored ship, and waits in the queue's rows
// when the pier is full.

import type { BuildingDisplay, IslandDisplay } from "../api/client";

interface IdleShip {
  id: number;
  state?: string;
  island_id?: string;
  leg?: unknown;
}

/** States of a ship at an island without a leg that lies in the harbour. */
const HARBOUR_STATES = new Set(["idle", "anchored_unpaid"]);

/**
 * The islands with their Trading Posts' `berths` extended by the idle ships
 * of the island: free berths first (up to `total`), then the end of the
 * queue; ascending ship ID. Everything else is passed through unchanged.
 */
export function withIdleAtPier<I extends Pick<IslandDisplay, "id" | "buildings">>(islands: readonly I[], ships: readonly IdleShip[]): I[] {
  const idle = new Map<string, number[]>();
  for (const s of ships) {
    if (s.leg || !s.island_id || !HARBOUR_STATES.has(s.state ?? "idle")) continue;
    const list = idle.get(s.island_id);
    if (list) list.push(s.id);
    else idle.set(s.island_id, [s.id]);
  }
  if (idle.size === 0) return [...islands];
  return islands.map((is) => {
    const ids = idle.get(is.id);
    if (!ids) return is;
    let seen = false;
    let changed = false;
    const buildings = is.buildings.map((b): BuildingDisplay => {
      if (seen || !b.berths) return b;
      seen = true;
      const held = new Set([...b.berths.ships, ...b.berths.queue]);
      const free = ids.filter((id) => !held.has(id)).sort((x, y) => x - y);
      if (free.length === 0) return b;
      changed = true;
      const room = Math.max(0, b.berths.total - b.berths.ships.length);
      return { ...b, berths: { ...b.berths, ships: [...b.berths.ships, ...free.slice(0, room)], queue: [...b.berths.queue, ...free.slice(room)] } };
    });
    return changed ? { ...is, buildings } : is;
  });
}
