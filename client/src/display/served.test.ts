import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { servedRelated } from "./served";

const b = (id: number, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as unknown as BuildingDisplay;
const chapel = { service: { radius: 16 } } as unknown as ContentBuilding;
const producer = {} as unknown as ContentBuilding;

describe("servedRelated", () => {
  const houses = [b(1, { served_by: [10, 11] }), b(2, { served_by: [11] }), b(3, { residents: 2000 })];
  const all = [...houses, b(10), b(11), b(12)];

  it("lists the serving buildings of a house", () => {
    expect(servedRelated(houses[0]!, all, undefined)).toEqual([10, 11]);
    expect(servedRelated(houses[2]!, all, undefined)).toEqual([]);
  });
  it("lists the houses a service building serves", () => {
    expect(servedRelated(b(11), all, chapel)).toEqual([1, 2]);
    expect(servedRelated(b(10), all, chapel)).toEqual([1]);
    expect(servedRelated(b(12), all, chapel)).toEqual([]);
  });
  it("ignores other buildings", () => {
    expect(servedRelated(b(10), all, producer)).toEqual([]);
  });

  it("links a producer with the Warehouse or Trading Post it delivers to, in both directions", () => {
    const rates = { inputs: {}, outputs: {} };
    const fisher = b(20, { assigned_warehouse_id: 30, rates });
    const lumberjack = b(21, { assigned_warehouse_id: 30, rates });
    const other = b(22, { assigned_warehouse_id: 31, rates });
    const warehouse = b(30);
    const everything = [fisher, lumberjack, other, warehouse, b(31), ...all];
    expect(servedRelated(fisher, everything, producer)).toEqual([30]);
    expect(servedRelated(warehouse, everything, producer)).toEqual([20, 21]);
    expect(servedRelated(b(31), everything, producer)).toEqual([22]);
    expect(servedRelated(b(32), everything, producer)).toEqual([]);
    // 0 = not connected: nothing to show.
    expect(servedRelated(b(23, { assigned_warehouse_id: 0, rates }), everything, producer)).toEqual([]);
  });
});
