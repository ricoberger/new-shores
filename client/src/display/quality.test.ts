import { describe, expect, it } from "vitest";
import { qualityFor, qualityOverride, resolveQuality } from "./quality";

describe("render quality", () => {
  it("is high on the desktop layout and low on touch layouts", () => {
    expect(qualityFor("desktop")).toBe("high");
    expect(qualityFor("tablet")).toBe("low");
    expect(qualityFor("phone-portrait")).toBe("low");
    expect(qualityFor("phone-landscape")).toBe("low");
  });

  it("reads the ?quality override", () => {
    expect(qualityOverride("?quality=high")).toBe("high");
    expect(qualityOverride("?fixture=dense-2x400&quality=low")).toBe("low");
    expect(qualityOverride("?quality=ultra")).toBeNull();
    expect(qualityOverride("")).toBeNull();
  });

  it("the override wins over the layout", () => {
    expect(resolveQuality("phone-portrait", "?quality=high")).toBe("high");
    expect(resolveQuality("desktop", "?quality=low")).toBe("low");
    expect(resolveQuality("desktop", "")).toBe("high");
    expect(resolveQuality("tablet", "?quality=bogus")).toBe("low");
  });
});
