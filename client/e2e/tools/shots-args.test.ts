import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICES, DEFAULT_FIXTURES, DEFAULT_VIEWS, DEVICES, FIXTURES, PRESETS, parseList, parseShotArgs, ShotArgError, VIEWS } from "./shots-args";

describe("parseShotArgs", () => {
  it("defaults to the three fixtures, all views and desktop and phone", () => {
    expect(parseShotArgs({})).toEqual({
      fixtures: DEFAULT_FIXTURES,
      views: [...DEFAULT_VIEWS],
      devices: [...DEFAULT_DEVICES],
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
    const a = parseShotArgs({ FIXTURE: "settled, played,settled", VIEW: "far", DEVICE: "phone" });
    expect(a.fixtures).toEqual(["settled", "played"]);
    expect(a.views).toEqual(["far"]);
    expect(a.devices).toEqual(["phone"]);
    expect(parseShotArgs({ DEVICE: "desktop-xl" }).devices).toEqual(["desktop-xl"]);
  });

  it("expands all", () => {
    const a = parseShotArgs({ FIXTURE: "all", VIEW: "all", DEVICE: "all" });
    expect(a.fixtures).toEqual([...FIXTURES]);
    expect(a.views).toEqual([...VIEWS]);
    expect(a.devices).toEqual([...DEVICES]);
  });

  it("fails on an unknown value with the allowed list", () => {
    expect(() => parseShotArgs({ FIXTURE: "settled,nope" })).toThrow(/FIXTURE: unknown value 'nope'; allowed: default, seafaring, town, settled.*, all/);
    expect(() => parseShotArgs({ VIEW: "close" })).toThrow(/VIEW: unknown value 'close'; allowed: near, mid, far, start, pan, all/);
    expect(() => parseShotArgs({ DEVICE: "tablet" })).toThrow(ShotArgError);
    expect(() => parseShotArgs({ PRESET: "x" })).toThrow(/PRESET: unknown value 'x'; allowed: info-panel, producer-inputs, house-card, service-card, warehouse-card, trading-post-card, shipyard-idle, shipyard-building, served-houses, serving-buildings, sheet, ghost, ghost-water-valid, ghost-water-in, ghost-water-out, ghost-depot-valid, ghost-depot-out, ghost-terrace-3, ghost-terrace-3-invalid, ghost-terrace-6, ghost-terrace-6-invalid, sloop, build-menu, warnings, away, ship-panel, ship-rename, route-editor, route-rename, route-paused, island-card, top-bar-popups, farm-selected, hemp-farm-selected, field-selected, field-ghost, field-paint, field-paint-result, field-paint-pasture, archipelago-far, far-labels, reroll, rename, merchant-house-card, merchant-build-menu, patrician-house-card, patrician-build-menu, harbour, founding-ghost, founding-docked, playhouse-menu, all/);
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

  it("parses SEED (the dev server's archipelago, D-053) and rejects values outside 1..2^53-1", () => {
    expect(parseShotArgs({ SEED: "4711" }).seed).toBe(4711);
    expect(parseShotArgs({ SEED: "" }).seed).toBeUndefined();
    expect(parseShotArgs({ CONTENT: " .experiment/content " }).content).toBe(".experiment/content");
    expect(parseShotArgs({ CONTENT: "" }).content).toBeUndefined();
    for (const bad of ["0", "-1", "1.5", "x", "9007199254740992"]) expect(() => parseShotArgs({ SEED: bad })).toThrow(/SEED: '.*' is not an integer in 1\.\.9007199254740991/);
    expect(parseShotArgs({ SEED: "42", PRESET: "archipelago-far" }).seed).toBe(42);
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
    expect(parseShotArgs({ PRESET: "ghost-water-valid,ghost-water-in,ghost-water-out" }).presets).toEqual(["ghost-water-valid", "ghost-water-in", "ghost-water-out"]);
    expect(() => parseShotArgs({ PRESET: "sloop", FIXTURE: "settled", ZOOM: "5" })).toThrow(/remove FIXTURE, ZOOM/);
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

describe("FIXTURES", () => {
  it("are the dev server's fixtures (devworld.Fixtures), in its order", () => {
    const dir = join(__dirname, "..", "..", "..", "server", "internal", "devworld");
    const go = readFileSync(join(dir, "fixtures.go"), "utf8");
    // The names are constants: in fixtures.go (a block) and played.go.
    const consts = go + readFileSync(join(dir, "played.go"), "utf8");
    const values = new Map([...consts.matchAll(/^(?:const)?\s*(Fixture\w+)\s*=\s*"(\w+)"/gm)].map((m) => [m[1]!, m[2]!] as const));
    const list = /func Fixtures\(\) \[\]string \{\s*return \[\]string\{([^}]*)\}/.exec(go)?.[1];
    expect(list, "devworld.Fixtures not found").toBeDefined();
    const names = list!.split(",").map((n) => values.get(n.trim())!);
    expect(names).toEqual([...FIXTURES]);
  });

  it("the default set is a subset", () => {
    expect(DEFAULT_FIXTURES).toEqual(["settled", "patricians", "played"]);
    for (const f of DEFAULT_FIXTURES) expect(FIXTURES).toContain(f);
  });
});
