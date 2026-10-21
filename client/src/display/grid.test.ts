import { describe, expect, it } from "vitest";
import { GRID_RADIUS, gridFade, gridOverlayVisible } from "./grid";

describe("grid overlay", () => {
  it("shows for placement tools only", () => {
    expect(gridOverlayVisible("build")).toBe(true);
    expect(gridOverlayVisible("road")).toBe(true);
    expect(gridOverlayVisible("field")).toBe(true);
    expect(gridOverlayVisible("move")).toBe(true);
    expect(gridOverlayVisible("found")).toBe(true);
    expect(gridOverlayVisible("none")).toBe(false);
    expect(gridOverlayVisible("demolish")).toBe(false);
  });

  it("fades out with the distance from the pointer", () => {
    expect(gridFade(0)).toBe(1);
    expect(gridFade(GRID_RADIUS * 0.3)).toBe(1);
    expect(gridFade(GRID_RADIUS)).toBe(0);
    expect(gridFade(GRID_RADIUS + 3)).toBe(0);
    expect(gridFade(GRID_RADIUS * 0.6)).toBeGreaterThan(gridFade(GRID_RADIUS * 0.8));
  });
});
