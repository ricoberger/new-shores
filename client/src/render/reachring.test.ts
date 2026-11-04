import { describe, expect, it } from "vitest";
import { ringBand } from "./reachring";

describe("reach ring band", () => {
  it("is a closed band: two vertices and two triangles per point, lifted above the ground", () => {
    const square = [
      { x: 0, z: 0, y: 1 },
      { x: 4, z: 0, y: 1 },
      { x: 4, z: 4, y: 2 },
      { x: 0, z: 4, y: 2 },
    ];
    const { positions, indices } = ringBand(square, 0.2);
    expect(positions).toHaveLength(4 * 2 * 3);
    expect(indices).toHaveLength(4 * 6);
    // The last segment wraps to the first point.
    expect(indices.slice(-6)).toEqual([6, 0, 7, 7, 0, 1]);
    for (let i = 1; i < positions.length; i += 3) expect(positions[i]).toBeGreaterThan(1);
    expect(ringBand(square.slice(0, 2)).positions).toHaveLength(0);
  });
});
