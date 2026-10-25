import { describe, expect, it } from "vitest";
import { DEFAULT_FIXTURES, DEVICES, FIXTURES, PRESETS, parseList, parseShotArgs, ShotArgError, VIEWS } from "./shots-args";

describe("parseShotArgs", () => {
  it("defaults to the three fixtures, all views and both devices", () => {
    expect(parseShotArgs({})).toEqual({
      fixtures: DEFAULT_FIXTURES,
      views: [...VIEWS],
      devices: [...DEVICES],
      rotation: 0,
      out: ".experiment/shots/default",
      hud: true,
      presets: [],
    });
  });

  it("treats empty values as unset (make passes FIXTURE= through)", () => {
    expect(parseShotArgs({ FIXTURE: "", VIEW: " ", DEVICE: "", ROTATION: "", ZOOM: "", HUD: "" })).toEqual(parseShotArgs({}));
  });

  it("parses comma lists, drops duplicates and trims", () => {
    const a = parseShotArgs({ FIXTURE: "showcase, dense-2x400,showcase", VIEW: "far", DEVICE: "phone" });
    expect(a.fixtures).toEqual(["showcase", "dense-2x400"]);
    expect(a.views).toEqual(["far"]);
    expect(a.devices).toEqual(["phone"]);
  });

  it("expands all", () => {
    const a = parseShotArgs({ FIXTURE: "all", VIEW: "all", DEVICE: "all" });
    expect(a.fixtures).toEqual([...FIXTURES]);
    expect(a.views).toEqual([...VIEWS]);
    expect(a.devices).toEqual([...DEVICES]);
  });

  it("fails on an unknown value with the allowed list", () => {
    expect(() => parseShotArgs({ FIXTURE: "showcase,nope" })).toThrow(/FIXTURE: unknown value 'nope'; allowed: showcase, settled, dense-2x400.*, all/);
    expect(() => parseShotArgs({ VIEW: "close" })).toThrow(/VIEW: unknown value 'close'; allowed: near, mid, far, all/);
    expect(() => parseShotArgs({ DEVICE: "tablet" })).toThrow(ShotArgError);
    expect(() => parseShotArgs({ PRESET: "x" })).toThrow(/PRESET: unknown value 'x'; allowed: info-panel, sheet, ghost, sloop, build-menu, warnings, ship-panel, all/);
  });

  it("validates ROTATION, HUD and the numbers", () => {
    expect(parseShotArgs({ ROTATION: "3" }).rotation).toBe(3);
    expect(() => parseShotArgs({ ROTATION: "4" })).toThrow(/ROTATION/);
    expect(() => parseShotArgs({ ROTATION: "1.5" })).toThrow(/ROTATION/);
    expect(parseShotArgs({ HUD: "0" }).hud).toBe(false);
    expect(parseShotArgs({ HUD: "1" }).hud).toBe(true);
    expect(() => parseShotArgs({ HUD: "off" })).toThrow(/HUD/);
    expect(parseShotArgs({ ZOOM: "9.5" }).zoom).toBe(9.5);
    expect(() => parseShotArgs({ ZOOM: "0" })).toThrow(/ZOOM/);
    expect(() => parseShotArgs({ ZOOM: "wide" })).toThrow(/ZOOM/);
  });

  it("takes the camera target as a pair", () => {
    expect(parseShotArgs({ X: "22", Y: "-3.5" })).toMatchObject({ x: 22, y: -3.5 });
    expect(() => parseShotArgs({ X: "22" })).toThrow(/together/);
  });

  it("sets island and output directory", () => {
    expect(parseShotArgs({ ISLAND: "dense2", OUT: "/tmp/x" })).toMatchObject({ island: "dense2", out: "/tmp/x" });
    expect(parseShotArgs({ SET: "before" }).out).toBe(".experiment/shots/before");
  });

  it("PRESET selects presets only and rejects matrix parameters", () => {
    const a = parseShotArgs({ PRESET: "all" });
    expect(a.presets).toEqual([...PRESETS]);
    expect(a.out).toBe(".experiment/shots/presets");
    expect(parseShotArgs({ PRESET: "sloop,sheet" }).presets).toEqual(["sloop", "sheet"]);
    expect(() => parseShotArgs({ PRESET: "sloop", FIXTURE: "showcase", ZOOM: "5" })).toThrow(/remove FIXTURE, ZOOM/);
  });
});

describe("parseList", () => {
  it("returns a copy of the fallback", () => {
    const fb = ["a"] as const;
    const out = parseList("N", undefined, ["a", "b"] as const, fb);
    expect(out).toEqual(["a"]);
    expect(out).not.toBe(fb);
  });
});
