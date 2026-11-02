import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { percent, perMin, signedTons, speedFactor, tons, tonsPerMin, tonsRatio, units } from "./format";

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

  it("shows goods in tonnes: quantities, ratios and rates carry `t`, in both languages (gold and population stay bare)", () => {
    for (const language of ["en", "de"] as const) {
      setLanguage(language, false);
      const comma = language === "de" ? "," : ".";
      expect(tons(45_000)).toBe("45\u00a0t");
      expect(tonsRatio(120_000, 300_000)).toBe("120/300\u00a0t");
      expect(tonsPerMin(1500)).toBe(`1${comma}5\u00a0t/min`);
      expect(tonsPerMin(48_000, true)).toBe(`+48${comma}0\u00a0t/min`);
      expect(signedTons(-50_000)).toBe("−50\u00a0t");
      expect(units(45_000)).toBe("45");
    }
    setLanguage("en", false);
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
