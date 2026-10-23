import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { buildBlocks } from "./blocks";
import { CANOPY_CELL, canopyBlobs } from "./canopy";

const defs = new Map<string, ContentBuilding>(
  (
    [
      ["house_settlers", 2, 2, "houses", {}],
      ["warehouse", 4, 3, "harbour", { warehouse: {} }],
      ["wheat_field", 1, 1, "production", { field: { type: "wheat_field" } }],
      ["road_dirt", 1, 1, "roads", {}],
    ] as const
  ).map(([id, w, h, category, extra]) => [id, { id, width: w, height: h, category, ...extra } as unknown as ContentBuilding]),
);

function b(id: number, type: string, x: number): BuildingDisplay {
  return { id, type, x, y: 2, rotation: 0, paused: false, paused_reason: "", status: "ok" } as BuildingDisplay;
}

describe("mid/far blocks", () => {
  it("draws buildings as boxes with a roof-coloured top, landmarks with a hip roof, fields flat and roads not at all", () => {
    const house = buildBlocks([b(1, "house_settlers", 0)], defs);
    // Top and four sides.
    expect(house.indices.length / 3).toBe(10);
    expect(Math.max(...house.positions.filter((_, i) => i % 3 === 1))).toBeGreaterThan(0.4);
    const wh = buildBlocks([b(2, "warehouse", 0)], defs);
    expect(wh.landmarks).toBe(1);
    expect(wh.indices.length / 3).toBe(14);
    const field = buildBlocks([b(3, "wheat_field", 0)], defs);
    expect(Math.max(...field.positions.filter((_, i) => i % 3 === 1))).toBeLessThan(0.1);
    expect(field.indices.length / 3).toBeGreaterThan(2);
    expect(buildBlocks([b(4, "road_dirt", 0)], defs).indices).toHaveLength(0);
  });
});

describe("forest canopies", () => {
  it("puts one blob per cell with at least two free forest tiles", () => {
    const width = 6;
    const height = 4;
    const terrain = Array.from({ length: width * height }, (_, i) => (i % width < 4 ? "forest" : "grass"));
    const blobs = canopyBlobs({ width, height, terrain }, new Set(), 7);
    expect(blobs).toHaveLength((4 / CANOPY_CELL) * (height / CANOPY_CELL));
    expect(canopyBlobs({ width, height, terrain }, new Set(), 7)).toEqual(blobs);
    for (const c of blobs) expect(c.x).toBeLessThan(4.3);
    // Footprints take their tiles: a cell left with one forest tile gets no blob.
    const blocked = new Set(["0,0", "1,0", "0,1"]);
    expect(canopyBlobs({ width, height, terrain }, blocked, 7)).toHaveLength(blobs.length - 1);
  });
});
