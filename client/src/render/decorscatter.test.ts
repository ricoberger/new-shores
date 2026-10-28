import { describe, expect, it } from "vitest";
import { detailSite, scatterDetail } from "./decorscatter";

/** An island of w × h tiles of one terrain. */
function island(t: string, w = 24, h = 24) {
  return { width: w, height: h, terrain: Array<string>(w * h).fill(t), seed: 5, blocked: new Set<string>() };
}

describe("ground detail", () => {
  it("places per terrain role: forest floor, meadow, beach and rock items, nothing on water", () => {
    const kinds = (t: string) => new Set(scatterDetail(island(t)).map((p) => p.id.replace(/_[ab]$/, "")));
    expect([...kinds("forest")].sort()).toEqual(expect.arrayContaining(["decor_fern", "decor_mushroom", "decor_log"]));
    expect(kinds("grass").has("decor_flowers")).toBe(true);
    expect(kinds("grass").has("decor_fern")).toBe(false);
    expect([...kinds("coast")].sort()).toEqual(["decor_pebbles", "decor_reeds"]);
    expect([...kinds("mountain")]).toEqual(["decor_pebbles"]);
    expect(scatterDetail(island("water"))).toEqual([]);
    expect(detailSite("water")).toBeNull();
  });

  it("is stable per tile, stays inside its tile and off blocked tiles, and a rect places the same items", () => {
    const all = scatterDetail(island("forest"));
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) expect(p.x - Math.floor(p.x)).toBeGreaterThan(0.1);
    const blocked = island("forest");
    blocked.blocked.add("3,4");
    expect(scatterDetail(blocked).some((p) => Math.floor(p.x) === 3 && Math.floor(p.y) === 4)).toBe(false);
    const rect = scatterDetail({ ...island("forest"), rect: { x: 8, y: 8, width: 8, height: 8 } });
    expect(rect).toEqual(all.filter((p) => p.x >= 8 && p.x < 16 && p.y >= 8 && p.y < 16));
  });
});
