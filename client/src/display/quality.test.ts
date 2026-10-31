import { describe, expect, it } from "vitest";
import { fxaaForced, qualityFor, qualityOverride, resolveQuality, softwareRenderer } from "./quality";

describe("render quality", () => {
  it("is high on the desktop layout and low on touch layouts", () => {
    expect(qualityFor("desktop")).toBe("high");
    expect(qualityFor("tablet")).toBe("low");
    expect(qualityFor("phone-portrait")).toBe("low");
    expect(qualityFor("phone-landscape")).toBe("low");
  });

  it("reads the ?quality override", () => {
    expect(qualityOverride("?quality=high")).toBe("high");
    expect(qualityOverride("?fixture=played&quality=low")).toBe("low");
    expect(qualityOverride("?quality=ultra")).toBeNull();
    expect(qualityOverride("")).toBeNull();
  });

  it("recognises software WebGL renderers", () => {
    expect(softwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(softwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(softwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)")).toBe(false);
    expect(softwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
  });

  it("reads the ?fxaa=1 toggle", () => {
    expect(fxaaForced("?fixture=played&quality=high&fxaa=1")).toBe(true);
    expect(fxaaForced("?fxaa=0")).toBe(false);
    expect(fxaaForced("")).toBe(false);
  });

  it("the override wins over the layout", () => {
    expect(resolveQuality("phone-portrait", "?quality=high")).toBe("high");
    expect(resolveQuality("desktop", "?quality=low")).toBe("low");
    expect(resolveQuality("desktop", "")).toBe("high");
    expect(resolveQuality("tablet", "?quality=bogus")).toBe("low");
  });
});
