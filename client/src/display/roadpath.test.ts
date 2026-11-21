import { describe, expect, it } from "vitest";
import { tileKey } from "./geometry";
import { unlinkedWarehouseHint } from "./roadpath";

// A 2 × 2 Trading Post at (0, 0) and a 2 × 2 Warehouse ghost at (10, 0); roads along y = 2.
const defs = new Map([
  ["trading_post", { width: 2, height: 2, trading_post: {} }],
  ["warehouse", { width: 2, height: 2, warehouse: {} }],
  ["fisher", { width: 2, height: 2 }],
]);
const tp = [{ type: "trading_post", x: 0, y: 0, rotation: 0 as const }];
const road = (from: number, to: number) => new Set(Array.from({ length: to - from + 1 }, (_, i) => tileKey({ x: from + i, y: 2 })));

describe("unlinkedWarehouseHint (D-081)", () => {
  const wh = defs.get("warehouse")!;
  it("is false when a road joins the ghost to the Trading Post", () => {
    expect(unlinkedWarehouseHint(wh, road(0, 11), 10, 0, 0, tp, defs)).toBe(false);
  });
  it("is true on a road that does not reach the Trading Post", () => {
    const roads = new Set([...road(0, 4), ...road(6, 11)]);
    expect(unlinkedWarehouseHint(wh, roads, 10, 0, 0, tp, defs)).toBe(true);
  });
  it("is true without any road next to the ghost", () => {
    expect(unlinkedWarehouseHint(wh, road(0, 4), 10, 0, 0, tp, defs)).toBe(true);
  });
  it("is true on an island without a Trading Post", () => {
    expect(unlinkedWarehouseHint(wh, road(0, 11), 10, 0, 0, [], defs)).toBe(true);
  });
  it("is false for any other building", () => {
    expect(unlinkedWarehouseHint(defs.get("fisher")!, new Set(), 10, 0, 0, tp, defs)).toBe(false);
  });
});
