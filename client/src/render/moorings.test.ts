import { describe, expect, it } from "vitest";
import type { BuildingDisplay } from "../api/client";
import { withIdleAtPier } from "./moorings";

const tp = (ships: number[], queue: number[], total = 2): BuildingDisplay => ({ type: "trading_post", berths: { total, busy: ships.length, ships, queue } }) as unknown as BuildingDisplay;
const island = (id: string, ...buildings: BuildingDisplay[]) => ({ id, buildings });

describe("idle ships at the pier", () => {
  it("puts idle ships into the free berths, the rest at the end of the queue", () => {
    const out = withIdleAtPier([island("a", tp([1], [9]))], [
      { id: 1, state: "manual_leg", island_id: "a", leg: {} },
      { id: 4, state: "idle", island_id: "a" },
      { id: 3, state: "anchored_unpaid", island_id: "a" },
      { id: 9, state: "waiting_for_berth", island_id: "a" },
    ]);
    expect(out[0]!.buildings[0]!.berths).toEqual({ total: 2, busy: 1, ships: [1, 3], queue: [9, 4] });
  });

  it("leaves other islands, ships on legs and ships already listed alone", () => {
    const a = island("a", tp([5], []));
    const b = island("b", { type: "house" } as unknown as BuildingDisplay);
    const out = withIdleAtPier([a, b], [
      { id: 5, state: "idle", island_id: "a" },
      { id: 6, state: "on_route", island_id: "a", leg: {} },
      { id: 7, state: "idle", island_id: "b" },
    ]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});
