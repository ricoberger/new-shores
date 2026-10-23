import { describe, expect, it } from "vitest";
import { angleDelta, compassTurn, headingDegrees, headingName, pointerAngle } from "./compass";

describe("compass", () => {
  it("shows the camera's bearing: north-east by default, +90° per quarter turn", () => {
    expect(headingDegrees(0)).toBeCloseTo(45, 9);
    expect(headingDegrees(0.5)).toBeCloseTo(90, 9);
    expect(headingDegrees(3.5)).toBe(0);
    expect(headingDegrees(1.3)).toBeCloseTo(162, 9);
    expect(headingName(0)).toBe("north-east");
    expect(headingName(3.5)).toBe("north");
    expect(headingName(2)).toBe("south-west");
  });

  it("measures pointer angles clockwise from up and turns the camera so the needle follows", () => {
    const c = { x: 20, y: 20 };
    expect(pointerAngle(c, { x: 20, y: 0 })).toBeCloseTo(0, 9);
    expect(pointerAngle(c, { x: 40, y: 20 })).toBeCloseTo(Math.PI / 2, 9);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    // A quarter circle clockwise on the compass = a quarter turn = +90° bearing.
    const q = compassTurn(Math.PI / 2);
    expect(q).toBeCloseTo(1, 9);
    expect(headingDegrees(q)).toBeCloseTo(135, 9);
  });
});
