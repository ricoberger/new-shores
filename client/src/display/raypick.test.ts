import { describe, expect, it } from "vitest";
import { ELEVATION } from "./camera";
import { type PickBox, pickNearest, type Ray, rayBox } from "./raypick";

// A view ray of the default camera: looking down at ELEVATION (30°) along the iso heading (+x, +z in world space,
// i.e. towards smaller archipelago y), ending on the ground at (gx, 0, gz).
function viewRay(gx: number, gz: number): Ray {
  const d = { x: Math.cos(ELEVATION) * Math.SQRT1_2, y: -Math.sin(ELEVATION), z: Math.cos(ELEVATION) * Math.SQRT1_2 };
  const k = 100;
  return { origin: { x: gx - d.x * k, y: -d.y * k, z: gz - d.z * k }, dir: d };
}

/** A house: a 2 × 2 footprint at (x, z) with a 2.5-tile-high model. */
function house(id: number, x: number, z: number, height = 2.5): PickBox<number> {
  return { min: { x, y: 0, z }, max: { x: x + 2, y: height, z: z + 2 }, item: id };
}

describe("mesh-first picking (UI.md §3 Selection)", () => {
  it("meets a box on its entry parameter and misses beside it", () => {
    const ray: Ray = { origin: { x: 0, y: 10, z: 0.5 }, dir: { x: 0, y: -1, z: 0 } };
    expect(rayBox(ray, { x: -1, y: 0, z: 0 }, { x: 1, y: 2, z: 1 })).toBe(8);
    expect(rayBox(ray, { x: 2, y: 0, z: 0 }, { x: 3, y: 2, z: 1 })).toBeNull();
    // A box behind the origin is not hit.
    expect(rayBox({ ...ray, dir: { x: 0, y: 1, z: 0 } }, { x: -1, y: 0, z: 0 }, { x: 1, y: 2, z: 1 })).toBeNull();
    // The pad (a touch's tolerance) grows the box.
    expect(rayBox(ray, { x: 0.1, y: 0, z: 0 }, { x: 1, y: 2, z: 1 })).toBeNull();
    expect(rayBox(ray, { x: 0.1, y: 0, z: 0 }, { x: 1, y: 2, z: 1 }, 0.2)).toBeCloseTo(7.8);
  });

  it("a roof picks its own house, not the house behind it whose footprint holds the ray's ground point", () => {
    const front = house(1, 0, 0);
    const back = house(2, 2, 2);
    // Aim at the front house's roof ridge: the ray reaches the ground inside the back house's footprint.
    const off = (1.5 / Math.tan(ELEVATION)) * Math.SQRT1_2;
    const rayToRoof = viewRay(1 + off, 1 + off);
    const g = { x: rayToRoof.origin.x + rayToRoof.dir.x * (rayToRoof.origin.y / -rayToRoof.dir.y), z: rayToRoof.origin.z + rayToRoof.dir.z * (rayToRoof.origin.y / -rayToRoof.dir.y) };
    expect(g.x).toBeGreaterThan(2);
    expect(g.x).toBeLessThan(4);
    expect(pickNearest(rayToRoof, [back, front])).toBe(1);
    // The back house's own roof, above the front one, picks the back house.
    const top = (2.5 / Math.tan(ELEVATION)) * Math.SQRT1_2;
    expect(pickNearest(viewRay(3.5 + top, 3.5 + top), [front, back])).toBe(2);
    // Open ground: nothing (the ground tile decides).
    expect(pickNearest(viewRay(10, -5), [front, back])).toBeUndefined();
  });
});
