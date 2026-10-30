import { describe, expect, it } from "vitest";
import { percent, perMin, speedFactor, units } from "./format";

describe("format", () => {
  it("shows whole units, never raw milli values", () => {
    expect(units(500_000)).toBe("500");
    expect(units(499_999.6)).toBe("499");
    expect(units(0)).toBe("0");
  });

  it("shows rates per minute with one decimal", () => {
    expect(perMin(2000)).toBe("2.0");
    expect(perMin(-3250, true)).toBe("−3.3");
    expect(perMin(48_000, true)).toBe("+48.0");
    expect(perMin(0, true)).toBe("0.0");
    expect(perMin(-10, true)).toBe("0.0");
    expect(perMin(-1500)).toBe("-1.5");
  });

  it("shows permille as percent", () => {
    expect(percent(1400)).toBe("140 %");
  });
});

describe("speedFactor", () => {
  it("shows one decimal, two where the second is not zero (D-060 ship speeds)", () => {
    expect([1200, 1000, 850, 1400, 1050].map(speedFactor)).toEqual(["1.2", "1.0", "0.85", "1.4", "1.05"]);
  });
});
