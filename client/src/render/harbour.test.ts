import { describe, expect, it } from "vitest";
import type { ContentBuilding, Island, IslandDisplay } from "../api/client";
import { islandBerths } from "./harbour";

describe("island berths", () => {
  // A 9 × 9 island: land with a lake at its centre and sea around the border.
  const n = 9;
  const terrain = Array.from({ length: n * n }, (_, i) => {
    const x = i % n;
    const y = Math.floor(i / n);
    return x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x === 4 && y === 4) ? "water" : "grass";
  });
  const statics = { width: n, height: n, terrain } as unknown as Island;
  const tp = { id: "tp", width: 2, height: 2, trading_post: {} } as unknown as ContentBuilding;
  const defs = new Map([["tp", tp]]);

  it("gives an unsettled island none: its founding ship stays where its leg ended, never on water inland (D-058)", () => {
    expect(islandBerths({ buildings: [] } as unknown as IslandDisplay, statics, defs)).toEqual([]);
  });

  it("puts a settled island's berths on the water nearest its Trading Post", () => {
    const berths = islandBerths({ buildings: [{ id: 1, type: "tp", x: 1, y: 1, rotation: 0 }] } as unknown as IslandDisplay, statics, defs);
    expect(berths.length).toBeGreaterThan(0);
    // The nearest berth is on the sea at the Trading Post's corner, not the lake at the centre.
    expect(berths[0]).not.toEqual({ x: 4, y: 4 });
    expect(Math.hypot(berths[0]!.x - 1.5, berths[0]!.y - 1.5)).toBeLessThan(2);
  });
});
