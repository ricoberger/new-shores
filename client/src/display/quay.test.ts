import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isQuayType, isShallow, offShallows, roadsOnWater, SHALLOWS_REACH } from "./quay";

// The shared fixture of the shallows rule (server/internal/sim/quay_test.go, TestShallowsFixture).
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "quay", "shallows.json"), "utf8")) as {
  reach: number;
  rows: string[];
  shallows: { x: number; y: number }[];
};
const CHARS: Record<string, string> = { "~": "water", c: "coast", ".": "grass", f: "forest", m: "mountain", r: "river", i: "islet", k: "cliff" };
const island = {
  width: fixture.rows[0]!.length,
  height: fixture.rows.length,
  terrain: fixture.rows.flatMap((r) => [...r].map((ch) => CHARS[ch]!)),
};

describe("shallows (D-060)", () => {
  it("mirrors the server rule on the shared fixture", () => {
    expect(SHALLOWS_REACH).toBe(fixture.reach);
    const got: { x: number; y: number }[] = [];
    for (let y = 0; y < island.height; y++) for (let x = 0; x < island.width; x++) if (isShallow(island, x, y)) got.push({ x, y });
    expect(got).toEqual(fixture.shallows);
  });

  it("lists the tiles of a drag that are not shallows", () => {
    expect(offShallows(island, [{ x: 10, y: 8 }, { x: 10, y: 5 }, { x: 10, y: 9 }, { x: -1, y: 8 }])).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 9 },
      { x: -1, y: 8 },
    ]);
  });

  it("tells quay road types and finds roads on water", () => {
    const defs = new Map([
      ["quay", { road: { shallows: true } }],
      ["road_dirt", { road: { shallows: false } }],
    ]);
    expect(isQuayType(defs, "quay")).toBe(true);
    expect(isQuayType(defs, "road_dirt")).toBe(false);
    expect(isQuayType(defs, "nope")).toBe(false);
    expect([...roadsOnWater(island, [{ x: 3, y: 8 }, { x: 3, y: 10 }])]).toEqual(["3,8"]);
  });
});
