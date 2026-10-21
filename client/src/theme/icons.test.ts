import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateIcons, roundPath, svgPaths } from "../../scripts/gen-hud-icons.mjs";
import { STATUS_STYLES, type StatusKey } from "../display/status";
import { categoryIcon, goodIcon, needIcon, statusIcon } from "./iconSet";
import { ICON_AUTHORS, ICON_PATHS } from "./icons";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const iconsDir = join(repo, "assets", "icons");
const manifest = JSON.parse(readFileSync(join(iconsDir, "icons.json"), "utf8")) as { icons: Record<string, { file: string; author: string }> };
const read = (f: string) => readFileSync(join(iconsDir, "game-icons", f));

describe("HUD icon generator", () => {
  it("the committed module is the output for assets/icons", () => {
    expect(readFileSync(join(here, "icons.ts"), "utf8")).toBe(generateIcons(manifest, read));
  });

  it("rejects a checksum mismatch, a missing fallback and bad keys", () => {
    const one = (icons: Record<string, unknown>) => ({ license: "CC BY 3.0", icons });
    const good = manifest.icons["good:_fallback"]!;
    const need = manifest.icons["need:_fallback"]!;
    expect(() => generateIcons(one({ "good:_fallback": { ...good, sha256: "0".repeat(64) }, "need:_fallback": need }), read)).toThrow(/checksum/);
    expect(() => generateIcons(one({ "good:_fallback": good }), read)).toThrow(/need:_fallback/);
    expect(() => generateIcons(one({ "Good:X": good, "good:_fallback": good, "need:_fallback": need }), read)).toThrow(/bad key/);
    expect(() => generateIcons({ icons: {} }, read)).toThrow(/license/);
  });

  it("extracts the icon path without the background and rounds coordinates", () => {
    const svg = '<svg viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M17.47 250.9C88.82-328.15.5.25z"/></svg>';
    expect(svgPaths(svg)).toBe("M17.47 250.9C88.82-328.15.5.25z");
    expect(roundPath("M17.47 250.9C88.82-328.15.5.25z")).toBe("M17.5 250.9C88.8-328.1 .5 .3z");
    expect(roundPath("M1 1a5 5 0 011 1z")).toBe("M1 1a5 5 0 011 1z");
  });
});

describe("HUD icon set", () => {
  const content = (file: string) => JSON.parse(readFileSync(join(repo, "content", "old_coast", file), "utf8")) as unknown;

  it("has an icon for every good, need and status of the content", () => {
    const goods = content("goods.json") as { id: string }[];
    expect(goods).toHaveLength(18);
    for (const g of goods) expect(ICON_PATHS[`good:${g.id}`], g.id).toBeTruthy();
    const needs = content("needs.json") as { category?: string; building?: string }[];
    for (const n of needs) expect(ICON_PATHS[n.category ? `need:${n.category}` : `need:${n.building}`], JSON.stringify(n)).toBeTruthy();
    for (const k of Object.keys(STATUS_STYLES) as StatusKey[]) expect(ICON_PATHS[`status:${k}`], k).toBeTruthy();
    for (const c of ["houses", "production", "public", "harbour", "roads", "other"]) expect(ICON_PATHS[`category:${c}`], c).toBeTruthy();
  });

  it("falls back to a generic icon for unknown content IDs", () => {
    expect(goodIcon("unobtainium")).toBe(ICON_PATHS["good:_fallback"]);
    expect(needIcon({ category: "luxury" })).toBe(ICON_PATHS["need:_fallback"]);
    expect(needIcon({ building: "opera" })).toBe(ICON_PATHS["need:_fallback"]);
    expect(needIcon({})).toBe(ICON_PATHS["need:_fallback"]);
    expect(categoryIcon("wonders")).toBe(ICON_PATHS["category:other"]);
    expect(goodIcon("fish")).toBe(ICON_PATHS["good:fish"]);
    expect(statusIcon("ok")).toBe(ICON_PATHS["status:ok"]);
  });

  it("credits every author of the manifest", () => {
    expect(ICON_AUTHORS).toEqual([...new Set(Object.values(manifest.icons).map((i) => i.author))].sort());
  });
});
