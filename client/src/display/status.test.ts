import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { statusText } from "./status";

const content = {
  region: { id: "r", name: "R", version: "v", rules: {} },
  tiers: [{ id: "settlers", name: "Settlers" }],
  goods: [
    { id: "wood", name: "Wood", type: "raw" },
    { id: "planks", name: "Planks", type: "construction" },
    { id: "fish", name: "Fish", type: "food" },
  ],
  buildings: [],
  needs: [],
} as unknown as Content;

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const bases = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => (JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as { base: DisplayState }).base);

describe("statusText", () => {
  it("renders a sentence for every building status in the fixtures", () => {
    const seen = new Set<string>();
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          const s = statusText(b, is, d, content);
          seen.add(s.key);
          expect(s.sentence).not.toMatch(/undefined|NaN/);
          if (s.key !== "ok") expect(s.fix).not.toBe("");
        }
      }
    }
    for (const key of ["ok", "paused_unpaid", "warehouse_full", "input_starved", "throttled", "low_efficiency", "not_connected"]) {
      expect(seen).toContain(key);
    }
  });

  it("suggests a road next to an unconnected building", () => {
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          if (b.status !== "not_connected") continue;
          const s = statusText(b, is, d, content);
          expect(s.sentence).toBe("No road to a warehouse");
          expect(s.fix).toBe("Build a road next to it that leads to a warehouse.");
          return;
        }
      }
    }
    throw new Error("no not_connected building in the fixtures");
  });

  it("names the starved inputs with their island rate", () => {
    for (const d of bases) {
      for (const is of d.islands) {
        for (const b of is.buildings) {
          if (b.status !== "input_starved") continue;
          const s = statusText(b, is, d, content);
          expect(s.sentence).toMatch(/^Missing: .+ \(-?\d+\.\d\/min\)/);
          return;
        }
      }
    }
    throw new Error("no input_starved building in the fixtures");
  });
});
